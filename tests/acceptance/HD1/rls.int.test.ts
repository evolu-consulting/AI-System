// HD-NFR-04 · HD-AC01 · HD-AC02 · HD-AC13 · HD-FR-01/03/04/05/06 · D-04 · D-08 · plan §3: DDL gói `contracts` — RLS theo tenant, FK kép,
// CHECK, UNIQUE khoá idempotency, quyền bớt (REVOKE DELETE / UPDATE). Thuần DB (role `contracts_rw` qua `hub_api` + SET ROLE như đường chạy thật).
// Điều kiện tiền đề: `needContracts` — thiếu bảng ⇒ đỏ NGAY ở expect (không PostgresError trong fixture).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { pgCode } from "../N1/_support/n1";
import { setupX2a } from "../X2a/_x2a";
import {
  catId,
  cid,
  fileRowId,
  inPack,
  insCategory,
  insContract,
  insEvents,
  insFile,
  insItem,
  needContracts,
  OUTCOMES,
  OWNER_X,
  P,
  packDirsSrc,
  ROLE_RW,
  type Sql,
  STATUSES,
  T,
  TABLES,
  truncateAll,
} from "./_support/hd1";

let sql: Sql;
beforeAll(async () => {
  sql = await setupX2a();
});
afterAll(async () => {
  await sql?.end();
});
const rw = <R>(tid: string | null, fn: (tx: Sql) => Promise<R>) => inPack(tid, fn, ROLE_RW);

/** acme: HĐ cA + 1 item + 1 event + 1 reminder + 1 loại + 1 file; beta: HĐ cB. */
async function arrange() {
  await needContracts(sql);
  await truncateAll(sql);
  await insFile(sql, T.acme, fileRowId(1), "ffffffff-0000-4000-8000-000000000001");
  await insCategory(sql, T.acme, catId(1), "Bao bì");
  await insCategory(sql, T.beta, catId(2), "Vận chuyển");
  await insContract(sql, { id: cid(1), tenant: T.acme, title: "A", fileId: fileRowId(1) });
  await insContract(sql, { id: cid(2), tenant: T.beta, title: "B" });
  await insItem(sql, T.acme, cid(1), 0, { category: catId(1) });
  await insEvents(sql, T.acme, cid(1), 1);
  await sql`insert into contracts.contract_reminders (tenant_id, contract_id, deadline, milestone, user_id, channel)
    values (${T.acme}, ${cid(1)}, '2026-12-31', 30, ${P.lan.id}, 'email')`;
}
const minimalContract = (
  tx: Sql,
  tenant: string,
  id: string,
  extra: { kind?: string; parent?: string | null; status?: string } = {},
) =>
  tx`insert into contracts.contracts (id, tenant_id, kind, parent_id, title, status, created_by)
    values (${id}, ${tenant}, ${extra.kind ?? "contract"}, ${extra.parent ?? null}, 'x', ${extra.status ?? "active"}, ${P.lan.id})`;

