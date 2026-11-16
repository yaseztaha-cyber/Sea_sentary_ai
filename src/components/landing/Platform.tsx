import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { Reveal } from "./Reveal";

const SHOTS = [
  { file: "live-monitoring.png", title: "Live monitoring", span: "md:col-span-7" },
  { file: "ai-inspection.png", title: "AI inspection", span: "md:col-span-5" },
  { file: "activity-heatmap.png", title: "Activity heat map", span: "md:col-span-5" },
  { file: "incident-desk.png", title: "Incident desk", span: "md:col-span-7" },
];

export function Platform() {
  // Only real captures of the running application are shown. Missing files render an honest placeholder.
  const have = (f: string) => fs.existsSync(path.join(process.cwd(), "public", "screenshots", f));
  return (
    <section id="platform" className="relative bg-ocean py-28 md:py-40">
      <div className="mx-auto max-w-[1560px] px-6 md:px-10">
        <Reveal><p className="eyebrow mb-6">06 — The platform</p></Reveal>
        <Reveal delay={0.1}>
          <h2 className="font-display max-w-[16ch] text-[clamp(2.4rem,6vw,6rem)] font-medium uppercase leading-[0.95] tracking-[-0.02em]">Meet your coastal control center.</h2>
        </Reveal>

        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-12 md:gap-8">
          {SHOTS.map((s, i) => (
            <Reveal key={s.file} delay={(i % 2) * 0.1} className={s.span}>
              <figure className={i % 2 ? "md:mt-16" : ""}>
                <div className="relative overflow-hidden rounded-[8px] border border-line bg-abyss shadow-[0_30px_90px_rgba(0,0,0,0.5)]">
                  {have(s.file) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/screenshots/${s.file}`} alt={`${s.title} — screenshot of the Sea Sentry AI application`} loading="lazy" className="aspect-[16/10] w-full object-cover object-top" />
                  ) : (
                    <div className="grid aspect-[16/10] place-items-center p-6 text-center">
                      <p className="max-w-xs text-[0.85rem] text-mist">Screenshot not captured yet. Only real captures of the running application are shown here.</p>
                    </div>
                  )}
                </div>
                <figcaption className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="font-display text-xl font-medium uppercase tracking-wide">{s.title}</span>
                  <span className="font-mono text-[0.68rem] text-mist max-md:hidden">real capture · Chromium virtual camera</span>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-20 flex justify-center">
          <Link href="/app" className="btn btn-primary">Enter Sea Sentry <span className="arrow" aria-hidden="true" /></Link>
        </Reveal>
      </div>
    </section>
  );
}
