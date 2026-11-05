// PK-FR-10 · TF4 · CR-118 · tham số `next` của /login: chỉ nhận đường dẫn tương đối nội bộ (chống open redirect; như chat-web).
import { canonicalHref } from "~/shared/kernel/legacy-routes";

function hasControlChar(s: string): boolean {
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

/** Trả về `raw` nếu là đường dẫn nội bộ an toàn, ngược lại `undefined`. */
export function safeNext(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return undefined;
  if (!raw.startsWith("/")) return undefined;
  // `//evil.com` và `/\evil.com` được trình duyệt coi là URL tuyệt đối cùng scheme.
  if (raw.startsWith("//") || raw.startsWith("/\\")) return undefined;
  // Trình duyệt gỡ tab/CR/LF khi phân tích URL → `/\t/evil.com` thành `//evil.com`.
  if (hasControlChar(raw)) return undefined;
  if (raw === "/login" || raw.startsWith("/login?")) return undefined;
  if (raw === "/contracts/login" || raw.startsWith("/contracts/login?")) return undefined;
  // CR-119 phần 2: `next` cũ (/overview, /contracts/<id>, /partners…) quy về URL chuẩn mới dưới /contracts.
  return canonicalHref(raw);
}
