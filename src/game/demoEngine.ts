/**
 * DEMO-ONLY client-side mirror of contracts/DontWakeIt.sol + GameMath.sol.
 *
 * This exists solely so the standalone URL (opened outside the chain.wtf
 * iframe, e.g. a judge clicking the raw Vercel link) is actually playable —
 * the jam's own eligibility rule requires it, but the SDK's bridge protocol
 * has no host to talk to in that context (see useGameHost.ts).
 *
 * Nothing here is real money, a real wallet, or Chain's VRF. It is used
 * ONLY as a fallback when the real host handshake times out. The instant a
 * real host answers, this is never touched — see useGameHost.ts.
 *
 * The stage/survival/multiplier numbers are kept in lockstep with
 * contracts/GameMath.sol on purpose (same literals as scripts/simulate-rtp.js).
 * If you change the paytable, change it in both places.
 */

export const STAGE_COUNT = 6;
const SURVIVAL_BPS = [8350, 7800, 7200, 6400, 5500, 4500];
const MULT_SCALE = 1_000_000n;
const MULTIPLIER = [
  1_149_701n,
  1_473_975n,
  2_047_188n,
  3_198_731n,
  5_815_874n,
  12_924_165n,
];

export function demoPayoutFor(wager: bigint, stage: number): bigint {
  if (stage < 1 || stage > STAGE_COUNT) return 0n;
  return (wager * MULTIPLIER[stage - 1]) / MULT_SCALE;
}

/** Cryptographically random (not Chain VRF, but not Math.random either — no reason to be sloppy even in a demo). */
function secureRoll(): number {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] % 10_000;
}

export function demoSurvives(stage: number): boolean {
  return secureRoll() < SURVIVAL_BPS[stage];
}
