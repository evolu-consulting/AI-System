// sso-switch · luật thuần chuyển phiên giữa các web (AI System = chat-web là nơi đăng nhập chung):
//  1. web nguồn mở `<nguồn>/sso?app=<đích>&next=<đường dẫn>` (trang của chính nó) ⇒ xin mã một lần ⇒ chuyển sang
//     `<đích>/sso#code=…&next=…` (mã trong fragment: không vào log máy chủ, không vào Referer).
//  2. web đích đổi mã lấy phiên riêng; không có phiên nguồn ⇒ `<đích>/login?sso=none&next=…` (form đăng nhập thường).
// URL đích chỉ lấy từ catalog do admin-api trả (	arget_url của POST /auth/sso/code, đã kiểm quyền + app có trong catalog;
// env build chỉ là dự phòng cho nhánh quay về form đăng nhập) — không từ query ⇒ không thành open redirect.

const NEXT_MAX = 2048;

/** Có ký tự điều khiển (C0/DEL) — trình duyệt gỡ tab/CR/LF khi phân tích URL ⇒ `/\t/evil.com` thành `//evil.com`. */
function hasControlChar(s: string): boolean {
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

/** `next` chỉ nhận đường dẫn cùng origin: bắt đầu `/`, không `//` hay `/\` (URL tuyệt đối trá hình), không ký tự điều
 *  khiển (kể cả dạng `%09` đã giải mã ra), ≤ 2048 ký tự (như chat-web `features/auth/lib/next.ts`). */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (typeof next !== "string" || next.length > NEXT_MAX) return fallback;
  if (!/^\/(?![/\\])/.test(next) || hasControlChar(next)) return fallback;
  let decoded = next;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return fallback;
  }
  return /^\/(?![/\\])/.test(decoded) && !hasControlChar(decoded) ? next : fallback;
}

const trimBase = (base: string): string => base.replace(/\/+$/, "");

/** Bước 1: trang `/sso` của web nguồn (nơi đã đăng nhập). */
export function ssoStartUrl(sourceBase: string, app: string, next: string): string {
  const q = new URLSearchParams({ app, next: safeNext(next) });
  return `${trimBase(sourceBase)}/sso?${q}`;
}

/** Bước 1 → 2: trang `/sso` của web đích, mã trong fragment. */
export function ssoLandingUrl(targetBase: string, code: string, next: string): string {
  const f = new URLSearchParams({ code, next: safeNext(next) });
  return `${trimBase(targetBase)}/sso#${f}`;
}

/** Không đổi được mã / không có phiên nguồn: về form đăng nhập của web đích, không dội lại nữa. */
export function ssoFallbackUrl(targetBase: string, next: string): string {
  const q = new URLSearchParams({ sso: "none", next: safeNext(next) });
  return `${trimBase(targetBase)}/login?${q}`;
}

/** Đọc fragment `#code=…&next=…` ở trang `/sso` của web đích. */
export function parseSsoFragment(hash: string): { code: string | null; next: string } {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  return { code: p.get("code") || null, next: safeNext(p.get("next")) };
}

/** Chống vòng dội (đích ↔ nguồn): mỗi tab chỉ thử SSO một lần trong `windowMs`. */
export function shouldTrySso(lastTry: number | null, now: number, windowMs = 60_000): boolean {
  return lastTry === null || now - lastTry > windowMs;
}

/**
 * Web nguồn → đích: có phiên ⇒ xin mã (admin-api trả `target_url` từ catalog) ⇒ `<target_url>/sso#code=…`. Không phiên / lỗi ⇒
 * form đăng nhập của đích tại `fallbackBase` (URL catalog đã biết hoặc env dự phòng); không có URL nào ⇒ `null` (gọi về trang chủ).
 */
export async function handOffUrl(o: {
  authed: boolean;
  grant: () => Promise<{ code: string; target_url: string }>;
  fallbackBase: string | undefined;
  next: string;
}): Promise<string | null> {
  const fallback = o.fallbackBase ? ssoFallbackUrl(o.fallbackBase, o.next) : null;
  if (!o.authed) return fallback;
  try {
    const g = await o.grant();
    return ssoLandingUrl(g.target_url, g.code, o.next);
  } catch {
    return fallback;
  }
}

const APP_KEY = /^[a-z0-9-]{2,32}$/;

/**
 * AI System chưa có phiên khi web khác xin SSO (`/sso?app=…`): về form đăng nhập CỦA AI SYSTEM với `next` = chính trang `/sso`
 * (đường dẫn cùng origin) ⇒ đăng nhập xong tiếp tục xin mã và trả người dùng về app đích. Đích cuối vẫn là `target_url` từ
 * catalog (admin-api) — URL này không mang địa chỉ ngoài nào ⇒ không thành open redirect. Khoá app lạ ⇒ form đăng nhập thường.
 */
export function ssoResumeLoginUrl(app: string, next: string): string {
  if (!APP_KEY.test(app)) return "/login";
  const back = `/sso?${new URLSearchParams({ app, next: safeNext(next) })}`;
  return `/login?${new URLSearchParams({ next: back })}`;
}
