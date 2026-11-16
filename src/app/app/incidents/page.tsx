"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEngine, useSnapshot } from "@/components/app/SentryProvider";
import { useIncidents } from "@/components/app/useIncidents";
import { Btn, ExperimentalTag, fmtDateTime, fmtTime, Mono, Panel, Pill, RiskBadge, SEVERITY_LABEL, STATUS_TONE, statusLabel } from "@/components/app/ui";
import type { Observation } from "@/lib/settings";

type Detail = {
  id: number;
  ref: string;
  severity: string;
  status: string;
  source: string;
  trackId: number | null;
  zoneName: string | null;
  title: string;
  isTest: boolean;
  observations: Observation[];
  observationCount: number;
  ruleVersion: string;
  modelVersion: string;
  trackHistory: { t: number; x: number; y: number }[];
  hasOriginal: boolean;
  hasAnnotated: boolean;
  hasPre: boolean;
  createdAt: string;
  events: { id: number; type: string; message: string; createdAt: string }[];
  deliveries?: { id: number; channel: string; recipient: string; phase: string; status: string; attempts: number; providerId: string | null; providerStatus: string | null; error: string | null; createdAt: string; sentAt: string | null; deliveredAt: string | null }[];
};

const FILTERS = [
  { v: "ALL", l: "All" },
  { v: "NEW,ACKNOWLEDGED,UNDER_REVIEW", l: "Open" },
  { v: "RESOLVED", l: "Resolved" },
  { v: "FALSE_ALARM", l: "False alarm" },
];

