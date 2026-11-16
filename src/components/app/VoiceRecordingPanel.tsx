"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEngine, useSnapshot } from "./SentryProvider";
import { Btn, Mono, Panel, Pill } from "./ui";

type ManifestAsset = { role: string; label: string; zoneId: number | null; zoneName: string | null; url?: string; recordedAt: string; size: number; mime: string };
type Manifest = { generic: ManifestAsset | null; zones: Record<string, ManifestAsset>; siren: { url: string; license: string; source: string } };

export function VoiceRecordingPanel() {
  const engine = useEngine();
  const snap = useSnapshot();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [recordingRole, setRecordingRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const loadManifest = useCallback(async () => {
    try {
      const r = await fetch("/api/audio/manifest", { cache: "no-store" });
      if (r.ok) setManifest((await r.json()) as Manifest);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void loadManifest(), 0);
    return () => clearTimeout(t);
  }, [loadManifest]);

  const recordingRoles = () => {
    const roles: { role: string; label: string; zoneId: number | null; zoneName: string | null; required: boolean }[] = [
      { role: "critical_generic", label: "Generic critical announcement", zoneId: null, zoneName: null, required: true },
    ];
    for (const z of snap.zones) {
      if (!z.enabled || z.type === "IGNORE") continue;
      roles.push({ role: `zone_${z.id}`, label: z.name, zoneId: z.id, zoneName: z.name, required: z.type === "SWIMMING" || z.type === "RESTRICTED" });
    }
    return roles;
  };

  const startRecording = async (role: string) => {
    setError(null);
    setStatus("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm" });
      chunks.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: recorder.mimeType });
        if (blob.size < 100) {
          setError("Recording was too short or empty");
          setRecordingRole(null);
          return;
        }
        const dataUrl = await blobToDataUrl(blob);
        const roleInfo = recordingRoles().find((r) => r.role === role)!;
        const res = await fetch("/api/audio/record", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, label: roleInfo.label, zoneId: roleInfo.zoneId, zoneName: roleInfo.zoneName, dataUrl }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setError(j.error ?? "Could not store recording");
        } else {
          setStatus(`Recorded ${roleInfo.label}`);
          await loadManifest();
          await engine.alerts.refreshAssets();
        }
        setRecordingRole(null);
      };
      mediaRecorder.current = recorder;
      setRecordingRole(role);
      recorder.start(250);
    } catch (e) {
      setError((e as Error).message || "Microphone access failed");
      setRecordingRole(null);
    }
  };

  const stopRecording = () => {
    mediaRecorder.current?.stop();
  };

  const deleteRecording = async (role: string) => {
    setError(null);
    const res = await fetch(`/api/audio/record?role=${encodeURIComponent(role)}`, { method: "DELETE" });
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Could not delete recording");
    else {
      await loadManifest();
      await engine.alerts.refreshAssets();
    }
  };

  const assetFor = (role: string): ManifestAsset | null => {
    if (!manifest) return null;
    if (role === "critical_generic") return manifest.generic;
    return manifest.zones[role] ?? null;
  };

  const roles = recordingRoles();
  const missingRequired = roles.filter((r) => r.required && !assetFor(r.role));

  return (
    <Panel title="Human-recorded critical voice">
      <div className="space-y-3 p-4">
        <p className="text-[0.74rem] leading-relaxed text-mist">
          Record a calm, clear, authoritative human announcement. The siren plays first, then this recording. Synthetic speech is never substituted.
        </p>
        {error && <p className="text-[0.74rem] text-coral">{error}</p>}
        {status && <p className="text-[0.74rem] text-mint">{status}</p>}
        {missingRequired.length > 0 && (
          <p className="text-[0.74rem] text-amber">
            Missing recordings for: {missingRequired.map((r) => r.label).join(", ")}. Those zones will play the siren and show text only.
          </p>
        )}
        <ul className="space-y-2">
          {roles.map((r) => {
            const asset = assetFor(r.role);
            const isRecording = recordingRole === r.role;
            return (
              <li key={r.role} className="rounded-[6px] border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-[0.82rem] text-moon">{r.label}</span>
                    <span className="ml-2 text-[0.68rem] text-mist">{r.required ? "required" : "optional"}</span>
                  </div>
                  {asset ? <Pill tone="ok">recorded</Pill> : <Pill tone="idle">missing</Pill>}
                </div>
                {asset && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <audio controls preload="none" src={asset.url} className="h-8 max-w-full" />
                    <Mono className="text-[0.64rem] text-mist">{Math.round(asset.size / 1024)} KB · {new Date(asset.recordedAt).toLocaleString()}</Mono>
                  </div>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {isRecording ? (
                    <Btn tone="danger" onClick={stopRecording}>Stop recording</Btn>
                  ) : (
                    <Btn tone="primary" onClick={() => void startRecording(r.role)} disabled={!!recordingRole}>Record</Btn>
                  )}
                  {asset && <Btn tone="quiet" onClick={() => void deleteRecording(r.role)}>Delete</Btn>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
