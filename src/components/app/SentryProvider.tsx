"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { SentryEngine, type EngineSnapshot } from "@/lib/engine/runtime";
import type { Settings } from "@/lib/settings";

const Ctx = createContext<SentryEngine | null>(null);

export function SentryProvider({ children }: { children: ReactNode }) {
  const [engine] = useState(() => new SentryEngine());
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
    void engine.start();
    void engine.start();
    // Local-first operator console: expose the live engine for automated E2E
    // verification and for inspecting real measured state from the browser.
    (window as unknown as { __sentry?: SentryEngine }).__sentry = engine;
    return () => {
      const w = window as unknown as { __sentry?: SentryEngine };
      if (w.__sentry === engine) delete w.__sentry;
    };
  }, [engine]);
  if (!mounted) {
    return (
      <div className="grid min-h-screen place-items-center bg-abyss">
        <p className="font-mono text-[0.72rem] uppercase tracking-[0.2em] text-mist">Preparing operator console…</p>
      </div>
    );
  }
  return <Ctx.Provider value={engine}>{children}</Ctx.Provider>;
}

export function useEngine(): SentryEngine {
  const e = useContext(Ctx);
  if (!e) throw new Error("SentryProvider missing");
  return e;
}

export function useSnapshot(): EngineSnapshot {
  const e = useEngine();
  return useSyncExternalStore(e.subscribe, e.getSnapshot, e.getServerSnapshot);
}

/** Applies a settings change immediately to the running engine and persists it (debounced). */
export function useSettingsUpdater() {
  const engine = useEngine();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return useCallback(
    (fn: (s: Settings) => void) => {
      const next = engine.applySettingsLocal(fn);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void engine.saveSettings(next).catch(() => {}), 350);
    },
    [engine],
  );
}
