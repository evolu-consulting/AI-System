// HD-FR-07 · HD-BR-03 · HD-AC01/03/04/05 · D-03 · D-10 · plan §1 §2 §6: GET /pack/contracts/contracts (danh sách: lọc, sắp, phân trang
// page/page_size/total) và /contracts/facets (cả tenant). Quyền viewer đọc được. Dữ liệu cụ thể, không ngẫu nhiên.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrange,
  CBASE,
  CK,
  type CtxN1,
  catId,
  cid,
  idsOf,
  insCategory,
  insContract,
  insItem,
  listOf,
  mkFields,
  OWNER_X,
  P,
  startHd1,
  T,
} from "./_support/hd1";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const ms = (n: number) => `2026-03-0${n}T00:00:00Z`;
/** acme: 6 HĐ (cid 1…6), 2 loại hàng; beta: 1 HĐ. updated_at tăng dần theo số ⇒ mặc định (desc) là 6,5,4,3,2,1. */
async function dataset() {
  await arrange(c);
  const s = c.sql;
  await insCategory(s, T.acme, catId(1), "Bao bì");
  await insCategory(s, T.acme, catId(2), "Vận chuyển");
  await insContract(s, {
    id: cid(1),
    tenant: T.acme,
    title: "Hợp đồng bao bì Minh Phát",
    status: "active",
    direction: "purchase",
    owner: P.lan.id,
    updatedAt: ms(1),
    fields: mkFields({
      number: "HD-001",
      supplier_name: "Công ty Minh Phát",
      buyer_name: "Công ty ABC",
      supplier_representative: "Trần Thị B",
      buyer_representative: "Nguyễn Văn A",
      total_value: 500_000_000,
      end_date: "2027-03-31",
      type: "purchase",
    }),
  });
  await insContract(s, {
    id: cid(2),
    tenant: T.acme,
    title: "Hợp đồng vận chuyển",
    status: "expiring",
    direction: "purchase",
    owner: P.hoa.id,
    updatedAt: ms(2),
    fields: mkFields({
      supplier_name: "Vận Tải Bắc Nam",
      buyer_name: "Công ty ABC",
      buyer_representative: "Lê Văn C",
      total_value: 120_000_000,
      end_date: "2026-12-31",
    }),
  });
  await insContract(s, {
    id: cid(3),
    tenant: T.acme,
    title: "Hợp đồng bán hàng Đông Á",
    status: "needs_review",
    direction: "sale",
    owner: P.lan.id,
    updatedAt: ms(3),
    fields: mkFields({
      supplier_name: "Công ty ABC",
      buyer_name: "Đông Á",
      buyer_representative: "nguyễn văn a",
      total_value: 90_000_000,
      end_date: "2027-06-30",
    }),
  });
  await insContract(s, {
    id: cid(4),
    tenant: T.acme,
    title: "Phụ lục 1 bao bì",
    kind: "appendix",
    parent: cid(1),
    status: "active",
    direction: null,
    owner: P.lan.id,
    updatedAt: ms(4),
  });
  await insContract(s, {
    id: cid(5),
    tenant: T.acme,
    title: "Giảm 100% phí",
    status: "extracting",
    direction: null,
    owner: P.tam.id,
    updatedAt: ms(5),
  });
  await insContract(s, {
    id: cid(6),
    tenant: T.acme,
    title: "Hợp đồng hết hạn",
    status: "expired",
    direction: "sale",
    owner: OWNER_X,
    updatedAt: ms(6),
    fields: mkFields({
      supplier_name: "Công ty Minh Phát",
      buyer_representative: "Nguyễn Văn A – Giám đốc",
      total_value: 10_000_000,
      end_date: "2025-12-31",
    }),
  });
  await insItem(s, T.acme, cid(1), 0, { category: catId(1) });
  await insItem(s, T.acme, cid(1), 1, { category: catId(1) });
  await insItem(s, T.acme, cid(2), 0, { category: catId(2) });
  await insItem(s, T.acme, cid(3), 0, { category: catId(1) });
  await insItem(s, T.acme, cid(3), 1, { category: catId(2) });
  await insContract(s, {
    id: cid(90),
    tenant: T.beta,
    title: "Hợp đồng của beta",
    owner: P.an.id,
    updatedAt: ms(7),
    fields: mkFields({ buyer_name: "Công ty ABC", supplier_name: "Công ty Minh Phát" }),
  });
}
const ids = (...n: number[]) => n.map(cid);
const sorted = (xs: string[]) => [...xs].sort();

