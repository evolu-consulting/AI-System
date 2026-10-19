// HUB-FR-72 · H4a-R14 · lỗi đăng nhập / bước TOTP → key i18n (plan-frontend-copy "Đăng nhập — map lỗi"). Không hiện `message` server.
import { ApiError } from "#/lib/http";

export type MessageSpec = { key: string; params?: Record<string, string> };

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO → HH:MM giờ trình duyệt; không đọc được → chuỗi rỗng. */
export function formatClock(iso: unknown): string {
  if (typeof iso !== "string") return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** L1b · `details.retry_after_s` (429) ⇒ số phút chờ, làm tròn lên, ≥ 1; thiếu ⇒ 1. */
export function retryMinutes(details: unknown): string {
  const s = (details as { retry_after_s?: unknown } | null | undefined)?.retry_after_s;
  const sec = typeof s === "number" && Number.isFinite(s) && s > 0 ? s : 60;
  return String(Math.max(1, Math.ceil(sec / 60)));
}

/** Bước mật khẩu (và mã chung cho bước TOTP). */
export function describeLoginError(err: unknown): MessageSpec {
  if (!(err instanceof ApiError)) return { key: "login.err.server", params: { code: "UNKNOWN" } };
  switch (err.code) {
    case "NETWORK_ERROR":
      return { key: "login.err.network" };
    case "INVALID_CREDENTIALS":
      return { key: "login.err.invalid" };
    case "ACCOUNT_LOCKED":
      return { key: "login.err.locked" };
    case "TEMP_LOCKED": {
      const until = (err.details as { until?: unknown } | null | undefined)?.until;
      return { key: "login.err.tempLocked", params: { time: formatClock(until) } };
    }
    // L1b: 429 vượt trần IP (phút chờ từ `details.retry_after_s`), 503 giới hạn đăng nhập tạm không dùng được.
    case "RATE_LIMITED":
      return { key: "login.err.rateLimited", params: { minutes: retryMinutes(err.details) } };
    case "AUTH_UNAVAILABLE":
      return { key: "login.err.unavailable" };
    default:
      return {
        key: "login.err.server",
        params: { code: err.code === "HTTP_ERROR" ? "UNKNOWN" : err.code },
      };
  }
}

export type TotpErrorOutcome =
  | { kind: "expired" }
  | { kind: "wrong" }
  | { kind: "other"; spec: MessageSpec };

/** Bước TOTP: `INVALID_TOTP_TOKEN` → hết hạn (về form mật khẩu); 401 khác (`INVALID_OTP`…) → mã sai; còn lại như bước mật khẩu. */
export function classifyTotpError(err: unknown): TotpErrorOutcome {
  if (err instanceof ApiError && err.code === "INVALID_TOTP_TOKEN") return { kind: "expired" };
  if (err instanceof ApiError && err.status === 401) return { kind: "wrong" };
  return { kind: "other", spec: describeLoginError(err) };
}
