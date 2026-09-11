import { useEffect, useRef, useState } from "react";
import {
  connectGameToHost,
  observeGameContentSize,
  type GuestApiV1,
  type HostApiV1,
  type HostSnapshotV1,
} from "./sdk/guest";
import { createDemoHost } from "./demoHost";

const HANDSHAKE_TIMEOUT_MS = 2000;

/**
 * Tries the real chain.wtf host bridge first (this is what production —
 * and the local simulator — actually use). If no host answers within
 * HANDSHAKE_TIMEOUT_MS (i.e. the page was opened directly, not embedded in
 * an iframe by a host), falls back to the client-side demo host so the
 * standalone URL stays playable, per Chain Jam's eligibility rule.
 */
export function useGameHost(): {
  hostApi: HostApiV1 | null;
  snapshot: HostSnapshotV1 | null;
  isDemo: boolean;
} {
  const [hostApi, setHostApi] = useState<HostApiV1 | null>(null);
  const [snapshot, setSnapshot] = useState<HostSnapshotV1 | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const resolvedRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    const guestMethods: GuestApiV1 = {
      async setState(nextSnapshot) {
        if (!mounted) return;
        setSnapshot(nextSnapshot);
      },
    };

    const connection = connectGameToHost(guestMethods);

    const timeout = window.setTimeout(() => {
      if (!mounted || resolvedRef.current) return;
      // No real host answered in time — switch to the demo host so the
      // page is playable standalone. The real connection is left running
      // in the background; if a host answers later (unlikely, but possible
      // on a slow parent), we simply ignore it — we've already committed
      // to demo mode for this page load.
      setIsDemo(true);
      const demo = createDemoHost((s) => mounted && setSnapshot(s));
      setHostApi(demo);
    }, HANDSHAKE_TIMEOUT_MS);

    void connection.promise
      .then((parent) => {
        if (!mounted) return;
        resolvedRef.current = true;
        window.clearTimeout(timeout);
        setHostApi(parent);
      })
      .catch(() => {
        // Real handshake failed outright — the timeout above still fires
        // and switches to demo mode.
      });

    return () => {
      mounted = false;
      window.clearTimeout(timeout);
      connection.destroy();
    };
  }, []);

  useEffect(() => {
    if (!hostApi || isDemo) return;
    const observer = observeGameContentSize(hostApi);
    return () => observer.disconnect();
  }, [hostApi, isDemo]);

  return { hostApi, snapshot, isDemo };
}