describe("HD-FR-07 · quyền và cách ly (HD-AC01)", () => {
  it("HD-AC01 · user tenant B: danh sách KHÔNG chứa HĐ của A (chỉ HĐ của B); total của B = 1", async () => {
    await dataset();
    const r = await listOf(c, P.an);
    expect({ status: r.status, ids: idsOf(r), total: r.json.total }).toEqual({
      status: 200,
      ids: ids(90),
      total: 1,
    });
  });
  it("HD-AC01 · lọc theo id/loại/người ký của A từ tenant B vẫn 0 hàng", async () => {
    await dataset();
    for (const q of [
      { category: [catId(1)] },
      { owner: [P.lan.id] },
      { signer: ["nguyễn văn a"] },
      { seller: ["Công ty Minh Phát"] },
    ]) {
      const r = await listOf(c, P.an, q);
      expect({ q, ids: idsOf(r).filter((i) => i !== cid(90)) }).toEqual({ q, ids: [] });
    }
  });
  it("HD-AC09 · viewer (tam) đọc được danh sách; user không Group (cuc) ⇒ 403 PACK_FORBIDDEN; không token ⇒ 401", async () => {
    await dataset();
    const v = await listOf(c, P.tam);
    const n = await listOf(c, P.cuc);
    const anon = await fetch(`${c.hub.base}${CBASE}`);
    expect([v.status, n.status, n.json?.error?.code, anon.status]).toEqual([
      200,
      403,
      "PACK_FORBIDDEN",
      401,
    ]);
  });
  it("HD-FR-07 · chưa có HĐ ⇒ 200 {items:[], total:0, page:1, page_size:20}", async () => {
    await arrange(c);
    const r = await listOf(c, P.tam);
    expect({ s: r.status, b: r.json }).toEqual({
      s: 200,
      b: { items: [], total: 0, parents: [], page: 1, page_size: 20 },
    });
  });
});