describe("HD-AC01 · cách ly tenant ở DB (RLS FORCE)", () => {
  it("HD-AC01 · tenant B đọc 5 bảng nghiệp vụ: 0 hàng của tenant A; chỉ thấy hàng của B", async () => {
    await arrange();
    const seen = await rw(T.beta, async (tx) => {
      const n = async (t: string) =>
        (
          await tx.unsafe(
            `select count(*)::int as n, count(*) filter (where tenant_id = '${T.acme}')::int as a from contracts.${t}`,
          )
        )[0] as unknown as { n: number; a: number };
      return {
        contracts: await n("contracts"),
        items: await n("contract_items"),
        categories: await n("contract_categories"),
        reminders: await n("contract_reminders"),
        events: await n("contract_events"),
      };
    });
    expect(seen).toEqual({
      contracts: { n: 1, a: 0 },
      items: { n: 0, a: 0 },
      categories: { n: 1, a: 0 },
      reminders: { n: 0, a: 0 },
      events: { n: 0, a: 0 },
    });
  });
  it("HD-AC01 · đối chứng: tenant A thấy đủ hàng của mình (không phải 0 ở mọi nơi)", async () => {
    await arrange();
    const seen = await rw(T.acme, async (tx) => ({
      c: (await tx`select count(*)::int as n from contracts.contracts`)[0]?.n,
      i: (await tx`select count(*)::int as n from contracts.contract_items`)[0]?.n,
      e: (await tx`select count(*)::int as n from contracts.contract_events`)[0]?.n,
      r: (await tx`select count(*)::int as n from contracts.contract_reminders`)[0]?.n,
    }));
    expect(seen).toEqual({ c: 1, i: 1, e: 1, r: 1 });
  });
  it("HD-AC01 · không đặt app.tenant_id ⇒ 0 hàng; đặt '' ⇒ 0 hàng, không lỗi cast uuid", async () => {
    await arrange();
    expect(
      await rw(
        null,
        async (tx) => (await tx`select count(*)::int as n from contracts.contracts`)[0]?.n,
      ),
    ).toBe(0);
    expect(
      await rw(null, async (tx) => {
        await tx`select set_config('app.tenant_id', '', true)`;
        return (await tx`select count(*)::int as n from contracts.contracts`)[0]?.n;
      }),
    ).toBe(0);
  });
  it("HD-AC01 · tenant B UPDATE hàng của A (contracts, items, categories) ⇒ 0 hàng bị đụng", async () => {
    await arrange();
    const hit = await rw(T.beta, async (tx) => ({
      c: (await tx`update contracts.contracts set title = 'hack' where id = ${cid(1)} returning id`)
        .length,
      i: (
        await tx`update contracts.contract_items set name = 'hack' where contract_id = ${cid(1)} returning id`
      ).length,
      k: (
        await tx`update contracts.contract_categories set name = 'hack' where id = ${catId(1)} returning id`
      ).length,
    }));
    expect(hit).toEqual({ c: 0, i: 0, k: 0 });
    const [r] = await sql`select title from contracts.contracts where id = ${cid(1)}`;
    expect(r?.title).toBe("A");
  });
  it("HD-AC01 · WITH CHECK: tenant B không chèn được HĐ mang tenant_id của A (42501)", async () => {
    await arrange();
    expect(await pgCode(() => rw(T.beta, (tx) => minimalContract(tx, T.acme, cid(50))))).toBe(
      "42501",
    );
  });
  it("HD-NFR-04 · 7 bảng gói: ENABLE + FORCE RLS và ≥ 1 policy FOR ALL TO contracts_rw", async () => {
    await needContracts(sql);
    const rows = await sql<{ relname: string; rls: boolean; force: boolean; pol: number }[]>`
      select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as force,
        (select count(*)::int from pg_policy p where p.polrelid = c.oid) as pol
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'contracts' and c.relkind = 'r' and c.relname = any(${[...TABLES]}) order by c.relname`;
    expect(rows.map((r) => [r.relname, r.rls, r.force, r.pol >= 1])).toEqual(
      [...TABLES].sort().map((t) => [t, true, true, true]),
    );
  });
});

