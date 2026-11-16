"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef } from "react";
import { registerGsap, usePrefersReducedMotion } from "@/lib/motion";
import { WaveField, type WaveLayer } from "./Waves";

// three independently moving surfaces; the front one is the colour of the next section so the water literally becomes the page
const LAYERS: WaveLayer[] = [
  { fill: "#17413A", opacity: 0.42, base: 0.7, amp: 46, speed: 0.34, freq: 1.1, seed: 0.4 },
  { fill: "#0A1C1B", opacity: 0.8, base: 0.8, amp: 40, speed: 0.5, freq: 1.6, seed: 2.3 },
  { fill: "#061211", opacity: 1, base: 0.9, amp: 34, speed: 0.27, freq: 0.9, seed: 4.6 },
];

export function Hero() {
  const root = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const progress = useRef(0);
  const reduced = usePrefersReducedMotion();

  useLayoutEffect(() => {
    const { gsap, ScrollTrigger } = registerGsap();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from("[data-hero-bg]", { opacity: 0, scale: 1.14, duration: 2.4, ease: "power2.out" }, 0)
        .from("[data-hero-light]", { opacity: 0, duration: 2.6 }, 0.5)
        .from("[data-hero-wave]", { yPercent: 40, opacity: 0, duration: 2.2 }, 0.4)
        .from("[data-line='1'] > span", { yPercent: 115, duration: 1.3 }, 0.9)
        .from("[data-line='2'] > span", { yPercent: 115, duration: 1.3 }, 1.35)
        .from("[data-hero-copy]", { y: 24, opacity: 0, duration: 1 }, 1.9)
        .from("[data-hero-cta]", { y: 20, opacity: 0, duration: 0.9, stagger: 0.12 }, 2.1)
        .from("[data-hero-marker]", { opacity: 0, scale: 0.6, duration: 1.4 }, 2.2)
        .from("[data-hero-scroll]", { opacity: 0, duration: 1 }, 2.5)
        .from("[data-hero-tag]", { opacity: 0, duration: 1 }, 2.3);

      // scroll-linked recomposition: water rises, imagery drifts at a different rate than type
      ScrollTrigger.create({
        trigger: root.current,
        start: "top top",
        end: "bottom bottom",
        scrub: true,
        onUpdate: (s) => (progress.current = s.progress),
      });
      gsap.to("[data-hero-bg]", { yPercent: 14, scale: 1.12, ease: "none", scrollTrigger: { trigger: root.current, start: "top top", end: "bottom bottom", scrub: true } });
      gsap.to("[data-hero-type]", { yPercent: -18, opacity: 0.0, ease: "none", scrollTrigger: { trigger: root.current, start: "top top", end: "70% top", scrub: true } });
      gsap.to("[data-hero-light]", { xPercent: 14, ease: "none", scrollTrigger: { trigger: root.current, start: "top top", end: "bottom bottom", scrub: true } });
      gsap.to("[data-hero-marker]", { yPercent: -60, opacity: 0, ease: "none", scrollTrigger: { trigger: root.current, start: "top top", end: "50% top", scrub: true } });
      gsap.to("[data-hero-tag]", { opacity: 0, ease: "none", scrollTrigger: { trigger: root.current, start: "top top", end: "40% top", scrub: true } });
      gsap.to("[data-hero-scroll]", { opacity: 0, ease: "none", scrollTrigger: { trigger: root.current, start: "top top", end: "12% top", scrub: true } });
    }, root);
    return () => ctx.revert();
  }, []);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (reduced) v.pause();
    else void v.play().catch(() => {});
  }, [reduced]);

  return (
    <section ref={root} id="top" className="relative h-[150vh] bg-abyss">
      <div className="sticky top-0 h-screen min-h-[620px] overflow-hidden">
        {/* ocean footage (colour-graded to the ABYSS palette) */}
        <div data-hero-bg className="absolute inset-[-4%]">
          <video ref={video} className="h-full w-full object-cover" autoPlay muted loop playsInline preload="auto" poster="/imagery/hero-poster.jpg" aria-hidden="true">
            <source src="/video/hero.mp4" type="video/mp4" />
          </video>
        </div>
        <div className="absolute inset-0 bg-[linear-gradient(100deg,rgba(6,18,17,0.92)_0%,rgba(6,18,17,0.6)_42%,rgba(6,18,17,0.15)_100%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,18,17,0.55)_0%,rgba(6,18,17,0)_30%,rgba(6,18,17,0)_60%,rgba(6,18,17,0.8)_100%)]" />

        {/* underwater light */}
        <div data-hero-light className="absolute inset-0 overflow-hidden mix-blend-screen" aria-hidden="true">
          <div className="light-sway absolute -top-[10%] left-[48%] h-[130%] w-[16%] bg-[linear-gradient(180deg,rgba(121,220,196,0.16),transparent_75%)] blur-2xl" />
          <div className="light-sway absolute -top-[10%] left-[64%] h-[130%] w-[9%] bg-[linear-gradient(180deg,rgba(168,215,201,0.12),transparent_70%)] blur-2xl [animation-delay:-5s]" />
          <div className="light-sway absolute -top-[10%] left-[78%] h-[130%] w-[12%] bg-[linear-gradient(180deg,rgba(121,220,196,0.1),transparent_72%)] blur-2xl [animation-delay:-9s]" />
        </div>

        {/* contour lines */}
        <svg className="absolute inset-0 h-full w-full opacity-[0.16]" viewBox="0 0 1440 900" preserveAspectRatio="none" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <path key={i} d={`M0 ${250 + i * 70} C 300 ${190 + i * 70}, 520 ${330 + i * 60}, 800 ${260 + i * 70} S 1250 ${200 + i * 70}, 1440 ${280 + i * 66}`} fill="none" stroke="#A8D7C9" strokeWidth="0.8" />
          ))}
        </svg>

        <div data-hero-wave className="absolute inset-0">
          <WaveField layers={LAYERS} getLift={() => progress.current * 1.02} />
        </div>
        <div className="grain absolute inset-0" />

        {/* observation marker */}
        <div data-hero-marker className="absolute right-[14%] top-[40%] hidden md:block" aria-hidden="true">
          <div className="relative h-24 w-24">
            <span className="absolute inset-0 rounded-full border border-mint/30 [animation:ping_5s_cubic-bezier(0,0,.2,1)_infinite]" />
            <span className="absolute inset-4 rounded-full border border-mint/40" />
            <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-mint" />
            <span className="absolute left-1/2 top-full h-28 w-px bg-gradient-to-b from-mint/50 to-transparent" />
          </div>
        </div>

        <div data-hero-type className="relative z-20 mx-auto flex h-full max-w-[1560px] flex-col justify-center px-6 pb-16 pt-28 md:px-10">
          <p data-hero-copy className="eyebrow mb-7">Sea Sentry AI <span className="mx-2 text-line">/</span> Coastal safety intelligence</p>
          <h1 className="font-display max-w-[15ch] text-[clamp(2.7rem,8.2vw,8.4rem)] font-medium uppercase leading-[0.9] tracking-[-0.025em] text-moon md:max-w-[13ch]">
            <span data-line="1" className="block overflow-hidden pb-[0.06em]"><span className="block">The ocean never stops moving.</span></span>
          </h1>
          <p className="font-serif-i mt-3 text-[clamp(2.2rem,6.2vw,6.2rem)] leading-[0.95] text-glass">
            <span data-line="2" className="block overflow-hidden pb-[0.12em]"><span className="block">Neither should its watch.</span></span>
          </p>
          <p data-hero-copy className="mt-9 max-w-[34rem] text-[1.02rem] leading-relaxed text-mist md:text-[1.1rem]">
            An intelligent coastal monitoring system that brings computer vision and real-time awareness together to support rescue teams.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link data-hero-cta href="/app" className="btn btn-primary">Explore the platform <span className="arrow" aria-hidden="true" /></Link>
            <a data-hero-cta href="#technology" onClick={(e) => { e.preventDefault(); document.getElementById("technology")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" }); }} className="btn btn-ghost">Discover the system</a>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-8 z-20 mx-auto flex max-w-[1560px] items-end justify-between px-6 md:px-10">
          <p data-hero-tag className="font-serif-i text-[1.15rem] text-moon/80">An eye in the sky. A rescuer at sea.</p>
          <div data-hero-scroll className="flex items-center gap-3 text-[0.68rem] uppercase tracking-[0.25em] text-mist" aria-hidden="true">
            Scroll
            <span className="relative h-12 w-px overflow-hidden bg-line">
              <span className="absolute inset-x-0 top-0 h-1/2 bg-mint [animation:scroll-cue_2.4s_ease-in-out_infinite]" />
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
