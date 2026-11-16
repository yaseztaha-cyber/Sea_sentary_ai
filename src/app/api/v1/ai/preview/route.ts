export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      error: "not_implemented",
      detail: "Annotated MJPEG preview requires the native Python inference service (planned). Annotated frames are drawn in the browser from real detections and tracks. No mock video is ever served.",
    },
    { status: 501 },
  );
}