describe("HD-AC03 · bộ lọc", () => {
  it("HD-AC03 · category=X ⇒ chỉ HĐ có ≥ 1 item loại X (HĐ nhiều item cùng loại không lặp)", async () => {
    await dataset();
    expect(idsOf(await listOf(c, P.tam, { category: [catId(1)] }))).toEqual(ids(3, 1));
    expect(idsOf(await listOf(c, P.tam, { category: [catId(2)] }))).toEqual(ids(3, 2));
    expect(sorted(idsOf(await listOf(c, P.tam, { category: [catId(1), catId(2)] })))).toEqual(
      sorted(ids(1, 2, 3)),
    );
  });
  it("HD-AC03 · status[] nhiều giá trị = HOẶC trong cùng bộ lọc", async () => {
    await dataset();
    expect(idsOf(await listOf(c, P.tam, { status: ["active"] }))).toEqual(ids(4, 1));
    expect(idsOf(await listOf(c, P.tam, { status: ["active", "expiring"] }))).toEqual(ids(4, 2, 1));
  });
  it("HD-AC03 · status[] + owner + category ⇒ GIAO các điều kiện", async () => {
    await dataset();
    expect(
      idsOf(
        await listOf(c, P.tam, { status: ["active"], owner: [P.lan.id], category: [catId(1)] }),
      ),
    ).toEqual(ids(1));
    const r = await listOf(c, P.tam, {
      status: ["active", "needs_review"],
      owner: [P.lan.id],
      category: [catId(1)],
    });
    expect({ ids: idsOf(r), total: r.json.total }).toEqual({ ids: ids(3, 1), total: 2 });
    expect(idsOf(await listOf(c, P.tam, { owner: [P.hoa.id], category: [catId(1)] }))).toEqual([]);
  });
  it("HD-FR-07 · owner[]: một và nhiều người phụ trách", async () => {
    await dataset();
    expect(idsOf(await listOf(c, P.tam, { owner: [P.lan.id] }))).toEqual(ids(4, 3, 1));
    expect(sorted(idsOf(await listOf(c, P.tam, { owner: [P.hoa.id, P.tam.id] })))).toEqual(
      sorted(ids(2, 5)),
    );
  });
  it("HD-AC04 · signer=' nguyễn văn  a ' khớp buyer_representative 'Nguyễn Văn A' (không phân biệt hoa/thường, bỏ khoảng trắng thừa)", async () => {
    await dataset();
    const r = await listOf(c, P.tam, { signer: [" nguyễn văn  a "] });
    expect(idsOf(r)).toContain(cid(1));
    expect(idsOf(r)).toContain(cid(3)); // 'nguyễn văn a' viết thường
  });
  it("HD-AC04 · signer khớp theo khoá người (bỏ dấu, cắt chức danh ' – Giám đốc'): 'nguyen van a' ⇒ HĐ 1, 3, 6", async () => {
    await dataset();
    expect(idsOf(await listOf(c, P.tam, { signer: ["nguyen van a"] }))).toEqual(ids(6, 3, 1));
  });
  it("HD-AC04 · signer cũng khớp supplier_representative: 'trần thị b' ⇒ HĐ 1", async () => {
    await dataset();
    expect(idsOf(await listOf(c, P.tam, { signer: ["trần thị b"] }))).toEqual(ids(1));
  });
  it("HD-FR-07 · seller[] / buyer[] khớp nguyên văn giá trị trường", async () => {
    await dataset();
    expect(idsOf(await listOf(c, P.tam, { seller: ["Công ty Minh Phát"] }))).toEqual(ids(6, 1));
    expect(idsOf(await listOf(c, P.tam, { buyer: ["Công ty ABC"] }))).toEqual(ids(2, 1));
    expect(
      idsOf(await listOf(c, P.tam, { seller: ["Công ty Minh Phát"], buyer: ["Công ty ABC"] })),
    ).toEqual(ids(1));
  });
  it("HD-FR-07 · direction[]: sale / purchase / unknown (= direction null)", async () => {
    await dataset();
    expect(idsOf(await listOf(c, P.tam, { direction: ["sale"] }))).toEqual(ids(6, 3));
    expect(idsOf(await listOf(c, P.tam, { direction: ["unknown"] }))).toEqual(ids(5, 4));
    expect(idsOf(await listOf(c, P.tam, { direction: ["sale", "unknown"] }))).toEqual(
      ids(6, 5, 4, 3),
    );
  });
  it("HD-FR-07 · kind[]: appendix ⇒ chỉ phụ lục (có parent_id); contract ⇒ phần còn lại", async () => {
    await dataset();
    const a = await listOf(c, P.tam, { kind: ["appendix"] });
    expect(idsOf(a)).toEqual(ids(4));
    expect(a.json.items[0].parent_id).toBe(cid(1));
    expect(idsOf(await listOf(c, P.tam, { kind: ["contract"] }))).toEqual(ids(6, 5, 3, 2, 1));
  });
  it("HD-FR-07 · value_min / value_max (bao gồm biên) và kết hợp", async () => {
    await dataset();
    expect(sorted(idsOf(await listOf(c, P.tam, { value_min: 100_000_000 })))).toEqual(
      sorted(ids(1, 2)),
    );
    expect(sorted(idsOf(await listOf(c, P.tam, { value_max: 90_000_000 })))).toEqual(
      sorted(ids(3, 6)),
    );
    expect(
      sorted(idsOf(await listOf(c, P.tam, { value_min: 90_000_000, value_max: 120_000_000 }))),
    ).toEqual(sorted(ids(2, 3)));
  });
  it("HD-FR-07 · q: không phân biệt hoa/thường và dấu; tìm trong tiêu đề + bên bán/mua/số HĐ/người ký", async () => {
    await dataset();
    expect(idsOf(await listOf(c, P.tam, { q: "minh phat" }))).toEqual(ids(6, 1));
    expect(idsOf(await listOf(c, P.tam, { q: "MINH PHÁT" }))).toEqual(ids(6, 1));
    expect(idsOf(await listOf(c, P.tam, { q: "hợp đồng" }))).toEqual(ids(6, 3, 2, 1));
    expect(idsOf(await listOf(c, P.tam, { q: "HD-001" }))).toEqual(ids(1));
  });
  it("D-18 · q / signer / seller viết bằng dấu tổ hợp (NFD) ⇒ chuẩn NFC ở biên, cho kết quả như bản NFC", async () => {
    await dataset();
    const nfd = (s: string) => s.normalize("NFD");
    expect(nfd("MINH PHÁT")).not.toBe("MINH PHÁT"); // tiền đề: thật sự là chuỗi tổ hợp
    expect(idsOf(await listOf(c, P.tam, { q: nfd("MINH PHÁT") }))).toEqual(ids(6, 1));
    expect(idsOf(await listOf(c, P.tam, { q: nfd("hợp đồng") }))).toEqual(ids(6, 3, 2, 1));
    expect(idsOf(await listOf(c, P.tam, { signer: [nfd("Nguyễn Văn A")] }))).toEqual(ids(6, 3, 1));
    expect(idsOf(await listOf(c, P.tam, { seller: [nfd("Công ty Minh Phát")] }))).toEqual(
      ids(6, 1),
    );
  });
  it("HD-BR-03 · q='100%' chỉ khớp tiêu đề có đúng '100%' (ký tự đại diện LIKE bị thoát)", async () => {
    await dataset();
    expect(idsOf(await listOf(c, P.tam, { q: "100%" }))).toEqual(ids(5));
    expect(idsOf(await listOf(c, P.tam, { q: "%%" }))).toEqual([]);
  });
});

