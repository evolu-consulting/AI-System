// HD-FR-51…55 · HD5 plan: danh sách có `parents`, chi tiết có `parent`/`appendices`, gắn HĐ gốc (khoá lạc quan, quyền, tenant),
// gợi ý, bảng giá áp phụ lục, loại hàng, danh bạ thành viên. Hạ tầng dùng lại HD1 (hub-api + admin-api thật, DB sạch).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrange,
  type CtxN1,
  catId,
  cid,
  GHOST,
  insCategory,
  insContract,
  listOf,
  mkFields,
  P,
  startHd1,
  T,
} from "../HD1/_support/hd1";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});
const BASE = "/pack/contracts";
const get = (p: (typeof P)[keyof typeof P], path: string) => c.hubCall(p, "GET", `${BASE}${path}`);
const send = (p: (typeof P)[keyof typeof P], m: string, path: string, body?: unknown) =>
  c.hubCall(p, m, `${BASE}${path}`, body);
const err = (r: { status: number; json?: { error?: { code?: string } } }) => [
  r.status,
  r.json?.error?.code,
];

async function family() {
  await arrange(c);
  await insContract(c.sql, {
    id: cid(1),
    tenant: T.acme,
    title: "HĐ gốc",
    fields: mkFields({ number: "01/2026/HĐMB-PN", supplier_name: "Công ty Minh Phát" }),
  });
  await insContract(c.sql, {
    id: cid(2),
    tenant: T.acme,
    title: "Phụ lục 1",
    kind: "appendix",
    parent: cid(1),
    fields: mkFields({ effective_date: "2026-07-01", number: "PL01" }),
    updatedAt: "2026-03-01T00:00:00Z",
  });
  await insContract(c.sql, {
    id: cid(3),
    tenant: T.acme,
    title: "Phụ lục chờ kiểm",
    kind: "appendix",
    parent: cid(1),
    status: "needs_review",
    fields: mkFields({ effective_date: "2026-08-01" }),
  });
  await insContract(c.sql, {
    id: cid(9),
    tenant: T.beta,
    title: "HĐ tenant khác",
    owner: P.an.id,
    createdBy: P.an.id,
  });
}
const item = (cidv: string, ord: number, name: string, price: number, code: string | null = null) =>
  c.sql`insert into contracts.contract_items (tenant_id, contract_id, ord, code, name, unit_price)
    values (${T.acme}, ${cidv}, ${ord}, ${code}, ${name}, ${price})`;

describe("HD-FR-51 · danh sách + chi tiết có phụ lục", () => {
  it("danh sách: hàng phụ lục có parent_id và `parents` liệt kê HĐ gốc một lần; ListRow vẫn 19 khoá", async () => {
    await family();
    const r = await listOf(c, P.tam);
    expect(r.status).toBe(200);
    expect(r.json.parents).toEqual([{ id: cid(1), title: "HĐ gốc", number: "01/2026/HĐMB-PN" }]);
    expect(Object.keys(r.json.items[0]).length).toBe(19);
    const only = await listOf(c, P.tam, { kind: "contract" });
    expect(only.json.parents).toEqual([]);
  });
  it("chi tiết: HĐ gốc có `appendices` (kèm ngày hiệu lực), phụ lục có `parent`", async () => {
    await family();
    const p = (await get(P.tam, `/contracts/${cid(1)}`)).json;
    expect(p.parent).toBeNull();
    expect(
      p.appendices
        .map((a: { id: string; effective_date: string | null }) => [a.id, a.effective_date])
        .sort(),
    ).toEqual([
      [cid(2), "2026-07-01"],
      [cid(3), "2026-08-01"],
    ]);
    const a = (await get(P.tam, `/contracts/${cid(2)}`)).json;
    expect(a.parent).toEqual({ id: cid(1), title: "HĐ gốc", number: "01/2026/HĐMB-PN" });
    expect(a.appendices).toEqual([]);
  });
});

