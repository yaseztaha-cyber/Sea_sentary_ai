"use client";

import { useEffect, useRef } from "react";
import { registerGsap, usePrefersReducedMotion, useIsMobile } from "@/lib/motion";

export type WaveLayer = {
  fill: string;
  opacity?: number;
  base: number; // 0..1 of container height (0 = top)
  amp: number; // px in 1000-unit space
  speed: number;
  freq: number;
  seed: number;
  stroke?: string;
};

const W = 1440;
const H = 900;

function wavePath(l: WaveLayer, t: number, lift: number, points: number) {
  const base = (l.base - lift) * H;
  const mod = 0.7 + 0.3 * Math.sin(t * 0.13 + l.seed);
  let d = "";
  for (let i = 0; i <= points; i++) {
    const x = (i / points) * W;
    const u = (x / W) * Math.PI * 2 * l.freq;
    // three non-commensurate components + a slowly drifting phase → the crest shape keeps changing instead of repeating
    const y =
      base +
      l.amp * mod * (0.62 * Math.sin(u + t * l.speed + l.seed) + 0.3 * Math.sin(u * 2.3 - t * l.speed * 0.71 + l.seed * 2.1) + 0.22 * Math.sin(u * 4.1 + t * l.speed * 1.9 + Math.sin(t * 0.21 + l.seed) * 2.4));
    d += (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1) + " ";
  }
  return d + `L${W} ${H + 10} L0 ${H + 10} Z`;
}

/** Layered, independently moving water surfaces. `getLift` lets scroll progress raise the water. */
export function WaveField({ layers, getLift, className = "" }: { layers: WaveLayer[]; getLift?: () => number; className?: string }) {
  const svg = useRef<SVGSVGElement>(null);
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const reduced = usePrefersReducedMotion();
  const mobile = useIsMobile();
  const liftRef = useRef(getLift);
  useEffect(() => {
    liftRef.current = getLift;
  }, [getLift]);

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const points = mobile ? 24 : 48;
    let raf = 0;
    let visible = true;
    const t0 = performance.now();
    const render = (t: number) => {
      const lift = liftRef.current?.() ?? 0;
      layers.forEach((l, i) => paths.current[i]?.setAttribute("d", wavePath(l, t, lift * (1 - i * 0.12), points)));
    };
    render(reduced ? 6 : 0);
    if (reduced) {
      // static, but still reacts to scroll position
      const onScroll = () => render(6);
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => window.removeEventListener("scroll", onScroll);
    }
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0 });
    io.observe(el);
    let last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || now - last < (mobile ? 50 : 33)) return;
      last = now;
      render((now - t0) / 1000);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [layers, reduced, mobile]);

  return (
    <svg ref={svg} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={`absolute inset-0 h-full w-full ${className}`} aria-hidden="true">
      {layers.map((l, i) => (
        <path key={i} ref={(n) => { paths.current[i] = n; }} fill={l.fill} fillOpacity={l.opacity ?? 1} stroke={l.stroke} strokeOpacity={0.5} strokeWidth={l.stroke ? 1.2 : 0} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

/**
 * Liquid boundary between two sections. The crest is re-shaped from real scroll progress
 * (ScrollTrigger scrub) — each `variant` has its own character so no two transitions match.
 */
export function LiquidEdge({ fill, variant = 0, flip = false, className = "", height = 160 }: { fill: string; variant?: number; flip?: boolean; className?: string; height?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const a = useRef<SVGPathElement>(null);
  const b = useRef<SVGPathElement>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const { ScrollTrigger } = registerGsap();
    const el = wrap.current;
    if (!el) return;
    const shape = (p: number, layer: number) => {
      const pts = 36;
      const k = [1.3, 2.1, 0.8, 1.7][variant % 4];
      const ph = [0, 1.7, 3.1, 4.4][variant % 4];
      let d = `M0 ${height + 2} `;
      for (let i = 0; i <= pts; i++) {
        const x = (i / pts) * W;
        const u = (x / W) * Math.PI * 2;
        const y = height * (0.52 + 0.18 * layer) + height * 0.3 * (0.6 * Math.sin(u * k + p * 7 + ph + layer) + 0.4 * Math.sin(u * k * 2.2 - p * 11 + ph * 1.7) * (0.4 + p * 0.6)) - p * height * 0.25 * (1 + layer);
        d += `L${x.toFixed(1)} ${y.toFixed(1)} `;
      }
      return d + `L${W} ${height + 2} Z`;
    };
    const set = (p: number) => {
      a.current?.setAttribute("d", shape(p, 0));
      b.current?.setAttribute("d", shape(p, 1));
    };
    set(0.3);
    if (reduced) return;
    const st = ScrollTrigger.create({ trigger: el, start: "top bottom", end: "bottom top", scrub: true, onUpdate: (s) => set(s.progress) });
    return () => st.kill();
  }, [variant, reduced, height]);

  return (
    <div ref={wrap} className={`pointer-events-none absolute inset-x-0 z-10 ${flip ? "top-0 rotate-180" : "bottom-0"} ${className}`} style={{ height }} aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" className="h-full w-full">
        <path ref={a} fill={fill} fillOpacity={0.35} />
        <path ref={b} fill={fill} />
      </svg>
    </div>
  );
}
