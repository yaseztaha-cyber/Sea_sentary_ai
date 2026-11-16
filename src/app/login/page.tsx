import { LoginForm } from "@/components/app/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center bg-abyss px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.28em] text-glass">Sea Sentry AI</p>
          <h1 className="mt-2 font-display text-3xl text-moon">Operator access</h1>
          <p className="mt-2 text-[0.82rem] leading-relaxed text-mist">The monitoring console, incident evidence and camera controls are restricted to the configured operator.</p>
        </div>
        {sp.error === "not-configured" && (
          <p className="mb-3 rounded border border-coral/50 bg-coral/10 p-3 text-[0.78rem] text-coral">Operator access is not configured on this deployment. Set OPERATOR_PASSWORD (or OPERATOR_PASSWORD_HASH) and SESSION_SECRET.</p>
        )}
        <LoginForm next={sp.next || "/app"} />
        <p className="mt-4 text-center text-[0.7rem] leading-relaxed text-mist">No public registration. Sessions expire after 12 hours. The public landing page remains open.</p>
      </div>
    </main>
  );
}
