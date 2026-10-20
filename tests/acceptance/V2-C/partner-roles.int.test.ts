// V2-C · KN-08 · HD-10 · BA 5.6a-d · DT-05 · intake C11 (làn đầy đủ, test RLS viết TRƯỚC code): đối tác nhiều vai
// (`partner_roles`: NCC / khách / bên trả HH, nhãn MỚI tới đủ số việc tối thiểu) + ghi chú (`partner_notes`, người + lúc, xoá được).
// Khớp đối tác từ HĐ = trigger trên `contracts.contracts` (khoá `party_key`: MST hoặc tên không phân biệt hoa thường/dấu). Luật thấy
// M1 như danh bạ HD8 (0019): chế độ org chỉ thấy vai/ghi chú của đối tác mình thấy (`visible_party_keys()`) hoặc do mình tạo — kiểm
// qua HTTP và trực tiếp dưới role gói (`withPackScope`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withPackScope } from "@ai/db/pack-scope";
import { connectDb } from "../../../apps/hub-api/src/lib/db";
import { HUB_API_URL } from "../H1/_fixtures";
import {
  arrangeHd8,
  type CtxN1,
  call,
  deal,
  type Json,
  ok,
  P,
  record,
  type Sql,
  startHd1,
  T,
} from "../HD8/_support/hd8";

let c: CtxN1;
let db: ReturnType<typeof connectDb>;
beforeAll(async () => {
  c = await startHd1();
  db = connectDb(HUB_API_URL, 2);
}, 120_000);
afterAll(async () => {
  await db?.close();
  await c?.stop();
});

const enc = encodeURIComponent;
const LAN_ONLY = "tax:0311110001";
const SHARED = "tax:0311110002";
const NEW_LABEL = "Đối tác mới · sẽ tạo khi lưu";

async function needV2c(sql: Sql): Promise<void> {
  const [r] = await sql<{ t: boolean; trg: boolean }[]>`select
    to_regclass('contracts.partner_roles') is not null and to_regclass('contracts.partner_notes') is not null as t,
    exists (select 1 from pg_trigger where tgrelid = 'contracts.contracts'::regclass
      and tgname = 'contracts_v2c_roles_ins') as trg`;
  expect({ v2c_migration: r }).toEqual({ v2c_migration: { t: true, trg: true } });
}
async function arrangeV2c(): Promise<void> {
  await needV2c(c.sql);
  await arrangeHd8(c);
  await c.sql`truncate contracts.partner_roles, contracts.partner_notes`;
}
const rolesOf = (sql: Sql) =>
  sql<{ party_key: string; role: string; name: string | null; contract_id: string | null }[]>`
    select party_key, role, name, contract_id from contracts.partner_roles where tenant_id = ${T.acme}
    order by party_key, role`;

const asHoa = <R>(fn: Parameters<typeof withPackScope<R>>[2]) =>
  withPackScope(db, { packKey: "contracts", tenantId: T.acme, userId: P.hoa.id }, fn);
const rows = async (q: string) =>
  asHoa(async (tx) => (await tx.execute(q as never)) as unknown as Record<string, unknown>[]);