describe("HD-FR-07 · kiểm tra tham số (400)", () => {
  it("HD-FR-07 · page=0, page=1001, page_size=0, page_size=101, sort lạ, dir lạ, q 1 ký tự, owner không phải uuid, status lạ ⇒ 400", async () => {
    await dataset();
    const bad: Record<string, string | number>[] = [
      { page: 0 },
      { page: 1001 },
      { page_size: 0 },
      { page_size: 101 },
      { sort: "fields" },
      { dir: "up" },
      { q: "a" },
      { owner: "không-phải-uuid" },
      { status: "approved" },
      { kind: "folder" },
      { value_min: -1 },
      { direction: "both" },
    ];
    for (const q of bad) {
      const r = await listOf(c, P.tam, q as never);
      expect({
        q,
        status: r.status,
        code: String(r.json?.error?.code ?? "").startsWith("VALIDATION"),
      }).toEqual({ q, status: 400, code: true });
    }
  });
});

describe("HD-FR-07 · sắp xếp", () => {
  const three = { status: ["active", "expiring", "needs_review"], kind: ["contract"] }; // HĐ 1, 2, 3
  it("HD-FR-07 · mặc định updated_at giảm dần", async () => {
    await dataset();
    expect(idsOf(await listOf(c, P.tam))).toEqual(ids(6, 5, 4, 3, 2, 1));
    expect(idsOf(await listOf(c, P.tam, { sort: "updated_at", dir: "asc" }))).toEqual(
      ids(1, 2, 3, 4, 5, 6),
    );
  });
  it("HD-FR-07 · sort=value asc/desc theo giá trị số (không theo chuỗi): 90M < 120M < 500M", async () => {
    await dataset();
    expect(idsOf(await listOf(c, P.tam, { ...three, sort: "value", dir: "asc" }))).toEqual(
      ids(3, 2, 1),
    );
    expect(idsOf(await listOf(c, P.tam, { ...three, sort: "value", dir: "desc" }))).toEqual(
      ids(1, 2, 3),
    );
  });
  it("HD-FR-07 · sort=end_date theo ngày: 2026-12-31 < 2027-03-31 < 2027-06-30", async () => {
    await dataset();
    expect(idsOf(await listOf(c, P.tam, { ...three, sort: "end_date", dir: "asc" }))).toEqual(
      ids(2, 1, 3),
    );
    expect(idsOf(await listOf(c, P.tam, { ...three, sort: "end_date", dir: "desc" }))).toEqual(
      ids(3, 1, 2),
    );
  });
  it("HD-FR-07 · sort=title (tiêu đề ASCII cùng kiểu hoa)", async () => {
    await arrange(c);
    for (const [i, t] of ["Charlie", "Alpha", "Bravo"].entries())
      await insContract(c.sql, { id: cid(i + 1), tenant: T.acme, title: t, updatedAt: ms(i + 1) });
    expect(idsOf(await listOf(c, P.tam, { sort: "title", dir: "asc" }))).toEqual(ids(2, 3, 1));
    expect(idsOf(await listOf(c, P.tam, { sort: "title", dir: "desc" }))).toEqual(ids(1, 3, 2));
  });
});

