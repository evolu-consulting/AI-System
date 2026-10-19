// PK-FR-09 · PK-FR-03 · PK-FR-08 · PK-AC09 · PK-AC10 · PK-NFR-03 · plan §4, §8, §10: module gói qua API thật `pkdemo`.
// tenant/user chỉ từ token (AC10); `withPackScope` ép role+tenant; outbox cùng tx với ghi nghiệp vụ (AC09) và đúng 1 câu INSERT
// cho cả lô (NFR-03). Hình body pkdemo: `itemBody` ở `_support/n1.ts` (Cần bổ sung #2).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { loadPackScope } from "./_support/load";
import {
  type CtxN1,
  countHops,
  ID,
  itemBody,
  needPackKit,
  P,
  PK,
  seedItem,
  startN1,
  T,
} from "./_support/n1";

let c: CtxN1;
beforeAll(async () => {
  c = await startN1();
});
afterAll(async () => {
  await c?.stop();
});
/** acme: lan=owner · hoa=editor · tam=viewer; beta: an=owner. Bảng gói rỗng. */
async function arrange(): Promise<void> {
  await needPackKit(c.sql);
  await c.sql`truncate pkdemo.item_lines, pkdemo.items, pkdemo.index_outbox`;
  await c.enable(T.acme);
  await c.enable(T.beta);
  await c.addToRole(T.acme, "owner", [P.lan]);
  await c.addToRole(T.acme, "editor", [P.hoa]);
  await c.addToRole(T.beta, "owner", [P.an]);
}
const count = async (q: string): Promise<number> =>
  Number(((await c.sql.unsafe(q)) as unknown as { n: number }[])[0]?.n);

describe("PK-AC10 · tenant lấy từ token, không từ body/query", () => {
  it("PK-AC10 · POST body có tenant_id=beta (editor acme) ⇒ 201, hàng ghi theo tenant của token (acme)", async () => {
    await arrange();
    const r = await c.hubCall(
      P.hoa,
      "POST",
      `/pack/${PK}/items`,
      itemBody("body giả", 2, { tenant_id: T.beta, user_id: P.an.id }),
    );
    expect(r.status).toBe(201);
    const rows = await c.sql<{ tenant_id: string; n: number }[]>`select i.tenant_id,
      (select count(*)::int from pkdemo.item_lines l where l.item_id = i.id and l.tenant_id = ${T.acme}) as n
      from pkdemo.items i where i.title = 'body giả'`;
    expect([...rows]).toEqual([{ tenant_id: T.acme, n: 2 }]);
  });
  it("PK-AC10 · phản hồi API gói không phơi tenant_id (chỉ id hàng của gói)", async () => {
    await arrange();
    const r = await c.hubCall(P.hoa, "POST", `/pack/${PK}/items`, itemBody("không lộ", 1));
    expect(r.status).toBe(201);
    expect(JSON.stringify(r.json)).not.toContain(T.acme);
    const g = await c.hubCall(P.hoa, "GET", `/pack/${PK}/items/${r.json.id}`);
    expect(g.status).toBe(200);
    expect(JSON.stringify(g.json)).not.toContain(T.acme);
  });
  it("PK-AC10 · ?tenant_id= và header x-tenant-id của beta KHÔNG đổi phạm vi: owner acme đọc hàng beta ⇒ 404", async () => {
    await arrange();
    await seedItem(c.sql, T.beta, ID.itemB, ID.lineB, "của beta");
    const q = await c.hubCall(P.lan, "GET", `/pack/${PK}/items/${ID.itemB}?tenant_id=${T.beta}`);
    const h = await fetch(`${c.hub.base}/pack/${PK}/items/${ID.itemB}`, {
      headers: { authorization: `Bearer ${await c.tok(P.lan)}`, "x-tenant-id": T.beta },
    });
    const own = await c.hubCall(P.an, "GET", `/pack/${PK}/items/${ID.itemB}`);
    expect([q.status, h.status, own.status]).toEqual([404, 404, 200]);
    expect(q.json?.error?.code).toBe("NOT_FOUND");
  });
  it("PK-FR-02 · API: sửa/ghi theo id hàng tenant khác không có tác dụng (RLS): lô ghi của acme không tạo hàng beta", async () => {
    await arrange();
    await seedItem(c.sql, T.beta, ID.itemB, ID.lineB, "của beta");
    await c.hubCall(P.hoa, "POST", `/pack/${PK}/items`, itemBody("acme mới", 3));
    expect({
      beta: await count(
        `select count(*)::int as n from pkdemo.items where tenant_id = '${T.beta}'`,
      ),
      acme: await count(
        `select count(*)::int as n from pkdemo.items where tenant_id = '${T.acme}'`,
      ),
    }).toEqual({ beta: 1, acme: 1 });
  });
});