describe("V2-C · 5.6 đối tác từ HĐ (trigger khi lưu)", () => {
  it("khớp tên không phân biệt hoa thường ⇒ một đối tác; thiếu vai ⇒ thêm vai; HĐ nháp không tạo; xác nhận / đổi tên ⇒ tạo", async () => {
    await arrangeV2c();
    const a = await deal(c.sql, { sale: false, partner: "Công ty ABC" });
    await deal(c.sql, { sale: true, partner: "CÔNG TY abc" });
    await deal(c.sql, { sale: false, partner: "công ty ABC" });
    const draft = await deal(c.sql, { sale: false, partner: "Nháp XYZ", status: "needs_review" });
    let r = await rolesOf(c.sql);
    expect(r.map((x) => [x.party_key, x.role])).toEqual([
      ["name:cong ty abc", "customer"],
      ["name:cong ty abc", "supplier"],
    ]);
    expect(r.find((x) => x.role === "supplier")?.contract_id).toBe(a);
    expect(r.find((x) => x.role === "supplier")?.name).toBe("Công ty ABC");

    await c.sql`update contracts.contracts set status = 'active' where id = ${draft}`;
    // HD-09: đổi sang tên đối tác chưa có (dưới role gói, người sửa = Hoà) ⇒ tạo đối tác + vai, tác giả = Hoà
    await c.sql`update contracts.contracts set owner_user_id = ${P.hoa.id} where id = ${a}`;
    const upd = await rows(
      `update contracts.contracts set fields = jsonb_set(fields, '{supplier_name,value}', '"Nhà Cung Cấp Mới"')
        where id = '${a}' returning id`,
    );
    expect(upd.length).toBe(1);
    r = await rolesOf(c.sql);
    expect(r.map((x) => [x.party_key, x.role])).toEqual([
      ["name:cong ty abc", "customer"],
      ["name:cong ty abc", "supplier"],
      ["name:nha cung cap moi", "supplier"],
      ["name:nhap xyz", "supplier"],
    ]);
    const [by] = await c.sql<
      { created_by: string }[]
    >`select created_by from contracts.partner_roles
      where party_key = 'name:nha cung cap moi'`;
    expect(by?.created_by).toBe(P.hoa.id);
  });

  it("HĐ Giới thiệu (deal = referral, V2-A) ⇒ bên trả hoa hồng = bên mua của HĐ; đối tác có sẵn ⇒ thêm vai", async () => {
    await arrangeV2c();
    await deal(c.sql, { sale: true, partner: "Bảo Hiểm Xe Sài Gòn", tax: "0311110055" });
    const fv = (value: unknown) => ({ value, quote: "", verified: true, edited: true });
    const fields = {
      number: fv("GT-01"),
      buyer_name: fv("BẢO HIỂM XE SÀI GÒN"),
      buyer_tax_id: fv("0311-110-055"),
      supplier_name: fv("Công ty Chúng Tôi"),
      supplier_tax_id: fv("0100000000"),
      total_value: fv(null),
    };
    await c.sql`insert into contracts.contracts (tenant_id, title, direction, deal, status, created_by, owner_user_id, fields)
      values (${T.acme}, 'HĐ giới thiệu', 'sale', 'referral', 'active', ${P.lan.id}, ${P.lan.id},
        ${c.sql.json(fields as never)})`;
    const r = await rolesOf(c.sql);
    expect(r.map((x) => [x.party_key, x.role])).toEqual([
      ["tax:0311110055", "commission_payer"],
      ["tax:0311110055", "customer"],
    ]);
  });
});

