// PK-FR-01 · review N1 m-02 · migration `migrations-packs/0003_install_owner.sql`: `packs.install` lần đầu gặp feature trùng
// khoá không thuộc gói ⇒ RAISE 23505 (không lặng lẽ nhận); không trùng ⇒ cài được; cài lại ⇒ idempotent. Mọi thứ trong tx
// rollback (role/schema cũng transactional) ⇒ không để lại gì. DB = DB Hub đã có bộ khung gói (mẫu test:int:par).
import { afterAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { withDatabase } from "./test-db";

const BASE = process.env.HUB_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!BASE)
  throw new Error("HUB_TEST_DATABASE_URL/TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev`");
const OWNER = process.env.HUB_TEST_DATABASE_URL ?? withDatabase(BASE, "ai_system_h1_test");
const sql = postgres(OWNER, { max: 1, onnotice: () => {} });
afterAll(() => sql.end({ timeout: 1 }));

class Rollback extends Error {}
/** Chạy `fn` trong tx rồi luôn rollback; trả SQLSTATE lỗi đầu tiên (null = không lỗi). */
async function inTx(fn: (tx: postgres.TransactionSql) => Promise<void>): Promise<string | null> {
  try {
    await sql.begin(async (tx) => {
      await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (e instanceof Rollback) return null;
    return (e as { code?: string }).code ?? "unknown";
  }
  return null;
}

describe("PK-FR-01 · review m-02 · packs.install không nhận feature của chủ khác", () => {
  it("feature `n1own-read` có sẵn, gói chưa cài ⇒ RAISE 23505, không tạo registry", async () => {
    const code = await inTx(async (tx) => {
      await tx`insert into admin.features (key, name, status)
        values ('n1own-read', '{"vi":"x","en":"x"}'::jsonb, 'on')`;
      await tx`select packs.install('n1own')`;
    });
    expect(code).toBe("23505");
  });
  it("không trùng ⇒ cài được; cài lại ⇒ không lỗi, đủ 3 feature + 1 registry", async () => {
    let got: unknown;
    const code = await inTx(async (tx) => {
      await tx`select packs.install('n1own')`;
      await tx`select packs.install('n1own')`;
      [got] = await tx`select
        (select array_agg(key order by key) from admin.features where key like 'n1own-%') as f,
        (select count(*)::int from packs.registry where key = 'n1own') as reg`;
    });
    expect(code).toBeNull();
    expect(got).toEqual({ f: ["n1own-admin", "n1own-read", "n1own-write"], reg: 1 });
  });
});
