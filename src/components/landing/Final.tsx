"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef } from "react";
import { registerGsap, usePrefersReducedMotion } from "@/lib/motion";
import { WaveField, type WaveLayer } from "./Waves";
import { Logo } from "@/components/brand/Logo";

const LAYERS: WaveLayer[] = [
  { fill: "#0A1C1B", opacity: 0.5, base: 0.84, amp: 28, speed: 0.18, freq: 1.0, seed: 1.2 },
  { fill: "#061211", opacity: 0.85, base: 0.92, amp: 24, speed: 0.12, freq: 1.4, seed: 3.8 },
];

export function Final() {
  const root = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const reduced = usePrefersReducedMotion();

  useLayoutEffect(() => {
    const { gsap } = registerGsap();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      gsap.fromTo("[data-final-bg]", { scale: 1.2, yPercent: -6 }, { scale: 1.02, yPercent: 4, ease: "none", scrollTrigger: { trigger: root.current, start: "top bottom", end: "bottom bottom", scrub: true } });
      gsap.fromTo("[data-final-line]", { yPercent: 105 }, { yPercent: 0, duration: 1.3, ease: "power3.out", stagger: 0.14, scrollTrigger: { trigger: root.current, start: "top 55%", once: true } });
    }, root);
    return () => ctx.revert();
  }, []);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (reduced) {
      v.pause();
      return;
    }
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? void v.play().catch(() => {}) : v.pause()), { threshold: 0.1 });
    io.observe(v);
    return () => io.disconnect();
  }, [reduced]);

  return (
    <section ref={root} id="final" className="relative overflow-hidden bg-abyss">
      <div className="relative flex min-h-screen flex-col justify-center overflow-hidden">
        <div data-final-bg className="absolute inset-[-3%]">
          <video ref={video} className="h-full w-full object-cover" muted loop playsInline preload="none" poster="/imagery/echo-poster.jpg" aria-hidden="true">
            <source src="/video/echo.mp4" type="video/mp4" />
          </video>
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_50%,rgba(6,18,17,0.88),rgba(6,18,17,0.45)_70%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,#061211_0%,transparent_22%,transparent_70%,#061211_100%)]" />
        <WaveField layers={LAYERS} />
        <div className="grain absolute inset-0" />

        <div className="relative z-20 mx-auto w-full max-w-[1560px] px-6 py-32 md:px-10">
          <h2 className="font-display max-w-[14ch] text-[clamp(2.8rem,8.4vw,8.8rem)] font-medium uppercase leading-[0.9] tracking-[-0.03em]">
            {["Every coast", "deserves a", "closer watch."].map((l) => (
              <span key={l} className="block overflow-hidden pb-[0.05em]"><span data-final-line className="block">{l}</span></span>
            ))}
          </h2>
          <div className="mt-12 flex flex-wrap items-center gap-x-10 gap-y-6">
            <p className="font-serif-i text-[1.8rem] text-glass">Discover Sea Sentry AI.</p>
            <Link href="/app" className="btn btn-primary">Open platform <span className="arrow" aria-hidden="true" /></Link>
          </div>
        </div>
      </div>

      <footer className="relative z-20 border-t border-line bg-abyss">
        <div className="mx-auto flex max-w-[1560px] flex-col gap-6 px-6 py-10 md:flex-row md:items-end md:justify-between md:px-10">
          <div>
            <Logo size={28} />
            <p className="mt-4 font-serif-i text-[1.05rem] text-mist">An eye in the sky. A rescuer at sea.</p>
          </div>
          <div className="max-w-xl text-[0.78rem] leading-relaxed text-mist md:text-right">
            <p>Project Creator &amp; Developer — <span className="text-moon">Eyad Sherif Elbagoury</span></p>
            <p className="mt-2">V1 · Camera-based AI monitoring. Behavior screening is experimental and requires human review; it is not validated drowning detection.</p>
            <p className="mt-2 text-mist/70">Footage and photographs: Pexels and Unsplash contributors (free licence). Typefaces: Clash Display (Fontshare), Instrument Serif, Manrope, IBM Plex Mono.</p>
          </div>
        </div>
      </footer>
    </section>
  );
}
