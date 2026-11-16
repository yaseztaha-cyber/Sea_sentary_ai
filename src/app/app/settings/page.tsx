"use client";

import { useEngine, useSettingsUpdater, useSnapshot } from "@/components/app/SentryProvider";
import { useRouter } from "next/navigation";
import { Btn, ExperimentalTag, Panel, Pill, Select, Slider, Toggle } from "@/components/app/ui";
import { VoiceRecordingPanel } from "@/components/app/VoiceRecordingPanel";
import { NotificationChannelsPanel } from "@/components/app/NotificationChannelsPanel";

export default function SettingsPage() {
  const engine = useEngine();
  const router = useRouter();
  const snap = useSnapshot();
  const update = useSettingsUpdater();
  const s = snap.settings;
  const d = s.distress;
  const h = s.heatmap;
  const a = s.alerts;
  const perm = snap.link.browserPermission;
  const audio = snap.audio;

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl">Settings</h1>
        <div className="flex items-center gap-3">
          <span className="text-[0.76rem] text-mist">Changes apply to the running engine immediately and are stored in PostgreSQL.</span>
          <Btn tone="quiet" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); }}>Sign out</Btn>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Camera source">
          <div className="p-4">
            <Select
              label="Video input"
              value={s.camera.deviceId ?? "auto"}
              onChange={(v) => void engine.selectCamera(v === "auto" ? null : v)}
              options={[
                { value: "auto", label: "System default (may be a virtual camera)" },
                ...snap.devices.map((d) => ({ value: d.deviceId, label: /virtual|obs|snap|manycam|droidcam|iriun|epoccam/i.test(d.label) ? `${d.label} (virtual)` : d.label })),
              ]}
              hint="Choose the physical camera for real footage. OBS/other virtual cameras can emit a green placeholder and are not physical-camera evidence."
            />
            <dl className="mt-2 space-y-1 font-mono text-[0.72rem] text-mist">
              <div className="flex justify-between gap-3"><dt>Current source</dt><dd className="text-right text-moon">{snap.camera.label ?? "not connected"}</dd></div>
              <div className="flex justify-between gap-3"><dt>Actual stream</dt><dd>{snap.camera.width ? `${snap.camera.width} × ${snap.camera.height} · ${snap.camera.actualFps ?? "?"} fps` : "—"}</dd></div>
            </dl>
            <div className="mt-2 flex flex-wrap gap-2">
              <Btn onClick={() => void engine.refreshDevices()}>Refresh device list</Btn>
              <Btn onClick={() => void engine.connect(s.camera.deviceId)}>Apply / reconnect</Btn>
              <Btn tone="quiet" onClick={() => engine.disconnect()}>Release camera</Btn>
            </div>
            <Toggle checked={s.camera.autoConnect} onChange={(v) => update((x) => (x.camera.autoConnect = v))} label="Connect automatically on launch" />
          </div>
        </Panel>

        <Panel title="Temporal distress assessment" action={<ExperimentalTag />}>
          <div className="p-4">
            <Toggle checked={d.enabled} onChange={(v) => update((x) => (x.distress.enabled = v))} label="Temporal distress assessment" hint="Explainable baseline over real track history. Not a validated drowning detector." />
            <Select label="Create an incident from" value={String(d.createIncidentLevel)} onChange={(v) => update((x) => (x.distress.createIncidentLevel = Number(v) as 3 | 4))} options={[{ value: "3", label: "Suspected + critical (recommended)" }, { value: "4", label: "Critical only" }]} />
            <Slider label="Analysis window" value={d.windowSeconds} min={8} max={40} step={1} onChange={(v) => update((x) => (x.distress.windowSeconds = v))} format={(v) => `${v}s`} hint="Recent behavior used for indicator values." />
            <Slider label="Submersion context window" value={d.contextSeconds} min={20} max={180} step={5} onChange={(v) => update((x) => (x.distress.contextSeconds = v))} format={(v) => `${v}s`} hint="How far back repeated tracker gaps/submersions are counted." />
            <Slider label="Minimum track history" value={d.minTrackSeconds} min={3} max={30} step={1} onChange={(v) => update((x) => (x.distress.minTrackSeconds = v))} format={(v) => `${v}s`} />
            <Slider label="Vertical posture aspect threshold" value={d.postureAspect} min={1.1} max={2.6} step={0.05} onChange={(v) => update((x) => (x.distress.postureAspect = v))} format={(v) => `${v.toFixed(2)} h/w`} hint="Bounding-box proxy only; not a pose model." />
            <Slider label="Struggle direction reversals" value={d.struggleReversals} min={2} max={12} step={1} onChange={(v) => update((x) => (x.distress.struggleReversals = v))} />
            <Slider label="Submersion gap threshold" value={d.submersionGapSeconds} min={0.5} max={4} step={0.1} onChange={(v) => update((x) => (x.distress.submersionGapSeconds = v))} format={(v) => `${v.toFixed(1)}s`} hint="A gap may also be occlusion or an intentional dive." />
            <Slider label="Repeated submersion count" value={d.submersionCount} min={1} max={6} step={1} onChange={(v) => update((x) => (x.distress.submersionCount = v))} />
            <Slider label="Immobility seconds" value={d.immobilitySeconds} min={3} max={30} step={1} onChange={(v) => update((x) => (x.distress.immobilitySeconds = v))} format={(v) => `${v}s`} hint="Stillness alone never creates a critical event." />
            <Slider label="Immobility speed" value={d.immobilitySpeed} min={0.004} max={0.04} step={0.002} onChange={(v) => update((x) => (x.distress.immobilitySpeed = v))} format={(v) => v.toFixed(3)} />
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Risk escalation" action={<ExperimentalTag />}>
            <div className="p-4">
              <Slider label="Watch score" value={d.watchScore} min={0.1} max={0.5} step={0.01} onChange={(v) => update((x) => (x.distress.watchScore = v))} format={(v) => v.toFixed(2)} />
              <Slider label="Suspected score" value={d.suspectedScore} min={0.3} max={0.8} step={0.01} onChange={(v) => update((x) => (x.distress.suspectedScore = v))} format={(v) => v.toFixed(2)} />
              <Slider label="Critical score" value={d.criticalScore} min={0.5} max={0.98} step={0.01} onChange={(v) => update((x) => (x.distress.criticalScore = v))} format={(v) => v.toFixed(2)} />
              <Slider label="Watch persistence" value={d.watchPersistSeconds} min={1} max={20} step={1} onChange={(v) => update((x) => (x.distress.watchPersistSeconds = v))} format={(v) => `${v}s`} />
              <Slider label="Suspected persistence" value={d.suspectedPersistSeconds} min={2} max={30} step={1} onChange={(v) => update((x) => (x.distress.suspectedPersistSeconds = v))} format={(v) => `${v}s`} />
              <Slider label="Critical persistence" value={d.criticalPersistSeconds} min={2} max={30} step={1} onChange={(v) => update((x) => (x.distress.criticalPersistSeconds = v))} format={(v) => `${v}s`} />
              <Slider label="Observation cooldown" value={d.cooldownSeconds} min={10} max={120} step={5} onChange={(v) => update((x) => (x.distress.cooldownSeconds = v))} format={(v) => `${v}s`} />
              <p className="text-[0.72rem] leading-relaxed text-mist">Scores are weights of observable indicators, not probabilities. Thresholds are engineering defaults and have not been validated on representative water footage.</p>
            </div>
          </Panel>

          <Panel title="Activity heatmap">
            <div className="p-4">
              <Select label="Mode" value={h.mode} onChange={(v) => update((x) => (x.heatmap.mode = v as typeof h.mode))} options={[{ value: "occupancy", label: "Occupancy — time in region" }, { value: "movement", label: "Movement — displacement activity" }, { value: "dwell", label: "Dwell — prolonged stationary" }]} />
              <Slider label="Decay half-life" value={h.decayHalfLifeSeconds} min={20} max={900} step={10} onChange={(v) => update((x) => (x.heatmap.decayHalfLifeSeconds = v))} format={(v) => `${v}s`} hint="Old tracked activity loses half its weight every half-life." />
              <Slider label="Intensity" value={h.intensity} min={0.4} max={3} step={0.1} onChange={(v) => update((x) => (x.heatmap.intensity = v))} format={(v) => v.toFixed(1)} />
              <Slider label="Opacity" value={h.opacity} min={0.1} max={1} step={0.05} onChange={(v) => update((x) => (x.heatmap.opacity = v))} format={(v) => `${Math.round(v * 100)}%`} />
              <Toggle checked={h.monitoredOnly} onChange={(v) => update((x) => (x.heatmap.monitoredOnly = v))} label="Restrict to monitored-area zones" hint="Ignore zones are always subtracted." />
            </div>
          </Panel>
        </div>

        <Panel title="Critical alert audio">
          <div className="p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Pill tone={audio.state === "ready" ? "ok" : audio.state === "locked" ? "warn" : audio.state === "muted" ? "idle" : "alert"} dot={audio.state === "ready"}>{audio.state}</Pill>
              <span className="text-[0.76rem] text-mist">{audio.message}</span>
            </div>
            <Toggle checked={a.audioEnabled} onChange={(v) => { update((x) => (x.alerts.audioEnabled = v)); if (!v) engine.alerts.stopAll("Alert audio disabled in settings"); }} label="Critical alert audio" hint="Browser autoplay policy requires an explicit operator unlock when monitoring starts." />
            <Toggle checked={a.sirenEnabled} onChange={(v) => update((x) => (x.alerts.sirenEnabled = v))} label="Siren before voice" />
            <Toggle checked={a.voiceEnabled} onChange={(v) => update((x) => (x.alerts.voiceEnabled = v))} label="Spoken zone announcement (local voice)" />
            <Slider label="Volume" value={a.volume} min={0.1} max={1} step={0.05} onChange={(v) => { update((x) => (x.alerts.volume = v)); engine.alerts.setVolume(v); }} format={(v) => `${Math.round(v * 100)}%`} />
            <Slider label="Repeat unacknowledged critical alert" value={a.repeatSeconds} min={20} max={300} step={10} onChange={(v) => update((x) => (x.alerts.repeatSeconds = v))} format={(v) => `${v}s`} />
            <Slider label="Maximum repeats" value={a.maxRepeats} min={0} max={10} step={1} onChange={(v) => update((x) => (x.alerts.maxRepeats = v))} />
            <div className="mt-2 flex flex-wrap gap-2">
              <Btn tone="primary" onClick={() => void engine.enableAlertAudio()}>Enable / test audio</Btn>
              <Btn onClick={() => void engine.testSiren()} disabled={!a.sirenEnabled}>Test siren</Btn>
              <Btn onClick={() => void engine.testVoice()} disabled={!a.voiceEnabled}>Test voice</Btn>
            </div>
            {audio.lastError && <p className="mt-2 text-[0.76rem] text-coral">{audio.lastError}</p>}
          </div>
        </Panel>

        <Panel title="Notifications & evidence">
          <div className="p-4">
            <Toggle checked={snap.settings.notifications.inApp} onChange={(v) => update((x) => (x.notifications.inApp = v))} label="In-app notifications" hint="No SMS or e-mail exists in this build." />
            <Toggle checked={snap.settings.notifications.browser} onChange={(v) => update((x) => (x.notifications.browser = v))} label="Browser notifications" hint={`Permission: ${perm}`} />
            {snap.settings.notifications.browser && perm !== "granted" && (
              <div className="pb-2">
                <Btn onClick={() => void engine.requestBrowserPermission()} disabled={perm === "unsupported"}>Request permission</Btn>
                {perm === "denied" && <p className="mt-2 text-[0.76rem] text-coral">Notifications are blocked in the browser settings for this site.</p>}
              </div>
            )}
            <Slider label="Incidents that keep evidence images" value={snap.settings.evidence.maxIncidentsWithEvidence} min={5} max={200} step={5} onChange={(v) => update((x) => (x.evidence.maxIncidentsWithEvidence = v))} hint="Older incidents keep their record and timeline; images are removed. No continuous video is stored." />
            <Slider label="Duplicate grouping window" value={snap.settings.evidence.groupWindowSeconds} min={20} max={600} step={10} onChange={(v) => update((x) => (x.evidence.groupWindowSeconds = v))} format={(v) => `${v}s`} hint="New observations for the same track join the open incident." />
          </div>
        </Panel>
        <VoiceRecordingPanel />
        <NotificationChannelsPanel />
      </div>
    </div>
  );
}
