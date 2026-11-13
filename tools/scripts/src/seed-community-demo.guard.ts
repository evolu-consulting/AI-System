// com-c12 · review TB-3 · chặn môi trường cho `seed-community-demo` (thuần, không I/O).

/** Host coi là máy dev/test (allowlist): localhost/loopback, `*.localhost`, `*.test`, dịch vụ compose `postgres`/`db`. */
export function isLocalDbHost(url: string): boolean {
  let h: string;
  try {
    h = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  return (
    ["localhost", "127.0.0.1", "::1", "postgres", "db"].includes(h) ||
    h.endsWith(".localhost") ||
    h.endsWith(".test")
  );
}

/**
 * Môi trường env là STACK STAGING `stg-test` (cùng khuôn chặn của deploy/stg-test/stg-seed.ts): `S2_STACK=stg-test` + admin URL
 * `https://ai-test-admin.*`, và KHÔNG phải `APP_ENV=production`. Prod không có hai biến này ⇒ không bao giờ khớp.
 */
export function isStagingStack(e: Record<string, string | undefined>): boolean {
  return (
    e.APP_ENV !== "production" &&
    e.S2_STACK === "stg-test" &&
    /^https:\/\/ai-test-admin\.[a-z0-9.-]+$/.test(e.S2_PUBLIC_ADMIN_URL ?? "")
  );
}

/** Allowlist host DB cho các script `demo:*`: host dev/test, hoặc — CHỈ khi là stack staging stg-test — dịch vụ compose `pg`. */
export function seedDbHost(
  e: Record<string, string | undefined> = process.env,
): (url: string) => boolean {
  return (url) => {
    if (isLocalDbHost(url)) return true;
    if (!isStagingStack(e)) return false;
    try {
      return new URL(url).hostname.toLowerCase() === "pg";
    } catch {
      return false;
    }
  };
}

/**
 * Lý do TỪ CHỐI chạy (null = được chạy). Production (`APP_ENV=production`) hoặc DB host ngoài allowlist ⇒ từ chối, trừ khi
 * `--i-know-prod`. Thiếu `--out` ⇒ từ chối (file mật khẩu phải do người chạy chọn chỗ, rồi tự xoá).
 */
export function seedGuard(o: {
  appEnv: string | undefined;
  urls: readonly string[];
  iKnowProd: boolean;
  out: string | undefined;
}): string | null {
  if (!o.out) return "cần --out <file> (file mật khẩu tạm; xoá ngay sau khi phát cho đối tác)";
  if (o.iKnowProd) return null;
  if (o.appEnv === "production") return "APP_ENV=production — thêm --i-know-prod nếu thật sự chủ ý";
  const bad = o.urls.find((u) => !isLocalDbHost(u));
  return bad ? "DB host không thuộc localhost/test — thêm --i-know-prod nếu thật sự chủ ý" : null;
}
