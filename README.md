# DON'T WAKE IT

**Steal the treasure. Run before it wakes.**

A provably-fair "push your luck" casino game for [Chain Jam Vol. 1](https://jam.chain.wtf/).
A guardian sleeps over a pile of treasure. Every successful steal raises the
payout and wakes it a little more. Cash out and run, or risk one more steal.

## How it works

Six discrete risk stages. Each successful steal increases the gross cash-out
multiplier while the probability of surviving the next steal decreases. All
outcomes use Chain's provably-fair VRF — nothing is decided client-side.

| Stage | Survive this steal | Cash-out multiplier |
| ----- | ------------------: | -------------------: |
| 1     | 83.50%              | 1.149701x            |
| 2     | 78.00%              | 1.473975x            |
| 3     | 72.00%              | 2.047188x            |
| 4     | 64.00%              | 3.198731x            |
| 5     | 55.00%              | 5.815874x            |
| 6     | 45.00%              | 12.924165x (forced cash-out, no Stage 7) |

Theoretical RTP is **96.00% at every fixed cash-out stage** (target range for
Chain Jam is 93–98%). Verified two ways — see `npm run verify`:

- **Closed-form**: `multiplier(n) = 0.96 / cumulativeSurvival(n)`.
- **Monte Carlo**: 1,000,000 simulated rounds per fixed strategy, within
  sampling noise of the theoretical value.

Displayed multipliers are rounded for readability; on-chain settlement uses
the full-precision integer values in `contracts/GameMath.sol`.

## Architecture

This is a Chain.wtf casino game: a Solidity contract implementing
`ICasinoGameV2`, plus a static frontend that runs inside the host's sandboxed
iframe. **The frontend never touches a wallet** — the host signs every
transaction; the game only talks to it through the `@chain/casino-sdk`
bridge (vendored in `src/chain/sdk/`, since the package isn't published
publicly — see `docs/GETTING_STARTED.md` in the SDK).

```text
contracts/
  interfaces/ICasinoGameV2.sol  — vendored, canonical interface (do not edit)
  GameMath.sol                  — single source of truth for the paytable
  DontWakeIt.sol                — the game: state machine + settlement

src/
  chain/
    sdk/           — vendored bridge SDK (guest.ts, types.ts, bet-limits.ts)
    useCasinoHost.ts
  game/
    math.ts        — DISPLAY-ONLY mirror of GameMath.sol (see file header)
    session.ts      — session lookup + action encode/decode helpers
  App.tsx           — the whole game UI (greybox — art comes in Phase 4)

scripts/
  simulate-rtp.js    — closed-form + Monte Carlo RTP verification
  compile-check.cjs  — solc compile sanity check (no native binary needed)
```

### Game state machine

```text
onSessionStart        -> WAITING_PLAYER_ACTION, stage = 0
onPlayerAction(STEAL)  -> WAITING_RANDOMNESS      (only if stage < 6)
onRandomness            survive: stage++; stage==6 auto-settles (no Stage 7)
                         wake:    SETTLED, payout = 0
onPlayerAction(RUN)    -> SETTLED, payout = wager * multiplier(stage)   (needs stage >= 1)
```

`gameState` is `abi.encode(uint8 stage)` — the only state we need, since the
whole paytable is a pure function of `stage`. Escrow accounting reserves the
full worst-case payout once in `onSessionStart`
(`reservedProfitDelta = maxPayout - wager`); every later step returns zero
deltas, since that upfront reservation already covers any stage's payout
(see `docs/CONTRACT_CONSTRAINTS.md` and the local facet's `_finalizeSession`).

`quoteForfeitPayout` returns a real value (mines-style): the current stage's
cash-out is fully determined by already-revealed state, never by unresolved
randomness, so quoting it is safe.

## Setup

```bash
npm install
npm run verify   # compile check + RTP simulation + type-check
npm run dev      # http://localhost:5173 — will show "Connecting to Chain…"
                  # until pointed at through the official local simulator
```

To actually play a round you need the official local simulator (from the
Chain Casino SDK download), pointed at this dev server:

```text
# in the unzipped casino-sdk package:
npm install && npm start
# open http://localhost:3300?game=http://localhost:5173
# drop contracts/DontWakeIt.sol (with GameMath.sol + the interface) into
# simulator/contracts/ — it auto-deploys and registers on the local host.
```

## Testing

Two independent layers:

- **`npm run verify`** — solc compile check (pure JS compiler, no native
  binary needed) + RTP Monte Carlo + TypeScript type-check. Safe to run
  anywhere, no network access to `binaries.soliditylang.org` required.
- **`npm run test:contracts`** — real Hardhat unit tests
  (`test/GameMath.test.cjs`, `test/DontWakeIt.test.cjs`) that deploy the
  actual contracts and call every `ICasinoGameV2` handler directly (no
  facet/vault needed — they're plain `external view/pure` functions).
  Covers: stage-0/stage-6 boundaries, invalid action codes, the "no Stage 7"
  rule from every angle, `quoteForfeitPayout`, `quoteCaps`/`quoteRiskParams`,
  and a full steal→steal→RUN walkthrough.
  **Needs `npx hardhat compile`'s native solc download — this couldn't be
  executed in the sandbox that built this scaffold (network-restricted).
  Run it yourself after `npm install` and report back if anything fails.**

## Status

- [x] Paytable locked and verified (96.00% RTP, closed-form + Monte Carlo)
- [x] `ICasinoGameV2` implementation compiles clean (solc 0.8.30)
- [x] Greybox frontend: bet → STEAL/STEAL AGAIN/RUN → result → reveal
- [x] Hardhat unit tests written for `GameMath` + `DontWakeIt` boundaries —
      **not yet executed, needs to be run locally** (see Testing above)
- [ ] End-to-end test against the real local simulator (needs the full
      Node stack — run this yourself with the steps above, or share
      results back for review)
- [ ] Visual & sound production (Phase 4 — intentionally not started; see
      the project spec's roadmap, "functionality before beauty")
- [ ] Jam widget verification, standalone hosting, mobile QA

## Eligibility notes

- RTP declared (96%) matches the implementation (`GameMath.sol`) — verify this
  stays true after any paytable change (`npm run verify`).
- No `Math.random()` or client-side outcome logic — the contract is the only
  source of truth (see `src/game/math.ts` header).
- Jam widget script is in `index.html`.

## Demo mode (standalone playability)

`src/chain/useGameHost.ts` tries the real Chain host bridge first (2s
timeout). If nothing answers — i.e. the page was opened directly rather than
embedded by a host — it falls back to `src/chain/demoHost.ts`, a client-side
mirror of the same stage machine (fake balance, no wallet, no real
transactions), clearly labeled with an on-screen "DEMO MODE" badge. This
satisfies the jam's "runs standalone as a playable demo outside the
chain.wtf iframe" eligibility rule; the reference coinflip example does not
do this out of the box (its `useCasinoHost` hook comment says opening
outside the host "never resolves, which is expected").

The real game logic (`GameMath.sol` / `DontWakeIt.sol`) is only exercised
through the real host + local simulator + eventual chain.wtf integration —
demo mode never touches it.
