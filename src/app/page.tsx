import { Nav } from "@/components/landing/Nav";
import { Hero } from "@/components/landing/Hero";
import { Depth } from "@/components/landing/Depth";
import { System } from "@/components/landing/System";
import { Experience } from "@/components/landing/Experience";
import { Journey } from "@/components/landing/Journey";
import { Platform } from "@/components/landing/Platform";
import { About } from "@/components/landing/About";
import { Future } from "@/components/landing/Future";
import { Final } from "@/components/landing/Final";

export default function LandingPage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Depth />
        <System />
        <Experience />
        <Journey />
        <Platform />
        <About />
        <Future />
        <Final />
      </main>
    </>
  );
}
