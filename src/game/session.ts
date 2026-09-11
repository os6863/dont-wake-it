import { decodeAbiParameters, encodeAbiParameters, type Hex } from "viem";
import type { HostSnapshotV1 } from "../chain/sdk/guest";

export const ACTION_STEAL = 0;
export const ACTION_RUN = 1;

export type SessionRow = HostSnapshotV1["sessions"]["items"][number];

/** Find the single non-terminal session for this player, if any. */
export function findActiveSession(snapshot: HostSnapshotV1 | null): SessionRow | undefined {
  if (!snapshot) return undefined;
  return snapshot.sessions.items.find((s) => !s.isSettled);
}

/** Most recently settled session — used to show the last round's result. */
export function findLastSettledSession(snapshot: HostSnapshotV1 | null): SessionRow | undefined {
  if (!snapshot) return undefined;
  return [...snapshot.sessions.items]
    .filter((s) => s.isSettled)
    .sort((a, b) => (b.settledAt ?? 0) - (a.settledAt ?? 0))[0];
}

/** Decode our gameState (abi.encode(uint8 stage)) into a plain number. Returns 0 if absent/undecodable. */
export function decodeStage(gameStateHex: Hex | undefined): number {
  if (!gameStateHex) return 0;
  try {
    const [stage] = decodeAbiParameters([{ type: "uint8" }], gameStateHex);
    return Number(stage);
  } catch {
    return 0;
  }
}

export function encodeStealAction(): Hex {
  return encodeAbiParameters([{ type: "uint8" }], [ACTION_STEAL]);
}

export function encodeRunAction(): Hex {
  return encodeAbiParameters([{ type: "uint8" }], [ACTION_RUN]);
}

/** Empty gameData — DON'T WAKE IT takes no per-round config (fixed 6-stage table). */
export const EMPTY_GAME_DATA: Hex = "0x";
