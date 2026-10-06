// HUB-FR-72 · tham số `next` của /login (plan-frontend §2): chỉ nhận đường dẫn nội bộ bắt đầu `/` (chống open redirect).

function hasControlChar(s: string): boolean {
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

/** Trả `raw` nếu là đường dẫn nội bộ an toàn (sau basepath), ngược lại `undefined`. */
export function safeNext(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return undefined;
  if (!raw.startsWith("/")) return undefined;
  // `//evil.com`, `/\evil.com` được trình duyệt coi là URL tuyệt đối cùng scheme.
  if (raw.startsWith("//") || raw.startsWith("/\\")) return undefined;
  // Trình duyệt gỡ tab/CR/LF khi phân tích URL → `/\t/evil.com` thành `//evil.com`.
  if (hasControlChar(raw)) return undefined;
  // Không quay lại chính trang đăng nhập / API.
  const path = raw.split(/[?#]/)[0] ?? "";
  if (path === "/login" || path.startsWith("/login/") || path.startsWith("/studio/api"))
    return undefined;
  return raw;
}
