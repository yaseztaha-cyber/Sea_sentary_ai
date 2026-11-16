import os from "node:os";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Real host/process measurements. This reports the Next.js server process and
// host memory, not the browser's GPU process. The console labels it exactly.
const g = globalThis as typeof globalThis & {
  __sentryCpu?: { usage: NodeJS.CpuUsage; at: number };
};
if (!g.__sentryCpu) g.__sentryCpu = { usage: process.cpuUsage(), at: Date.now() };

export async function GET() {
  const now = Date.now();
  const prev = g.__sentryCpu!;
  const usage = process.cpuUsage(prev.usage);
  const elapsedMs = Math.max(1, now - prev.at);
  const cores = Math.max(1, os.cpus().length);
  const cpuPercent = Math.round(((usage.user + usage.system) / 1000 / elapsedMs / cores) * 1000) / 10;
  g.__sentryCpu = { usage: process.cpuUsage(), at: now };
  const mem = process.memoryUsage();
  return Response.json({
    cpuPercent,
    cpuScope: `${cores} logical cores · server process`,
    rssMb: Math.round(mem.rss / 1048576),
    heapUsedMb: Math.round(mem.heapUsed / 1048576),
    usedMb: Math.round((os.totalmem() - os.freemem()) / 1048576),
    totalMb: Math.round(os.totalmem() / 1048576),
    uptimeSeconds: Math.round(process.uptime()),
    platform: `${os.platform()} ${os.release()}`,
    at: new Date(now).toISOString(),
  });
}
