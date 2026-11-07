// CR-122 · A2b · `withPackRoleInTx`: chạy dưới role gói + tenant trong tx đang mở, rồi trả role và `app.*` — kể cả khi `fn` ném
// (lỗi JS, hoặc lỗi SQL trong savepoint mà tx vẫn chạy tiếp).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db, type Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql } from "drizzle-orm";
import { withPackRoleInTx } from "./pack-role-in-tx";

let o: Sql;
let db: Db;
let T = "";

type Scope = { role: string; tid: string; uid: string; kind: string; ext: string };
const scope = async (tx: Tx): Promise<Scope> =>
  (
    await tx.execute<Scope>(sql`select current_user::text as role,
      coalesce(current_setting('app.tenant_id', true), '') as tid, coalesce(current_setting('app.user_id', true), '') as uid,
      coalesce(current_setting('app.user_kind', true), '') as kind, coalesce(current_setting('app.ext_org_id', true), '') as ext`)
  )[0] as Scope;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  T = (await tenants(o, 1, 1260))[0] as string;
  db = createDb(urls().hubApi, { max: 2 });
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("withPackRoleInTx [CR-122 A2b]", () => {
  it("trong fn: role gói + tenant; xong (thành công hoặc fn ném) ⇒ role và app.* như cũ, tx chạy tiếp", async () => {
    await withHubScope(db, { kind: "system" }, async (tx) => {
      const before = await scope(tx);
      // thành công
      const inside = await withPackRoleInTx(tx, "community", T, () => scope(tx));
      expect(inside).toMatchObject({ role: "community_rw", tid: T, uid: "" });
      expect(await scope(tx)).toEqual(before);
      // fn ném lỗi JS
      const e1 = await withPackRoleInTx(tx, "community", T, async () => {
        throw new Error("boom");
      }).then(
        () => null,
        (e: Error) => e,
      );
      expect(e1?.message).toBe("boom");
      expect(await scope(tx)).toEqual(before);
      // fn gây lỗi SQL trong savepoint (tx không hỏng) rồi ném ra ngoài
      const e2 = await withPackRoleInTx(tx, "community", T, async () => {
        await tx.transaction(async (sp) => {
          await sp.execute(sql`select 1/0`);
        });
      }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(e2).not.toBeNull();
      expect(await scope(tx)).toEqual(before);
      expect((await tx.execute<{ ok: number }>(sql`select 1 as ok`))[0]?.ok).toBe(1);
    });
  });

  it("CR-122 · trigger DEFERRED của gói (HĐ bán sang hiệu lực) chạy dưới role gói, không lỗi lúc COMMIT bằng hub_api", async () => {
    const [u] = (await users(o, T, 1, { from: 1260 })) as [string];
    const [c] =
      (await o`insert into contracts.contracts (tenant_id, title, status, created_by, deal, direction, kind)
      values (${T}, 'HĐ bán', 'needs_review', ${u}, 'sell', 'sale', 'contract') returning id::text`) as unknown as [
        { id: string },
      ];
    // trước sửa: COMMIT ném "permission denied for schema contracts" (contracts_v2d_sc_upd chạy bằng hub_api)
    await withHubScope(db, { kind: "system" }, async (tx) => {
      await withPackRoleInTx(tx, "contracts", T, async () => {
        await tx.execute(sql`update contracts.contracts set status = 'active', confirmed_at = now()
          where id = ${c?.id}::uuid`);
      });
    });
    const [after] = await o`select status from contracts.contracts where id = ${c?.id ?? ""}::uuid`;
    expect(after?.status).toBe("active");
  });

  it("khoá gói sai / tenant không phải uuid ⇒ lỗi trước khi đổi gì", async () => {
    await withHubScope(db, { kind: "system" }, async (tx) => {
      const before = await scope(tx);
      const bad = (p: string, t: string) =>
        withPackRoleInTx(tx, p, t, async () => 1).then(
          () => null,
          (e: unknown) => e,
        );
      expect(await bad("Bad Key;", T)).not.toBeNull();
      expect(await bad("community", "not-a-uuid")).not.toBeNull();
      expect(await scope(tx)).toEqual(before);
    });
  });
});
