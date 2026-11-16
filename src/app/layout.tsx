import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sea Sentry AI — An eye in the sky. A rescuer at sea.",
  description: "Intelligent coastal awareness. Camera-based person detection, tracking and activity mapping to support rescue teams.",
};

export const viewport: Viewport = { themeColor: "#061211", colorScheme: "dark" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preload" href="/fonts/ClashDisplay-Variable.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/manrope-latin-400-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="bg-abyss text-moon antialiased">{children}</body>
    </html>
  );
}
