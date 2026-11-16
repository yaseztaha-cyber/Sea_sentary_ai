"use client";

import { useLayoutEffect, useRef } from "react";
import { registerGsap } from "@/lib/motion";
import { Reveal } from "./Reveal";

const STEPS = [
  { n: "01", t: "Camera intelligence", d: "Person detection, tracking, activity maps and explainable screening from one camera.", now: true },
  { n: "02", t: "Connected sensors", d: "More cameras and environmental sensors feeding a single picture of the coast." },
  { n: "03", t: "Aerial observation", d: "Elevated viewpoints that widen what a team can see." },
  { n: "04", t: "Advanced coastal intelligence", d: "Water-specific distress models — only after independent validation." },
];

export function Future() {
  const root = useRef<HTMLElement>(null);
  const path = useRef<SVGPathElement>(null);

  useLayoutEffect(() => {
    const { gsap } = registerGsap();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !path.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(path.current, { strokeDashoffset: 100 }, { strokeDashoffset: 0, ease: "none", scrollTrigger: { trigger: root.current, start: "top 60%", end: "bottom 70%", scrub: true } });
    }, root);
    return () => ctx.revert();
  }, []);

  return (
    <section ref={root} id="future" className="relative bg-ocean py-28 md:py-40">
      <div className="mx-auto max-w-[1560px] px-6 md:px-10">
        <Reveal><p className="eyebrow mb-6">08 — Future vision</p></Reveal>
        <Reveal delay={0.1}>
          <h2 className="font-display text-[clamp(2.4rem,6vw,6rem)] font-medium uppercase leading-[0.95] tracking-[-0.02em]">Where the tide <span className="font-serif-i normal-case text-glass">goes next.</span></h2>
        </Reveal>

        <div className="relative mt-20">
          <svg className="absolute inset-x-0 top-[22px] hidden h-14 w-full md:block" viewBox="0 0 1000 56" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 28 C 80 6, 170 50, 250 28 S 420 6, 500 28 S 670 50, 750 28 S 920 6, 1000 28" fill="none" stroke="#1D3430" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            <path ref={path} d="M0 28 C 80 6, 170 50, 250 28 S 420 6, 500 28 S 670 50, 750 28 S 920 6, 1000 28" fill="none" stroke="#79DCC4" strokeWidth="2.4" pathLength="100" strokeDasharray="100" vectorEffect="non-scaling-stroke" />
          </svg>
          <ol className="relative grid gap-10 md:grid-cols-4 md:gap-8">
            {STEPS.map((s, i) => (
              <Reveal as="li" key={s.n} delay={i * 0.12} className="relative border-l border-line pl-6 md:border-l-0 md:pl-0 md:pt-20">
                <span className={`absolute -left-[7px] top-1 h-3.5 w-3.5 rounded-full border-2 md:left-0 md:top-[21px] md:h-[18px] md:w-[18px] ${s.now ? "border-mint bg-mint" : "border-teal bg-ocean"}`} />
                <p className={`font-mono text-[0.72rem] ${s.now ? "text-mint" : "text-mist"}`}>{s.n} — {s.now ? "AVAILABLE NOW · V1 · EXPERIMENTAL" : "PLANNED · NOT BUILT"}</p>
                <h3 className="font-display mt-3 text-[1.5rem] font-medium uppercase leading-tight">{s.t}</h3>
                <p className="mt-3 max-w-[22rem] text-[0.92rem] leading-relaxed text-mist">{s.d}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