describe("HD-FR-54 · gắn / gỡ HĐ gốc", () => {
  it("editor gắn HĐ thành phụ lục: kind/parent_id đổi, version+1, event parent_changed, outbox; gỡ trả về HĐ", async () => {
    await family();
    await insContract(c.sql, { id: cid(4), tenant: T.acme, title: "Rời" });
    const r = await send(P.hoa, "PATCH", `/contracts/${cid(4)}/parent`, {
      version: 1,
      parent_id: cid(1),
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ id: cid(4), kind: "appendix", parent_id: cid(1), version: 2 });
    const [ev] =
      await c.sql`select type, data, actor_user_id from contracts.contract_events where contract_id = ${cid(4)}`;
    expect(ev).toMatchObject({
      type: "parent_changed",
      data: { from: null, to: cid(1) },
      actor_user_id: P.hoa.id,
    });
    const [ob] =
      await c.sql`select entity, op from contracts.index_outbox where entity_id = ${cid(4)}`;
    expect(ob).toMatchObject({ entity: "contract", op: "upsert" });
    const back = await send(P.lan, "PATCH", `/contracts/${cid(4)}/parent`, {
      version: 2,
      parent_id: null,
    });
    expect(back.json).toMatchObject({ kind: "contract", parent_id: null, version: 3 });
  });
  it("viewer ⇒ 403; version cũ ⇒ 409 CONTRACT_STALE; không đổi DB", async () => {
    await family();
    await insContract(c.sql, { id: cid(4), tenant: T.acme, title: "Rời" });
    const v = await send(P.tam, "PATCH", `/contracts/${cid(4)}/parent`, {
      version: 1,
      parent_id: cid(1),
    });
    expect(err(v)).toEqual([403, "PACK_FORBIDDEN"]);
    const s = await send(P.hoa, "PATCH", `/contracts/${cid(4)}/parent`, {
      version: 7,
      parent_id: cid(1),
    });
    expect(err(s)).toEqual([409, "CONTRACT_STALE"]);
    const [row] = await c.sql`select kind, version from contracts.contracts where id = ${cid(4)}`;
    expect(row).toMatchObject({ kind: "contract", version: 1 });
  });
  it("cha không hợp lệ ⇒ 422 PARENT_INVALID: chính nó, cha là phụ lục, HĐ đang có phụ lục, cha ở tenant khác / không tồn tại", async () => {
    await family();
    await insContract(c.sql, { id: cid(4), tenant: T.acme, title: "Rời" });
    const body = (parent_id: string) => ({ version: 1, parent_id });
    const cases: [string, string][] = [
      [cid(4), cid(4)],
      [cid(4), cid(2)],
      [cid(1), cid(4)],
      [cid(4), cid(9)],
      [cid(4), GHOST],
    ];
    for (const [id, parent] of cases) {
      const r = await send(P.hoa, "PATCH", `/contracts/${id}/parent`, body(parent));
      expect([id, err(r)]).toEqual([id, [422, "PARENT_INVALID"]]);
    }
    const [row] =
      await c.sql`select count(*)::int as n from contracts.contracts where kind = 'appendix'`;
    expect(row?.n).toBe(2);
  });
  it("id lạ / tenant khác ⇒ 404 giống nhau; id sai dạng ⇒ 400", async () => {
    await family();
    const body = { version: 1, parent_id: cid(1) };
    const a = await send(P.hoa, "PATCH", `/contracts/${GHOST}/parent`, body);
    const b = await send(P.hoa, "PATCH", `/contracts/${cid(9)}/parent`, body);
    expect([err(a), err(b)]).toEqual([
      [404, "NOT_FOUND"],
      [404, "NOT_FOUND"],
    ]);
    expect((await send(P.hoa, "PATCH", "/contracts/xyz/parent", body)).status).toBe(400);
  });
  it("gợi ý: số HĐ nêu trong văn bản ⇒ cited_number; tenant khác không lộ", async () => {
    await family();
    await insContract(c.sql, {
      id: cid(5),
      tenant: T.acme,
      title: "PL mới",
      source: "# PHỤ LỤC 02\nKèm theo Hợp đồng số: 01/2026/HĐMB-PN ngày 1/1/2026",
      fields: mkFields({ supplier_name: "Khác" }),
    });
    const r = await get(P.tam, `/contracts/${cid(5)}/parent-suggestions`);
    expect(r.status).toBe(200);
    expect(r.json.items).toEqual([
      {
        id: cid(1),
        title: "HĐ gốc",
        number: "01/2026/HĐMB-PN",
        seller: "Công ty Minh Phát",
        buyer: null,
        reason: "cited_number",
      },
    ]);
    expect(err(await get(P.tam, `/contracts/${cid(9)}/parent-suggestions`))).toEqual([
      404,
      "NOT_FOUND",
    ]);
  });
});

