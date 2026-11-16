"use client";

import { useCallback, useEffect, useState } from "react";
import { useSnapshot } from "./SentryProvider";

export type IncidentRow = {
  id: number;
  ref: string;
  severity: string;
  status: string;
  source: string;
  trackId: number | null;
  zoneName: string | null;
  title: string;
  isTest: boolean;
  observationCount: number;
  hasEvidence: boolean;
  createdAt: string;
  updatedAt: string;
};

/** Loads incidents from PostgreSQL and refetches whenever the server publishes an incident event. */
export function useIncidents(status: string) {
  const snap = useSnapshot();
  const [rows, setRows] = useState<IncidentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const trigger = snap.events.find((e) => e.kind === "incident")?.id ?? 0;

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/incidents?status=${encodeURIComponent(status)}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setRows(await r.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, trigger]);

  return { rows, error, loading, reload: load, trigger };
}