describe("HD-AC02 · FK kép (x_id, tenant_id) — chéo tenant bị chặn kể cả khi bỏ RLS", () => {
  it("HD-AC02 · item(B) trỏ HĐ(A) ⇒ 23503 qua role gói VÀ qua owner", async () => {
    await arrange();
    const ins = (tx: Sql) =>
      tx`insert into contracts.contract_items (id, tenant_id, contract_id, ord, name) values (${"17e00000-0000-4000-8000-0000000000aa"}, ${T.beta}, ${cid(1)}, 0, 'x')`;
    expect(await pgCode(() => rw(T.beta, ins))).toBe("23503");
    expect(await pgCode(() => ins(sql))).toBe("23503");
  });
  it("HD-AC02 · event(B) và reminder(B) trỏ HĐ(A) ⇒ 23503", async () => {
    await arrange();
    expect(
      await pgCode(
        () =>
          sql`insert into contracts.contract_events (tenant_id, contract_id, type) values (${T.beta}, ${cid(1)}, 'uploaded')`,
      ),
    ).toBe("23503");
    expect(
      await pgCode(
        () => sql`insert into contracts.contract_reminders (tenant_id, contract_id, deadline, milestone, user_id, channel)
          values (${T.beta}, ${cid(1)}, '2026-12-31', 7, ${P.an.id}, 'email')`,
      ),
    ).toBe("23503");
  });
  it("HD-AC02 · item(A) gắn loại hàng của B ⇒ 23503 (FK kép categories)", async () => {
    await arrange();
    expect(
      await pgCode(
        () => sql`insert into contracts.contract_items (id, tenant_id, contract_id, ord, name, category_id)
          values (${"17e00000-0000-4000-8000-0000000000ab"}, ${T.acme}, ${cid(1)}, 1, 'x', ${catId(2)})`,
      ),
    ).toBe("23503");
  });
  it("HD-AC02 · phụ lục(B) trỏ HĐ cha(A) ⇒ 23503; HĐ(B) trỏ file(A) ⇒ 23503", async () => {
    await arrange();
    expect(
      await pgCode(() =>
        minimalContract(sql, T.beta, cid(60), { kind: "appendix", parent: cid(1) }),
      ),
    ).toBe("23503");
    expect(
      await pgCode(
        () => sql`insert into contracts.contracts (id, tenant_id, title, created_by, file_id)
          values (${cid(61)}, ${T.beta}, 'x', ${P.an.id}, ${fileRowId(1)})`,
      ),
    ).toBe("23503");
  });
  it("HD-AC02 · UNIQUE (id, tenant_id) có ở contracts và contract_categories (đích của FK kép)", async () => {
    await needContracts(sql);
    const rows = await sql<{ t: string }[]>`select conrelid::regclass::text as t from pg_constraint
      where contype in ('u', 'p') and conrelid::regclass::text in ('contracts.contracts', 'contracts.contract_categories')
        and (select array_agg(attname::text order by attname) from pg_attribute a where a.attrelid = conrelid and a.attnum = any(conkey)) = array['id', 'tenant_id']`;
    expect(rows.map((r) => r.t).sort()).toEqual([
      "contracts.contract_categories",
      "contracts.contracts",
    ]);
  });
  it("HD-FR-04 · xoá loại hàng (owner) ⇒ item.category_id = NULL, tenant_id GIỮ; xoá HĐ ⇒ items/events/reminders CASCADE", async () => {
    await arrange();
    await sql`delete from contracts.contract_categories where id = ${catId(1)}`;
    const [it] =
      await sql`select category_id, tenant_id from contracts.contract_items where contract_id = ${cid(1)}`;
    expect({ cat: it?.category_id, tenant: it?.tenant_id }).toEqual({ cat: null, tenant: T.acme });
    await sql`delete from contracts.contracts where id = ${cid(1)}`;
    const [n] = await sql`select (select count(*) from contracts.contract_items)::int as i,
      (select count(*) from contracts.contract_events)::int as e, (select count(*) from contracts.contract_reminders)::int as r`;
    expect(n).toEqual({ i: 0, e: 0, r: 0 });
  });
});

