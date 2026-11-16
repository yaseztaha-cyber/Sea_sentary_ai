"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { registerGsap } from "@/lib/motion";

const STAGES = [
  { t: "Observation", d: "The camera watches. Nothing is flagged." },
  { t: "Unusual activity", d: "A tracked path breaks from normal movement." },
  { t: "Incident", d: "A rule-matched observation opens a stored incident with evidence." },
  { t: "Notification", d: "The console alerts the operator. Only in-app in V1." },
  { t: "Human response", d: "A trained person reviews and decides. Always." },
];

export function Journey() {
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const [p, setP] = useState(0);

  useLayoutEffect(() => {
    const { ScrollTrigger } = registerGsap();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const st = ScrollTrigger.create({
      trigger: root.current,
      start: "top top",
      end: "bottom bottom",
      scrub: reduce ? false : true,
      onUpdate: (s) => {
        setP(s.progress);
        setActive(Math.min(STAGES.length - 1, Math.floor(s.progress * STAGES.length)));
      },
    });
    return () => st.kill();
  }, []);

  const show = (i: number) => ({ opacity: active === i ? 1 : 0, transform: active === i ? "none" : "translateY(24px) scale(0.985)", pointerEvents: active === i ? ("auto" as const) : ("none" as const) });

  return (
    <section ref={root} id="journey" className="relative h-[520vh] bg-abyss">
      <div className="sticky top-0 flex h-screen min-h-[600px] flex-col overflow-hidden">
        <div className="mx-auto flex w-full max-w-[1560px] flex-1 flex-col gap-6 px-6 pb-8 pt-24 md:grid md:grid-cols-[0.9fr_1.4fr] md:items-center md:gap-14 md:px-10">
          <div>
            <p className="eyebrow mb-5">05 — The incident journey</p>
            <p className="font-mono text-[0.8rem] text-mint">0{active + 1} / 05</p>
            <div className="relative mt-2 h-[clamp(5.5rem,13vw,11rem)] overflow-hidden">
              {STAGES.map((s, i) => (
                <h2 key={s.t} className="font-display absolute inset-x-0 top-0 text-[clamp(1.9rem,3.6vw,3.6rem)] font-medium uppercase leading-[0.95] tracking-[-0.02em] transition-all duration-700" style={{ opacity: active === i ? 1 : 0, transform: active === i ? "none" : active > i ? "translateY(-40%)" : "translateY(40%)" }}>
                  {s.t}
                </h2>
              ))}
            </div>
            <div className="relative h-14">
              {STAGES.map((s, i) => (
                <p key={s.t} className="absolute inset-x-0 top-0 max-w-sm text-[1rem] leading-relaxed text-mist transition-all duration-700" style={{ opacity: active === i ? 1 : 0, transform: active === i ? "none" : "translateY(10px)" }}>{s.d}</p>
              ))}
            </div>
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden rounded-[70px_8px_70px_8px] border border-line bg-ocean md:aspect-[16/10] md:flex-none max-md:rounded-[8px]">
            {/* shared camera frame */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/imagery/demo-poster.jpg" alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-all duration-1000" style={{ filter: active >= 2 ? "brightness(0.35) blur(3px)" : active === 1 ? "brightness(0.8)" : "none", transform: active === 0 ? "scale(1.02)" : "scale(1.08)" }} />
            <svg viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden="true">
              {/* stage 1: calm tracked path, then stage 2: path becomes erratic */}
              <path d="M470 430 C 520 410, 570 430, 640 405" fill="none" stroke="#79DCC4" strokeWidth="3" strokeLinecap="round" pathLength="100" strokeDasharray="100" strokeDashoffset={active === 0 ? 100 - Math.min(100, p * 5 * 100) : 0} style={{ opacity: active <= 1 ? 1 : 0, transition: "opacity .6s" }} />
              <path d="M640 405 C 700 380, 640 340, 690 350 S 740 420, 680 410 S 650 340, 705 372 S 740 330, 700 318" fill="none" stroke="#E6B86C" strokeWidth="3.2" strokeLinecap="round" pathLength="100" strokeDasharray="100" strokeDashoffset={active === 1 ? 100 - Math.min(100, ((p * 5 - 1) % 1) * 100) : active > 1 ? 0 : 100} style={{ opacity: active <= 1 ? 1 : 0, transition: "opacity .6s" }} />
              <rect x="640" y="285" width="60" height="150" fill="none" stroke={active === 1 ? "#E6B86C" : "#79DCC4"} strokeWidth="2" style={{ opacity: active <= 1 ? 1 : 0, transition: "all .6s" }} />
            </svg>
            <span className="absolute left-3 top-3 rounded bg-abyss/80 px-2 py-1 text-[0.62rem] uppercase tracking-[0.16em] text-mist">Illustrative sequence · recorded clip frame</span>

            {/* stage 3: incident */}
            <div className="absolute inset-0 grid place-items-center p-6 transition-all duration-700" style={show(2)}>
              <div className="w-full max-w-md rounded-[7px] border border-coral/50 bg-ocean p-5 shadow-2xl">
                <div className="flex items-center justify-between"><span className="font-mono text-[0.75rem] text-moon">INC-0007</span><span className="rounded border border-coral/40 bg-coral/10 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-coral">New</span></div>
                <p className="mt-3 font-display text-xl text-coral">Level 3 · Potential distress indicators</p>
                <dl className="mt-4 grid grid-cols-2 gap-3 font-mono text-[0.72rem] text-mist"><div><dt>Track</dt><dd className="text-moon">#4</dd></div><div><dt>Evidence</dt><dd className="text-moon">original · annotated</dd></div></dl>
                <p className="mt-4 text-[0.72rem] font-semibold tracking-[0.12em] text-amber">EXPERIMENTAL — HUMAN REVIEW REQUIRED</p>
              </div>
            </div>
            {/* stage 4: notification */}
            <div className="absolute inset-0 grid place-items-center p-6 transition-all duration-700" style={show(3)}>
              <div className="w-full max-w-sm space-y-3">
                <div className="rounded-[7px] border border-coral/50 bg-ocean p-4 shadow-2xl"><p className="text-[0.85rem] font-semibold text-coral">INC-0007 — Level 3 · Potential distress indicators</p><p className="mt-1 text-[0.78rem] text-mist">In-app notification. No external responder is contacted.</p><p className="mt-2 text-[0.78rem] text-mint">Open in Incident Desk →</p></div>
                <div className="rounded-[7px] border border-line bg-ocean/90 p-4 text-[0.78rem] text-mist">Browser notification · local audio alert (optional)</div>
              </div>
            </div>
            {/* stage 5: human */}
            <div className="absolute inset-0 grid place-items-center bg-abyss/55 p-8 text-center transition-all duration-700" style={show(4)}>
              <p className="font-serif-i max-w-xl text-[clamp(1.8rem,4vw,3.6rem)] leading-[1.05] text-moon">The final rescue decision belongs to a trained human.</p>
            </div>
          </div>
        </div>

        {/* progress path */}
        <div className="mx-auto w-full max-w-[1560px] px-6 pb-8 md:px-10" aria-hidden="true">
          <div className="relative h-8">
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1000 32" preserveAspectRatio="none">
              <path d="M0 16 C 100 2, 150 30, 250 16 S 400 2, 500 16 S 650 30, 750 16 S 900 2, 1000 16" fill="none" stroke="#1D3430" strokeWidth="2" vectorEffect="non-scaling-stroke" />
              <path d="M0 16 C 100 2, 150 30, 250 16 S 400 2, 500 16 S 650 30, 750 16 S 900 2, 1000 16" fill="none" stroke="#79DCC4" strokeWidth="2.4" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - p * 100} vectorEffect="non-scaling-stroke" />
            </svg>
            {STAGES.map((s, i) => (
              <span key={s.t} className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-all duration-500 ${active >= i ? "border-mint bg-mint" : "border-line bg-abyss"}`} style={{ left: `${(i / (STAGES.length - 1)) * 100}%` }} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
