import crypto from "node:crypto";

/**
 * Provider-independent phone-call interface. The only adapter implemented is
 * Twilio Programmable Voice, which is optional and must be explicitly
 * configured. A call is only reported as completed when the provider's status
 * callback says so; an HTTP 201 from the API means "initiated", nothing more.
 */

export type CallAttemptState =
  | "ATTEMPTED"
  | "INITIATED"
  | "RINGING"
  | "ANSWERED"
  | "COMPLETED"
  | "FAILED"
  | "BUSY"
  | "NO_ANSWER"
  | "CANCELED";

export type CallRequest = {
  to: string;
  incidentId: number;
  incidentRef: string;
  idempotencyKey: string;
  twimlUrl: string;
  statusCallbackUrl: string;
};

export type CallResult = {
  ok: boolean;
  state: CallAttemptState;
  providerId: string | null;
  providerStatus: string | null;
  error: string | null;
  detail?: Record<string, unknown>;
};

export interface PhoneCallProvider {
  readonly id: string;
  configured(): boolean;
  verify(): Promise<{ ok: boolean; error: string | null; account: Record<string, unknown> | null; balance: Record<string, unknown> | null }>;
  placeCall(req: CallRequest): Promise<CallResult>;
  cancelCall?(providerId: string): Promise<boolean>;
}

const EMERGENCY_NUMBERS = new Set(["911", "112", "999", "000", "110", "119", "120", "118", "102", "101", "+911", "+112", "+999", "+000"]);

export function normalizePhoneNumber(raw: string): string | null {
  const compact = raw.replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(compact)) return null;
  if (EMERGENCY_NUMBERS.has(compact) || EMERGENCY_NUMBERS.has(compact.slice(1))) return null;
  return compact;
}

export function isEmergencyNumber(raw: string): boolean {
  const compact = raw.replace(/[\s().-]/g, "");
  return EMERGENCY_NUMBERS.has(compact) || EMERGENCY_NUMBERS.has(compact.replace(/^\+/, ""));
}

export function validateResponders(numbers: string[]): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of numbers) {
    const n = normalizePhoneNumber(raw);
    if (n) valid.push(n);
    else invalid.push(raw);
  }
  return { valid, invalid };
}

const API = () => (process.env.TWILIO_API_BASE ?? "https://api.twilio.com").replace(/\/$/, "");

