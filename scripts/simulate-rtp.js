#!/usr/bin/env node
// Monte Carlo + closed-form verification of DON'T WAKE IT's paytable.
// Mirrors contracts/GameMath.sol exactly. Run: node scripts/simulate-rtp.js

const SURVIVAL_BPS = [8350, 7800, 7200, 6400, 5500, 4500];
const MULT_SCALE = 1_000_000;
const MULTIPLIER = [1_149_701, 1_473_975, 2_047_188, 3_198_731, 5_815_874, 12_924_165];
const STAGE_COUNT = 6;
const BPS_DENOM = 10_000;

function cumulativeSurvival(stage) {
  let p = 1;
  for (let i = 0; i < stage; i++) p *= SURVIVAL_BPS[i] / BPS_DENOM;
  return p;
}

console.log("=== Closed-form check (target RTP = 0.96, range 0.93-0.98) ===");
let allInRange = true;
for (let stage = 1; stage <= STAGE_COUNT; stage++) {
  const cum = cumulativeSurvival(stage);
  const mult = MULTIPLIER[stage - 1] / MULT_SCALE;
  const rtp = cum * mult;
  const inRange = rtp >= 0.93 && rtp <= 0.98;
  allInRange = allInRange && inRange;
  console.log(
    `stage ${stage}: cumSurvival=${(cum * 100).toFixed(4)}%  mult=${mult.toFixed(6)}x  ` +
      `RTP-if-everyone-cashes-here=${(rtp * 100).toFixed(4)}%  ${inRange ? "OK" : "*** OUT OF RANGE ***"}`
  );
}
console.log(allInRange ? "\n✅ Every fixed cash-out stage is within 93-98% RTP.\n" : "\n❌ FAILED range check.\n");

// --- Monte Carlo: simulate a fixed "always push to stage N" strategy for each N,
// and also a naive "always push to stage 6" as the worst-case-probability check
// used for quoteRiskParams.
function simulateFixedStrategy(targetStage, rounds) {
  let totalWager = 0;
  let totalPayout = 0;
  for (let r = 0; r < rounds; r++) {
    totalWager += 1;
    let stage = 0;
    let alive = true;
    while (stage < targetStage && alive) {
      const roll = Math.random() * BPS_DENOM;
      if (roll < SURVIVAL_BPS[stage]) {
        stage++;
      } else {
        alive = false;
      }
    }
    if (alive) {
      totalPayout += MULTIPLIER[stage - 1] / MULT_SCALE;
    }
  }
  return totalPayout / totalWager;
}

console.log("=== Monte Carlo (1,000,000 rounds per fixed strategy) ===");
const ROUNDS = 1_000_000;
let mcAllInRange = true;
for (let stage = 1; stage <= STAGE_COUNT; stage++) {
  const simRtp = simulateFixedStrategy(stage, ROUNDS);
  const theoRtp = cumulativeSurvival(stage) * (MULTIPLIER[stage - 1] / MULT_SCALE);
  const diff = Math.abs(simRtp - theoRtp);
  const ok = diff < 0.01; // within 1pp is expected sampling noise at 1M rounds
  mcAllInRange = mcAllInRange && ok;
  console.log(
    `push-to-stage-${stage}: simulated RTP=${(simRtp * 100).toFixed(3)}%  ` +
      `theoretical=${(theoRtp * 100).toFixed(3)}%  diff=${(diff * 100).toFixed(3)}pp  ${ok ? "OK" : "*** MISMATCH ***"}`
  );
}
console.log(mcAllInRange ? "\n✅ Monte Carlo confirms theoretical RTP within sampling noise.\n" : "\n❌ Monte Carlo mismatch — investigate.\n");

console.log(`Stage-6 (max payout) probability: ${(cumulativeSurvival(6) * 100).toFixed(6)}% ` +
  `-> used as quoteRiskParams.probabilityWad`);

if (!allInRange || !mcAllInRange) process.exit(1);
