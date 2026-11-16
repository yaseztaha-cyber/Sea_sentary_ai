type Props = { tone?: "dark" | "light"; size?: number; wordmark?: boolean; className?: string };

/** Observation point · two connected wave forms · coastal horizon. */
export function LogoMark({ tone = "dark", size = 36 }: { tone?: "dark" | "light"; size?: number }) {
  const fg = tone === "dark" ? "#E7EEE8" : "#061211";
  const accent = tone === "dark" ? "#79DCC4" : "#26786F";
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M3 25h14M31 25h14" stroke={fg} strokeOpacity="0.45" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="24" cy="12" r="3.4" fill={accent} />
      <path d="M17.5 16.5a9.2 9.2 0 0 0 13 0" stroke={accent} strokeOpacity="0.55" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4 33c5-6.5 9.5-6.5 14 0s9 6.5 13.5 0S40 28 44 31" stroke={fg} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 42c5-6.5 9.5-6.5 14 0s9 6.5 13.5 0S40 37 44 40" stroke={accent} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ tone = "dark", size = 34, wordmark = true, className = "" }: Props) {
  const fg = tone === "dark" ? "text-moon" : "text-abyss";
  return (
    <span className={`inline-flex items-center gap-3 ${className}`}>
      <LogoMark tone={tone} size={size} />
      {wordmark && (
        <span className={`font-display text-[1.02rem] font-medium leading-none tracking-[0.2em] ${fg}`}>
          SEA SENTRY <span className={tone === "dark" ? "text-mint" : "text-teal"}>AI</span>
        </span>
      )}
    </span>
  );
}