describe("HD-FR-55 · bảng giá áp phụ lục", () => {
  it("phụ lục đã chốt thay giá gốc từ ngày hiệu lực; phụ lục chờ kiểm không áp; total_value không đổi; gọi từ phụ lục = cùng họ", async () => {
    await family();
    await item(cid(1), 0, "Thùng", 100, "T1");
    await item(cid(1), 1, "Màng", 50);
    await item(cid(2), 0, "thùng", 120, "t1");
    await item(cid(3), 0, "Màng", 1);
    const before = (await c.sql`select value from contracts.contracts where id = ${cid(1)}`)[0];
    const r = await get(P.tam, `/contracts/${cid(1)}/prices?as_of=2026-08-15`);
    expect(r.status).toBe(200);
    const rows = r.json.lines.map(
      (l: {
        item: { name: string; unit_price: number };
        source: { id: string };
        valid_to: string | null;
        superseded_by: string | null;
        current: boolean;
      }) => [l.item.name, l.item.unit_price, l.source.id, l.valid_to, l.superseded_by, l.current],
    );
    expect(rows).toEqual([
      ["Thùng", 100, cid(1), "2026-06-30", cid(2), false],
      ["Màng", 50, cid(1), null, null, true],
      ["thùng", 120, cid(2), null, null, true],
    ]);
    expect(r.json).toMatchObject({ as_of: "2026-08-15", total: 3 });
    const viaAppendix = await get(P.tam, `/contracts/${cid(2)}/prices?as_of=2026-08-15`);
    expect(viaAppendix.json.lines).toEqual(r.json.lines);
    expect((await c.sql`select value from contracts.contracts where id = ${cid(1)}`)[0]).toEqual(
      before,
    );
    expect(err(await get(P.tam, `/contracts/${cid(1)}/prices?as_of=2026-13-01`))).toEqual([
      400,
      "VALIDATION_ERROR",
    ]);
    expect(err(await get(P.tam, `/contracts/${cid(9)}/prices`))).toEqual([404, "NOT_FOUND"]);
  });
});

describe("HD-FR-53 · loại hàng", () => {
  it("liệt kê theo tên; editor thêm ⇒ 201; trùng tên (hoa/thường) ⇒ 409; viewer thêm ⇒ 403; cách ly tenant", async () => {
    await arrange(c);
    await insCategory(c.sql, T.acme, catId(1), "Vận chuyển");
    await insCategory(c.sql, T.beta, catId(2), "Của beta");
    const ok = await send(P.hoa, "POST", "/categories", { name: "  Bao bi " });
    expect(ok.status).toBe(201);
    expect(ok.json.name).toBe("Bao bi");
    expect(err(await send(P.hoa, "POST", "/categories", { name: "BAO BI" }))).toEqual([
      409,
      "CATEGORY_EXISTS",
    ]);
    expect(err(await send(P.tam, "POST", "/categories", { name: "Mới" }))).toEqual([
      403,
      "PACK_FORBIDDEN",
    ]);
    expect((await send(P.hoa, "POST", "/categories", { name: "" })).status).toBe(400);
    const l = await get(P.tam, "/categories");
    expect(l.json.items.map((x: { name: string }) => x.name)).toEqual(["Bao bi", "Vận chuyển"]);
  });
  it("tới trần 200 loại ⇒ 422 CATEGORY_LIMIT", async () => {
    await arrange(c);
    await c.sql`insert into contracts.contract_categories (tenant_id, name) select ${T.acme}, 'c' || g from generate_series(1, 200) g`;
    expect(err(await send(P.hoa, "POST", "/categories", { name: "thừa" }))).toEqual([
      422,
      "CATEGORY_LIMIT",
    ]);
  });
});

describe("HD-FR-52 · danh bạ thành viên", () => {
  it("chỉ người dùng của tenant token, chỉ {id,name}; viewer đọc được", async () => {
    await arrange(c);
    const r = await get(P.tam, "/members");
    expect(r.status).toBe(200);
    const ids = r.json.items.map((m: { id: string }) => m.id);
    expect(ids).toContain(P.lan.id);
    expect(ids).toContain(P.tam.id);
    expect(ids).not.toContain(P.an.id);
    for (const m of r.json.items) expect(Object.keys(m).sort()).toEqual(["id", "name"]);
  });
});