describe("HD-FR-01/03 · CHECK ở DB", () => {
  it("HD-FR-01 · kind='appendix' phải có parent_id; kind='contract' không được có parent_id (23514)", async () => {
    await arrange();
    expect(
      await pgCode(() => minimalContract(sql, T.acme, cid(70), { kind: "appendix", parent: null })),
    ).toBe("23514");
    expect(
      await pgCode(() =>
        minimalContract(sql, T.acme, cid(71), { kind: "contract", parent: cid(1) }),
      ),
    ).toBe("23514");
    expect(
      await pgCode(() =>
        minimalContract(sql, T.acme, cid(72), { kind: "appendix", parent: cid(1) }),
      ),
    ).toBeNull();
    expect(await pgCode(() => minimalContract(sql, T.acme, cid(73), { kind: "other" }))).toBe(
      "23514",
    );
  });
  it("D-04 · status nhận đúng 9 giá trị (có 'rejected'), từ chối giá trị lạ (23514)", async () => {
    await arrange();
    for (const [i, s] of STATUSES.entries())
      expect({
        s,
        code: await pgCode(() => minimalContract(sql, T.acme, cid(100 + i), { status: s })),
      }).toEqual({ s, code: null });
    expect(await pgCode(() => minimalContract(sql, T.acme, cid(120), { status: "approved" }))).toBe(
      "23514",
    );
    expect(await pgCode(() => minimalContract(sql, T.acme, cid(121), { status: "Active" }))).toBe(
      "23514",
    );
  });
  it("HD-FR-03 · handled.outcome nhận 4 giá trị, từ chối giá trị lạ; handled null được", async () => {
    await arrange();
    for (const [i, o] of OUTCOMES.entries())
      expect(
        await pgCode(() =>
          insContract(sql, { id: cid(130 + i), tenant: T.acme, handled: { outcome: o } }),
        ),
      ).toBeNull();
    expect(
      await pgCode(() =>
        insContract(sql, { id: cid(140), tenant: T.acme, handled: { outcome: "ignored" } }),
      ),
    ).toBe("23514");
  });
  it("HD-FR-01 · direction chỉ sale/purchase/null; title 1…200; fields phải là object; error ≤ 2000", async () => {
    await arrange();
    expect(
      await pgCode(() => insContract(sql, { id: cid(150), tenant: T.acme, direction: "both" })),
    ).toBe("23514");
    expect(await pgCode(() => insContract(sql, { id: cid(151), tenant: T.acme, title: "" }))).toBe(
      "23514",
    );
    expect(
      await pgCode(() =>
        insContract(sql, { id: cid(152), tenant: T.acme, title: "x".repeat(201) }),
      ),
    ).toBe("23514");
    expect(
      await pgCode(
        () =>
          sql`insert into contracts.contracts (id, tenant_id, title, created_by, fields) values (${cid(153)}, ${T.acme}, 'x', ${P.lan.id}, '[]'::jsonb)`,
      ),
    ).toBe("23514");
    expect(
      await pgCode(
        () =>
          sql`insert into contracts.contracts (id, tenant_id, title, created_by, error) values (${cid(154)}, ${T.acme}, 'x', ${P.lan.id}, ${"e".repeat(2001)})`,
      ),
    ).toBe("23514");
  });
  it("HD-FR-01 · mặc định: status='extracting', version=1, fields='{}', clauses/warnings='[]', owner/confirmed/handled/run_id null", async () => {
    await arrange();
    await sql`insert into contracts.contracts (id, tenant_id, title, created_by) values (${cid(160)}, ${T.acme}, 'x', ${P.lan.id})`;
    const [r] =
      await sql`select status, version, fields, clauses, warnings, owner_user_id, confirmed_at, handled, run_id, action_deadline, source_text
      from contracts.contracts where id = ${cid(160)}`;
    expect(r).toMatchObject({
      status: "extracting",
      version: 1,
      fields: {},
      clauses: [],
      warnings: [],
      owner_user_id: null,
      confirmed_at: null,
      handled: null,
      run_id: null,
      action_deadline: null,
      source_text: null,
    });
  });
  it("HD-FR-04 · item: name 1…500, ord 0…9999 và UNIQUE (contract_id, ord), vat_rate 0…100, lead_time_days 0…3650", async () => {
    await arrange();
    const ins = (o: { ord: number; name?: string; vat?: number; lead?: number }) =>
      sql`insert into contracts.contract_items (id, tenant_id, contract_id, ord, name, vat_rate, lead_time_days)
        values (gen_random_uuid(), ${T.acme}, ${cid(1)}, ${o.ord}, ${o.name ?? "x"}, ${o.vat ?? null}, ${o.lead ?? null})`;
    expect(await pgCode(() => ins({ ord: 0 }))).toBe("23505"); // đã có ord 0 từ arrange()
    expect(await pgCode(() => ins({ ord: 10_000 }))).toBe("23514");
    expect(await pgCode(() => ins({ ord: 1, name: "" }))).toBe("23514");
    expect(await pgCode(() => ins({ ord: 2, vat: 100.5 }))).toBe("23514");
    expect(await pgCode(() => ins({ ord: 3, lead: 3651 }))).toBe("23514");
    expect(await pgCode(() => ins({ ord: 4, vat: 8, lead: 30 }))).toBeNull();
  });
  it("HD-FR-04 · loại hàng: name 1…40; UNIQUE (tenant_id, lower(name)) — trùng hoa/thường ⇒ 23505, tenant khác được", async () => {
    await arrange();
    expect(await pgCode(() => insCategory(sql, T.acme, catId(10), "Packaging"))).toBeNull();
    expect(await pgCode(() => insCategory(sql, T.acme, catId(11), "PACKAGING"))).toBe("23505");
    expect(await pgCode(() => insCategory(sql, T.beta, catId(12), "Packaging"))).toBeNull();
    expect(await pgCode(() => insCategory(sql, T.acme, catId(13), "x".repeat(41)))).toBe("23514");
    expect(await pgCode(() => insCategory(sql, T.acme, catId(14), ""))).toBe("23514");
  });
  it("HD-FR-06 · event: type khớp ^[a-z_]{2,40}$, data ≤ 64 KiB; actor_user_id null = hệ thống", async () => {
    await arrange();
    const ins = (type: string, data = "{}", actor: string | null = null) =>
      sql`insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
        values (${T.acme}, ${cid(1)}, ${type}, ${actor}, ${data}::text::jsonb)`;
    expect(await pgCode(() => ins("field_edited", "{}", null))).toBeNull();
    expect(await pgCode(() => ins("Bad Type"))).toBe("23514");
    expect(await pgCode(() => ins("x"))).toBe("23514");
    expect(await pgCode(() => ins("uploaded", JSON.stringify({ blob: "x".repeat(70_000) })))).toBe(
      "23514",
    );
  });
});

