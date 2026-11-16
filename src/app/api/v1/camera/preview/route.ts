export const dynamic = "force-dynamic";

// In this Next.js build the physical camera is owned by the operator's browser (getUserMedia),
// so the server has no frames to stream. We return an explicit error instead of any mock video.
export function GET() {
  return Response.json(
    {
      error: "not_implemented",
      detail: "Raw MJPEG preview requires the native Python camera manager (planned). The web console shows the real camera directly in the browser. No mock video is ever served.",
    },
    { status: 501 },
  );
}
