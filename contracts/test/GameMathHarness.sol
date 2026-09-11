// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import { GameMath } from "../GameMath.sol";

/// @title GameMathHarness
/// @notice TEST-ONLY. GameMath's functions are `internal` (inlined, no
///         linking needed by the real game contract) so they can't be called
///         directly from test transactions — this harness just re-exposes
///         them as `external` for unit testing. Never deploy/reference this
///         in production wiring.
contract GameMathHarness {
    function stageCount() external pure returns (uint8) {
        return GameMath.STAGE_COUNT;
    }

    function survivalBpsAt(uint8 i) external pure returns (uint16) {
        return GameMath.survivalBpsAt(i);
    }

    function multiplierAt(uint8 stage) external pure returns (uint256) {
        return GameMath.multiplierAt(stage);
    }

    function cumulativeSurvivalWad(uint8 stage) external pure returns (uint256) {
        return GameMath.cumulativeSurvivalWad(stage);
    }

    function payoutFor(uint256 wagerBase, uint8 stage) external pure returns (uint256) {
        return GameMath.payoutFor(wagerBase, stage);
    }

    function nextSurvivalBps(uint8 currentStage) external pure returns (uint16) {
        return GameMath.nextSurvivalBps(currentStage);
    }

    function maxPayout(uint256 wagerBase) external pure returns (uint256) {
        return GameMath.maxPayout(wagerBase);
    }

    function maxPayoutProbabilityWad() external pure returns (uint256) {
        return GameMath.maxPayoutProbabilityWad();
    }
}