describe("HD-AC13 · HD-FR-05 · contract_reminders — khoá idempotency UNIQUE (contract_id, deadline, milestone, user_id)", () => {
  const ins = (
    o: { deadline?: string; milestone?: number; user?: string; channel?: string } = {},
  ) =>
    sql`insert into contracts.contract_reminders (tenant_id, contract_id, deadline, milestone, user_id, channel)
      values (${T.acme}, ${cid(1)}, ${o.deadline ?? "2027-01-31"}, ${o.milestone ?? 14}, ${o.user ?? P.lan.id}, ${o.channel ?? "email"})`;
  it("HD-AC13 · cùng (HĐ, hạn, mốc, user) lần 2 ⇒ 23505; ON CONFLICT DO NOTHING không thêm hàng", async () => {
    await arrange();
    expect(await pgCode(() => ins())).toBeNull();
    expect(await pgCode(() => ins())).toBe("23505");
    await sql`insert into contracts.contract_reminders (tenant_id, contract_id, deadline, milestone, user_id, channel)
      values (${T.acme}, ${cid(1)}, '2027-01-31', 14, ${P.lan.id}, 'email') on conflict do nothing`;
    const [n] =
      await sql`select count(*)::int as n from contracts.contract_reminders where deadline = '2027-01-31'`;
    expect(n?.n).toBe(1);
  });
  it("HD-AC13 · khác hạn ⇒ được (đổi hạn = khoá mới); khác mốc ⇒ được; khác user ⇒ được", async () => {
    await arrange();
    expect(await pgCode(() => ins())).toBeNull();
    expect(await pgCode(() => ins({ deadline: "2027-02-28" }))).toBeNull();
    expect(await pgCode(() => ins({ milestone: 7 }))).toBeNull();
    expect(await pgCode(() => ins({ user: P.hoa.id }))).toBeNull();
  });
  it("HD-FR-05 · channel khớp ^[a-z_]{2,20}$; milestone −3650…3650; sent_at mặc định now()", async () => {
    await arrange();
    expect(await pgCode(() => ins({ channel: "Bad Chan" }))).toBe("23514");
    expect(await pgCode(() => ins({ milestone: 3651 }))).toBe("23514");
    expect(await pgCode(() => ins({ milestone: -3651 }))).toBe("23514");
    expect(await pgCode(() => ins({ milestone: -3, channel: "in_app" }))).toBeNull();
    const [r] = await sql`select sent_at from contracts.contract_reminders where milestone = -3`;
    expect(r?.sent_at).toBeInstanceOf(Date);
  });
});