describe("HD-AC05 · phân trang page/page_size/total (D-03; thay keyset cũ)", () => {
  async function many(n: number) {
    await arrange(c);
    await c.sql`insert into contracts.contracts (id, tenant_id, title, created_by, updated_at)
      select ('c0de0000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, ${T.acme}::uuid, 'HĐ ' || g, ${P.lan.id}::uuid,
        timestamptz '2026-01-01T00:00:00Z' + g * interval '1 minute' from generate_series(1, ${n}::int) g`;
  }
  it("HD-AC05 · 120 HĐ, page_size=50 ⇒ 3 trang 50/50/20, total=120, không trùng, không sót, đúng thứ tự updated_at giảm dần", async () => {
    await many(120);
    const pages = [];
    for (const page of [1, 2, 3]) pages.push(await listOf(c, P.tam, { page, page_size: 50 }));
    expect(
      pages.map((r) => [
        r.status,
        r.json.items.length,
        r.json.total,
        r.json.page,
        r.json.page_size,
      ]),
    ).toEqual([
      [200, 50, 120, 1, 50],
      [200, 50, 120, 2, 50],
      [200, 20, 120, 3, 50],
    ]);
    const all = pages.flatMap(idsOf);
    expect(new Set(all).size).toBe(120);
    const want = (
      await c.sql<
        { id: string }[]
      >`select id from contracts.contracts order by updated_at desc, id desc`
    ).map((r) => r.id);
    expect(all).toEqual(want);
  });
  it("HD-AC05 · trang 4 (quá cuối) ⇒ 200 items rỗng, total vẫn 120", async () => {
    await many(120);
    const r = await listOf(c, P.tam, { page: 4, page_size: 50 });
    expect({ s: r.status, n: r.json.items.length, total: r.json.total }).toEqual({
      s: 200,
      n: 0,
      total: 120,
    });
  });
  it("D-03 · mặc định page=1, page_size=20; page_size=100 trả tối đa 100; response không còn next_cursor", async () => {
    await many(120);
    const d = await listOf(c, P.tam);
    expect({
      n: d.json.items.length,
      page: d.json.page,
      size: d.json.page_size,
      cursor: "next_cursor" in d.json,
    }).toEqual({ n: 20, page: 1, size: 20, cursor: false });
    expect((await listOf(c, P.tam, { page_size: 100 })).json.items.length).toBe(100);
  });
  it("D-03 · total theo bộ lọc (không phải tổng bảng): lọc status=active trên tập có 2 active ⇒ total 2", async () => {
    await dataset();
    const r = await listOf(c, P.tam, { status: ["active"], page_size: 1 });
    expect({ n: r.json.items.length, total: r.json.total }).toEqual({ n: 1, total: 2 });
  });
});

