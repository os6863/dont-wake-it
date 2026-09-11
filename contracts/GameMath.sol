// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title GameMath
/// @notice Single source of truth for DON'T WAKE IT's paytable.
///         Do NOT duplicate these numbers anywhere else (contract, frontend, docs) —
///         everyone must read from here. Changing a value here changes the RTP;
///         see docs/RTP_MATH.md / the "math change procedure" before touching it.
///
/// @dev Solidity `constant` only supports value types and byte arrays, not fixed
///      arrays — so the paytable is stored as individually named constants and
///      read through survivalBpsAt(i) / multiplierAt(i) instead of array indexing.
library GameMath {
    uint8 internal constant STAGE_COUNT = 6;
    uint256 internal constant BPS_DENOM = 10_000;

    /// @dev Survival probability *for that single steal*, in basis points (1e4 = 100%).
    uint16 internal constant SURVIVAL_BPS_1 = 8350;
    uint16 internal constant SURVIVAL_BPS_2 = 7800;
    uint16 internal constant SURVIVAL_BPS_3 = 7200;
    uint16 internal constant SURVIVAL_BPS_4 = 6400;
    uint16 internal constant SURVIVAL_BPS_5 = 5500;
    uint16 internal constant SURVIVAL_BPS_6 = 4500;

    /// @dev Scale for internal (high-precision) multipliers. 1_000_000 == 1.000000x.
    uint256 internal constant MULT_SCALE = 1_000_000;

    /// @dev Gross cash-out multiplier if the player RUNs immediately after
    ///      successfully completing stage n. multiplier(n) = targetRTP / cumulativeSurvival(n).
    ///      targetRTP = 0.96 (96%).
    uint256 internal constant MULTIPLIER_1 = 1_149_701; // 1.149701x
    uint256 internal constant MULTIPLIER_2 = 1_473_975; // 1.473975x
    uint256 internal constant MULTIPLIER_3 = 2_047_188; // 2.047188x
    uint256 internal constant MULTIPLIER_4 = 3_198_731; // 3.198731x
    uint256 internal constant MULTIPLIER_5 = 5_815_874; // 5.815874x
    uint256 internal constant MULTIPLIER_6 = 12_924_165; // 12.924165x (final stage, forced cash-out)

    /// @notice Survival bps for the (i+1)-th steal, 0-indexed (i = 0..5).
    function survivalBpsAt(uint8 i) internal pure returns (uint16) {
        if (i == 0) return SURVIVAL_BPS_1;
        if (i == 1) return SURVIVAL_BPS_2;
        if (i == 2) return SURVIVAL_BPS_3;
        if (i == 3) return SURVIVAL_BPS_4;
        if (i == 4) return SURVIVAL_BPS_5;
        if (i == 5) return SURVIVAL_BPS_6;
        revert("GameMath: bad stage index");
    }

    /// @notice Multiplier for cashing out after completing `stage` steals (1-indexed, 1..6).
    function multiplierAt(uint8 stage) internal pure returns (uint256) {
        if (stage == 1) return MULTIPLIER_1;
        if (stage == 2) return MULTIPLIER_2;
        if (stage == 3) return MULTIPLIER_3;
        if (stage == 4) return MULTIPLIER_4;
        if (stage == 5) return MULTIPLIER_5;
        if (stage == 6) return MULTIPLIER_6;
        revert("GameMath: bad stage");
    }

    /// @notice Cumulative probability (WAD, 1e18 = 100%) of surviving all steals
    ///         from stage 1 through `stage` (1-indexed).
    function cumulativeSurvivalWad(uint8 stage) internal pure returns (uint256 p) {
        p = 1e18;
        for (uint8 i = 0; i < stage; i++) {
            p = (p * survivalBpsAt(i)) / BPS_DENOM;
        }
    }

    /// @notice Gross payout (in wager units) for cashing out after successfully
    ///         completing `stage` (1-indexed, 1..STAGE_COUNT) steals.
    function payoutFor(uint256 wagerBase, uint8 stage) internal pure returns (uint256) {
        require(stage >= 1 && stage <= STAGE_COUNT, "GameMath: bad stage");
        return (wagerBase * multiplierAt(stage)) / MULT_SCALE;
    }

    /// @notice Survival probability (bps) of the *next* steal attempt, given the
    ///         player currently sits at `currentStage` (0 = not started yet).
    function nextSurvivalBps(uint8 currentStage) internal pure returns (uint16) {
        require(currentStage < STAGE_COUNT, "GameMath: no next stage");
        return survivalBpsAt(currentStage);
    }

    function maxPayout(uint256 wagerBase) internal pure returns (uint256) {
        return payoutFor(wagerBase, STAGE_COUNT);
    }

    /// @notice Probability (WAD) of reaching/completing the final stage —
    ///         used for quoteRiskParams, matching the SDK's "full path" convention
    ///         (see mines: probability of the full-board cashout path).
    function maxPayoutProbabilityWad() internal pure returns (uint256) {
        return cumulativeSurvivalWad(STAGE_COUNT);
    }
}
