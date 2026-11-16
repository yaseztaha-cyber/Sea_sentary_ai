"use client";

import { useState } from "react";

export function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="rounded-[7px] border border-line bg-depth/40 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(j.error || `Login failed (${r.status})`);
          window.location.assign(next.startsWith("/app") ? next : "/app");
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <label className="block text-[0.74rem] text-mist" htmlFor="operator-password">Operator password</label>
      <input
        id="operator-password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="mt-1 h-10 w-full rounded-[5px] border border-line bg-abyss/70 px-3 font-mono text-sm text-moon outline-none focus:border-mint"
        required
      />
      {error && <p className="mt-2 text-[0.76rem] text-coral">{error}</p>}
      <button disabled={busy} className="mt-3 h-10 w-full rounded-[5px] bg-mint font-semibold text-abyss disabled:opacity-50" type="submit">
        {busy ? "Verifying…" : "Enter console"}
      </button>
    </form>
  );
}
