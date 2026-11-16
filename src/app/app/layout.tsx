import type { ReactNode } from "react";
import type { Metadata } from "next";
import { SentryProvider } from "@/components/app/SentryProvider";
import { AppShell } from "@/components/app/AppShell";

export const metadata: Metadata = { title: "Sea Sentry AI — Platform" };

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SentryProvider>
      <AppShell>{children}</AppShell>
    </SentryProvider>
  );
}
