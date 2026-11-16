"use client";

import { useEngine, useSettingsUpdater, useSnapshot } from "./SentryProvider";
import { Btn, Mono, Panel, Pill, Slider, Toggle, type Tone } from "./ui";

const STATE_TONE: Record<string, { tone: Tone; label: string }> = {
  ready: { tone: "ok", label: "Audio ready" },
  locked: { tone: "warn", label: "Audio locked" },
  muted: { tone: "idle", label: "Audio disabled" },
  unsupported: { tone: "alert", label: "Audio unsupported" },
  error: { tone: "alert", label: "Audio failure" },
};

export function AudioPanel() {
  const engine = useEngine();
  const snap = useSnapshot();
  const update = useSettingsUpdater();
  const a = snap.audio;
  const s = snap.settings.alerts;
  const st = STATE_TONE[a.state] ?? STATE_TONE.locked;
  const zone = snap.zones.find((z) => z.enabled && z.type === "SWIMMING")?.name ?? snap.zones.find((z) => z.enabled && z.type !== "IGNORE")?.name;
  const last = a.lastPlayback;

  return (
    <Panel
      title="Critical siren & voice"
      action={<Pill tone={st.tone} dot={a.state === "ready"}>{st.label}</Pill>}
    >
      <div className="space-y-3 p-3">
        <p className={`text-[0.74rem] leading-relaxed ${a.state === "error" || a.state === "unsupported" ? "text-coral" : a.state === "locked" || a.state === "muted" ? "text-amber" : "text-mist"}`}>
          {a.message}
        </p>
        {a.state !== "ready" && (
          <Btn tone="primary" className="w-full" onClick={() => void engine.enableAlertAudio()} disabled={a.state === "unsupported"}>
            Enable alert audio
          </Btn>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Btn onClick={() => void engine.testSiren()} disabled={!s.sirenEnabled} className="!h-8 !px-2 !text-[0.7rem]">Test siren</Btn>
          <Btn onClick={() => void engine.testVoice(zone)} disabled={!s.voiceEnabled} className="!h-8 !px-2 !text-[0.7rem]">Test voice{zone ? ` · ${zone}` : ""}</Btn>
          {a.state === "ready" && <Btn tone="quiet" onClick={() => engine.alerts.setMuted(true)} className="!h-8 !px-2 !text-[0.7rem]">Mute</Btn>}
          {a.state === "muted" && <Btn onClick={() => { engine.alerts.setMuted(false); void engine.enableAlertAudio(); }} className="!h-8 !px-2 !text-[0.7rem]">Unmute</Btn>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Toggle checked={s.sirenEnabled} onChange={(v) => update((x) => (x.alerts.sirenEnabled = v))} label="Siren" />
          <Toggle checked={s.voiceEnabled} onChange={(v) => update((x) => (x.alerts.voiceEnabled = v))} label="Voice" />
        </div>
        <Slider label="Volume" value={s.volume} min={0.1} max={1} step={0.05} onChange={(v) => { update((x) => (x.alerts.volume = v)); engine.alerts.setVolume(v); }} format={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="Repeat unacknowledged alert" value={s.repeatSeconds} min={20} max={300} step={10} onChange={(v) => update((x) => (x.alerts.repeatSeconds = v))} format={(v) => `${v}s`} hint={`At most ${s.maxRepeats + 1} announcements per incident. Acknowledgment stops the siren immediately.`} />
        <div className="border-t border-line/60 pt-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[0.68rem] uppercase tracking-[0.12em] text-glass">Last playback</span>
            <Mono className="text-[0.64rem] text-mist">{a.voice ?? "no local voice listed"}</Mono>
          </div>
          {last ? (
            <dl className="mt-1 space-y-0.5 font-mono text-[0.66rem] text-mist">
              <div className="flex justify-between"><dt>{last.ref}{last.repeat ? ` · repeat ${last.repeat}` : ""}</dt><dd>{last.zone ? `Zone ${last.zone}` : "unzoned"}</dd></div>
              <div className="flex justify-between"><dt>Siren</dt><dd className={last.sirenRequested && !last.sirenPlayed ? "text-coral" : last.sirenPlayed ? "text-mint" : ""}>{last.sirenRequested ? (last.sirenPlayed ? `played · signal ${last.signalPeak}` : "FAILED") : "off"}</dd></div>
              <div className="flex justify-between"><dt>Voice</dt><dd className={last.voiceRequested && !last.voicePlayed ? "text-coral" : last.voicePlayed ? "text-mint" : ""}>{last.voiceRequested ? (last.voicePlayed ? "spoken" : "FAILED") : "off"}</dd></div>
              {last.error && <div className="text-[0.64rem] text-coral">{last.error}</div>}
            </dl>
          ) : (
            <p className="mt-1 text-[0.68rem] text-mist">No critical alert has played in this session. Use the tests above to verify the speaker path.</p>
          )}
          {a.active && <p className="mt-1 font-mono text-[0.64rem] text-amber">Playing {a.active.phase} · {a.active.ref}{a.queued ? ` · ${a.queued} queued` : ""}</p>}
          {a.queued > 0 && !a.active && <p className="mt-1 font-mono text-[0.64rem] text-amber">{a.queued} alert(s) queued</p>}
        </div>
      </div>
    </Panel>
  );
}
