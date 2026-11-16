"use client";

import { useEffect, useRef, useState } from "react";
import { Reveal } from "./Reveal";
import { LiquidEdge } from "./Waves";

const STAGES = [
  { n: "01", t: "Observe", d: "A camera watches the water. Frames arrive continuously from a USB webcam." },
  { n: "02", t: "Detect", d: "A person detector finds people in each frame and reports how sure it is." },
  { n: "03", t: "Track", d: "Anonymous IDs follow each person from frame to frame and draw their path." },
  { n: "04", t: "Analyze", d: "Movement over time is screened against transparent rules, inside zones you draw." },
  { n: "05", t: "Respond", d: "Only a rule-matched observation opens an incident. A trained human decides what happens next." },
];

// positions of the two people in the demo clip's poster frame (fractions of the frame)
const P = { a: { x: 0.505, y: 0.395, w: 0.03, h: 0.18 }, b: { x: 0.54, y: 0.405, w: 0.03, h: 0.17 } };

function Visual({ i }: { i: number }) {
  return (
    <div className="absolute inset-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/imagery/demo-poster.jpg" alt="" loading="lazy" className={`h-full w-full object-cover transition-all duration-1000 ${i === 3 ? "scale-110 brightness-[0.55]" : i === 4 ? "scale-125 brightness-[0.4] blur-[2px]" : "scale-100"}`} style={{ transformOrigin: "52% 48%" }} />
      <svg viewBox="0 0 1280 720" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        {/* detect */}
        <g style={{ opacity: i >= 1 && i <= 3 ? 1 : 0, transition: "opacity .8s" }}>
          {[P.a, P.b].map((b, k) => (
            <g key={k}>
              <rect x={b.x * 1280 - 6} y={b.y * 720 - 6} width={b.w * 1280 + 12} height={b.h * 720 + 12} fill="none" stroke="#A8D7C9" strokeWidth="2" />
              {i >= 2 && <rect x={b.x * 1280 - 6} y={b.y * 720 - 26} width="44" height="20" fill="#79DCC4" />}
              {i >= 2 && <text x={b.x * 1280 - 1} y={b.y * 720 - 11} fontFamily="IBM Plex Mono" fontSize="13" fill="#061211">ID {k + 1}</text>}
            </g>
          ))}
        </g>
        {/* track */}
        <g style={{ opacity: i >= 2 && i <= 3 ? 1 : 0, transition: "opacity .8s" }} fill="none" strokeLinecap="round">
          <path d="M470 420 C 520 400, 560 440, 640 400 S 700 380, 655 330" stroke="#79DCC4" strokeWidth="3" strokeDasharray="6 8" />
          <path d="M760 430 C 720 450, 700 410, 690 380" stroke="#79DCC4" strokeWidth="3" strokeDasharray="6 8" />
        </g>
        {/* analyze: zone */}
        <g style={{ opacity: i === 3 ? 1 : 0, transition: "opacity .8s" }}>
          <polygon points="0,0 1280,0 1280,250 900,290 420,270 0,300" fill="#79DCC4" fillOpacity="0.14" stroke="#79DCC4" strokeWidth="2" strokeDasharray="8 6" />
          <text x="40" y="60" fontFamily="Manrope" fontSize="22" fill="#79DCC4">swimming zone</text>
        </g>
      </svg>
      {i === 4 && (
        <div className="absolute inset-0 grid place-items-center p-6">
          <div className="w-full max-w-sm rounded-[7px] border border-coral/50 bg-ocean/95 p-5 shadow-2xl">
            <p className="font-mono text-[0.7rem] text-mist">INC-0001 · illustrative</p>
            <p className="mt-1 font-display text-lg text-coral">Level 3 · Potential distress indicators</p>
            <p className="mt-2 text-[0.82rem] text-mist">Experimental screening. A person reviews the evidence and decides.</p>
            <div className="mt-4 flex gap-2 text-[0.7rem] font-semibold uppercase tracking-wider">
              <span className="rounded bg-mint px-3 py-2 text-abyss">Acknowledge</span>
              <span className="rounded border border-line px-3 py-2 text-moon">False alarm</span>
            </div>
          </div>
        </div>
      )}
      <span className="absolute bottom-3 left-3 rounded bg-abyss/80 px-2 py-1 text-[0.62rem] uppercase tracking-[0.16em] text-mist">{i === 0 ? "Recorded demo clip" : "Conceptual visual — see the live demo below for real results"}</span>
    </div>
  );
}

