"use client";

import { useState } from "react";
import type { Pt, Zone, ZoneType } from "@/lib/settings";
import { useEngine, useSnapshot } from "./SentryProvider";
import { Btn, Select } from "./ui";
import { ZONE_COLORS } from "@/lib/engine/draw";

export const ZONE_TYPES: { value: ZoneType; label: string }[] = [
  { value: "OBSERVATION", label: "Observation" },
  { value: "SWIMMING", label: "Swimming" },
  { value: "RESTRICTED", label: "Restricted" },
  { value: "IGNORE", label: "Ignore" },
];

export type ZoneDraft = { active: boolean; points: Pt[]; name: string; type: ZoneType };

export function ZonePanel({ draft, setDraft }: { draft: ZoneDraft; setDraft: (d: ZoneDraft) => void }) {
  const engine = useEngine();
  const { zones } = useSnapshot();
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (draft.points.length < 3) return setErr("A zone needs at least 3 points");
    const r = await fetch("/api/zones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: draft.name || "Zone", type: draft.type, points: draft.points }) });
    if (!r.ok) return setErr((await r.json()).error ?? "Could not save zone");
    setErr(null);
    setDraft({ active: false, points: [], name: "", type: draft.type });
    await engine.loadZones();
  };
  const patch = async (z: Zone, body: Partial<Zone>) => {
    await fetch(`/api/zones/${z.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await engine.loadZones();
  };
  const del = async (z: Zone) => {
    await fetch(`/api/zones/${z.id}`, { method: "DELETE" });
    await engine.loadZones();
  };

  return (
    <div className="p-4">
      <p className="text-[0.74rem] leading-relaxed text-mist">Zones are regions of the camera image (normalized coordinates), not GPS polygons.</p>
      <div className="mt-3 rounded-[6px] border border-line bg-abyss/50 p-3">
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Zone name" aria-label="Zone name" className="h-9 w-full rounded-[5px] border border-line bg-depth/60 px-2 text-[0.82rem] text-moon outline-none focus:border-mint" />
        <Select value={draft.type} onChange={(v) => setDraft({ ...draft, type: v as ZoneType })} options={ZONE_TYPES} />
        <div className="mt-2 flex flex-wrap gap-2">
          {!draft.active ? (
            <Btn tone="primary" onClick={() => setDraft({ ...draft, active: true, points: [] })}>Draw zone</Btn>
          ) : (
            <>
              <Btn tone="primary" disabled={draft.points.length < 3} onClick={save}>Close zone</Btn>
              <Btn onClick={() => setDraft({ ...draft, points: draft.points.slice(0, -1) })} disabled={!draft.points.length}>Undo point</Btn>
              <Btn tone="quiet" onClick={() => setDraft({ ...draft, active: false, points: [] })}>Cancel</Btn>
            </>
          )}
        </div>
        {draft.active && <p className="mt-2 text-[0.72rem] text-mint">{draft.points.length} point(s) placed</p>}
        {err && <p className="mt-2 text-[0.74rem] text-coral">{err}</p>}
      </div>
      <ul className="mt-4 space-y-2">
        {zones.length === 0 && <li className="text-[0.8rem] text-mist">No zones defined. Without zones, behavior screening cannot judge water regions.</li>}
        {zones.map((z) => (
          <li key={z.id} className="rounded-[6px] border border-line p-2.5">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: ZONE_COLORS[z.type] }} />
              <input defaultValue={z.name} aria-label="Rename zone" onBlur={(e) => e.target.value.trim() && e.target.value !== z.name && patch(z, { name: e.target.value.trim() })} className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-[0.82rem] text-moon outline-none hover:border-line focus:border-mint" />
              <button onClick={() => patch(z, { enabled: !z.enabled })} className={`rounded px-2 py-1 text-[0.68rem] uppercase tracking-wider ${z.enabled ? "bg-mint/15 text-mint" : "bg-depth text-mist"}`}>{z.enabled ? "On" : "Off"}</button>
              <button onClick={() => del(z)} className="px-1 text-mist hover:text-coral" aria-label={`Delete ${z.name}`}><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" /></svg></button>
            </div>
            <Select value={z.type} onChange={(v) => patch(z, { type: v as ZoneType })} options={ZONE_TYPES} />
          </li>
        ))}
      </ul>
    </div>
  );
}
