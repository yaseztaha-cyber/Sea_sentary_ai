"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function CameraAiTabs() {
  const p = usePathname();
  const tabs = [
    { href: "/app/camera", label: "Camera & model" },
    { href: "/app/ai", label: "AI analysis & heat map" },
  ];
  return (
    <div className="flex gap-1 border-b border-line px-4 pt-3" role="tablist">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} role="tab" aria-selected={p.startsWith(t.href)} className={`border-b-2 px-3 pb-2.5 text-[0.78rem] font-semibold uppercase tracking-[0.12em] transition-colors ${p.startsWith(t.href) ? "border-mint text-mint" : "border-transparent text-mist hover:text-moon"}`}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
