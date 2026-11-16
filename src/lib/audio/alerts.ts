/**
 * Critical-alert audio: synthesized two-tone siren followed by local
 * speechSynthesis voice. No cloud TTS, no remote audio asset.
 *
 * The controller is deliberately conservative:
 *  - audio must be unlocked by an operator gesture;
 *  - one announcement at a time, prioritized, deduplicated by incident id;
 *  - acknowledging an incident stops its active siren immediately;
 *  - every failure is surfaced as an explicit state, never reported as played.
 */

export type AudioState = "locked" | "ready" | "muted" | "unsupported" | "error";

export type CriticalAlert = {
  incidentId: number;
  ref: string;
  zone: string | null;
  at: string;
};

export type AlertPlayback = {
  incidentId: number;
  ref: string;
  zone: string | null;
  startedAt: string;
  finishedAt: string | null;
  sirenRequested: boolean;
  sirenPlayed: boolean;
  sirenAssetUsed: boolean;
  voiceRequested: boolean;
  voicePlayed: boolean;
  voiceAvailable: boolean;
  voiceError: string | null;
  error: string | null;
  signalPeak: number;
  repeat: number;
  spokenText: string | null;
};

type VoiceAsset = { role: string; label: string; zoneId: number | null; zoneName: string | null; url: string; recordedAt: string; recordedBy: string };
type AudioManifest = {
  generic: VoiceAsset | null;
  zones: Record<string, VoiceAsset>;
  siren: { url: string; license: string; source: string };
};

export type AlertAudioStatus = {
  state: AudioState;
  message: string;
  voice: string | null;
  voices: number;
  volume: number;
  sirenEnabled: boolean;
  voiceEnabled: boolean;
  audioEnabled: boolean;
  active: { incidentId: number; ref: string; phase: "siren" | "voice" } | null;
  queued: number;
  lastPlayback: AlertPlayback | null;
  lastError: string | null;
  unlockedAt: string | null;
  sirenAssetAvailable: boolean;
  genericVoiceRecorded: boolean;
  recordedZoneNames: string[];
  manifestError: string | null;
  manifestLoadedAt: number;
};

type Listener = () => void;

const fmt = () => new Date().toISOString();

export class AlertAudioController {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private active: { alert: CriticalAlert; phase: "siren" | "voice" } | null = null;
  private queue: CriticalAlert[] = [];
  private acked = new Set<number>();
  private announced = new Map<number, { at: number; count: number; lastRef: string }>();
  private cancelSiren: (() => void) | null = null;
  private cancelVoice: (() => void) | null = null;
  private speechToken = 0;
  private listeners = new Set<Listener>();
  private volume = 0.8;
  private sirenEnabled = true;
  private voiceEnabled = true;
  private audioEnabled = false;
  private allowSynthFallback = false;
  private maxRepeats = 3;
  private manifest: AudioManifest | null = null;
  private audioBuffers = new Map<string, AudioBuffer>();
  private manifestLoadedAt = 0;
  private manifestError: string | null = null;
  private sirenRequested = false;
  private muted = false;
  private state: AudioState = "locked";
  private message = "Alert audio is locked. Press “Enable alert audio”.";
  private voice: string | null = null;
  private voices = 0;
  private lastPlayback: AlertPlayback | null = null;
  private lastError: string | null = null;
  private unlockedAt: string | null = null;
  private running = false;
  private playbackListener: ((rec: AlertPlayback) => void) | null = null;

