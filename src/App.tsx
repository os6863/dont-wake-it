import { useEffect, useMemo, useState } from "react";
import { parseUnits, formatUnits } from "viem";
import { computeMaxWager } from "./chain/sdk/guest";
import { useGameHost } from "./chain/useGameHost";
import {
  findActiveSession,
  findLastSettledSession,
  decodeStage,
  encodeStealAction,
  encodeRunAction,
  EMPTY_GAME_DATA,
} from "./game/session";
import { STAGE_COUNT, STAGE_COPY, displayMultiplier, nextStageSurvivalPct } from "./game/math";

const MAX_MULTIPLIER_X = 12.924165; // stage 6 — keep in sync with contracts/GameMath.sol

export default function App() {
  const { hostApi, snapshot, isDemo } = useGameHost();
  const [betInput, setBetInput] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealedSessionId, setRevealedSessionId] = useState<string | null>(null);

  const activeSession = findActiveSession(snapshot);
  const lastSettled = findLastSettledSession(snapshot);
  const stage = decodeStage(activeSession?.raw.gameState);

  const decimals = snapshot?.token.decimals ?? 18;
  const maxWager = useMemo(
    () => computeMaxWager(snapshot, { maxMultiplierX: MAX_MULTIPLIER_X }),
    [snapshot],
  );

  const walletReady = snapshot?.wallet.status === "ready";

  async function withBusyGuard(fn: () => Promise<void>) {
    if (busy) return; // duplicate-click protection (spec §60)
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Nothing was charged.");
    } finally {
      setBusy(false);
    }
  }

  async function handleEnterChamber() {
    if (!hostApi) return;
    await withBusyGuard(async () => {
      const wager = parseUnits(betInput || "0", decimals);
      await hostApi.openSession({ wager: wager.toString(), gameData: EMPTY_GAME_DATA });
    });
  }

  async function handleSteal() {
    if (!hostApi || !activeSession) return;
    await withBusyGuard(async () => {
      await hostApi.submitAction({
        sessionId: activeSession.sessionId,
        actionData: encodeStealAction(),
      });
    });
  }

  async function handleRun() {
    if (!hostApi || !activeSession) return;
    await withBusyGuard(async () => {
      await hostApi.submitAction({
        sessionId: activeSession.sessionId,
        actionData: encodeRunAction(),
      });
    });
  }

  // Reveal exactly once per settled session, right after we've shown the
  // result — until this fires the host keeps the payout out of its own
  // balance display (see SDK docs §5, "revealOutcome").
  useEffect(() => {
    if (!hostApi || !lastSettled) return;
    if (lastSettled.sessionId === revealedSessionId) return;
    setRevealedSessionId(lastSettled.sessionId);
    void hostApi.revealOutcome({ sessionId: lastSettled.sessionId }).catch(() => {
      // Non-fatal: worst case the host's own balance bar updates a beat late.
    });
  }, [hostApi, lastSettled, revealedSessionId]);

  if (!hostApi || !snapshot) {
    return <Screen isDemo={isDemo}>Connecting to Chain…</Screen>;
  }

  if (!walletReady) {
    return <Screen isDemo={isDemo}>Wallet not ready ({snapshot.wallet.status}). Reconnect to continue.</Screen>;
  }

  // --- No active round: betting screen ---
  if (!activeSession) {
    return (
      <Screen isDemo={isDemo}>
        <h1>DON'T WAKE IT</h1>
        <p className="tagline">Steal the treasure. Run before it wakes.</p>

        {lastSettled && (
          <RoundResultBanner
            settled={lastSettled}
            decimals={decimals}
            symbol={snapshot.token.symbol}
          />
        )}

        <label>
          Wager
          <input
            value={betInput}
            onChange={(e) => setBetInput(e.target.value)}
            inputMode="decimal"
          />
        </label>
        {maxWager !== undefined && (
          <div className="hint">Max wager: {formatUnits(maxWager, decimals)} {snapshot.token.symbol}</div>
        )}

        <button disabled={busy} onClick={handleEnterChamber} className="primary">
          {busy ? "…" : "ENTER THE CHAMBER"}
        </button>
        {error && <div className="error">{error}</div>}
      </Screen>
    );
  }

  // --- Mid-round: waiting for the VRF result of a STEAL ---
  if (activeSession.phaseName === "WAITING_RANDOMNESS") {
    return <Screen isDemo={isDemo}>The guardian stirs… (resolving)</Screen>;
  }

  // --- Mid-round: player's turn (STEAL AGAIN or RUN) ---
  const copy = stage >= 1 && stage <= STAGE_COUNT ? STAGE_COPY[stage - 1] : STAGE_COPY[0];
  return (
    <Screen isDemo={isDemo}>
      <h2>{stage === 0 ? "Stage 0 — untouched" : copy.label}</h2>
      <p>{stage === 0 ? "The guardian sleeps deeply." : `${copy.creature} — ${copy.feeling}`}</p>

      {stage >= 1 && (
        <div className="payout-preview">
          Cash out now: {displayMultiplier(stage)} × wager
        </div>
      )}

      {stage < STAGE_COUNT && (
        <div className="hint">
          Next steal survival chance: {nextStageSurvivalPct(stage)}%
        </div>
      )}

      <div className="actions">
        <button disabled={busy} onClick={handleSteal} className="primary danger">
          {stage === 0 ? "STEAL" : "STEAL AGAIN"}
        </button>
        {stage >= 1 && (
          <button disabled={busy} onClick={handleRun} className="secondary">
            RUN
          </button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
    </Screen>
  );
}

function RoundResultBanner({
  settled,
  decimals,
  symbol,
}: {
  settled: NonNullable<ReturnType<typeof findLastSettledSession>>;
  decimals: number;
  symbol?: string;
}) {
  const payout = settled.payout ? BigInt(settled.payout) : 0n;
  const won = payout > 0n;
  return (
    <div className={`result-banner ${won ? "win" : "loss"}`}>
      {won
        ? `You escaped with ${formatUnits(payout, decimals)} ${symbol ?? ""}!`
        : "The guardian woke. The chamber is empty."}
    </div>
  );
}

function Screen({ children, isDemo }: { children: React.ReactNode; isDemo: boolean }) {
  return (
    <div className="screen">
      {isDemo && (
        <div className="demo-badge">
          DEMO MODE — no real transactions (opened outside the Chain host)
        </div>
      )}
      {children}
    </div>
  );
}
