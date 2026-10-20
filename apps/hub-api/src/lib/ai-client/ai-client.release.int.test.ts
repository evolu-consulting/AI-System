// TD #241 · hub 0045: `hub.ai_release_tokens(hold_id, tenant_id)` chỉ xoá chỗ giữ khi id VÀ tenant cùng khớp
// (Postgres thật, role hub_api qua `pgUsageStore`). Hàm 1 tham số cũ không còn.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql as dsql } from "drizzle-orm";
import { HUB_API_URL } from "../../../../../tests/acceptance/H1/_fixtures";
import { setupX2a } from "../../../../../tests/acceptance/X2a/_x2a";
import { connectDb } from "../db";
import { pgUsageStore } from "./usage.pg";

type Sql = Awaited<ReturnType<typeof setupX2a>>;
const TA = "a4d10000-0000-4000-8000-0000000000a1";
const TB = "a4d10000-0000-4000-8000-0000000000b2";

let sql: Sql;
let db: ReturnType<typeof connectDb>;
beforeAll(async () => {
  sql = await setupX2a();
  db = connectDb(HUB_API_URL, 2);
}, 120_000);
afterAll(async () => {
  await db?.close();
  await sql?.end();
});

const holds = async (id: string) =>
  Number(
    (await sql<{ n: string }[]>`select count(*) as n from hub.ai_token_holds where id = ${id}`)[0]
      ?.n ?? 0,
  );
const reserve = async (tenantId: string) => {
  const hold = await pgUsageStore(db).reserve?.({
    tenantId,
    since: new Date(Date.now() - 86_400_000),
    cap: 1_000_000,
    inputTokens: 10,
    maxOutput: 100,
    minOutput: 10,
    ttlS: 600,
  });
  if (!hold) throw new Error("reserve không cấp");
  return hold.holdId;
};

describe("TD #241 · ai_release_tokens kiểm tenant", () => {
  it("sai tenant ⇒ chỗ giữ còn nguyên; đúng tenant ⇒ xoá", async () => {
    const id = await reserve(TA);
    expect(await holds(id)).toBe(1);
    await pgUsageStore(db).release?.(id, TB);
    expect(await holds(id)).toBe(1);
    await pgUsageStore(db).release?.(id, TA);
    expect(await holds(id)).toBe(0);
  });

  it("hàm 1 tham số (chỉ theo id) đã bị bỏ", async () => {
    const id = await reserve(TA);
    let err: unknown;
    try {
      await db.db.execute(dsql`select hub.ai_release_tokens(${id}::uuid)`);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(await holds(id)).toBe(1);
    await pgUsageStore(db).release?.(id, TA);
  });
});
