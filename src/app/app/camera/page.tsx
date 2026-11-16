"use client";

import { useEngine, useSettingsUpdater, useSnapshot } from "@/components/app/SentryProvider";
import { CameraAiTabs } from "@/components/app/CameraAiTabs";
import { Btn, Mono, Panel, Pill, Row, Select, Slider, monitoringStatus } from "@/components/app/ui";

const RES = [
  { value: "1920x1080", label: "1920 × 1080 (requested default)" },
  { value: "1280x720", label: "1280 × 720" },
  { value: "640x480", label: "640 × 480" },
];

export default function CameraPage() {
  const engine = useEngine();
  const snap = useSnapshot();
  const update = useSettingsUpdater();
  const s = snap.settings;
  const c = snap.camera;
  const st = monitoringStatus(snap);
  const connected = c.state === "connected" || c.state === "degraded";
  const selectedId = s.camera.deviceId ?? c.deviceId ?? snap.devices[0]?.deviceId ?? "";

  return (
    <div>
      <CameraAiTabs />
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <Panel title="Camera" action={<Pill tone={st.tone} dot>{c.state}</Pill>}>
          <div className="space-y-3 p-4">
            <Select
              label="Detected cameras"
              value={selectedId}
              onChange={(v) => update((x) => (x.camera.deviceId = v))}
              disabled={snap.devices.length === 0}
              options={snap.devices.length ? snap.devices.map((d) => ({ value: d.deviceId, label: d.label })) : [{ value: "", label: "No cameras listed — press Discover" }]}
            />
            <div className="flex flex-wrap gap-2">
              <Btn onClick={async () => { await engine.refreshDevices(); }}>Discover cameras</Btn>
              <Btn tone="primary" disabled={c.state === "connecting"} onClick={() => void engine.connect(selectedId || null)}>{connected ? "Switch / connect" : "Connect"}</Btn>
              <Btn disabled={!connected} onClick={() => engine.disconnect()}>Disconnect</Btn>
              <Btn disabled={c.state === "connecting"} onClick={() => void engine.reconnect()}>Reconnect</Btn>
            </div>
            {c.error && <p className="rounded border border-coral/40 bg-coral/10 p-2 text-[0.8rem] text-coral">{c.error}</p>}
            <p className="text-[0.74rem] leading-relaxed text-mist">Camera names appear after the browser has been granted access. Connect once to reveal them.</p>

            <h3 className="pt-2 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-glass">Capture configuration (requested)</h3>
            <Select label="Resolution" value={`${s.camera.width}x${s.camera.height}`} onChange={(v) => { const [w, h] = v.split("x").map(Number); update((x) => { x.camera.width = w; x.camera.height = h; }); }} options={RES} />
            <Select label="Frame rate" value={String(s.camera.fps)} onChange={(v) => update((x) => (x.camera.fps = Number(v)))} options={[{ value: "30", label: "30 FPS" }, { value: "15", label: "15 FPS" }, { value: "60", label: "60 FPS" }]} />
            <div className="flex items-center justify-between">
              <span className="text-[0.85rem]">Connect automatically when the console opens</span>
              <input type="checkbox" checked={s.camera.autoConnect} onChange={(e) => update((x) => (x.camera.autoConnect = e.target.checked))} className="h-4 w-4 accent-[#79DCC4]" aria-label="Auto connect" />
            </div>
            <Btn disabled={!connected} onClick={() => void engine.reconnect()}>Apply &amp; reconnect</Btn>
          </div>
        </Panel>

        <Panel title="Negotiated configuration (actual)">
          <dl className="p-4">
            <Row k="Camera" v={c.label ?? "—"} />
            <Row k="Requested" v={`${s.camera.width} × ${s.camera.height} @ ${s.camera.fps} fps`} />
            <Row k="Actual resolution" v={c.width ? `${c.width} × ${c.height}` : "—"} tone={c.width && c.width !== s.camera.width ? "warn" : undefined} />
            <Row k="Device-reported FPS" v={c.actualFps ? c.actualFps.toFixed(0) : "—"} />
            <Row k="Measured capture FPS" v={c.live ? c.captureFps.toFixed(1) : "—"} />
            <Row k="Pixel format" v={<span className="text-mist">not exposed</span>} />
            <Row k="Frames / skipped by AI" v={`${c.frames.toLocaleString()} / ${c.drops.toLocaleString()}`} />
          </dl>
          <p className="border-t border-line p-4 text-[0.76rem] leading-relaxed text-mist">
            Requested values are not guaranteed. This web build captures through the browser (<Mono>getUserMedia</Mono>), so the operating system and driver choose the pixel format (MJPEG/YUY2 on a USB webcam) and the browser reports only the negotiated size and rate. Direct DirectShow / Media Foundation control belongs to the planned native Python camera manager. The AUKEY One Shot PC-W10 has <span className="text-amber">not been tested</span>.
          </p>
        </Panel>

        <Panel title="Person detector" action={<Pill tone={snap.ai.model === "ready" ? "ok" : snap.ai.model === "unavailable" ? "alert" : "idle"}>{snap.ai.model}</Pill>}>
          <div className="p-4">
            <div className="mb-3 flex flex-wrap gap-2">
              <Btn tone={snap.ai.enabled ? "default" : "primary"} active={snap.ai.enabled} onClick={() => void engine.setAi(!snap.ai.enabled)}>{snap.ai.model === "loading" ? "Loading model…" : snap.ai.enabled ? "AI running — stop" : "Start AI"}</Btn>
              <Btn onClick={() => engine.resetTracking()}>Reset tracking</Btn>
            </div>
            {snap.ai.modelError && <p className="mb-2 text-[0.8rem] text-coral">{snap.ai.modelError}</p>}
            <Slider label="Inference frequency" value={s.inference.targetFps} min={1} max={15} step={1} onChange={(v) => update((x) => (x.inference.targetFps = v))} format={(v) => `${v} fps target`} hint="Target only. The measured inference FPS is shown below and is limited by the CPU/GPU." />
            <Slider label="Detection confidence threshold" value={s.inference.minScore} min={0.25} max={0.9} step={0.05} onChange={(v) => update((x) => (x.inference.minScore = v))} format={(v) => `${Math.round(v * 100)}%`} />
            <Select label="Model input (longest side)" value={String(s.inference.inputSize)} onChange={(v) => update((x) => (x.inference.inputSize = Number(v)))} options={[{ value: "320", label: "320 px — fastest" }, { value: "416", label: "416 px — low latency" }, { value: "512", label: "512 px — previous default" }, { value: "640", label: "640 px — benchmark-selected default" }]} />
            <Select label="Inference provider" value={s.inference.backend} onChange={(v) => update((x) => (x.inference.backend = v as typeof s.inference.backend))} options={[{ value: "auto", label: "Auto — measured at model load" }, { value: "webgl", label: "Pin WebGL" }, { value: "cpu", label: "Pin CPU (TF.js)" }]} hint="A provider is used only after a real workload probe succeeds." />
            <Slider label="Maximum detections" value={s.inference.maxDetections} min={5} max={50} step={5} onChange={(v) => update((x) => (x.inference.maxDetections = v))} />
            <dl className="mt-2">
              <Row k="Runtime / provider (verified)" v={snap.ai.model === "ready" ? `TF.js · ${snap.ai.backend}` : "—"} />
              <Row k="Provider selection" v={snap.ai.model === "ready" ? snap.ai.backendReason : "—"} />
              <Row k="Measured detector rate" v={snap.ai.enabled && snap.ai.inferenceFrames ? `${snap.ai.detectorRate.toFixed(2)} /s` : "—"} />
              <Row k="Tracking update rate" v={snap.ai.enabled ? `${snap.ai.trackingRate.toFixed(2)} /s` : "—"} />
              <Row k="Latency last / avg / p95" v={snap.ai.inferenceFrames ? `${snap.ai.latencyMs.toFixed(0)} / ${snap.ai.avgLatencyMs.toFixed(0)} / ${snap.ai.p95LatencyMs.toFixed(0)} ms` : "—"} />
              <Row k="Preprocess / frame age" v={snap.ai.inferenceFrames ? `${snap.ai.preprocessMs.toFixed(0)} / ${snap.ai.queueDelayMs.toFixed(0)} ms` : "—"} />
              <Row k="Server CPU / RSS / system RAM" v={snap.perf.serverCpuPercent !== null ? `${snap.perf.serverCpuPercent.toFixed(1)}% / ${snap.perf.serverRssMb} / ${snap.perf.systemUsedMb} MB` : "—"} />
            </dl>
          </div>
        </Panel>

        <Panel title="Tracking">
          <div className="p-4">
            <p className="mb-2 text-[0.76rem] leading-relaxed text-mist">ByteTrack-style association: IoU matching in two stages (high- and low-confidence detections), motion prediction, re-association of lost tracks. Anonymous IDs only — no face recognition, no cross-camera identity.</p>
            <Slider label="IoU association threshold" value={s.tracking.iouThreshold} min={0.1} max={0.6} step={0.05} onChange={(v) => update((x) => (x.tracking.iouThreshold = v))} />
            <Slider label="Keep lost tracks for" value={s.tracking.maxLostSeconds} min={0.5} max={10} step={0.5} onChange={(v) => update((x) => (x.tracking.maxLostSeconds = v))} format={(v) => `${v}s`} />
            <Slider label="Detections to confirm a track" value={s.tracking.minHits} min={1} max={8} step={1} onChange={(v) => update((x) => (x.tracking.minHits = v))} />
            <Slider label="Trail length" value={s.tracking.trailSeconds} min={2} max={30} step={1} onChange={(v) => update((x) => (x.tracking.trailSeconds = v))} format={(v) => `${v}s`} />
          </div>
        </Panel>

        <Panel title="Inference benchmark" className="lg:col-span-2">
          <div className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Btn tone="primary" disabled={snap.perf.benchmarkRunning || !snap.camera.live || snap.ai.model !== "ready"} onClick={() => void engine.benchmarkDetector()}>
                {snap.perf.benchmarkRunning ? "Benchmarking…" : "Benchmark 320 / 416 / 512 / 640"}
              </Btn>
              <span className="text-[0.76rem] text-mist">Runs real inference on one frozen live frame at each input size; 5 measured passes after a warm-up.</span>
            </div>
            {snap.perf.benchmark ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-[0.76rem]">
                  <thead className="text-mist">
                    <tr><th className="pb-1 font-medium">Input</th><th className="font-medium">p50</th><th className="font-medium">p95</th><th className="font-medium">Persons</th><th className="font-medium">Mean score</th><th className="font-medium">Agreement vs 640</th></tr>
                  </thead>
                  <tbody className="font-mono">
                    {snap.perf.benchmark.rows.map((r) => (
                      <tr key={r.inputSize} className="border-t border-line/60">
                        <td className="py-1 text-mint">{r.inputSize}px</td>
                        <td>{r.p50Ms.toFixed(1)} ms</td>
                        <td>{r.p95Ms.toFixed(1)} ms</td>
                        <td>{r.detections}</td>
                        <td>{r.avgScore.toFixed(2)}</td>
                        <td>{r.agreement === null ? "—" : `${Math.round(r.agreement * 100)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-[0.72rem] leading-relaxed text-mist">{snap.perf.benchmark.notes} Provider: {snap.perf.benchmark.backend}. Source: {snap.perf.benchmark.source}.</p>
                {snap.ai.backendSelection && (
                  <p className="mt-1 font-mono text-[0.68rem] text-mist">
                    backend probes: {snap.ai.backendSelection.probes.map((p) => `${p.backend} ${p.ok ? `${p.medianMs}ms` : "failed"}`).join(" · ")} · selected {snap.ai.backendSelection.backend}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-[0.78rem] text-mist">No benchmark run in this session. Nothing is estimated.</p>
            )}
          </div>
        </Panel>

        <Panel title="Model card" className="lg:col-span-2">
          <dl className="grid gap-x-8 p-4 md:grid-cols-2">
            <Row k="Architecture" v="SSDLite + MobileNetV2 (COCO-SSD “lite_mobilenet_v2”)" />
            <Row k="Version / format" v="TF.js graph model, tfjs-models/coco-ssd 2.2.x" />
            <Row k="Weights source" v="TensorFlow Object Detection API model zoo · storage.googleapis.com/tfjs-models" />
            <Row k="Licence" v="Apache-2.0 (code and published weights); training data: COCO (CC BY 4.0 annotations)" />
            <Row k="Classes" v="90 COCO classes — only “person” (id 1) is used" />
            <Row k="Input / output" v="RGB image, resized to the chosen input size · boxes + class + score" />
            <Row k="Hosting" v="Bundled locally in /public/models/coco-ssd-lite — no cloud inference" />
            <Row k="Water validation" v={<span className="text-amber">none — person detector only; not a drowning detector</span>} />
            <Row k="Provider benchmark" v="TF.js WebGL vs CPU microbenchmark at load; live provider reported above" />
            <Row k="Temporal stage" v="Separate experimental distress baseline over track history (see Distress panel)" />
          </dl>
          <p className="border-t border-line p-4 text-[0.76rem] text-mist">Commercial use of the weights should be re-checked against the upstream licence before any deployment. A YOLO ONNX detector can be added behind the <Mono>PersonDetector</Mono> interface once its weight licence is verified.</p>
        </Panel>
      </div>
    </div>
  );
}