describe("V2-C · M1 trên vai + ghi chú (chế độ org) · cách ly tenant", () => {
  it("thành viên chỉ thấy vai/ghi chú của đối tác mình thấy; không ghi/xoá/giả tác giả ngoài phạm vi; owner thấy hết", async () => {
    await arrangeV2c();
    await deal(c.sql, { sale: false, partner: "NCC Riêng Lan", tax: "0311110001" });
    const hoaDeal = await deal(c.sql, { sale: false, partner: "NCC Của Hoà", tax: "0311110002" });
    await c.sql`update contracts.contracts set owner_user_id = ${P.hoa.id} where id = ${hoaDeal}`;
    await c.sql`insert into contracts.partner_roles (tenant_id, party_key, role, name)
      values (${T.beta}, 'tax:0399999999', 'supplier', 'Tenant khác')`;
    const lanNote = await ok(
      call(c, P.lan, "POST", "/partners/notes", { party: LAN_ONLY, body: "Giao chậm 2 lần" }),
    );
    await ok(call(c, P.lan, "POST", "/partners/notes", { party: SHARED, body: "Ghi chú chung" }));
    // tenant khác không lộ (owner, chế độ tenant)
    const all: Json[] = await ok(call(c, P.lan, "GET", "/partners/roles"));
    expect(all.map((x: Json) => x.party).sort()).toEqual([LAN_ONLY, SHARED]);

    await ok(call(c, P.lan, "PUT", "/visibility", { mode: "org" }));
    try {
      const roles: Json[] = await ok(call(c, P.hoa, "GET", "/partners/roles"));
      expect(roles.map((x: Json) => x.party)).toEqual([SHARED]);
      expect(await ok(call(c, P.hoa, "GET", `/partners/notes?party=${enc(LAN_ONLY)}`))).toEqual([]);
      const shared: Json[] = await ok(
        call(c, P.hoa, "GET", `/partners/notes?party=${enc(SHARED)}`),
      );
      expect(shared.map((n: Json) => n.body)).toEqual(["Ghi chú chung"]);
      const post = await call(c, P.hoa, "POST", "/partners/notes", { party: LAN_ONLY, body: "x" });
      expect(post.status).toBe(404);
      expect((await call(c, P.hoa, "DELETE", `/partners/notes/${lanNote.id}`)).status).toBe(404);
      // gợi ý đối tác: đối tác ngoài phạm vi ⇒ "mới" (không lộ là đã có)
      const lk = await ok(
        call(
          c,
          P.hoa,
          "GET",
          `/partners/lookup?name=${enc("NCC Riêng Lan")}&tax_id=0311110001&deal=buy`,
        ),
      );
      expect([lk.status, lk.label]).toEqual(["new", NEW_LABEL]);

      // trực tiếp dưới role gói
      expect(
        (await rows("select party_key from contracts.partner_roles")).map((x) => x.party_key),
      ).toEqual([SHARED]);
      expect((await rows("select body from contracts.partner_notes")).map((x) => x.body)).toEqual([
        "Ghi chú chung",
      ]);
      const del = await rows(
        `delete from contracts.partner_notes where id = '${lanNote.id}' returning id`,
      );
      expect(del.length).toBe(0);
      await expect(
        rows("update contracts.partner_notes set body = 'x' returning id"),
      ).rejects.toThrow();
      await expect(
        rows(`insert into contracts.partner_notes (tenant_id, party_key, body)
          values ('${T.acme}', '${LAN_ONLY}', 'chen ngang')`),
      ).rejects.toThrow();
      await expect(
        rows(`insert into contracts.partner_notes (tenant_id, party_key, body, created_by)
          values ('${T.acme}', '${SHARED}', 'gia tac gia', '${P.lan.id}')`),
      ).rejects.toThrow();
      await expect(
        rows(`insert into contracts.partner_roles (tenant_id, party_key, role, created_by)
          values ('${T.acme}', 'tax:0311119999', 'supplier', '${P.lan.id}')`),
      ).rejects.toThrow();
      await expect(rows("delete from contracts.partner_roles returning id")).rejects.toThrow();
      await expect(
        rows("update contracts.partner_roles set name = 'x' returning id"),
      ).rejects.toThrow();
      await expect(
        rows(`insert into contracts.partner_roles (tenant_id, party_key, role)
          values ('${T.beta}', 'tax:0311119998', 'supplier')`),
      ).rejects.toThrow();
      // owner vẫn thấy hết
      expect((await ok(call(c, P.lan, "GET", "/partners/roles"))).length).toBe(2);
      const lanSees: Json[] = await ok(
        call(c, P.lan, "GET", `/partners/notes?party=${enc(LAN_ONLY)}`),
      );
      expect(lanSees.length).toBe(1);
    } finally {
      await c.sql`update contracts.visibility_settings set mode = 'tenant'`;
    }
  });
});

describe("V2-C · DT-05 ghi chú đối tác", () => {
  it("ghi người + lúc, mới nhất trước; người viết hoặc quản lý xoá; viewer không ghi; đầu vào sai ⇒ 400", async () => {
    await arrangeV2c();
    await deal(c.sql, { sale: false, partner: "NCC Của Hoà", tax: "0311110002" });
    const lanNote = await ok(
      call(c, P.lan, "POST", "/partners/notes", { party: SHARED, body: "Một" }),
    );
    const hoaNote = await ok(
      call(c, P.hoa, "POST", "/partners/notes", { party: SHARED, body: "  Hai  " }),
    );
    expect([hoaNote.body, hoaNote.by_user, hoaNote.party]).toEqual(["Hai", P.hoa.id, SHARED]);
    expect(typeof hoaNote.by).toBe("string");
    expect(Number.isNaN(Date.parse(hoaNote.at))).toBe(false);
    const list: Json[] = await ok(call(c, P.hoa, "GET", `/partners/notes?party=${enc(SHARED)}`));
    expect(list.map((n: Json) => n.body)).toEqual(["Hai", "Một"]);

    expect((await call(c, P.hoa, "DELETE", `/partners/notes/${lanNote.id}`)).status).toBe(403);
    expect(
      (await call(c, P.tam, "POST", "/partners/notes", { party: SHARED, body: "x" })).status,
    ).toBe(403);
    for (const b of [
      { party: SHARED, body: "   " },
      { party: SHARED, body: "x".repeat(2001) },
      { party: "tax:03\u000011", body: "x" },
      { party: SHARED, body: "x", extra: 1 },
    ])
      expect((await call(c, P.hoa, "POST", "/partners/notes", b)).status).toBe(400);
    expect((await call(c, P.hoa, "DELETE", "/partners/notes/khong-phai-uuid")).status).toBe(400);
    // đối tác chưa có ⇒ 404
    const none = await call(c, P.hoa, "POST", "/partners/notes", {
      party: "tax:0311110077",
      body: "x",
    });
    expect(none.status).toBe(404);

    expect((await call(c, P.hoa, "DELETE", `/partners/notes/${hoaNote.id}`)).status).toBe(200);
    expect((await call(c, P.lan, "DELETE", `/partners/notes/${lanNote.id}`)).status).toBe(200);
    expect(await ok(call(c, P.hoa, "GET", `/partners/notes?party=${enc(SHARED)}`))).toEqual([]);
    expect((await call(c, P.lan, "DELETE", `/partners/notes/${lanNote.id}`)).status).toBe(404);
  });
});

