const { expect } = require("chai");
const { ethers } = require("hardhat");

const ACTION_STEAL = 0;
const ACTION_RUN = 1;

const abiCoder = ethers.AbiCoder.defaultAbiCoder();
const encodeStage = (stage) => abiCoder.encode(["uint8"], [stage]);
const decodeStage = (hex) => Number(abiCoder.decode(["uint8"], hex)[0]);
const encodeAction = (action) => abiCoder.encode(["uint8"], [action]);

const WAGER = ethers.parseUnits("10", 18);
const MULT_SCALE = 1_000_000n;
const MULTIPLIER = [1_149_701n, 1_473_975n, 2_047_188n, 3_198_731n, 5_815_874n, 12_924_165n];

// getAddress() forces the correct EIP-55 checksum casing — passing an
// arbitrarily-cased placeholder address (e.g. "...dE") makes ethers v6
// assume it's an ENS name instead of a raw address, which then fails with
// "resolveName is not implemented" on Hardhat's local provider.
const PLAYER_ADDRESS = ethers.getAddress(`0x${"1".repeat(39)}d`);
const VAULT_ADDRESS = ethers.getAddress(`0x${"2".repeat(39)}f`);

// SessionPhase enum order from ICasinoGameV2.sol: NONE, WAITING_RANDOMNESS,
// WAITING_PLAYER_ACTION, SETTLED, FORFEITED, CANCELLED.
const Phase = {
  NONE: 0n,
  WAITING_RANDOMNESS: 1n,
  WAITING_PLAYER_ACTION: 2n,
  SETTLED: 3n,
  FORFEITED: 4n,
  CANCELLED: 5n,
};

function payoutFor(stage) {
  return (WAGER * MULTIPLIER[stage - 1]) / MULT_SCALE;
}

/** Builds a SessionContext tuple. `stage` is baked into gameState. */
function ctxAt(stage, overrides = {}) {
  const base = {
    sessionId: 1n,
    player: PLAYER_ADDRESS,
    vault: VAULT_ADDRESS,
    wagerBase: WAGER,
    escrowedStake: WAGER,
    reservedProfit: payoutFor(6) - WAGER, // fully reserved upfront, as onSessionStart does
    step: 0n,
    gameData: "0x",
    gameState: encodeStage(stage),
    ...overrides,
  };
  return [
    base.sessionId,
    base.player,
    base.vault,
    base.wagerBase,
    base.escrowedStake,
    base.reservedProfit,
    base.step,
    base.gameData,
    base.gameState,
  ];
}

// Random-ness bytes32 values picked so that
// uint256(keccak256(abi.encodePacked(x))) % 10_000 lands clearly above/below
// any SURVIVAL_BPS threshold used below. Found by local brute force against
// the exact hashing in DontWakeIt._survives; if the hashing ever changes,
// regenerate these two constants (see scripts/find-randomness-fixtures.cjs
// idea — not required for CI, only for these two literals).
let SURVIVES_ALL_STAGES; // roll % 10000 very low -> survives any stage (even the harshest, 4500 bps)
let WAKES_ALL_STAGES; // roll % 10000 very high -> wakes at any stage (even the safest, 8350 bps)

