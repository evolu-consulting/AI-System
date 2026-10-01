// ADM-NFR-07 · RLS + withScope trên role admin_api (plan M1 §3.5). qc có M1-AC02 riêng.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { sql as dsql } from "drizzle-orm";
import postgres from "postgres";
import { createDb } from "./client";
import { runMigrations } from "./migrate";
import { NIL_SCOPE, withScope } from "./scope";
import { resetTestDb } from "./test-db";

const OWNER = process.env.TEST_DATABASE_URL;
const API = process.env.TEST_ADMIN_API_DATABASE_URL;
if (!OWNER || !API) throw new Error("TEST_DATABASE_URL/TEST_ADMIN_API_DATABASE_URL chưa đặt");

const ACME = "01900000-0000-7000-8000-00000000a001";
const GLOBEX = "01900000-0000-7000-8000-00000000a002";
const uid = (n: number) => `01900000-0000-7000-8000-00000000b00${n}`;
const hash = (s: string) => createHash("sha256").update(s).digest();

const owner = postgres(OWNER, { max: 1, onnotice: () => {} });
const db = createDb(API, { max: 1 });

beforeAll(async () => {
  await resetTestDb(OWNER);
  await runMigrations({ url: OWNER, appEnv: "test" });
  await owner`insert into admin.tenants (id, key, name) values (${ACME}, 'acme', 'Acme'), (${GLOBEX}, 'globex', 'Globex')`;
  const rows = [
    [uid(1), ACME, "a1"],
    [uid(2), ACME, "a2"],
    [uid(3), GLOBEX, "g1"],
    [uid(4), GLOBEX, "g2"],
  ];
  for (const [id, tid, name] of rows) {
    await owner`insert into admin.users (id, tenant_id, username, password_hash, display_name, role)
      values (${id as string}, ${tid as string}, ${name as string}, 'h', 'D', 'member')`;
  }
  for (const [uidx, tid] of [
    [uid(1), ACME],
    [uid(3), GLOBEX],
  ] as const) {
    await owner`insert into admin.refresh_tokens (id, user_id, tenant_id, family_id, token_hash, client, expires_at)
      values (${uidx}, ${uidx}, ${tid}, ${uidx}, ${hash(tid)}, 'web', now() + interval '1 day')`;
  }
});
afterAll(async () => {
  await db.close();
  await owner.end();
});

type Row = Record<string, unknown>;
const q = async (tx: { execute: (s: ReturnType<typeof dsql>) => Promise<unknown> }, s: string) =>
  (await tx.execute(dsql.raw(s))) as unknown as Row[];
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    return err.code ?? err.cause?.code ?? "unknown";
  }
};

describe("ADM-NFR-07 · RLS qua withScope (admin_api)", () => {
  test("ADM-NFR-07 · không đặt scope → 0 hàng users/tenants", async () => {
    const r = await db.db.transaction(async (tx) => [
      await q(tx, "select count(*)::int as n from admin.users"),
      await q(tx, "select count(*)::int as n from admin.tenants"),
    ]);
    expect(r.map((x) => x[0]?.n)).toEqual([0, 0]);
  });

  test("ADM-NFR-07 · scope tenant acme → chỉ user acme; update globex 0 hàng; insert globex → 42501", async () => {
    await withScope(db, { kind: "tenant", tenantId: ACME }, async (tx) => {
      const us = await q(tx, "select tenant_id from admin.users");
      expect(us).toHaveLength(2);
      expect(new Set(us.map((u) => u.tenant_id))).toEqual(new Set([ACME]));
      const upd = await q(
        tx,
        `update admin.users set display_name = 'x' where tenant_id = '${GLOBEX}' returning id`,
      );
      expect(upd).toHaveLength(0);
    });
    const err = await code(
      withScope(db, { kind: "tenant", tenantId: ACME }, (tx) =>
        q(
          tx,
          `insert into admin.users (tenant_id, username, password_hash, display_name, role)
           values ('${GLOBEX}', 'x1', 'h', 'X', 'member')`,
        ),
      ),
    );
    expect(err).toBe("42501");
  });

  test("ADM-NFR-07 · scope platform → thấy cả hai tenant", async () => {
    const n = await withScope(db, { kind: "platform" }, async (tx) => [
      (await q(tx, "select count(*)::int as n from admin.users"))[0]?.n,
      (await q(tx, "select count(*)::int as n from admin.tenants"))[0]?.n,
      (await q(tx, "select count(*)::int as n from admin.refresh_tokens"))[0]?.n,
    ]);
    expect(n).toEqual([4, 2, 2]);
  });

  test("ADM-NFR-07 · hàm SECURITY DEFINER trả tenant_id dưới NIL_SCOPE; hub_ro bị từ chối", async () => {
    const r = await withScope(db, NIL_SCOPE, async (tx) => ({
      key: (await q(tx, "select admin.tenant_id_by_key('acme') as id"))[0]?.id,
      users: (await q(tx, "select count(*)::int as n from admin.users"))[0]?.n,
    }));
    expect(r).toEqual({ key: ACME, users: 0 });
    const denied = await code(
      owner.begin(async (tx) => {
        await tx`set local role hub_ro`;
        await tx`select admin.tenant_id_by_key('acme')`;
      }),
    );
    expect(denied).toBe("42501");
  });

  test("ADM-NFR-07 · hub_ro: password_hash và refresh_tokens → 42501; id đọc được cả 2 tenant", async () => {
    const asHub = (s: string) =>
      owner.begin(async (tx) => {
        await tx`set local role hub_ro`;
        return tx.unsafe(s);
      });
    expect(await code(asHub("select password_hash from admin.users"))).toBe("42501");
    expect(await code(asHub("select * from admin.refresh_tokens"))).toBe("42501");
    const ids = (await asHub("select tenant_id from admin.users")) as unknown as Row[];
    expect(new Set(ids.map((x) => x.tenant_id)).size).toBe(2);
  });

  test("ADM-NFR-07 · hai transaction liên tiếp trên cùng kết nối: lần 2 không đặt scope → 0 hàng", async () => {
    const first = await withScope(db, { kind: "platform" }, async (tx) =>
      Number((await q(tx, "select count(*)::int as n from admin.users"))[0]?.n),
    );
    const second = await db.db.transaction(async (tx) =>
      Number((await q(tx, "select count(*)::int as n from admin.users"))[0]?.n),
    );
    expect([first, second]).toEqual([4, 0]);
  });

  test("ADM-NFR-07 · admin_api không super/bypassrls, là member admin_rw", async () => {
    const [r] = await owner`select rolsuper, rolbypassrls,
      pg_has_role('admin_api', 'admin_rw', 'member') as member from pg_roles where rolname = 'admin_api'`;
    expect(r).toEqual({ rolsuper: false, rolbypassrls: false, member: true });
  });
});