describe("V2-C · HD-10 gợi ý đối tác + nhãn MỚI (5.6d)", () => {
  it("có sẵn ⇒ existing + vai + điểm; tên chỉ khác hoa thường ⇒ khớp; thiếu vai ⇒ has_role=false; chưa có ⇒ nhãn mới", async () => {
    await arrangeV2c();
    await deal(c.sql, { sale: false, partner: "Công ty ABC" });
    await deal(c.sql, { sale: false, partner: "Thép Việt", tax: "0311110009" });
    const abc = "name:cong ty abc";

    let lk = await ok(
      call(c, P.hoa, "GET", `/partners/lookup?name=${enc("CÔNG TY abc")}&deal=buy`),
    );
    expect([lk.status, lk.party, lk.role, lk.has_role, lk.roles, lk.is_new]).toEqual([
      "existing",
      abc,
      "supplier",
      true,
      ["supplier"],
      true,
    ]);
    expect("score" in lk && "band" in lk).toBe(true);
    lk = await ok(call(c, P.hoa, "GET", `/partners/lookup?name=${enc("Công ty ABC")}&deal=sell`));
    expect([lk.status, lk.role, lk.has_role]).toEqual(["existing", "customer", false]);

    // đủ 3 việc (bỏ việc bị huỷ / chấm tay) ⇒ hết MỚI
    for (const at of ["2026-09-01", "2026-09-02"])
      await record(c.sql, T.acme, abc, "supplier", "delivered", at);
    await record(c.sql, T.acme, abc, "supplier", "rating", "2026-09-03");
    let roles: Json[] = await ok(call(c, P.hoa, "GET", `/partners/roles?party=${enc(abc)}`));
    expect(roles.map((x: Json) => [x.role, x.events, x.min_events, x.is_new])).toEqual([
      ["supplier", 2, 3, true],
    ]);
    await record(c.sql, T.acme, abc, "supplier", "paid", "2026-09-04");
    roles = await ok(call(c, P.hoa, "GET", `/partners/roles?party=${enc(abc)}`));
    expect(roles.map((x: Json) => [x.role, x.events, x.is_new])).toEqual([["supplier", 3, false]]);
    lk = await ok(call(c, P.hoa, "GET", `/partners/lookup?name=${enc("công ty abc")}&deal=buy`));
    expect(lk.is_new).toBe(false);

    // chỉ gõ tên, đối tác có MST ⇒ khớp theo tên, trả MST để form điền
    lk = await ok(call(c, P.hoa, "GET", `/partners/lookup?name=${enc("thép việt")}&deal=buy`));
    expect([lk.status, lk.party, lk.tax_id]).toEqual(["existing", "tax:0311110009", "0311110009"]);

    lk = await ok(
      call(c, P.hoa, "GET", `/partners/lookup?name=${enc("Công ty Mới Toanh")}&deal=referral`),
    );
    expect(lk).toEqual({
      status: "new",
      party: "name:cong ty moi toanh",
      role: "commission_payer",
      label: NEW_LABEL,
    });
    expect((await call(c, P.hoa, "GET", "/partners/lookup?name=")).status).toBe(400);
    expect((await call(c, P.hoa, "GET", "/partners/lookup?name=a&deal=lend")).status).toBe(400);
  });
});