describe("D-08 · quyền bớt của contracts_rw", () => {
  it("D-08 · contracts_rw KHÔNG xoá được contracts / contract_items / contract_categories (42501, kể cả hàng của chính tenant)", async () => {
    await arrange();
    const del = async (t: string) =>
      pgCode(() => rw(T.acme, (tx) => tx.unsafe(`delete from contracts.${t}`)));
    // V2-M: contracts_rw lấy lại DELETE trên contracts, nhưng policy RESTRICTIVE chỉ mở khi tx có cờ
    // contracts.v2m_del = <id> (hàm delete_contract) ⇒ xoá trần không lỗi nhưng KHÔNG xoá hàng nào.
    const countContracts = async () =>
      Number((await sql`select count(*)::int as n from contracts.contracts`)[0]?.n);
    const before = await countContracts();
    expect(before).toBeGreaterThan(0);
    expect(await del("contracts")).toBeNull();
    expect(await countContracts()).toBe(before);
    expect({
      items: await del("contract_items"),
      categories: await del("contract_categories"),
    }).toEqual({ items: "42501", categories: "42501" });
  });
  it("D-08 · events/reminders chỉ thêm: UPDATE và DELETE đều 42501; INSERT/SELECT được", async () => {
    await arrange();
    for (const t of ["contract_events", "contract_reminders"]) {
      expect({
        t,
        upd: await pgCode(() =>
          rw(T.acme, (tx) => tx.unsafe(`update contracts.${t} set tenant_id = tenant_id`)),
        ),
      }).toEqual({ t, upd: "42501" });
      expect({
        t,
        del: await pgCode(() => rw(T.acme, (tx) => tx.unsafe(`delete from contracts.${t}`))),
      }).toEqual({ t, del: "42501" });
    }
    expect(
      await pgCode(() =>
        rw(
          T.acme,
          (tx) =>
            tx`insert into contracts.contract_events (tenant_id, contract_id, type) values (${T.acme}, ${cid(1)}, 'uploaded')`,
        ),
      ),
    ).toBeNull();
  });
  it("D-08 · contracts_rw vẫn INSERT/UPDATE được contracts, items, categories của tenant mình (đối chứng)", async () => {
    await arrange();
    const r = await rw(T.acme, async (tx) => {
      await minimalContract(tx, T.acme, cid(200));
      return (
        await tx`update contracts.contracts set title = 'đổi' where id = ${cid(1)} returning id`
      ).length;
    });
    expect(r).toBe(1);
  });
  it("D-08 · contracts_rw không TRUNCATE và không DDL", async () => {
    await arrange();
    expect(await pgCode(() => rw(T.acme, (tx) => tx.unsafe("truncate contracts.contracts")))).toBe(
      "42501",
    );
    expect(
      await pgCode(() => rw(T.acme, (tx) => tx.unsafe("create table contracts.evil (a int)"))),
    ).toBe("42501");
  });
});

describe("HD-FR-01 · PACK_DIRS", () => {
  it("HD-FR-01 · packages/db/src/migrate-packs.ts khai {key:'contracts', devOnly:false} (production cài gói)", async () => {
    const src = await packDirsSrc();
    expect(/key:\s*["']contracts["'][^}]*devOnly:\s*false/.test(src)).toBe(true);
  });
  it("HD-FR-01 · owner_user_id/created_by/run_id là uuid trần: không FK sang admin.*/hub.*", async () => {
    await needContracts(sql);
    const fks = await sql<
      { ref: string }[]
    >`select confrelid::regclass::text as ref from pg_constraint
      where contype = 'f' and connamespace = 'contracts'::regnamespace`;
    expect(fks.filter((f) => !f.ref.startsWith("contracts."))).toEqual([]);
    expect(OWNER_X).toBeTruthy();
  });
});
