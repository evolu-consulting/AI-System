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
