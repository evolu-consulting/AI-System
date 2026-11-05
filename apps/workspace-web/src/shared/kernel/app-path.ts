// CR-119 phần 2 · chuẩn đường dẫn web gộp: mỗi app ở `/<appKey>/…` (appKey = khoá catalog, vd `contracts`, `community`).
// Thuần, không React. Module khai `basePath = basePathOf(key)` trong manifest; nav/guard/home/`next` đều suy từ đây, nên app mới
// chỉ cần khai khoá. Trang công khai (đăng nhập, SSO, điều khoản) nằm ngoài mọi app.

/** Đường dẫn công khai (không thuộc app nào). */
export const PUBLIC_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/login",
  "/sso",
  "/privacy",
  "/terms",
]);

/** Gốc đường dẫn của app: `contracts` → `/contracts`. */
export const basePathOf = <K extends string>(appKey: K): `/${K}` => `/${appKey}`;

/** Phần path của một href (bỏ `?query`/`#hash`), bỏ dấu `/` cuối (trừ gốc). */
export function pathOf(href: string): string {
  const p = href.split(/[?#]/, 1)[0] || "/";
  return p.length > 1 && p.endsWith("/") ? p.replace(/\/+$/, "") || "/" : p;
}

/** Phần `?query#hash` của một href ("" nếu không có). */
export function tailOf(href: string): string {
  const i = href.search(/[?#]/);
  return i < 0 ? "" : href.slice(i);
}

/** Khoá app từ path (`/contracts/c/1` → `contracts`); trang công khai / không có đoạn đầu → null. */
export function appKeyOf(href: string): string | null {
  const path = pathOf(href);
  if (PUBLIC_PATHS.has(path)) return null;
  return /^\/([a-z][a-z0-9-]*)(?:\/|$)/.exec(path)?.[1] ?? null;
}

/** `path` có nằm dưới gốc của app (đúng bằng gốc hoặc `gốc/…`) không. */
export function isUnderApp(href: string, appKey: string): boolean {
  const base = basePathOf(appKey);
  const path = pathOf(href);
  return path === base || path.startsWith(`${base}/`);
}