function env(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

export function phoneConfigStatus() {
  const sid = env("TWILIO_ACCOUNT_SID");
  const token = env("TWILIO_AUTH_TOKEN");
  const from = env("TWILIO_FROM_NUMBER");
  const base = env("PUBLIC_BASE_URL");
  const configured = !!(sid && token && from && base);
  const missing = [sid ? null : "TWILIO_ACCOUNT_SID", token ? null : "TWILIO_AUTH_TOKEN", from ? null : "TWILIO_FROM_NUMBER", base ? null : "PUBLIC_BASE_URL"].filter(Boolean);
  return { configured, sid, from, base, missing, provider: configured ? "twilio" : null };
}

export class TwilioProvider implements PhoneCallProvider {
  readonly id = "twilio";

  configured() {
    return phoneConfigStatus().configured;
  }

  private auth() {
    const c = phoneConfigStatus();
    if (!c.sid || !env("TWILIO_AUTH_TOKEN")) throw new Error("Twilio credentials are not configured");
    return `Basic ${Buffer.from(`${c.sid}:${env("TWILIO_AUTH_TOKEN")}`).toString("base64")}`;
  }

  async verify() {
    const c = phoneConfigStatus();
    if (!c.sid || !env("TWILIO_AUTH_TOKEN")) return { ok: false, error: "Twilio credentials are not configured", account: null, balance: null };
    try {
      const headers = { Authorization: this.auth() };
      const acctRes = await fetch(`${API()}/2010-04-01/Accounts/${c.sid}.json`, { headers, cache: "no-store" });
      const acct = (await acctRes.json().catch(() => ({}))) as Record<string, unknown>;
      if (!acctRes.ok) return { ok: false, error: providerError(acct, `HTTP ${acctRes.status}`), account: null, balance: null };
      let balance: Record<string, unknown> | null = null;
      try {
        const br = await fetch(`${API()}/2010-04-01/Accounts/${c.sid}/Balance.json`, { headers, cache: "no-store" });
        if (br.ok) balance = (await br.json()) as Record<string, unknown>;
      } catch {}
      return { ok: true, error: null, account: acct, balance };
    } catch (e) {
      return { ok: false, error: (e as Error).message, account: null, balance: null };
    }
  }

  async placeCall(req: CallRequest): Promise<CallResult> {
    const c = phoneConfigStatus();
    if (!c.configured) {
      return { ok: false, state: "FAILED", providerId: null, providerStatus: "NOT_CONFIGURED", error: `Phone provider not configured: missing ${c.missing.join(", ")}` };
    }
    const to = normalizePhoneNumber(req.to);
    if (!to) return { ok: false, state: "FAILED", providerId: null, providerStatus: "INVALID_NUMBER", error: "Recipient is not a valid E.164 number or is a public emergency number" };
    const from = normalizePhoneNumber(c.from ?? "");
    if (!from) return { ok: false, state: "FAILED", providerId: null, providerStatus: "INVALID_FROM", error: "TWILIO_FROM_NUMBER is not a valid E.164 number" };
    const form = new URLSearchParams({
      To: to,
      From: from,
      Url: req.twimlUrl,
      StatusCallback: req.statusCallbackUrl,
      StatusCallbackEvent: "initiated ringing answered completed",
      Timeout: "25",
      MachineDetection: "Enable",
      Record: "false",
    });
    try {
      const res = await fetch(`${API()}/2010-04-01/Accounts/${c.sid}/Calls.json`, {
        method: "POST",
        headers: { Authorization: this.auth(), "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        return { ok: false, state: "FAILED", providerId: null, providerStatus: String(body.code ?? res.status), error: providerError(body, `Twilio rejected the call (HTTP ${res.status})`), detail: { httpStatus: res.status } };
      }
      const status = String(body.status ?? "queued");
      return {
        ok: true,
        state: statusToState(status) === "COMPLETED" ? "COMPLETED" : "INITIATED",
        providerId: typeof body.sid === "string" ? body.sid : null,
        providerStatus: status,
        error: null,
        detail: { httpStatus: res.status, direction: body.direction ?? null },
      };
    } catch (e) {
      return { ok: false, state: "FAILED", providerId: null, providerStatus: "NETWORK_ERROR", error: (e as Error).message };
    }
  }

  async cancelCall(providerId: string): Promise<boolean> {
    const c = phoneConfigStatus();
    if (!c.sid) return false;
    try {
      const res = await fetch(`${API()}/2010-04-01/Accounts/${c.sid}/Calls/${encodeURIComponent(providerId)}.json`, {
        method: "POST",
        headers: { Authorization: this.auth(), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ Status: "canceled" }),
        cache: "no-store",
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export function statusToState(status: string): CallAttemptState {
  const s = status.toLowerCase();
  if (s === "queued" || s === "initiated") return "INITIATED";
  if (s === "ringing") return "RINGING";
  if (s === "in-progress" || s === "answered") return "ANSWERED";
  if (s === "completed") return "COMPLETED";
  if (s === "busy") return "BUSY";
  if (s === "no-answer") return "NO_ANSWER";
  if (s === "canceled") return "CANCELED";
  if (s === "failed") return "FAILED";
  return "ATTEMPTED";
}

export function activePhoneProvider(): PhoneCallProvider | null {
  const p = new TwilioProvider();
  return p.configured() ? p : null;
}

/** Validates Twilio's X-Twilio-Signature header for status callbacks. */
export function validTwilioSignature(url: string, params: Record<string, string>, signature: string | null): boolean {
  const token = env("TWILIO_AUTH_TOKEN");
  if (!token) return false;
  if (!signature) return false;
  const data = Object.keys(params)
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join("");
  const expected = crypto.createHmac("sha1", token).update(url + data).digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

function providerError(body: Record<string, unknown>, fallback: string) {
  const msg = typeof body.message === "string" ? body.message : fallback;
  return `${msg}${body.code ? ` (Twilio ${body.code})` : ""}`;
}
