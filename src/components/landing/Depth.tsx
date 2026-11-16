"use client";

import { useLayoutEffect, useRef } from "react";
import { registerGsap } from "@/lib/motion";
import { LiquidEdge } from "./Waves";
import { Reveal } from "./Reveal";

export function Depth() {
  const root = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const { gsap } = registerGsap();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = gsap.context(() => {
      const st = { trigger: root.current, start: "top 80%", end: "center 40%", scrub: 0.6 };
      // the ocean opens up as you arrive: an organic mask grows to reveal the full image
      gsap.fromTo("[data-depth-mask]", { clipPath: "inset(14% 22% 14% 22% round 120px 40px 160px 60px)" }, { clipPath: "inset(0% 0% 0% 0% round 0px)", ease: "none", scrollTrigger: st });
      gsap.fromTo("[data-depth-img]", { yPercent: -10, scale: 1.25 }, { yPercent: 10, scale: 1.05, ease: "none", scrollTrigger: { trigger: root.current, start: "top bottom", end: "bottom top", scrub: true } });
      gsap.fromTo("[data-depth-inset]", { yPercent: 18 }, { yPercent: -26, ease: "none", scrollTrigger: { trigger: root.current, start: "top bottom", end: "bottom top", scrub: true } });
      gsap.fromTo("[data-depth-particles]", { yPercent: 0 }, { yPercent: -30, ease: "none", scrollTrigger: { trigger: root.current, start: "top bottom", end: "bottom top", scrub: true } });
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={root} id="depth" className="relative z-10 -mt-[28vh] min-h-[120vh] overflow-hidden bg-abyss py-28 md:py-0">
      <div data-depth-mask className="absolute inset-0 md:min-h-[120vh]">
        <div data-depth-img className="absolute inset-[-12%]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/imagery/deep.jpg" alt="Sunlight falling through dark, deep water" loading="lazy" className="h-full w-full object-cover" />
        </div>
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(6,18,17,0.9)_0%,rgba(6,18,17,0.55)_45%,rgba(6,18,17,0.1)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_20%,rgba(121,220,196,0.12),transparent_60%)]" />
        <div className="grain absolute inset-0" />
      </div>

      <div className="relative z-20 mx-auto flex min-h-[120vh] max-w-[1560px] flex-col justify-center px-6 md:px-10">
        <Reveal><p className="eyebrow mb-8">02 — The depth</p></Reveal>
        <Reveal delay={0.1}>
          <h2 className="font-display max-w-[11ch] text-[clamp(2.6rem,7.4vw,7.6rem)] font-medium uppercase leading-[0.92] tracking-[-0.02em]">
            The coast is beautiful.
          </h2>
        </Reveal>
        <Reveal delay={0.2}>
          <p className="font-serif-i mt-2 text-[clamp(2.2rem,6vw,6rem)] leading-none text-glass">And unpredictable.</p>
        </Reveal>
        <Reveal delay={0.3} className="mt-10 max-w-[30rem]">
          <p className="text-[1.05rem] leading-relaxed text-moon/80">Watching every metre of shoreline, every minute, is hard. Intelligent monitoring gives human lookouts a steadier set of eyes.</p>
        </Reveal>

        <div data-depth-inset className="absolute bottom-[8%] right-6 hidden w-[min(30vw,430px)] md:right-10 md:block">
          <div className="relative overflow-hidden rounded-[60px_8px_90px_8px] border border-moon/10 shadow-[0_30px_80px_rgba(0,0,0,0.6)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/imagery/coast.jpg" alt="Aerial view of waves breaking against a rocky coast" loading="lazy" className="aspect-[4/5] w-full object-cover saturate-[0.85]" />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,transparent_55%,rgba(6,18,17,0.7))]" />
          </div>
        </div>
      </div>
      <LiquidEdge fill="#0A1C1B" variant={1} height={180} />
    </section>
  );
}
