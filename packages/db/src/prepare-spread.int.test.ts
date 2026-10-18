// CR-093 Luật 4c · T19-perf vòng 3 · `createDb({ spread: true })` trên Postgres thật: câu có tham số chạy trên MỘT kết nối
// ⇒ sau `spread.idle()` MỌI kết nối của pool đã có câu chuẩn bị đó (`pg_prepared_statements` theo phiên); describe không
// thực thi (INSERT không thêm hàng). Không cần migrate (bảng tạm của phiên chủ).
import { afterAll, describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { createDb } from "./client";

const OWNER = process.env.TEST_DATABASE_URL;
if (!OWNER) throw new Error("TEST_DATABASE_URL chưa đặt");

const MAX = 3;
const raw = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(OWNER, { max: MAX, spread: true });

afterAll(async () => {
  await raw`drop table if exists public.spread_probe`;
  await raw.end();
  await db.close();
});

/** Giữ đồng thời MAX kết nối (mỗi cái khác nhau) và đếm câu chuẩn bị khớp `like` trên từng phiên. */
async function preparedPerConn(like: string): Promise<number[]> {
  const pool = (db.db as unknown as { $client: postgres.Sql }).$client;
  const conns = await Promise.all(Array.from({ length: MAX }, () => pool.reserve()));
  try {
    return await Promise.all(
      conns.map(async (c) => {
        const [r] = await c<{ n: number }[]>`select count(*)::int as n from pg_prepared_statements
          where statement like ${like}`;
        return r?.n ?? 0;
      }),
    );
  } finally {
    for (const c of conns) c.release();
  }
}

describe("CR-093 · T19-perf vòng 3 · prepare-spread (Postgres thật)", () => {
  test("câu mới chạy trên 1 kết nối ⇒ sau idle mọi kết nối đều đã chuẩn bị; INSERT chỉ describe, không ghi", async () => {
    await raw`create table if not exists public.spread_probe (v int)`;
    await preparedPerConn("%"); // mở đủ MAX kết nối trước
    await db.db.execute(sql`select ${7}::int + 1 as spread_probe_sel`);
    await db.db.execute(sql`insert into public.spread_probe (v) select ${1}::int where false`);
    await db.spread?.idle();
    // Kết nối gốc có thể có 2 bản (describe chuẩn bị lại tên mới — trần: 1 bản thừa mỗi câu mỗi kết nối gốc).
    for (const like of ["%spread_probe_sel%", "insert into public.spread_probe%"]) {
      const per = await preparedPerConn(like);
      expect(per.every((n) => n >= 1)).toBe(true);
      expect(per.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(MAX + 1);
    }
    const [r] = await raw<{ n: number }[]>`select count(*)::int as n from public.spread_probe`;
    expect(r?.n).toBe(0);
    expect(db.spread?.size()).toBe(2);
  });
});
