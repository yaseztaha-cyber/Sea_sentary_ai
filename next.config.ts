import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // the specified endpoint names end in .mjpg, which Next treats as a file extension
    return {
      beforeFiles: [
        { source: "/api/v1/camera/preview.mjpg", destination: "/api/v1/camera/preview" },
        { source: "/api/v1/ai/preview.mjpg", destination: "/api/v1/ai/preview" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
