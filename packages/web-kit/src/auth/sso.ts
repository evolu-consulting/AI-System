// sso-switch · luật thuần chuyển phiên giữa các web (AI System = chat-web là nơi đăng nhập chung):
//  1. web nguồn mở `<nguồn>/sso?app=<đích>&next=<đường dẫn>` (trang của chính nó) ⇒ xin mã một lần ⇒ chuyển sang
//     `<đích>/sso#code=…&next=…` (mã trong fragment: không vào log máy chủ, không vào Referer).
//  2. web đích đổi mã lấy phiên riêng; không có phiên nguồn ⇒ `<đích>/login?sso=none&next=…` (form đăng nhập thường).
// URL đích chỉ lấy từ catalog do admin-api trả (	arget_url của POST /auth/sso/code, đã kiểm quyền + app có trong catalog;
// env build chỉ là dự phòng cho nhánh quay về form đăng nhập) — không từ query ⇒ không thành open redirect.

/** `next` chỉ nhận đường dẫn cùng origin: bắt đầu `/`, không `//` hay `/\` (URL tuyệt đối trá hình). */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  const ok = typeof next === "string" && /^\/(?![/\\])/.test(next);
  return ok ? next : fallback;
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