export function System() {
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const root = useRef<HTMLElement>(null);
  const visible = useRef(false);

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => (visible.current = e.isIntersecting), { threshold: 0.3 });
    if (root.current) io.observe(root.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!auto || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => visible.current && setActive((a) => (a + 1) % STAGES.length), 4800);
    return () => clearInterval(id);
  }, [auto]);

  const pct = (active / (STAGES.length - 1)) * 100;

  return (
    <section ref={root} id="technology" className="relative bg-ocean pb-40 pt-28 md:pt-36">
      <div className="mx-auto max-w-[1560px] px-6 md:px-10">
        <Reveal><p className="eyebrow mb-6">03 — The system</p></Reveal>
        <Reveal delay={0.1}>
          <h2 className="font-display text-[clamp(2.4rem,6vw,6rem)] font-medium uppercase leading-[0.95] tracking-[-0.02em]">
            One system. <span className="font-serif-i normal-case text-glass">Five steps.</span>
          </h2>
        </Reveal>

        <div className="mt-14 grid gap-10 lg:grid-cols-[minmax(320px,0.8fr)_1.5fr] lg:gap-16">
          <div className="relative">
            {/* organic connecting path with progress */}
            <svg className="absolute left-0 top-3 hidden h-[calc(100%-1.5rem)] w-10 lg:block" viewBox="0 0 40 500" preserveAspectRatio="none" aria-hidden="true">
              <path d="M20 0 C 4 50, 36 90, 20 125 S 4 190, 20 250 S 36 320, 20 375 S 6 440, 20 500" fill="none" stroke="#1D3430" strokeWidth="2" />
              <path d="M20 0 C 4 50, 36 90, 20 125 S 4 190, 20 250 S 36 320, 20 375 S 6 440, 20 500" fill="none" stroke="#79DCC4" strokeWidth="2.4" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - pct} style={{ transition: "stroke-dashoffset 1s cubic-bezier(.6,0,.2,1)" }} />
            </svg>
            <ol className="space-y-2 lg:pl-14">
              {STAGES.map((s, i) => (
                <li key={s.n}>
                  <button onClick={() => { setActive(i); setAuto(false); }} aria-pressed={active === i} className={`group relative block w-full rounded-[7px] border px-5 py-4 text-left transition-all duration-500 ${active === i ? "border-mint/40 bg-depth" : "border-transparent hover:bg-depth/40"}`}>
                    <span className="flex items-baseline gap-4">
                      <span className={`font-mono text-[0.78rem] transition-colors ${active === i ? "text-mint" : "text-mist"}`}>{s.n}</span>
                      <span className={`font-display text-[1.7rem] font-medium uppercase tracking-wide transition-colors ${active === i ? "text-moon" : "text-mist group-hover:text-moon"}`}>{s.t}</span>
                    </span>
                    <span className="grid transition-all duration-500" style={{ gridTemplateRows: active === i ? "1fr" : "0fr" }}>
                      <span className="overflow-hidden"><span className="block pt-2 pl-11 text-[0.95rem] leading-relaxed text-mist">{s.d}</span></span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>

          <div className="relative aspect-[16/10] overflow-hidden rounded-[8px_70px_8px_70px] border border-line bg-abyss">
            <Visual i={active} />
            <div className="absolute inset-x-0 bottom-0 h-1 bg-line"><div className="h-full bg-mint transition-all duration-1000" style={{ width: `${((active + 1) / STAGES.length) * 100}%` }} /></div>
          </div>
        </div>
      </div>
      <LiquidEdge fill="#061211" variant={2} height={150} />
    </section>
  );
}
