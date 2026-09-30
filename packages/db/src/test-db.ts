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