describe("PK-FR-03 · withPackScope (@ai/db/pack-scope)", () => {
  it("PK-FR-03 · tenantId không phải uuid ⇒ ném TENANT_INVALID TRƯỚC khi mở tx (fn không chạy)", async () => {
    const m = await loadPackScope();
    let ran = false;
    const p = m.withPackScope(
      c.hub.db,
      { packKey: PK, tenantId: "khong-phai-uuid", userId: null },
      async () => {
        ran = true;
      },
    );
    await expect(p).rejects.toThrow(/TENANT_INVALID/);
    expect(ran).toBe(false);
  });
  it("PK-FR-03 · packKey sai dạng / bị cấm (Bad, public, admin, pg_x) ⇒ ném, không SET ROLE", async () => {
    const m = await loadPackScope();
    const rej: string[] = [];
    for (const packKey of ["Bad", "public", "admin", "pg_x"]) {
      try {
        await m.withPackScope(c.hub.db, { packKey, tenantId: T.acme, userId: null }, async () => 1);
      } catch {
        rej.push(packKey);
      }
    }
    expect(rej).toEqual(["Bad", "public", "admin", "pg_x"]);
  });
  it("PK-FR-03 · hết tx ⇒ role trở lại hub_api (pool không rò role gói sang request sau)", async () => {
    const m = await loadPackScope();
    await m.withPackScope(
      c.hub.db,
      { packKey: PK, tenantId: T.acme, userId: P.lan.id },
      async () => 1,
    );
    const pool = (
      c.hub.db as unknown as {
        db: { $client: (s: TemplateStringsArray) => Promise<{ u: string; t: string | null }[]> };
      }
    ).db.$client;
    const rows = await Promise.all(
      Array.from(
        { length: 8 },
        () => pool`select current_user as u, current_setting('app.tenant_id', true) as t`,
      ),
    );
    expect(rows.flat().filter((r) => r.u !== "hub_api" || (r.t ?? "") !== "")).toEqual([]);
  });
});

