import { bus, type BusEvent } from "@/lib/server/bus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const send = (evt: BusEvent) => {
        try {
          controller.enqueue(encoder.encode(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`));
        } catch {
          cleanup();
        }
      };
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      }, 15000);
      bus.on("event", send);
      controller.enqueue(encoder.encode(`event: hello\ndata: ${JSON.stringify({ type: "hello", data: {}, at: new Date().toISOString() })}\n\n`));
      cleanup = () => {
        clearInterval(ping);
        bus.off("event", send);
        try {
          controller.close();
        } catch {}
      };
      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
