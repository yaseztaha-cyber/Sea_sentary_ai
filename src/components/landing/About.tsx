"use client";

import { useLayoutEffect, useRef } from "react";
import { registerGsap } from "@/lib/motion";
import { Reveal } from "./Reveal";
import { LiquidEdge } from "./Waves";

export function About() {
  const root = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const { gsap } = registerGsap();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      gsap.fromTo("[data-about-img]", { yPercent: -8, scale: 1.2 }, { yPercent: 8, scale: 1.05, ease: "none", scrollTrigger: { trigger: root.current, start: "top bottom", end: "bottom top", scrub: true } });
      gsap.fromTo("[data-about-name]", { xPercent: 8 }, { xPercent: -6, ease: "none", scrollTrigger: { trigger: root.current, start: "top bottom", end: "bottom top", scrub: true } });
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={root} id="about" className="relative overflow-hidden bg-abyss py-28 md:py-44">
      <div className="mx-auto grid max-w-[1560px] gap-12 px-6 md:grid-cols-12 md:items-center md:px-10">
        <div className="md:col-span-7">
          <Reveal><p className="eyebrow mb-8">07 — About the project</p></Reveal>
          <Reveal delay={0.1}>
            <h2 className="font-display text-[clamp(2.6rem,7vw,7.2rem)] font-medium uppercase leading-[0.92] tracking-[-0.025em]">Built to watch over what matters.</h2>
          </Reveal>
          <Reveal delay={0.2} className="mt-12 max-w-xl">
            <p className="text-[1.05rem] leading-relaxed text-moon/80">Sea Sentry AI is an independently developed technology project exploring the use of computer vision and intelligent monitoring to support coastal safety and rescue assistance.</p>
          </Reveal>
          <Reveal delay={0.3} className="mt-10">
            <p className="font-serif-i text-[clamp(2rem,4.4vw,4.2rem)] leading-none text-glass">Eyad Sherif Elbagoury</p>
            <p className="mt-3 text-[0.78rem] uppercase tracking-[0.22em] text-mist">Project Creator &amp; Developer</p>
          </Reveal>
        </div>

        <div className="relative md:col-span-5">
          <div className="relative aspect-[4/5] overflow-hidden rounded-[140px_8px_140px_8px] border border-line max-md:rounded-[60px_8px_60px_8px]">
            <div data-about-img className="absolute inset-[-10%]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/imagery/foam.jpg" alt="Dark ocean breaking against coastal rock" loading="lazy" className="h-full w-full object-cover" />
            </div>
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(6,18,17,0.1),rgba(6,18,17,0.65))]" />
            <div className="grain absolute inset-0" />
          </div>
          <p data-about-name aria-hidden="true" className="font-display pointer-events-none absolute -left-10 bottom-8 hidden whitespace-nowrap text-[7rem] font-medium uppercase leading-none tracking-tighter text-moon/[0.07] lg:block">Sentry</p>
        </div>
      </div>
      <LiquidEdge fill="#0A1C1B" variant={3} height={150} />
    </section>
  );
}
