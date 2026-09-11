import type { HostApiV1, HostSnapshotV1, HexString } from "./sdk/types";
import { decodeAbiParameters } from "viem";
import { demoPayoutFor, demoSurvives, STAGE_COUNT } from "../game/demoEngine";

const DEMO_STARTING_BALANCE = 1_000_000n * 10n ** 18n;
const DEMO_TOKEN_DECIMALS = 18;

type DemoSessionRow = HostSnapshotV1["sessions"]["items"][number];

/**
 * Fake host used only when no real chain.wtf host answers the handshake
 * (see useGameHost.ts). Reproduces just enough of HostApiV1/HostSnapshotV1
 * for the UI to run through a full round. Never touches a wallet, a
 * contract, or real funds — every session here is clearly a simulation.
 */
export function createDemoHost(onSnapshot: (snapshot: HostSnapshotV1) => void) {
  let balance = DEMO_STARTING_BALANCE;
  let sessions: DemoSessionRow[] = [];
  let nextSessionId = 1;

  const emit = () => {
    onSnapshot({
      apiVersion: 1,
      integration: {
        chainId: 0,
        slug: "demo",
        gameAddress: "0x0000000000000000000000000000000000dEad",
        manifest: {
          schemaVersion: 1,
          gameId: "DontWakeItGame",
          apiVersion: 1,
          defaultLocale: "en",
          locales: { en: { name: "Don't Wake It (Demo)" } },
        },
      },
      wallet: { status: "ready" },
      token: { symbol: "DEMO", decimals: DEMO_TOKEN_DECIMALS },
      balances: { smartVaultBalance: balance.toString() },
      sessions: { items: sessions },
      ui: { locale: "en", theme: "dark" },
    });
  };

  const hostApi: HostApiV1 = {
    async openSession({ wager }) {
      const wagerBig = BigInt(wager);
      if (wagerBig > balance) throw new Error("Demo balance too low for this wager.");
      balance -= wagerBig;

      const sessionId = String(nextSessionId++);
      const row: DemoSessionRow = {
        sessionId,
        sessionKey: `demo:${sessionId}`,
        gameAddress: "0x0000000000000000000000000000000000dEad",
        phase: 2,
        phaseName: "WAITING_PLAYER_ACTION",
        wager,
        stake: wager,
        payout: undefined,
        isSettled: false,
        openedAt: Date.now(),
        lastEventTimestamp: Date.now(),
        raw: { gameState: encodeStage(0) },
      };
      sessions = [...sessions.filter((s) => s.isSettled), row];
      emit();
      return { sessionKey: row.sessionKey, transactionHash: "0xdemo" as HexString };
    },

    async submitAction({ sessionId, actionData }) {
      const row = sessions.find((s) => s.sessionId === sessionId);
      if (!row) throw new Error("Demo session not found.");
      const [action] = decodeAbiParameters([{ type: "uint8" }], actionData as HexString);
      const stage = decodeStage(row.raw.gameState);
      const wager = BigInt(row.wager ?? "0");

      if (Number(action) === 1) {
        // RUN
        if (stage < 1) throw new Error("Nothing to cash out yet.");
        const payout = demoPayoutFor(wager, stage);
        balance += payout;
        settle(row, payout);
        emit();
        return { transactionHash: "0xdemo" as HexString };
      }

      // STEAL
      if (stage >= STAGE_COUNT) throw new Error("No further steal at the final stage.");
      row.phase = 1;
      row.phaseName = "WAITING_RANDOMNESS";
      row.lastEventTimestamp = Date.now();
      emit();

      // Simulate VRF latency so the tension beat still reads, then resolve.
      setTimeout(() => {
        const survived = demoSurvives(stage);
        if (!survived) {
          settle(row, 0n);
        } else {
          const newStage = stage + 1;
          row.raw = { gameState: encodeStage(newStage) };
          if (newStage === STAGE_COUNT) {
            const payout = demoPayoutFor(wager, newStage);
            balance += payout;
            settle(row, payout);
          } else {
            row.phase = 2;
            row.phaseName = "WAITING_PLAYER_ACTION";
            row.lastEventTimestamp = Date.now();
          }
        }
        emit();
      }, 550);

      return { transactionHash: "0xdemo" as HexString };
    },

    async cancelStuckRandomness() {
      throw new Error("Demo mode: nothing gets stuck, this is not needed.");
    },

    async revealOutcome() {
      // No-op in demo mode — there's no host balance bar to unhide.
    },
  };

  emit();
  return hostApi;
}

function settle(row: DemoSessionRow, payout: bigint) {
  row.phase = 3;
  row.phaseName = "SETTLED";
  row.payout = payout.toString();
  row.isSettled = true;
  row.settledAt = Date.now();
  row.lastEventTimestamp = Date.now();
}

function encodeStage(stage: number): HexString {
  // abi.encode(uint8) — 32-byte word, value right-aligned in the low byte.
  return (`0x${stage.toString(16).padStart(64, "0")}`) as HexString;
}

function decodeStage(gameState: HexString | undefined): number {
  if (!gameState) return 0;
  return parseInt(gameState.slice(-2), 16);
}