function Desk() {
  const router = useRouter();
  const params = useSearchParams();
  const selected = Number(params.get("id")) || null;
  const [filter, setFilter] = useState("ALL");
  const { rows, error, loading, trigger } = useIncidents(filter);

  return (
    <div className="grid min-h-full gap-4 p-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Panel
        title="Incident Desk"
        action={<ExperimentalTag />}
        className="lg:sticky lg:top-4 lg:max-h-[calc(100dvh-5.5rem)] lg:self-start lg:overflow-hidden"
      >
        <div className="flex gap-1 border-b border-line p-2" role="tablist">
          {FILTERS.map((f) => (
            <button key={f.v} role="tab" aria-selected={filter === f.v} onClick={() => setFilter(f.v)} className={`rounded px-2.5 py-1.5 text-[0.72rem] font-medium ${filter === f.v ? "bg-mint/15 text-mint" : "text-mist hover:text-moon"}`}>
              {f.l}
            </button>
          ))}
        </div>
        <ul className="app-scroll max-h-[60dvh] divide-y divide-line/60 overflow-auto lg:max-h-[calc(100dvh-12rem)]">
          {loading && <li className="p-4 text-[0.82rem] text-mist">Loading…</li>}
          {error && <li className="p-4 text-[0.82rem] text-coral">Could not load incidents: {error}</li>}
          {!loading && !error && rows.length === 0 && <li className="p-4 text-[0.82rem] text-mist">No incidents in this view.</li>}
          {rows.map((r) => (
            <li key={r.id}>
              <button onClick={() => router.replace(`/app/incidents?id=${r.id}`)} className={`block w-full px-4 py-3 text-left transition-colors hover:bg-depth/50 ${selected === r.id ? "bg-depth/70" : ""}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2"><Mono className="text-moon">{r.ref}</Mono>{r.isTest && <Pill tone="warn">Test</Pill>}</span>
                  <Pill tone={STATUS_TONE[r.status]}>{statusLabel(r.status)}</Pill>
                </span>
                <span className={`mt-1 block text-[0.78rem] ${r.severity === "CRITICAL" || r.severity === "LEVEL_3" ? "text-coral" : "text-amber"}`}>{SEVERITY_LABEL[r.severity] ?? r.severity}</span>
                <span className="block text-[0.74rem] text-mist">{fmtDateTime(r.createdAt)}{r.trackId ? ` · track #${r.trackId}` : ""}{r.observationCount > 1 ? ` · ${r.observationCount} obs.` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      {selected ? <DetailView id={selected} trigger={trigger} /> : (
        <Panel className="grid min-h-[320px] place-items-center p-8 text-center">
          <div>
            <p className="font-display text-xl">Select an incident</p>
            <p className="mt-2 max-w-sm text-[0.85rem] text-mist">Incidents are created only from eligible behavior observations. Every action is stored in PostgreSQL with its own timeline entry.</p>
          </div>
        </Panel>
      )}
    </div>
  );
}

function DetailView({ id, trigger }: { id: number; trigger: number }) {
  const engine = useEngine();
  const snap = useSnapshot();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/incidents/${id}`, { cache: "no-store" });
    if (!r.ok) {
      setErr(r.status === 404 ? "Incident not found" : `HTTP ${r.status}`);
      setD(null);
      return;
    }
    setErr(null);
    setD(await r.json());
  }, [id]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, trigger]);

  const act = async (action: string, noteText?: string) => {
    setPending(true);
    const r = await fetch(`/api/incidents/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note: noteText }) });
    setPending(false);
    if (!r.ok) setErr((await r.json()).error ?? "Action failed");
    else {
      setErr(null);
      if (action === "acknowledge") engine.alerts.acknowledge(id);
      if (action === "note") setNote("");
      await load();
    }
  };

  if (err && !d) return <Panel className="p-6 text-coral">{err}</Panel>;
  if (!d) return <Panel className="p-6 text-mist">Loading incident…</Panel>;
  const closed = d.status === "RESOLVED" || d.status === "FALSE_ALARM";

  return (
    <div className="min-w-0 space-y-4">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3 p-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl">{d.ref}</h1>
              <Pill tone={STATUS_TONE[d.status]} dot>{statusLabel(d.status)}</Pill>
              {d.isTest && <Pill tone="warn">TEST — not a real detection</Pill>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <RiskBadge risk={d.severity === "CRITICAL" ? "CRITICAL" : d.severity === "SUSPECTED" || d.severity === "LEVEL_3" ? "SUSPECTED" : "WATCH"} />
              <span className={`text-[0.85rem] ${d.severity === "CRITICAL" ? "text-coral" : "text-amber"}`}>{SEVERITY_LABEL[d.severity] ?? d.severity}</span>
            </div>
            <p className="mt-1 text-[0.8rem] text-mist">{d.title}</p>
          </div>
          <ExperimentalTag />
        </div>
        <dl className="grid grid-cols-2 gap-px border-t border-line bg-line text-[0.8rem] md:grid-cols-4">
          {[
            ["Time", fmtDateTime(d.createdAt)],
            ["Tracking ID", d.trackId ? `#${d.trackId}` : "—"],
            ["Source", d.source],
            ["Zone", d.zoneName ?? "—"],
            ["Observations", String(d.observationCount)],
            ["Rule version", d.ruleVersion],
            ["Model", d.modelVersion],
          ].map(([k, v]) => (
            <div key={k} className="bg-ocean p-3">
              <dt className="text-[0.68rem] uppercase tracking-wider text-mist">{k}</dt>
              <dd className="mt-0.5 break-words font-mono text-[0.76rem]">{v}</dd>
            </div>
          ))}
        </dl>
        {d.severity === "CRITICAL" && d.status !== "RESOLVED" && d.status !== "FALSE_ALARM" && (
          <p className="border-t border-coral/30 bg-coral/5 px-4 py-2 text-[0.76rem] text-coral">
            Critical suspected distress. Acknowledging silences the siren only; the incident stays open until a human resolves it. No drowning is confirmed by this system.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-line p-3">
          <Btn tone="primary" disabled={pending || d.status !== "NEW"} onClick={() => act("acknowledge")}>Acknowledge &amp; silence siren</Btn>
          <Btn disabled={pending || closed || d.status === "UNDER_REVIEW"} onClick={() => act("review")}>Under review</Btn>
          <Btn disabled={pending || closed} onClick={() => act("resolve")}>Resolve</Btn>
          <Btn tone="danger" disabled={pending || closed} onClick={() => act("false_alarm")}>Mark false alarm</Btn>
          {snap.settings.notifications.phone.manualNumber && (
            <a href={`tel:${snap.settings.notifications.phone.manualNumber}`} className="inline-flex h-9 items-center rounded-[5px] border border-line bg-depth/50 px-3 text-[0.78rem] font-medium text-moon hover:border-teal">
              Call responder (manual)
            </a>
          )}
          {err && <span className="text-[0.78rem] text-coral">{err}</span>}
        </div>
      </Panel>

      <div className="grid gap-4 2xl:grid-cols-2">
        <Panel title="Behavioral observations">
          <ul className="divide-y divide-line/60">
            {d.observations.slice().reverse().map((o, i) => (
              <li key={i} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <RiskBadge risk={o.level === 4 ? "CRITICAL" : o.level === 3 ? "SUSPECTED" : "WATCH"} short />
                    <span className={`text-[0.85rem] font-semibold ${o.level === 4 ? "text-coral" : "text-amber"}`}>{o.kind}</span>
                  </span>
                  <Mono className="text-mist">{fmtTime(o.at)} · {o.durationSeconds}s · {o.trackId ? `track #${o.trackId}` : "no track"}</Mono>
                </div>
                <p className="text-[0.82rem] leading-relaxed text-moon/90">{o.summary}</p>
                {o.assessment && (
                  <div className="rounded border border-line/70 bg-abyss/40 p-2">
                    <p className="font-mono text-[0.66rem] text-mist">
                      heuristic score {o.assessment.score.toFixed(2)} ({o.assessment.scoreKind}) · model confidence {o.assessment.modelConfidence === null ? "not available" : o.assessment.modelConfidence} · pattern {o.assessment.persistentSeconds.toFixed(1)}s · zone {o.assessment.zone ?? "unzoned"} · visible {o.assessment.visible ? "yes" : "no"}
                    </p>
                    <ul className="mt-1 space-y-0.5 text-[0.72rem] text-glass">
                      {o.assessment.indicators.filter((i) => i.available && i.strength >= 0.25).map((i) => (
                        <li key={i.key}>• {i.label}: {i.value} {i.unit} (threshold {i.threshold}) · strength {Math.round(i.strength * 100)}% · {i.seconds}s</li>
                      ))}
                    </ul>
                    <p className="mt-1 text-[0.68rem] text-mist">{o.assessment.limitations.slice(0, 2).join(" ")}</p>
                  </div>
                )}
                {o.reached.length > 0 && (
                  <div>
                    <p className="text-[0.68rem] uppercase tracking-wider text-mist">Thresholds reached</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[0.78rem] text-glass">{o.reached.map((r) => <li key={r}>{r}</li>)}</ul>
                  </div>
                )}
                <details className="text-[0.76rem] text-mist">
                  <summary className="cursor-pointer hover:text-moon">Contributing features &amp; thresholds</summary>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <pre className="overflow-auto rounded bg-abyss/70 p-2 font-mono text-[0.72rem] text-moon/80">{JSON.stringify(o.features, null, 2)}</pre>
                    <pre className="overflow-auto rounded bg-abyss/70 p-2 font-mono text-[0.72rem] text-moon/80">{JSON.stringify(o.thresholds, null, 2)}</pre>
                  </div>
                </details>
                <p className="font-mono text-[0.68rem] text-mist">rule {o.ruleVersion}</p>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Evidence & observed moment">
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            {([["original", d.hasOriginal, "Original snapshot"], ["annotated", d.hasAnnotated, "Annotated snapshot"], ["pre", d.hasPre, "Pre-event frame (~seconds earlier)"]] as const).map(([k, has, label]) => (
              <figure key={k} className="overflow-hidden rounded-[6px] border border-line bg-abyss">
                {has ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/incidents/${d.id}/evidence?kind=${k}`} alt={label} className="aspect-video w-full object-cover" />
                ) : (
                  <div className="grid aspect-video place-items-center p-3 text-center text-[0.74rem] text-mist">{d.isTest && !d.hasOriginal ? "No live frame was available when this test ran." : "Not stored, or removed by bounded retention."}</div>
                )}
                <figcaption className="px-2 py-1.5 text-[0.7rem] text-mist">{label}</figcaption>
              </figure>
            ))}
            <TrackPlot points={d.trackHistory} />
          </div>
        </Panel>
      </div>

      <Panel title="Timeline">
        <ol className="p-4">
          {d.events.map((e) => (
            <li key={e.id} className="relative border-l border-line pb-4 pl-5 last:pb-0">
              <span className={`absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full ${e.type === "CREATED" ? "bg-coral" : e.type === "RESOLVED" ? "bg-mint" : e.type === "NOTE" ? "bg-glass" : "bg-amber"}`} />
              <Mono className="text-mist">{fmtDateTime(e.createdAt)} · {e.type.replace("_", " ")}</Mono>
              <p className="mt-0.5 text-[0.84rem]">{e.message}</p>
            </li>
          ))}
        </ol>
        <form
          className="flex gap-2 border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) void act("note", note);
          }}
        >
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note to the timeline…" aria-label="Note" className="h-9 min-w-0 flex-1 rounded-[5px] border border-line bg-depth/60 px-3 text-[0.82rem] outline-none focus:border-mint" />
          <Btn type="submit" disabled={pending || !note.trim()}>Add note</Btn>
        </form>
      </Panel>

      <Panel title="Alert delivery timeline">
        <ul className="divide-y divide-line/60">
          {(d.deliveries ?? []).length === 0 && <li className="p-4 text-[0.8rem] text-mist">No delivery records yet.</li>}
          {(d.deliveries ?? []).map((x) => (
            <li key={x.id} className="grid gap-1 p-3 text-[0.76rem]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-moon">{x.channel.replace("_", " ")}</span>
                <Pill tone={x.status === "DELIVERED" || x.status === "SENT" ? "ok" : x.status === "FAILED" ? "alert" : x.status === "ACKNOWLEDGED" ? "warn" : "idle"}>{x.status}</Pill>
              </div>
              <Mono className="text-mist">{x.recipient} · {x.phase} · attempts {x.attempts} · {fmtDateTime(x.createdAt)}</Mono>
              {x.providerId && <Mono className="text-mist">provider {x.providerId} · {x.providerStatus}</Mono>}
              {x.error && <span className="text-coral">{x.error}</span>}
              {x.sentAt && <Mono className="text-mist">sent {fmtDateTime(x.sentAt)}{x.deliveredAt ? ` · delivered ${fmtDateTime(x.deliveredAt)}` : ""}</Mono>}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function TrackPlot({ points }: { points: { x: number; y: number }[] }) {
  return (
    <figure className="overflow-hidden rounded-[6px] border border-line bg-abyss">
      <svg viewBox="0 0 160 90" className="aspect-video w-full">
        <rect width="160" height="90" fill="#0A1C1B" />
        {points.length > 1 ? (
          <>
            <polyline points={points.map((p) => `${p.x * 160},${p.y * 90}`).join(" ")} fill="none" stroke="#79DCC4" strokeWidth="1.2" strokeLinejoin="round" />
            <circle cx={points[0].x * 160} cy={points[0].y * 90} r="2" fill="#98ABA2" />
            <circle cx={points[points.length - 1].x * 160} cy={points[points.length - 1].y * 90} r="2.6" fill="#F17869" />
          </>
        ) : (
          <text x="80" y="48" textAnchor="middle" fill="#98ABA2" fontSize="6">No tracking history stored</text>
        )}
      </svg>
      <figcaption className="px-2 py-1.5 text-[0.7rem] text-mist">Tracking history (image space)</figcaption>
    </figure>
  );
}

export default function IncidentsPage() {
  useSnapshot();
  return (
    <Suspense fallback={<div className="p-6 text-mist">Loading…</div>}>
      <Desk />
    </Suspense>
  );
}

