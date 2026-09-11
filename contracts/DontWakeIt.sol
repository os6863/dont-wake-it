// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {
    ICasinoGameV2,
    SessionContext,
    SessionPhase,
    StepResult
} from "./interfaces/ICasinoGameV2.sol";
import { GameMath } from "./GameMath.sol";

/// @title DontWakeIt
/// @notice "Steal from a sleeping guardian, then decide: STEAL AGAIN or RUN."
///         Multi-action game, mines-style. gameState = abi.encode(uint8 stage),
///         where stage counts *successful* steals completed so far (0..6).
///
/// Lifecycle (mirrors the SDK's documented mines pattern):
///   onSessionStart      -> WAITING_PLAYER_ACTION, stage = 0
///   onPlayerAction(STEAL)-> WAITING_RANDOMNESS   (stage unchanged; resolved below)
///   onRandomness         -> survive: stage++ ; stage==6 auto-settles (no Stage 7)
///                           wake:    SETTLED, payout = 0
///   onPlayerAction(RUN)  -> SETTLED, payout = GameMath.payoutFor(wager, stage)
///
/// All escrow accounting follows the documented convention: the full worst-case
/// payout is reserved once in onSessionStart (reservedProfitDelta = maxPayout - wager);
/// every later step returns 0 deltas because that upfront reservation already
/// covers any stage's payout (see docs/CONTRACT_CONSTRAINTS.md + local facet source).
contract DontWakeIt is ICasinoGameV2 {
    uint8 internal constant ACTION_STEAL = 0;
    uint8 internal constant ACTION_RUN = 1;

    error DontWakeIt__UnexpectedGameData();
    error DontWakeIt__NoFurtherSteal();
    error DontWakeIt__NothingToCashOut();
    error DontWakeIt__InvalidAction();
    error DontWakeIt__NotAwaitingSteal();

    /// @inheritdoc ICasinoGameV2
    function quoteCaps(
        uint256 wager,
        bytes calldata /* gameData */
    ) external pure returns (uint256 maxEscrowStake, uint256 maxReservedProfit) {
        maxEscrowStake = wager;
        uint256 maxP = GameMath.maxPayout(wager);
        maxReservedProfit = maxP > wager ? maxP - wager : 0;
    }

    /// @inheritdoc ICasinoGameV2
    function quoteRiskParams(
        uint256 wager,
        bytes calldata /* gameData */
    )
        external
        pure
        returns (
            uint256 maxPayoutOut,
            uint256 probabilityWad,
            uint256 expectedPayout,
            uint256 subJackpotVarianceScaled
        )
    {
        maxPayoutOut = GameMath.maxPayout(wager);
        // Convention shared with the SDK's Mines example: probability of the
        // single "full path" outcome (here: surviving all 6 steals) rather than
        // the compound probability across every possible cash-out point.
        probabilityWad = GameMath.maxPayoutProbabilityWad();
        expectedPayout = (maxPayoutOut * probabilityWad) / 1e18;
        subJackpotVarianceScaled = 0;
    }

    /// @inheritdoc ICasinoGameV2
    function onSessionStart(
        SessionContext calldata ctx
    ) external pure returns (StepResult memory stepResult) {
        if (ctx.gameData.length != 0) revert DontWakeIt__UnexpectedGameData();

        uint256 maxP = GameMath.maxPayout(ctx.wagerBase);
        uint256 maxReservedProfit = maxP > ctx.wagerBase ? maxP - ctx.wagerBase : 0;

        stepResult.newGameState = abi.encode(uint8(0));
        stepResult.escrowDelta = 0;
        stepResult.reservedProfitDelta = int256(maxReservedProfit);
        stepResult.nextPhase = SessionPhase.WAITING_PLAYER_ACTION;
        stepResult.requestRandomnessNow = false;
        stepResult.payout = 0;
    }

    /// @inheritdoc ICasinoGameV2
    function onPlayerAction(
        SessionContext calldata ctx,
        bytes calldata actionData
    ) external pure returns (StepResult memory stepResult) {
        uint8 stage = abi.decode(ctx.gameState, (uint8));
        uint8 action = abi.decode(actionData, (uint8));

        stepResult.escrowDelta = 0;
        stepResult.reservedProfitDelta = 0;

        if (action == ACTION_STEAL) {
            if (stage >= GameMath.STAGE_COUNT) revert DontWakeIt__NoFurtherSteal();
            stepResult.newGameState = ctx.gameState; // unchanged until onRandomness resolves it
            stepResult.nextPhase = SessionPhase.WAITING_RANDOMNESS;
            stepResult.requestRandomnessNow = true;
            stepResult.payout = 0;
        } else if (action == ACTION_RUN) {
            if (stage < 1) revert DontWakeIt__NothingToCashOut();
            stepResult.newGameState = ctx.gameState;
            stepResult.nextPhase = SessionPhase.SETTLED;
            stepResult.requestRandomnessNow = false;
            stepResult.payout = GameMath.payoutFor(ctx.wagerBase, stage);
        } else {
            revert DontWakeIt__InvalidAction();
        }
    }

    /// @inheritdoc ICasinoGameV2
    function onRandomness(
        SessionContext calldata ctx,
        bytes32 randomness
    ) external pure returns (StepResult memory stepResult) {
        uint8 stage = abi.decode(ctx.gameState, (uint8));
        if (stage >= GameMath.STAGE_COUNT) revert DontWakeIt__NotAwaitingSteal();

        uint16 survivalBps = GameMath.nextSurvivalBps(stage);
        bool survived = _survives(randomness, survivalBps);

        stepResult.escrowDelta = 0;
        stepResult.reservedProfitDelta = 0;
        stepResult.requestRandomnessNow = false;

        if (!survived) {
            // The guardian wakes. Entire round is lost.
            stepResult.newGameState = ctx.gameState;
            stepResult.nextPhase = SessionPhase.SETTLED;
            stepResult.payout = 0;
            return stepResult;
        }

        uint8 newStage = stage + 1;
        stepResult.newGameState = abi.encode(newStage);

        if (newStage == GameMath.STAGE_COUNT) {
            // Stage 6 reached: no Stage 7. Forced auto cash-out ("RUN WITH THE LOOT").
            stepResult.nextPhase = SessionPhase.SETTLED;
            stepResult.payout = GameMath.payoutFor(ctx.wagerBase, newStage);
        } else {
            stepResult.nextPhase = SessionPhase.WAITING_PLAYER_ACTION;
            stepResult.payout = 0;
        }
    }

    /// @inheritdoc ICasinoGameV2
    /// @dev Mines-style anytime cash-out: value is fully determined by already-revealed
    ///      state (the completed-stage count), never by unresolved randomness or hidden
    ///      state, so a real quote here is safe (see CONTRACT_CONSTRAINTS.md).
    function quoteForfeitPayout(
        SessionContext calldata ctx
    ) external pure returns (uint256 cashoutValue) {
        uint8 stage = abi.decode(ctx.gameState, (uint8));
        if (stage < 1) return 0;
        return GameMath.payoutFor(ctx.wagerBase, stage);
    }

    /// @dev Unbiased-enough survive/wake check: a keccak-derived bytes32 has 2**256
    ///      possible values against a modulus of 10_000, so the modulo bias
    ///      (bounded by modulus / 2**256) is astronomically smaller than the
    ///      d6 case the SDK docs specifically warn about (6 barely divides 256).
    function _survives(bytes32 randomness, uint16 survivalBps) internal pure returns (bool) {
        uint256 roll = uint256(keccak256(abi.encodePacked(randomness))) % GameMath.BPS_DENOM;
        return roll < survivalBps;
    }
}
