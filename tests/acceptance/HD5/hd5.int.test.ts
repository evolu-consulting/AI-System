// HD-FR-51…55 · HD5 plan: danh sách có `parents`, chi tiết có `parent`/`appendices`, gắn HĐ gốc (khoá lạc quan, quyền, tenant),
// gợi ý, bảng giá áp phụ lục, loại hàng, danh bạ thành viên. Hạ tầng dùng lại HD1 (hub-api + admin-api thật, DB sạch).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrange,
  type CtxN1,
  catId,
  cid,
  dayIn,
  GHOST,
  insCategory,
  insContract,
  listOf,
  mkFields,
  P,
  startHd1,
  T,
  unlockContract,
} from "../HD1/_support/hd1";
import { afterReload, bumpConfig } from "../N1/_support/n1";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});
const BASE = "/pack/contracts";
/** lock-strict: HĐ dựng ở trạng thái xác nhận bị khoá ⇒ gỡ khoá để test gắn/gỡ HĐ gốc (ca bị khoá: K1/lock.int). */
const insOpen = async (
  sql: Parameters<typeof insContract>[0],
  r: Parameters<typeof insContract>[1],
) => {
  await insContract(sql, r);
  await unlockContract(sql, r.id);
};
const get = (p: (typeof P)[keyof typeof P], path: string) => c.hubCall(p, "GET", `${BASE}${path}`);
const send = (p: (typeof P)[keyof typeof P], m: string, path: string, body?: unknown) =>
  c.hubCall(p, m, `${BASE}${path}`, body);
const err = (r: { status: number; json?: { error?: { code?: string } } }) => [
  r.status,
  r.json?.error?.code,
];

async function family() {
  await arrange(c);
  await insOpen(c.sql, {
    id: cid(1),
    tenant: T.acme,
    title: "HĐ gốc",
    fields: mkFields({ number: "01/2026/HĐMB-PN", supplier_name: "Công ty Minh Phát" }),
  });
  await insOpen(c.sql, {
    id: cid(2),
    tenant: T.acme,
    title: "Phụ lục 1",
    kind: "appendix",
    parent: cid(1),
    fields: mkFields({ effective_date: "2026-07-01", number: "PL01" }),
    updatedAt: "2026-03-01T00:00:00Z",
  });
  await insOpen(c.sql, {
    id: cid(3),
    tenant: T.acme,
    title: "Phụ lục chờ kiểm",
    kind: "appendix",
    parent: cid(1),
    status: "needs_review",
    fields: mkFields({ effective_date: "2026-08-01" }),
  });
  await insOpen(c.sql, {
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
  it("danh sách: hàng phụ lục có parent_id và `parents` liệt kê HĐ gốc một lần; ListRow 22 khoá (CR-097 K1 locked, K2 version_no/versions_count)", async () => {
    await family();
    const r = await listOf(c, P.tam);
    expect(r.status).toBe(200);
    expect(r.json.parents).toEqual([{ id: cid(1), title: "HĐ gốc", number: "01/2026/HĐMB-PN" }]);
    expect(Object.keys(r.json.items[0]).length).toBe(22);
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

// CR-101a (Câu 5, 2026-10-27): ngừng tạo phụ lục mới — gắn làm phụ lục ⇒ 410 USE_VERSIONS (sau guard quyền + đọc thân); phụ lục cũ
// chỉ đọc; gỡ phụ lục cũ (`parent_id: null`) vẫn được. Ca gắn thành công / cha không hợp lệ / gắn đồng thời của HD5 đã bỏ (đảo CR-097 Q9).
describe("HD-FR-54 · gắn / gỡ HĐ gốc (CR-101a)", () => {
  it("editor gắn HĐ thành phụ lục ⇒ 410 USE_VERSIONS, không đổi DB, không event", async () => {
    await family();
    await insOpen(c.sql, { id: cid(4), tenant: T.acme, title: "Rời" });
    const r = await send(P.hoa, "PATCH", `/contracts/${cid(4)}/parent`, {
      version: 1,
      parent_id: cid(1),
    });
    expect(err(r)).toEqual([410, "USE_VERSIONS"]);
    const [row] =
      await c.sql`select kind, parent_id, version from contracts.contracts where id = ${cid(4)}`;
    expect(row).toMatchObject({ kind: "contract", parent_id: null, version: 1 });
    const ev = await c.sql`select 1 from contracts.contract_events where contract_id = ${cid(4)}`;
    expect(ev.length).toBe(0);
  });
  it("gỡ phụ lục cũ ⇒ 200, trả về HĐ; viewer ⇒ 403; version cũ ⇒ 409 CONTRACT_STALE", async () => {
    await family();
    const v = await send(P.tam, "PATCH", `/contracts/${cid(2)}/parent`, {
      version: 1,
      parent_id: null,
    });
    expect(err(v)).toEqual([403, "PACK_FORBIDDEN"]);
    const s = await send(P.hoa, "PATCH", `/contracts/${cid(2)}/parent`, {
      version: 7,
      parent_id: null,
    });
    expect(err(s)).toEqual([409, "CONTRACT_STALE"]);
    const back = await send(P.lan, "PATCH", `/contracts/${cid(2)}/parent`, {
      version: 1,
      parent_id: null,
    });
    expect(back.json).toMatchObject({ kind: "contract", parent_id: null, version: 2 });
  });
  it("id lạ / tenant khác ⇒ 404 giống nhau; id sai dạng ⇒ 400", async () => {
    await family();
    const body = { version: 1, parent_id: null };
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
    await insOpen(c.sql, {
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
  it("as_of mặc định = ngày lịch theo MÚI TENANT (HD4-FR-02), không phải UTC", async () => {
    await family();
    const zones = ["Pacific/Kiritimati", "Pacific/Pago_Pago"] as const;
    const got: string[] = [];
    try {
      for (const tz of zones) {
        await afterReload(c.hub, async () => {
          await c.sql`update admin.tenants set timezone = ${tz} where id = ${T.acme}`;
          await bumpConfig(c.sql, T.acme);
        });
        const r = await get(P.tam, `/contracts/${cid(1)}/prices`);
        expect(r.status).toBe(200);
        expect(r.json.as_of).toBe(dayIn(tz));
        got.push(r.json.as_of);
      }
    } finally {
      await c.sql`update admin.tenants set timezone = 'Asia/Ho_Chi_Minh' where id = ${T.acme}`;
      await bumpConfig(c.sql, T.acme);
    }
    expect(got[0]).not.toBe(got[1]);
  });
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
