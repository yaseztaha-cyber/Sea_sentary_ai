"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { registerGsap } from "@/lib/motion";

/** Scroll-entered reveal for text blocks. Content stays visible if JS or motion is unavailable. */
export function Reveal({ children, className = "", delay = 0, y = 36, as: Tag = "div" }: { children: ReactNode; className?: string; delay?: number; y?: number; as?: "div" | "p" | "h2" | "li" }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const { gsap } = registerGsap();
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const tween = gsap.fromTo(el, { y, opacity: 0 }, { y: 0, opacity: 1, duration: 1.1, delay, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 88%", once: true } });
    return () => {
      tween.scrollTrigger?.kill();
      tween.kill();
    };
  }, [delay, y]);
  const T = Tag as "div";
  return (
    <T ref={ref as React.RefObject<HTMLDivElement>} className={className}>
      {children}
    </T>
  );
}