describe("PK-AC09 · outbox chỉ mục cùng transaction", () => {
  it("PK-AC09 · POST ghi cha+con VÀ ≥ 1 hàng index_outbox (entity item, op upsert, đúng tenant, chưa processed)", async () => {
    await arrange();
    const r = await c.hubCall(P.hoa, "POST", `/pack/${PK}/items`, itemBody("có outbox", 2));
    expect(r.status).toBe(201);
    const o = await c.sql<
      {
        entity: string;
        op: string;
        tenant_id: string;
        processed_at: Date | null;
        entity_id: string;
      }[]
    >`
      select entity, op, tenant_id, processed_at, entity_id from pkdemo.index_outbox order by id`;
    expect(o.length).toBeGreaterThanOrEqual(1);
    expect(
      o.every((x) => x.tenant_id === T.acme && x.op === "upsert" && x.processed_at === null),
    ).toBe(true);
    expect(o.map((x) => x.entity)).toContain("item");
    expect(o.map((x) => x.entity_id)).toContain(r.json.id);
  });
  it("PK-AC09 · tx rollback ⇒ KHÔNG còn hàng outbox (và không còn hàng nghiệp vụ)", async () => {
    await arrange();
    await c.sql`create or replace function pkdemo.n1_boom() returns trigger language plpgsql as $$ begin raise exception 'n1 boom'; end $$`;
    await c.sql`create constraint trigger n1_boom after insert on pkdemo.item_lines deferrable initially deferred
      for each row when (new.text = 'BOOM') execute function pkdemo.n1_boom()`;
    try {
      const r = await c.hubCall(P.hoa, "POST", `/pack/${PK}/items`, {
        title: "sẽ rollback",
        lines: [{ text: "ok" }, { text: "BOOM" }],
      });
      expect(r.status).toBeGreaterThanOrEqual(400); // lỗi ở COMMIT (ràng buộc hoãn)
      expect({
        items: await count("select count(*)::int as n from pkdemo.items"),
        lines: await count("select count(*)::int as n from pkdemo.item_lines"),
        outbox: await count("select count(*)::int as n from pkdemo.index_outbox"),
      }).toEqual({ items: 0, lines: 0, outbox: 0 });
    } finally {
      await c.sql`drop trigger if exists n1_boom on pkdemo.item_lines`;
      await c.sql`drop function if exists pkdemo.n1_boom()`;
    }
  });
  it("PK-AC09 · ghi xong thì commit: item + outbox cùng thấy sau POST thành công (không có 'ghi nghiệp vụ mà thiếu outbox')", async () => {
    await arrange();
    for (let i = 0; i < 3; i++)
      await c.hubCall(P.hoa, "POST", `/pack/${PK}/items`, itemBody(`l${i}`, 1));
    const [r] = await c.sql<{ items: number; missing: number }[]>`select
      (select count(*)::int from pkdemo.items) as items,
      (select count(*)::int from pkdemo.items i where not exists
         (select 1 from pkdemo.index_outbox o where o.entity = 'item' and o.entity_id = i.id)) as missing`;
    expect(r).toEqual({ items: 3, missing: 0 });
  });
});

describe("PK-NFR-03 · outbox +1 câu INSERT mỗi lệnh ghi", () => {
  const OUTBOX = /insert into pkdemo\.index_outbox/i;
  it("PK-NFR-03 · POST 1 con và POST 100 con: ĐÚNG 1 câu INSERT index_outbox, tổng 3 câu (set_config, ghi cha+con, outbox)", async () => {
    await arrange();
    await c.hubCall(P.hoa, "GET", `/pack/${PK}/me`); // làm nóng cache quyền
    const small = await countHops(c, () =>
      c.hubCall(P.hoa, "POST", `/pack/${PK}/items`, itemBody("nhỏ", 1)),
    );
    const big = await countHops(c, () =>
      c.hubCall(P.hoa, "POST", `/pack/${PK}/items`, itemBody("lô 100", 100)),
    );
    expect([small.r.status, big.r.status]).toEqual([201, 201]);
    const nOutbox = (h: { queries: string[] }) => h.queries.filter((q) => OUTBOX.test(q)).length;
    expect({ small: nOutbox(small), big: nOutbox(big) }).toEqual({ small: 1, big: 1 });
    expect({ small: small.sql, big: big.sql }).toEqual({ small: 3, big: 3 });
  });
  it("PK-NFR-03 · lệnh đọc (GET) không ghi outbox; ghi rỗng (0 con) vẫn đúng 1 câu outbox cho cha", async () => {
    await arrange();
    const w = await c.hubCall(P.hoa, "POST", `/pack/${PK}/items`, itemBody("đọc", 1));
    const g = await countHops(c, () => c.hubCall(P.hoa, "GET", `/pack/${PK}/items/${w.json.id}`));
    expect(g.queries.filter((q) => OUTBOX.test(q))).toEqual([]);
    const e = await countHops(c, () =>
      c.hubCall(P.hoa, "POST", `/pack/${PK}/items`, itemBody("không con", 0)),
    );
    expect(e.queries.filter((q) => OUTBOX.test(q)).length).toBe(1);
  });
});
