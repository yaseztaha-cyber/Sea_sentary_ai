"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/Logo";

const LINKS = [
  { id: "top", label: "Home" },
  { id: "technology", label: "Technology" },
  { id: "experience", label: "Experience" },
  { id: "about", label: "About" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("top");

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 48);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActive(e.target.id)),
      { rootMargin: "-45% 0px -50% 0px" },
    );
    LINKS.forEach((l) => {
      const el = document.getElementById(l.id);
      if (el) io.observe(el);
    });
    return () => {
      window.removeEventListener("scroll", onScroll);
      io.disconnect();
    };
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const go = (id: string) => {
    setOpen(false);
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  return (
    <>
      <header className={`fixed inset-x-0 top-0 z-[60] transition-all duration-500 ${scrolled ? "border-b border-line/80 bg-abyss/80 py-3 backdrop-blur-md" : "border-b border-transparent py-6"}`}>
        <div className="mx-auto grid max-w-[1560px] grid-cols-[1fr_auto] items-center gap-4 px-6 md:grid-cols-[1fr_auto_1fr] md:px-10">
          <button onClick={() => go("top")} aria-label="Sea Sentry AI — top" className="justify-self-start">
            <Logo size={scrolled ? 30 : 34} className="transition-all duration-500" />
          </button>
          <nav className="hidden items-center gap-9 md:flex" aria-label="Sections">
            {LINKS.map((l) => (
              <a key={l.id} href={`#${l.id}`} onClick={(e) => { e.preventDefault(); go(l.id); }} className={`relative py-1 text-[0.8rem] font-medium tracking-wide transition-colors duration-300 ${active === l.id ? "text-moon" : "text-mist hover:text-moon"}`}>
                {l.label}
                <span className={`absolute -bottom-0.5 left-0 h-px bg-mint transition-all duration-500 ${active === l.id ? "w-full" : "w-0"}`} />
              </a>
            ))}
          </nav>
          <div className="flex items-center justify-self-end gap-3">
            <Link href="/app" className="btn btn-ghost hidden !h-10 md:inline-flex">
              Open platform <span className="arrow" aria-hidden="true" />
            </Link>
            <button onClick={() => setOpen((o) => !o)} className="relative z-[60] grid h-10 w-10 place-items-center md:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}>
              <span className={`absolute h-px w-6 bg-moon transition-all duration-500 ${open ? "rotate-45" : "-translate-y-[5px]"}`} />
              <span className={`absolute h-px w-6 bg-moon transition-all duration-500 ${open ? "-rotate-45" : "translate-y-[5px]"}`} />
            </button>
          </div>
        </div>
      </header>

      {/* mobile menu: circular water-drop reveal */}
      <div
        className="fixed inset-0 z-[55] bg-abyss transition-[clip-path] duration-700 ease-[cubic-bezier(.7,0,.2,1)] md:hidden"
        style={{ clipPath: open ? "circle(150% at calc(100% - 2.2rem) 2.2rem)" : "circle(0% at calc(100% - 2.2rem) 2.2rem)" }}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="flex h-full flex-col justify-between px-8 pb-12 pt-28">
          <ul className="space-y-2">
            {LINKS.map((l, i) => (
              <li key={l.id} className="overflow-hidden">
                <a href={`#${l.id}`} onClick={(e) => { e.preventDefault(); go(l.id); }} className="font-display block text-[2.6rem] font-medium leading-tight text-moon transition-all duration-700" style={{ transform: open ? "none" : "translateY(110%)", transitionDelay: open ? `${250 + i * 70}ms` : "0ms" }}>
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <Link href="/app" className="btn btn-primary justify-center" onClick={() => setOpen(false)}>Open platform <span className="arrow" aria-hidden="true" /></Link>
        </div>
      </div>
    </>
  );
}