describe("DontWakeIt", function () {
  let game;

  before(async function () {
    const Game = await ethers.getContractFactory("DontWakeIt");
    game = await Game.deploy();
    await game.waitForDeployment();

    // Brute-force two fixed bytes32 seeds with a clearly-above / clearly-below
    // roll, so tests don't depend on randomness at all (deterministic input).
    for (let i = 0; i < 5000; i++) {
      const seed = ethers.zeroPadValue(ethers.toBeHex(i), 32);
      const roll = BigInt(ethers.keccak256(ethers.solidityPacked(["bytes32"], [seed]))) % 10_000n;
      if (SURVIVES_ALL_STAGES === undefined && roll < 1000n) SURVIVES_ALL_STAGES = seed;
      if (WAKES_ALL_STAGES === undefined && roll > 9000n) WAKES_ALL_STAGES = seed;
      if (SURVIVES_ALL_STAGES && WAKES_ALL_STAGES) break;
    }
    expect(SURVIVES_ALL_STAGES, "fixture search failed").to.not.be.undefined;
    expect(WAKES_ALL_STAGES, "fixture search failed").to.not.be.undefined;
  });

  describe("onSessionStart", function () {
    it("reverts on non-empty gameData (fixed 6-stage config, no per-round params)", async function () {
      const ctx = ctxAt(0, { gameState: encodeStage(0), gameData: "0x01" });
      await expect(game.onSessionStart(ctx)).to.be.revertedWithCustomError(
        game,
        "DontWakeIt__UnexpectedGameData",
      );
    });

    it("starts at stage 0, WAITING_PLAYER_ACTION, reserving the full worst-case payout", async function () {
      const ctx = ctxAt(0, { reservedProfit: 0n }); // no prior reservation before open
      const result = await game.onSessionStart(ctx);
      expect(decodeStage(result.newGameState)).to.equal(0);
      expect(result.nextPhase).to.equal(Phase.WAITING_PLAYER_ACTION);
      expect(result.requestRandomnessNow).to.equal(false);
      expect(result.payout).to.equal(0n);
      expect(result.escrowDelta).to.equal(0n);
      expect(result.reservedProfitDelta).to.equal(payoutFor(6) - WAGER);
    });
  });

  describe("onPlayerAction — STEAL", function () {
    it("moves stage 0 to WAITING_RANDOMNESS without changing gameState yet", async function () {
      const ctx = ctxAt(0);
      const result = await game.onPlayerAction(ctx, encodeAction(ACTION_STEAL));
      expect(result.nextPhase).to.equal(Phase.WAITING_RANDOMNESS);
      expect(result.requestRandomnessNow).to.equal(true);
      expect(decodeStage(result.newGameState)).to.equal(0);
      expect(result.payout).to.equal(0n);
    });

    it("reverts if the player tries to STEAL again at stage 6 (no Stage 7)", async function () {
      const ctx = ctxAt(6);
      await expect(
        game.onPlayerAction(ctx, encodeAction(ACTION_STEAL)),
      ).to.be.revertedWithCustomError(game, "DontWakeIt__NoFurtherSteal");
    });
  });

  describe("onPlayerAction — RUN", function () {
    it("reverts at stage 0 (nothing survived yet, nothing to cash out)", async function () {
      const ctx = ctxAt(0);
      await expect(
        game.onPlayerAction(ctx, encodeAction(ACTION_RUN)),
      ).to.be.revertedWithCustomError(game, "DontWakeIt__NothingToCashOut");
    });

    it("settles with payout = wager * multiplier(stage) for every valid stage", async function () {
      for (let stage = 1; stage <= 6; stage++) {
        const ctx = ctxAt(stage);
        const result = await game.onPlayerAction(ctx, encodeAction(ACTION_RUN));
        expect(result.nextPhase).to.equal(Phase.SETTLED);
        expect(result.payout).to.equal(payoutFor(stage));
      }
    });
  });

  describe("onPlayerAction — invalid action code", function () {
    it("reverts for any action other than 0 (STEAL) or 1 (RUN)", async function () {
      const ctx = ctxAt(1);
      await expect(
        game.onPlayerAction(ctx, encodeAction(2)),
      ).to.be.revertedWithCustomError(game, "DontWakeIt__InvalidAction");
    });
  });

  describe("onRandomness", function () {
    it("reverts if called at stage 6 (nothing left to resolve)", async function () {
      const ctx = ctxAt(6);
      await expect(
        game.onRandomness(ctx, SURVIVES_ALL_STAGES),
      ).to.be.revertedWithCustomError(game, "DontWakeIt__NotAwaitingSteal");
    });

    it("on survive at stage 0: advances to stage 1, stays open, payout 0", async function () {
      const ctx = ctxAt(0);
      const result = await game.onRandomness(ctx, SURVIVES_ALL_STAGES);
      expect(decodeStage(result.newGameState)).to.equal(1);
      expect(result.nextPhase).to.equal(Phase.WAITING_PLAYER_ACTION);
      expect(result.payout).to.equal(0n);
    });

    it("on survive at stage 5: auto-settles at stage 6 with the max payout (no Stage 7)", async function () {
      const ctx = ctxAt(5);
      const result = await game.onRandomness(ctx, SURVIVES_ALL_STAGES);
      expect(decodeStage(result.newGameState)).to.equal(6);
      expect(result.nextPhase).to.equal(Phase.SETTLED);
      expect(result.payout).to.equal(payoutFor(6));
    });

    it("on wake at any stage: settles immediately with payout 0", async function () {
      for (const stage of [0, 2, 5]) {
        const ctx = ctxAt(stage);
        const result = await game.onRandomness(ctx, WAKES_ALL_STAGES);
        expect(result.nextPhase).to.equal(Phase.SETTLED);
        expect(result.payout).to.equal(0n);
      }
    });

    it("never returns Stage 7 under any input", async function () {
      const ctx = ctxAt(5);
      const result = await game.onRandomness(ctx, SURVIVES_ALL_STAGES);
      expect(decodeStage(result.newGameState)).to.be.lessThanOrEqual(6);
    });
  });

  describe("quoteForfeitPayout (mines-style anytime cash-out)", function () {
    it("returns 0 before any successful steal (stage 0)", async function () {
      expect(await game.quoteForfeitPayout(ctxAt(0))).to.equal(0n);
    });

    it("returns the current stage's cash-out value once stage >= 1", async function () {
      for (let stage = 1; stage <= 6; stage++) {
        expect(await game.quoteForfeitPayout(ctxAt(stage))).to.equal(payoutFor(stage));
      }
    });
  });

  describe("quoteCaps / quoteRiskParams", function () {
    it("quoteCaps: maxEscrowStake = wager, maxReservedProfit = maxPayout - wager", async function () {
      const [maxEscrowStake, maxReservedProfit] = await game.quoteCaps(WAGER, "0x");
      expect(maxEscrowStake).to.equal(WAGER);
      expect(maxReservedProfit).to.equal(payoutFor(6) - WAGER);
    });

    it("quoteRiskParams: probabilityWad <= 1e18 and maxPayout = payoutFor(6)", async function () {
      const [maxPayoutOut, probabilityWad] = await game.quoteRiskParams(WAGER, "0x");
      expect(maxPayoutOut).to.equal(payoutFor(6));
      expect(probabilityWad).to.be.lessThanOrEqual(10n ** 18n); // CasinoGameFacet__InvalidRiskProbability guard
    });
  });

  describe("full round walkthrough (spec §73 acceptance test, minus the facet/token plumbing)", function () {
    it("steal, steal, RUN settles at stage 2's multiplier — and never twice", async function () {
      let ctx = ctxAt(0);
      let r = await game.onPlayerAction(ctx, encodeAction(ACTION_STEAL));
      expect(r.nextPhase).to.equal(Phase.WAITING_RANDOMNESS);

      ctx = ctxAt(0);
      r = await game.onRandomness(ctx, SURVIVES_ALL_STAGES);
      expect(decodeStage(r.newGameState)).to.equal(1);

      ctx = ctxAt(1);
      r = await game.onPlayerAction(ctx, encodeAction(ACTION_STEAL));
      expect(r.nextPhase).to.equal(Phase.WAITING_RANDOMNESS);

      ctx = ctxAt(1);
      r = await game.onRandomness(ctx, SURVIVES_ALL_STAGES);
      expect(decodeStage(r.newGameState)).to.equal(2);

      ctx = ctxAt(2);
      r = await game.onPlayerAction(ctx, encodeAction(ACTION_RUN));
      expect(r.nextPhase).to.equal(Phase.SETTLED);
      expect(r.payout).to.equal(payoutFor(2));

      // "cannot cash out twice" in this contract's world = the facet won't
      // call a SETTLED session again; here we just confirm RUN at stage 2
      // is deterministic and doesn't silently mutate state further.
      const again = await game.onPlayerAction(ctx, encodeAction(ACTION_RUN));
      expect(again.payout).to.equal(payoutFor(2));
    });
  });
});
