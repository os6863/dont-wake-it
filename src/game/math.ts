/**
 * DISPLAY-ONLY mirror of contracts/GameMath.sol.
 *
 * This file exists so the UI can render "current multiplier" / "next stage
 * odds" instantly, without waiting on a chain read. It must NEVER be used to
 * compute an actual settlement value that gets shown as final/authoritative —
 * the contract + facet are the only source of truth for real payouts
 * (see spec §59 CLIENT/SERVER/CONTRACT TRUST BOUNDARY).
 *
 * If you change a number here without changing contracts/GameMath.sol and
 * scripts/simulate-rtp.js in lockstep, the UI will show numbers that don't
 * match what actually settles on-chain. Don't do that.
 */

export const STAGE_COUNT = 6;

export const SURVIVAL_BPS: readonly number[] = [8350, 7800, 7200, 6400, 5500, 4500];

const MULT_SCALE = 1_000_000;

export const MULTIPLIER: readonly number[] = [
  1_149_701, 1_473_975, 2_047_188, 3_198_731, 5_815_874, 12_924_165,
].map((m) => m / MULT_SCALE);

export function cumulativeSurvival(stage: number): number {
  let p = 1;
  for (let i = 0; i < stage; i++) p *= SURVIVAL_BPS[i] / 10_000;
  return p;
}

export function displayMultiplier(stage: number): string {
  if (stage < 1 || stage > STAGE_COUNT) return "1.00x";
  return `${MULTIPLIER[stage - 1].toFixed(2)}x`;
}

export function nextStageSurvivalPct(currentStage: number): number {
  if (currentStage >= STAGE_COUNT) return 0;
  return SURVIVAL_BPS[currentStage] / 100;
}

export const STAGE_COPY = [
  { label: "Stage 1", creature: "Deep asleep", feeling: "Safe / curious" },
  { label: "Stage 2", creature: "Ear/finger moves", feeling: "Slight tension" },
  { label: "Stage 3", creature: "Breathing changes", feeling: "Suspicion" },
  { label: "Stage 4", creature: "Eye twitches", feeling: "Danger" },
  { label: "Stage 5", creature: "Eye partially opens", feeling: "Very dangerous" },
  { label: "Stage 6", creature: "Almost awake", feeling: "Maximum greed" },
] as const;
