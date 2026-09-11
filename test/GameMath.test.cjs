const { expect } = require("chai");
const { ethers } = require("hardhat");

// Mirrors contracts/GameMath.sol constants exactly — used only to compute
// expected values in JS for cross-checking, never as the thing under test.
const SURVIVAL_BPS = [8350, 7800, 7200, 6400, 5500, 4500];
const MULT_SCALE = 1_000_000n;
const MULTIPLIER = [1_149_701n, 1_473_975n, 2_047_188n, 3_198_731n, 5_815_874n, 12_924_165n];

function cumulativeSurvivalWad(stage) {
  let p = 10n ** 18n;
  for (let i = 0; i < stage; i++) {
    p = (p * BigInt(SURVIVAL_BPS[i])) / 10_000n;
  }
  return p;
}

describe("GameMath", function () {
  let math;

  before(async function () {
    const Harness = await ethers.getContractFactory("GameMathHarness");
    math = await Harness.deploy();
    await math.waitForDeployment();
  });

  it("reports STAGE_COUNT = 6", async function () {
    expect(await math.stageCount()).to.equal(6);
  });

  describe("survivalBpsAt", function () {
    it("returns the correct bps for every valid stage index (0..5)", async function () {
      for (let i = 0; i < 6; i++) {
        expect(await math.survivalBpsAt(i)).to.equal(SURVIVAL_BPS[i]);
      }
    });

    it("reverts for an out-of-range index (6)", async function () {
      await expect(math.survivalBpsAt(6)).to.be.reverted;
    });
  });

  describe("multiplierAt", function () {
    it("returns the correct multiplier for every valid stage (1..6)", async function () {
      for (let stage = 1; stage <= 6; stage++) {
        expect(await math.multiplierAt(stage)).to.equal(MULTIPLIER[stage - 1]);
      }
    });

    it("reverts for stage 0 (never a valid cash-out point)", async function () {
      await expect(math.multiplierAt(0)).to.be.reverted;
    });

    it("reverts for stage 7 (Stage 7 must never exist — spec rule #8)", async function () {
      await expect(math.multiplierAt(7)).to.be.reverted;
    });
  });

  describe("payoutFor", function () {
    const wager = ethers.parseUnits("10", 18);

    it("matches wager * multiplier / 1e6 for every valid stage", async function () {
      for (let stage = 1; stage <= 6; stage++) {
        const expected = (wager * MULTIPLIER[stage - 1]) / MULT_SCALE;
        expect(await math.payoutFor(wager, stage)).to.equal(expected);
      }
    });

    it("reverts for stage 0", async function () {
      await expect(math.payoutFor(wager, 0)).to.be.reverted;
    });

    it("reverts for stage 7", async function () {
      await expect(math.payoutFor(wager, 7)).to.be.reverted;
    });

    it("handles a zero wager without reverting (payout = 0)", async function () {
      expect(await math.payoutFor(0, 3)).to.equal(0);
    });
  });

  describe("cumulativeSurvivalWad", function () {
    it("is 1e18 (100%) at stage 0 (nothing survived yet, nothing to lose)", async function () {
      expect(await math.cumulativeSurvivalWad(0)).to.equal(10n ** 18n);
    });

    it("matches the product of all six survival bps at stage 6", async function () {
      expect(await math.cumulativeSurvivalWad(6)).to.equal(cumulativeSurvivalWad(6));
    });

    it("is strictly decreasing as stage increases (monotonic risk)", async function () {
      let prev = await math.cumulativeSurvivalWad(0);
      for (let stage = 1; stage <= 6; stage++) {
        const cur = await math.cumulativeSurvivalWad(stage);
        expect(cur).to.be.lessThan(prev);
        prev = cur;
      }
    });
  });

  describe("nextSurvivalBps", function () {
    it("returns stage-1's bps when currentStage = 0", async function () {
      expect(await math.nextSurvivalBps(0)).to.equal(SURVIVAL_BPS[0]);
    });

    it("returns stage-6's bps when currentStage = 5", async function () {
      expect(await math.nextSurvivalBps(5)).to.equal(SURVIVAL_BPS[5]);
    });

    it("reverts when currentStage = 6 (no next stage — Stage 7 forbidden)", async function () {
      await expect(math.nextSurvivalBps(6)).to.be.reverted;
    });
  });

  describe("RTP invariant (spec: every fixed cash-out stage must be 93-98%, target 96%)", function () {
    it("holds for all six stages within 1 basis point of 96.00%", async function () {
      for (let stage = 1; stage <= 6; stage++) {
        const cum = await math.cumulativeSurvivalWad(stage);
        const mult = await math.multiplierAt(stage);
        // rtp = cum/1e18 * mult/1e6, scaled to bps (1e4) for an integer comparison
        const rtpBps = (cum * mult * 10_000n) / (10n ** 18n * MULT_SCALE);
        expect(rtpBps).to.be.closeTo(9600n, 1n);
      }
    });
  });

  describe("maxPayout / maxPayoutProbabilityWad", function () {
    it("maxPayout(wager) equals payoutFor(wager, 6)", async function () {
      const wager = ethers.parseUnits("25", 18);
      expect(await math.maxPayout(wager)).to.equal(await math.payoutFor(wager, 6));
    });

    it("maxPayoutProbabilityWad equals cumulativeSurvivalWad(6)", async function () {
      expect(await math.maxPayoutProbabilityWad()).to.equal(await math.cumulativeSurvivalWad(6));
    });
  });
});