describe("HD-FR-07 · dòng tóm tắt ListRow (đủ cột màn danh sách)", () => {
  it("HD-FR-07 · HĐ 1: 20 khoá ListRow (CR-097 thêm locked), giá trị đúng; KHÔNG có fields/source_text/clauses/search_key/signer_keys", async () => {
    await dataset();
    const row = (await listOf(c, P.tam, { q: "HD-001" })).json.items[0];
    expect(Object.keys(row).sort()).toEqual(
      [
        "action_deadline",
        "buyer",
        "buyer_signer",
        "category_ids",
        "direction",
        "end_date",
        "id",
        "kind",
        "number",
        "owner_user_id",
        "parent_id",
        "seller",
        "seller_signer",
        "status",
        "title",
        "type",
        "updated_at",
        "value",
        "version",
        "locked",
      ].sort(),
    );
    expect({ ...row, value: Number(row.value), updated_at: undefined }).toMatchObject({
      id: cid(1),
      kind: "contract",
      parent_id: null,
      title: "Hợp đồng bao bì Minh Phát",
      number: "HD-001",
      type: "purchase",
      direction: "purchase",
      status: "active",
      seller: "Công ty Minh Phát",
      buyer: "Công ty ABC",
      seller_signer: "Trần Thị B",
      buyer_signer: "Nguyễn Văn A",
      value: 500_000_000,
      end_date: "2027-03-31",
      // HD4 (HD-FR-42): hạn chót = end_date − notice_days; HĐ này end 2027-03-31, không có notice_days (= 0) ⇒ 2027-03-31 (trước HD4: null).
      action_deadline: "2027-03-31",
      owner_user_id: P.lan.id,
      version: 1,
    });
    expect(row.category_ids).toEqual([catId(1)]);
    expect(new Date(row.updated_at).toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });
  it("HD-FR-07 · HĐ chưa trích (fields rỗng): các cột tóm tắt là null, category_ids = []", async () => {
    await dataset();
    const row = (await listOf(c, P.tam, { q: "100%" })).json.items[0];
    expect(row).toMatchObject({
      number: null,
      seller: null,
      buyer: null,
      seller_signer: null,
      buyer_signer: null,
      value: null,
      end_date: null,
      type: null,
      category_ids: [],
    });
  });
  it("HD-FR-07 · HĐ nhiều item cùng/khác loại: category_ids không lặp (HĐ 3 có 2 loại)", async () => {
    await dataset();
    const row = (await listOf(c, P.tam, { q: "đông á" })).json.items[0];
    expect([...row.category_ids].sort()).toEqual([catId(1), catId(2)].sort());
  });
});

describe("D-10 · GET /contracts/facets (cả tenant, không theo bộ lọc)", () => {
  const nOf = (xs: { v: string; n: number }[]) => Object.fromEntries(xs.map((x) => [x.v, x.n]));
  it("D-10 · /facets đọc được bởi viewer; không bị /:id nuốt; không token ⇒ 401; cuc ⇒ 403", async () => {
    await dataset();
    const ok = await c.hubCall(P.tam, "GET", `${CBASE}/facets`);
    const no = await c.hubCall(P.cuc, "GET", `${CBASE}/facets`);
    const anon = await fetch(`${c.hub.base}${CBASE}/facets`);
    expect([ok.status, no.status, anon.status]).toEqual([200, 403, 401]);
  });
  it("D-10 · đếm theo status, direction, kind, owner trên HĐ của tenant", async () => {
    await dataset();
    const f = (await c.hubCall(P.tam, "GET", `${CBASE}/facets`)).json;
    expect(nOf(f.status)).toEqual({
      active: 2,
      expiring: 1,
      needs_review: 1,
      extracting: 1,
      expired: 1,
    });
    expect(nOf(f.direction)).toEqual({ purchase: 2, sale: 2, unknown: 2 });
    expect(nOf(f.kind)).toEqual({ contract: 5, appendix: 1 });
    expect(nOf(f.owner)).toEqual({ [P.lan.id]: 3, [P.hoa.id]: 1, [P.tam.id]: 1, [OWNER_X]: 1 });
  });
  it("D-10 · seller / buyer: giá trị khác rỗng và số HĐ", async () => {
    await dataset();
    const f = (await c.hubCall(P.tam, "GET", `${CBASE}/facets`)).json;
    expect(nOf(f.seller)).toEqual({
      "Công ty Minh Phát": 2,
      "Vận Tải Bắc Nam": 1,
      "Công ty ABC": 1,
    });
    expect(nOf(f.buyer)).toEqual({ "Công ty ABC": 2, "Đông Á": 1 });
  });
  it("D-10 · signer: {v: khoá người, label, n}; 'nguyen van a' ở HĐ 1, 3, 6 ⇒ n=3", async () => {
    await dataset();
    const f = (await c.hubCall(P.tam, "GET", `${CBASE}/facets`)).json;
    const by = Object.fromEntries(
      f.signer.map((s: { v: string; label: string; n: number }) => [s.v, s]),
    );
    expect(by["nguyen van a"].n).toBe(3);
    expect(typeof by["nguyen van a"].label).toBe("string");
    expect(by["nguyen van a"].label.length).toBeGreaterThan(0);
    expect([by["tran thi b"]?.n, by["le van c"]?.n]).toEqual([1, 1]);
  });
  it("D-10 · category: {v, label, n}, n = số HĐ có ≥ 1 item loại đó (Bao bì: HĐ 1 và 3 ⇒ 2, dù có 3 item)", async () => {
    await dataset();
    const f = (await c.hubCall(P.tam, "GET", `${CBASE}/facets`)).json;
    const by = Object.fromEntries(
      f.category.map((s: { v: string; label: string; n: number }) => [s.v, s]),
    );
    expect([by[catId(1)].label, by[catId(1)].n, by[catId(2)].label, by[catId(2)].n]).toEqual([
      "Bao bì",
      2,
      "Vận chuyển",
      2,
    ]);
  });
  it("D-10 · value {min, max} theo HĐ có giá trị; truncated rỗng khi chưa vượt trần", async () => {
    await dataset();
    const f = (await c.hubCall(P.tam, "GET", `${CBASE}/facets`)).json;
    expect({
      value: { min: Number(f.value.min), max: Number(f.value.max) },
      truncated: f.truncated,
    }).toEqual({
      value: { min: 10_000_000, max: 500_000_000 },
      truncated: [],
    });
  });
  it("D-10 · KHÔNG theo bộ lọc đang chọn: ?status=active cho kết quả y hệt không lọc", async () => {
    await dataset();
    const a = await c.hubCall(P.tam, "GET", `${CBASE}/facets`);
    const b = await c.hubCall(P.tam, "GET", `${CBASE}/facets?status=active&owner=${P.lan.id}`);
    expect(b.json).toEqual(a.json);
  });
  it("HD-AC01 · facets của B không lộ giá trị của A; tenant rỗng ⇒ mảng rỗng, value null", async () => {
    await dataset();
    const f = (await c.hubCall(P.an, "GET", `${CBASE}/facets`)).json;
    expect(nOf(f.seller)).toEqual({ "Công ty Minh Phát": 1 });
    expect(f.owner.map((o: { v: string }) => o.v)).toEqual([P.an.id]);
    expect(f.category).toEqual([]);
    await arrange(c);
    const e = (await c.hubCall(P.tam, "GET", `${CBASE}/facets`)).json;
    expect([e.status, e.seller, e.signer, e.category, e.value, e.truncated]).toEqual([
      [],
      [],
      [],
      [],
      null,
      [],
    ]);
  });
  it("D-10 · seller > 500 giá trị riêng ⇒ cắt còn 500 và truncated chứa 'seller'", async () => {
    await arrange(c);
    await c.sql`insert into contracts.contracts (id, tenant_id, title, created_by, fields)
      select ('c0de0000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, ${T.acme}::uuid, 'HĐ ' || g, ${P.lan.id}::uuid,
        jsonb_build_object('supplier_name', jsonb_build_object('value', 'Bên bán ' || g, 'quote', '', 'verified', true, 'edited', false))
      from generate_series(1, 501) g`;
    const f = (await c.hubCall(P.tam, "GET", `${CBASE}/facets`)).json;
    expect({ n: f.seller.length, truncated: f.truncated }).toEqual({
      n: 500,
      truncated: ["seller"],
    });
    expect(CK).toBe("contracts");
  });
});
