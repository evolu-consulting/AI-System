// ADM-NFR-06 · dọn DB test trước mỗi test tích hợp. Chỉ chạy trên DB tên kết thúc `_test`.
import postgres from "postgres";

export async function resetTestDb(url: string | undefined): Promise<void> {
  if (!url) throw new Error("TEST_DATABASE_URL chưa đặt");
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!name.endsWith("_test")) throw new Error("resetTestDb: tên DB phải kết thúc _test");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`DROP SCHEMA IF EXISTS admin, hub, drizzle CASCADE`;
  } finally {
    await sql.end();
  }
}

/** Tag DB test riêng của một agent/worktree (TECH-DEBT #17, plan M3 §12). */
export const TEST_DB_TAG_RE = /^[a-z0-9_]{1,24}$/;

/** `ai_system_<tag>_test` — luôn hậu tố `_test` để `resetTestDb`/`db:test:drop` chấp nhận. Tag sai → ném. */
export function testDbName(tag: string): string {
  if (!TEST_DB_TAG_RE.test(tag))
    throw new Error(`tag DB test không hợp lệ: ${JSON.stringify(tag)} (cần ^[a-z0-9_]{1,24}$)`);
  return `ai_system_${tag}_test`;
}

/** Cùng URL nhưng đổi tên database (giữ user, mật khẩu, host, cổng, query). */
export function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(name)}`;
  return u.toString();
}

/** Bản sao nội dung `.env` với `TEST_DATABASE_URL`, `TEST_ADMIN_API_DATABASE_URL` trỏ DB `name` (thêm dòng nếu thiếu). */
export function testEnvFile(envText: string, name: string): string {
  const keys = ["TEST_DATABASE_URL", "TEST_ADMIN_API_DATABASE_URL"];
  const seen = new Set<string>();
  const lines = envText.split(/\r?\n/).map((line) => {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (!m?.[1] || !keys.includes(m[1])) return line;
    seen.add(m[1]);
    return `${m[1]}=${withDatabase(m[2] ?? "", name)}`;
  });
  const missing = keys.filter((k) => !seen.has(k));
  if (missing.length) throw new Error(`.env thiếu ${missing.join(", ")}`);
  return lines.join("\n");
}