  constructor() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const refresh = () => {
        const v = window.speechSynthesis.getVoices();
        this.voices = v.length;
        const pref = v.find((x) => x.localService && /^en[-_]/i.test(x.lang)) ?? v.find((x) => /^en[-_]/i.test(x.lang)) ?? v[0];
        this.voice = pref?.name ?? null;
        if (this.state !== "unsupported") this.refreshState();
        this.emit();
      };
      refresh();
      window.speechSynthesis.addEventListener?.("voiceschanged", refresh);
    } else {
      this.state = "unsupported";
      this.message = "This browser does not expose local speech synthesis; the siren can still play.";
    }
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  /** Reports completed local playback so the incident can store channel records. */
  onPlayback(fn: (rec: AlertPlayback) => void) {
    this.playbackListener = fn;
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  configure(opts: { volume: number; sirenEnabled: boolean; voiceEnabled: boolean; audioEnabled: boolean; maxRepeats?: number; allowSynthFallback?: boolean }) {
    this.volume = Math.min(1, Math.max(0, opts.volume));
    this.sirenEnabled = opts.sirenEnabled;
    this.voiceEnabled = opts.voiceEnabled;
    this.audioEnabled = opts.audioEnabled;
    if (typeof opts.allowSynthFallback === "boolean") this.allowSynthFallback = opts.allowSynthFallback;
    if (typeof opts.maxRepeats === "number") this.maxRepeats = Math.max(0, Math.floor(opts.maxRepeats));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    if (!opts.audioEnabled) {
      this.stopAll("Critical alert audio disabled by the operator");
      this.message = "Critical alert audio is disabled in Settings.";
      if (this.state === "ready") this.state = "muted";
    } else if (this.state === "muted") {
      this.refreshState();
    }
    this.emit();
  }

  private refreshState() {
    if (this.muted) {
      this.state = "muted";
      this.message = "Alert audio is muted by the operator.";
      return;
    }
    if (!this.audioEnabled) {
      this.state = "muted";
      this.message = "Critical alert audio is disabled in Settings.";
      return;
    }
    if (this.ctx?.state === "running") {
      this.state = "ready";
      this.message = this.voice ? `Audio ready · voice: ${this.voice}` : "Audio ready · local voice not listed yet";
    } else if (this.ctx) {
      this.state = "locked";
      this.message = "Browser audio is suspended. Press “Enable alert audio”.";
    }
  }

  /** Must be called from a click/tap. Creates and resumes the AudioContext. */
  async unlock(): Promise<boolean> {
    try {
      if (!("AudioContext" in window) && !("webkitAudioContext" in window)) {
        this.state = "unsupported";
        this.message = "Web Audio is not available in this browser.";
        this.emit();
        return false;
      }
      if (!this.ctx) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 512;
        this.master.connect(this.analyser);
        this.analyser.connect(this.ctx.destination);
      }
      this.audioEnabled = true;
      this.muted = false;
      await this.ctx.resume();
      await this.loadAssets();
      this.unlockedAt = fmt();
      if (this.ctx.state !== "running") {
        this.state = "locked";
        this.message = "The browser did not resume audio. Check the site's sound permission.";
        this.emit();
        return false;
      }
      this.state = "ready";
      this.message = this.voice ? `Audio ready · voice: ${this.voice}` : "Audio ready";
      this.lastError = null;
      // Audible confirmation that the output path works.
      void this.playReadyChime();
      this.emit();
      return true;
    } catch (e) {
      this.state = "error";
      this.lastError = (e as Error).message || "Audio unlock failed";
      this.message = `Audio unlock failed: ${this.lastError}`;
      this.emit();
      return false;
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : this.volume, this.ctx.currentTime, 0.02);
    if (muted) this.stopAll("Alert audio muted");
    this.refreshState();
    this.emit();
  }

  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.02);
    this.emit();
  }

  acknowledge(incidentId: number) {
    this.acked.add(incidentId);
    this.queue = this.queue.filter((a) => a.incidentId !== incidentId);
    if (this.active?.alert.incidentId === incidentId) {
      this.cancelSiren?.();
      this.cancelSiren = null;
      this.cancelVoice?.();
      this.cancelVoice = null;
      this.stopSpeech();
      this.active = null;
      this.message = "Acknowledged — active siren stopped. Incident remains open until resolved.";
      this.emit();
    }
  }

  isAcknowledged(incidentId: number) {
    return this.acked.has(incidentId);
  }

  /** Queue a critical announcement. Returns false with a visible reason when it cannot play. */
  announce(alert: CriticalAlert, opts: { force?: boolean; repeat?: number } = {}): { queued: boolean; reason?: string } {
    if (this.acked.has(alert.incidentId)) return { queued: false, reason: "Incident already acknowledged" };
    if (this.muted) {
      this.lastError = "Critical alert audio is muted by the operator.";
      this.message = this.lastError;
      this.emit();
      return { queued: false, reason: this.lastError };
    }
    if (!this.audioEnabled) {
      this.lastError = "Critical alert audio is disabled.";
      this.message = "Critical alert occurred, but alert audio is disabled.";
      this.emit();
      return { queued: false, reason: this.lastError };
    }
    if (this.state === "unsupported") {
      this.lastError = "Web Audio or speech synthesis is unavailable.";
      this.emit();
      return { queued: false, reason: this.lastError };
    }
    const prev = this.announced.get(alert.incidentId);
    if (!opts.force && prev) return { queued: false, reason: "Already announced for this incident" };
    if (opts.force && prev && prev.count >= 1 + this.maxRepeats) return { queued: false, reason: "Repeat limit reached" };
    if (this.ctx?.state !== "running") {
      this.lastError = "Audio is locked. Press “Enable alert audio”.";
      this.message = this.lastError;
      this.emit();
      return { queued: false, reason: this.lastError };
    }
    if (this.queue.some((a) => a.incidentId === alert.incidentId) || this.active?.alert.incidentId === alert.incidentId) {
      if (!opts.force) return { queued: false, reason: "Alert already queued or playing" };
    }
    this.announced.set(alert.incidentId, { at: Date.now(), count: (prev?.count ?? 0) + 1, lastRef: alert.ref });
    this.queue.push(alert);
    if (this.queue.length > 3) this.queue = this.queue.slice(-3);
    this.emit();
    void this.drain();
    return { queued: true };
  }

  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const alert = this.queue.shift()!;
        if (this.acked.has(alert.incidentId)) continue;
        this.active = { alert, phase: "siren" };
        const prevCount = this.announced.get(alert.incidentId)?.count ?? 1;
        const rec: AlertPlayback = {
          incidentId: alert.incidentId,
          ref: alert.ref,
          zone: alert.zone,
          startedAt: fmt(),
          finishedAt: null,
          sirenRequested: this.sirenEnabled,
          sirenPlayed: false,
          sirenAssetUsed: false,
          voiceRequested: this.voiceEnabled,
          voicePlayed: false,
          voiceAvailable: false,
          voiceError: null,
          error: null,
          signalPeak: 0,
          repeat: Math.max(0, prevCount - 1),
          spokenText: null,
        };
        this.lastPlayback = rec;
        this.lastError = null;
        this.emit();
        if (this.sirenEnabled) {
          try {
            const siren = await this.playSiren(3.2);
            rec.sirenPlayed = siren.peak > 0.001;
            rec.sirenAssetUsed = siren.asset;
            rec.signalPeak = siren.peak;
            if (!rec.sirenPlayed) rec.error = "Siren produced no measurable signal";
          } catch (e) {
            rec.error = `Siren failed: ${(e as Error).message}`;
          }
        }
        if (this.acked.has(alert.incidentId)) {
          rec.finishedAt = fmt();
          rec.voicePlayed = false;
          this.message = "Acknowledged — active siren stopped. Incident remains open until resolved.";
          this.active = null;
          this.emit();
          this.playbackListener?.(rec);
          continue;
        }
        if (this.voiceEnabled) {
          this.active = { alert, phase: "voice" };
          this.emit();
          try {
            const voice = await this.playRecordedVoice(alert.zone);
            rec.voicePlayed = voice.played;
            rec.voiceAvailable = voice.available;
            rec.voiceError = voice.error;
            rec.spokenText = voice.text;
            if (!voice.played) {
              this.message = "Siren played. Spoken zone announcement unavailable — recorded voice missing or failed.";
              this.lastError = voice.error;
            }
          } catch (e) {
            rec.voiceError = `Voice failed: ${(e as Error).message}`;
          }
        }
        rec.finishedAt = fmt();
        if (rec.error) this.lastError = rec.error;
        this.active = null;
        this.emit();
        this.playbackListener?.(rec);
        await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      this.running = false;
      this.active = null;
      if (this.lastPlayback?.error) {
        this.state = "error";
        this.message = `Alert audio problem: ${this.lastPlayback.error}`;
      } else if (this.state === "locked" && this.ctx?.state === "running") {
        this.state = "ready";
      }
      this.emit();
    }
  }

  private async loadAssets(): Promise<void> {
    if (!this.ctx) return;
    try {
      const r = await fetch("/api/audio/manifest", { cache: "no-store" });
      if (!r.ok) throw new Error(`manifest ${r.status}`);
      this.manifest = (await r.json()) as AudioManifest;
      this.manifestLoadedAt = Date.now();
      this.manifestError = null;
      if (this.manifest?.siren?.url) {
        try {
          const siren = await this.fetchBuffer(this.manifest.siren.url);
          this.audioBuffers.set("__siren__", siren);
        } catch (e) {
          this.manifestError = `Siren asset could not be decoded: ${(e as Error).message}`;
        }
      }
    } catch (e) {
      this.manifestError = `Audio manifest unavailable: ${(e as Error).message}`;
    }
  }

  async refreshAssets(): Promise<void> {
    this.audioBuffers.delete("__siren__");
    await this.loadAssets();
    this.emit();
  }

  private async fetchBuffer(url: string): Promise<AudioBuffer> {
    if (!this.ctx) throw new Error("Audio context not unlocked");
    const hit = this.audioBuffers.get(url);
    if (hit) return hit;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`audio fetch ${r.status}`);
    const data = await r.arrayBuffer();
    const buf = await this.ctx.decodeAudioData(data.slice(0));
    this.audioBuffers.set(url, buf);
    return buf;
  }

  private voiceFor(zone: string | null): VoiceAsset | null {
    if (!this.manifest) return null;
    if (zone) {
      return Object.values(this.manifest.zones).find((a) => a.zoneName?.toLowerCase() === zone.toLowerCase()) ?? null;
    }
    return this.manifest.generic;
  }

  private async playSiren(durationSec: number): Promise<{ peak: number; asset: boolean }> {
    if (!this.ctx || !this.master) throw new Error("Audio context not unlocked");
    const ctx = this.ctx;
    const buffer = this.audioBuffers.get("__siren__");
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    let asset = false;
    if (buffer) {
      source.buffer = buffer;
      asset = true;
    } else {
      // Explicit fallback only if the recorded asset is unavailable. The UI
      // records sirenAssetUsed so this is never presented as the licensed asset.
      const osc = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      osc.type = "triangle";
      osc2.type = "sine";
      osc2.detune.value = 7;
      const steps = 6;
      const step = durationSec / steps;
      for (let i = 0; i < steps; i++) {
        const up = i % 2 === 0;
        osc.frequency.setValueAtTime(up ? 680 : 900, ctx.currentTime + i * step);
        osc.frequency.linearRampToValueAtTime(up ? 900 : 680, ctx.currentTime + (i + 1) * step);
        osc2.frequency.setValueAtTime(up ? 340 : 450, ctx.currentTime + i * step);
        osc2.frequency.linearRampToValueAtTime(up ? 450 : 340, ctx.currentTime + (i + 1) * step);
      }
      osc.connect(gain);
      osc2.connect(gain);
      osc.start();
      osc.stop(ctx.currentTime + durationSec);
    }
    const dur = asset ? Math.min(durationSec, Math.max(1.8, buffer!.duration)) : durationSec;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.75, ctx.currentTime + 0.06);
    gain.gain.setValueAtTime(0.75, ctx.currentTime + Math.max(0.1, dur - 0.12));
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    source.connect(gain);
    gain.connect(this.master);
    if (asset) source.start();
    this.sirenRequested = true;
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      try {
        gain.gain.cancelScheduledValues(ctx.currentTime);
        gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.02);
        if (asset) source.stop(ctx.currentTime + 0.08);
      } catch {}
    };
    this.cancelSiren = stop;
    let peak = 0;
    const sample = () => {
      if (!this.analyser) return;
      const buf = new Float32Array(this.analyser.fftSize);
      this.analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      peak = Math.max(peak, Math.sqrt(sum / buf.length));
    };
    const timer = setInterval(sample, 80);
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, dur * 1000 + 80);
      const check = setInterval(() => {
        if (stopped) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 50);
    });
    clearInterval(timer);
    sample();
    stop();
    this.cancelSiren = null;
    return { peak: Math.round(peak * 1000) / 1000, asset };
  }

  private async playRecordedVoice(zone: string | null): Promise<{ played: boolean; available: boolean; text: string | null; error: string | null }> {
    if (!this.ctx || !this.master) return { played: false, available: false, text: null, error: "Audio context not unlocked" };
    const voice = this.voiceFor(zone);
    if (!voice) {
      const text = zone ? `Recorded announcement missing for zone ${zone}` : "No recorded critical announcement is configured";
      if (this.allowSynthFallback) {
        const phrase = `Critical alert. Possible swimmer distress. Lifeguard required${zone ? ` at ${zone}` : ""}.`;
        try {
          await this.speak(phrase);
          return { played: true, available: true, text: phrase, error: null };
        } catch (e) {
          return { played: false, available: true, text: phrase, error: (e as Error).message };
        }
      }
      return { played: false, available: false, text: null, error: text };
    }
    try {
      const buffer = await this.fetchBuffer(voice.url);
      const source = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      source.buffer = buffer;
      gain.gain.value = 1;
      source.connect(gain);
      gain.connect(this.master);
      let resolveVoice: (() => void) | null = null;
      const done = new Promise<void>((resolve) => {
        resolveVoice = resolve;
        source.onended = () => resolve();
      });
      this.cancelVoice = () => {
        try {
          source.stop();
        } catch {}
        resolveVoice?.();
      };
      source.start();
      await Promise.race([done, new Promise<void>((resolve) => setTimeout(resolve, Math.min(20000, buffer.duration * 1000 + 500)))]);
      this.cancelVoice = null;
      return { played: true, available: true, text: voice.label, error: null };
    } catch (e) {
      return { played: false, available: true, text: voice.label, error: (e as Error).message };
    }
  }

  private async playReadyChime() {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    for (const [i, f] of [660, 880].entries()) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now + i * 0.13);
      g.gain.exponentialRampToValueAtTime(0.12, now + i * 0.13 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.13 + 0.16);
      o.connect(g).connect(this.master);
      o.start(now + i * 0.13);
      o.stop(now + i * 0.13 + 0.18);
    }
  }

  private stopSpeech() {
    this.speechToken++;
    try {
      window.speechSynthesis?.cancel();
    } catch {}
  }

  private speak(text: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!("speechSynthesis" in window)) {
        reject(new Error("speechSynthesis is not available"));
        return;
      }
      const token = ++this.speechToken;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "en-US";
      u.rate = 0.94;
      u.pitch = 1;
      u.volume = this.volume;
      const voices = window.speechSynthesis.getVoices();
      const chosen = voices.find((v) => v.name === this.voice) ?? voices.find((v) => v.localService && /^en/i.test(v.lang)) ?? voices.find((v) => /^en/i.test(v.lang));
      if (chosen) u.voice = chosen;
      let settled = false;
      const finish = (ok: boolean, err?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (ok) resolve(true);
        else reject(new Error(err || "voice failed"));
      };
      u.onstart = () => {
        if (token === this.speechToken) this.message = "Speaking critical alert…";
        this.emit();
      };
      // Acknowledgment/mute calls speechSynthesis.cancel(), which fires
      // "interrupted" or a mismatched token. That is a deliberate stop, not an
      // audio failure, so it must not put the controller into the error state.
      u.onend = () => finish(true);
      u.onerror = (e) => {
        if (token !== this.speechToken) finish(true);
        else finish(false, `speech error: ${e.error || "unknown"}`);
      };
      const timer = setTimeout(() => finish(false, "speech timed out"), Math.min(20000, 4000 + text.length * 90));
      try {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      } catch (e) {
        finish(false, (e as Error).message);
      }
    });
  }

  async testSiren(): Promise<boolean> {
    if (this.muted) {
      this.lastError = "Alert audio is muted; unmute before testing.";
      this.emit();
      return false;
    }
    if (this.ctx?.state !== "running") {
      const ok = await this.unlock();
      if (!ok) return false;
    }
    if (this.active) {
      this.lastError = "An alert is already playing; test not started.";
      this.emit();
      return false;
    }
    try {
      this.active = { alert: { incidentId: -1, ref: "TEST", zone: "TEST", at: fmt() }, phase: "siren" };
      this.emit();
      const siren = await this.playSiren(3.2);
      this.lastPlayback = {
        incidentId: -1,
        ref: "TEST SIREN",
        zone: "TEST",
        startedAt: fmt(),
        finishedAt: fmt(),
        sirenRequested: true,
        sirenPlayed: siren.peak > 0.001,
        sirenAssetUsed: siren.asset,
        voiceRequested: false,
        voicePlayed: false,
        voiceAvailable: false,
        voiceError: null,
        error: siren.peak > 0.001 ? null : "No measurable signal",
        signalPeak: siren.peak,
        repeat: 0,
        spokenText: null,
      };
      this.active = null;
      this.message = siren.peak > 0.001 ? `Siren test completed (${siren.asset ? "licensed recording" : "fallback tone"}).` : "Siren test produced no signal.";
      this.emit();
      return siren.peak > 0.001;
    } catch (e) {
      this.lastError = (e as Error).message;
      this.active = null;
      this.emit();
      return false;
    }
  }

  async testVoice(zoneName?: string): Promise<boolean> {
    if (this.muted) {
      this.lastError = "Alert audio is muted; unmute before testing.";
      this.emit();
      return false;
    }
    if (this.ctx?.state !== "running") {
      const ok = await this.unlock();
      if (!ok) return false;
    }
    if (this.active) {
      this.lastError = "An alert is already playing; voice test not started.";
      this.emit();
      return false;
    }
    const zone = zoneName || "the monitored area";
    const startedAt = fmt();
    this.lastPlayback = {
      incidentId: -2,
      ref: "TEST VOICE",
      zone: zoneName ?? null,
      startedAt,
      finishedAt: null,
      sirenRequested: false,
      sirenPlayed: false,
      sirenAssetUsed: false,
      voiceRequested: true,
      voicePlayed: false,
      voiceAvailable: false,
      voiceError: null,
      error: null,
      signalPeak: 0,
      repeat: 0,
      spokenText: null,
    };
    this.active = { alert: { incidentId: -2, ref: "TEST VOICE", zone: zoneName ?? null, at: startedAt }, phase: "voice" };
    this.emit();
    try {
      const voice = await this.playRecordedVoice(zoneName ?? null);
      this.lastPlayback = { ...this.lastPlayback, finishedAt: fmt(), voicePlayed: voice.played, voiceAvailable: voice.available, voiceError: voice.error, spokenText: voice.text };
      this.message = voice.played ? `Voice test completed (${zone}).` : voice.available ? "Voice test failed." : `No recorded announcement for ${zone}; record it in Settings.`;
      if (!voice.played) this.lastError = voice.error;
      this.emit();
      return voice.played;
    } catch (e) {
      this.lastError = (e as Error).message;
      this.message = `Voice test failed: ${this.lastError}`;
      this.emit();
      return false;
    } finally {
      this.active = null;
      this.emit();
    }
  }

  stopAll(reason = "Stopped") {
    this.queue = [];
    this.cancelSiren?.();
    this.cancelSiren = null;
    this.cancelVoice?.();
    this.cancelVoice = null;
    this.stopSpeech();
    if (this.active) this.message = reason;
    this.active = null;
    this.emit();
  }

  getStatus(): AlertAudioStatus {
    return {
      state: this.state,
      message: this.message,
      voice: this.voice,
      voices: this.voices,
      volume: this.volume,
      sirenEnabled: this.sirenEnabled,
      voiceEnabled: this.voiceEnabled,
      audioEnabled: this.audioEnabled,
      active: this.active ? { incidentId: this.active.alert.incidentId, ref: this.active.alert.ref, phase: this.active.phase } : null,
      queued: this.queue.length,
      lastPlayback: this.lastPlayback,
      lastError: this.lastError,
      unlockedAt: this.unlockedAt,
      sirenAssetAvailable: this.audioBuffers.has("__siren__"),
      genericVoiceRecorded: !!this.manifest?.generic,
      recordedZoneNames: this.manifest ? Object.values(this.manifest.zones).map((z) => z.zoneName ?? z.label) : [],
      manifestError: this.manifestError,
      manifestLoadedAt: this.manifestLoadedAt,
    };
  }
}
