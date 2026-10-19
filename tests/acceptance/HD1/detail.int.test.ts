// HD-FR-07 · HD-FR-02 · HD-FR-06 · HD-AC01 · HD-AC12 · D-13 · plan §1 §2: GET /contracts/:id (chi tiết), /:id/source, /:id/file (302).
// Cách ly tenant ⇒ 404 giống hệt id lạ; viewer đọc được; FileBox không bị gọi khi 404.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { utf8 } from "../FB1/_fbfake";
import {
  arrange,
  CBASE,
  type CtxN1,
  catId,
  cid,
  emptyField,
  FIELD_KEYS,
  fileRowId,
  GHOST,
  insCategory,
  insContract,
  insEvents,
  insFile,
  insItem,
  mkFields,
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
const get = (p: (typeof P)[keyof typeof P], path: string) =>
  c.hubCall(p, "GET", `${CBASE}/${path}`);
const e404 = { status: 404, code: "NOT_FOUND" };

describe("HD-FR-07 · chi tiết HĐ", () => {
  it("HD-FR-07 · trả HĐ + fields đủ 23 khoá + items (theo ord) + events + file; viewer đọc được", async () => {
    await arrange(c);
    await insCategory(c.sql, T.acme, catId(1), "Bao bì");
    const fid = c.fb.put(utf8("%PDF-1.4 x"), "hd.pdf", `t_${T.acme}`).file_id;
    await insFile(c.sql, T.acme, fileRowId(1), fid, "hd-minh-phat.pdf");
    await insContract(c.sql, {
      id: cid(1),
      tenant: T.acme,
      title: "HĐ Minh Phát",
      status: "needs_review",
      direction: "purchase",
      fileId: fileRowId(1),
      source: "# Điều 1\nnội dung",
      fields: mkFields({ number: "HD-001", total_value: 500_000_000 }, { quote: "trích" }),
    });
    await insItem(c.sql, T.acme, cid(1), 2, { name: "Hàng C", category: catId(1) });
    await insItem(c.sql, T.acme, cid(1), 0, { name: "Hàng A" });
    await insItem(c.sql, T.acme, cid(1), 1, { name: "Hàng B" });
    await insEvents(c.sql, T.acme, cid(1), 3);
    const r = await get(P.tam, cid(1));
    expect(r.status).toBe(200);
    const d = r.json;
    expect(d).toMatchObject({
      id: cid(1),
      title: "HĐ Minh Phát",
      status: "needs_review",
      version: 1,
      kind: "contract",
      has_source: true,
    });
    expect(d.fields.number).toEqual({
      value: "HD-001",
      quote: "trích",
      verified: true,
      edited: false,
    });
    expect(Object.keys(d.fields).sort()).toEqual([...FIELD_KEYS].sort());
    expect(d.items.map((i: { name: string }) => i.name)).toEqual(["Hàng A", "Hàng B", "Hàng C"]);
    expect(d.items[2].category_id).toBe(catId(1));
    expect(d.events).toHaveLength(3);
    expect(d.file).toMatchObject({
      name: "hd-minh-phat.pdf",
      mime: "application/pdf",
      size_bytes: 10,
    });
  });
  it("D-13 · chi tiết KHÔNG trả source_text, search_key, signer_keys (nặng/nội bộ)", async () => {
    await arrange(c);
    await insContract(c.sql, {
      id: cid(1),
      tenant: T.acme,
      source: "x".repeat(1000),
      fields: mkFields({ buyer_representative: "A" }),
    });
    const d = (await get(P.tam, cid(1))).json;
    for (const k of ["source_text", "search_key", "signer_keys"])
      expect({ k, has: k in d }).toEqual({ k, has: false });
    expect(d.has_source).toBe(true);
  });
  it("HD-AC12 · HĐ cũ thiếu khoá buyer_representative ⇒ chi tiết trả {null,'',false,false}, không lỗi", async () => {
    await arrange(c);
    await insContract(c.sql, { id: cid(1), tenant: T.acme, fields: mkFields({ number: "HD-9" }) });
    const r = await get(P.tam, cid(1));
    expect(r.status).toBe(200);
    expect(r.json.fields.buyer_representative).toEqual(emptyField());
    expect(Object.keys(r.json.fields)).toHaveLength(23);
  });
  it("HD-AC12 · fields chứa khoá lạ (dữ liệu cũ) ⇒ bỏ khi ĐỌC, không lỗi", async () => {
    await arrange(c);
    await insContract(c.sql, {
      id: cid(1),
      tenant: T.acme,
      fields: { ...mkFields({ number: "A" }), khoa_la: { value: 1 } },
    });
    const r = await get(P.tam, cid(1));
    expect(r.status).toBe(200);
    expect("khoa_la" in r.json.fields).toBe(false);
  });
  it("HD-FR-06 · chỉ 50 event MỚI NHẤT, mới → cũ (60 event ⇒ id 60…11)", async () => {
    await arrange(c);
    await insContract(c.sql, { id: cid(1), tenant: T.acme });
    await insEvents(c.sql, T.acme, cid(1), 60);
    const d = (await get(P.tam, cid(1))).json;
    expect(d.events).toHaveLength(50);
    expect(d.events.map((e: { data: { n: number } }) => e.data.n)).toEqual(
      Array.from({ length: 50 }, (_, i) => 60 - i),
    );
  });
  it("HD-FR-07 · HĐ không có file / không có item ⇒ file null, items [], has_source false", async () => {
    await arrange(c);
    await insContract(c.sql, { id: cid(1), tenant: T.acme });
    const d = (await get(P.tam, cid(1))).json;
    expect({ file: d.file, items: d.items, has_source: d.has_source, events: d.events }).toEqual({
      file: null,
      items: [],
      has_source: false,
      events: [],
    });
  });
  it("HD-FR-07 · id không phải uuid ⇒ 400 VALIDATION (không lọt vào SQL); không Group (cuc) ⇒ 403; không token ⇒ 401", async () => {
    await arrange(c);
    const bad = await get(P.tam, "khong-phai-uuid");
    const no = await get(P.cuc, cid(1));
    const anon = await fetch(`${c.hub.base}${CBASE}/${cid(1)}`);
    expect([
      bad.status,
      String(bad.json?.error?.code).startsWith("VALIDATION"),
      no.status,
      no.json?.error?.code,
      anon.status,
    ]).toEqual([400, true, 403, "PACK_FORBIDDEN", 401]);
  });
});

describe("HD-AC01 · cách ly tenant ở API (404, không lộ tồn tại)", () => {
  async function two() {
    await arrange(c);
    await insContract(c.sql, { id: cid(1), tenant: T.acme, title: "A", source: "bí mật A" });
    await insContract(c.sql, { id: cid(2), tenant: T.beta, title: "B" });
  }
  it("HD-AC01 · user B gọi chi tiết / source / file bằng id của A ⇒ 404 NOT_FOUND", async () => {
    await two();
    for (const path of [cid(1), `${cid(1)}/source`, `${cid(1)}/file`]) {
      const r = await get(P.an, path);
      expect({ path, status: r.status, code: r.json?.error?.code }).toEqual({
        path,
        status: 404,
        code: "NOT_FOUND",
      });
    }
  });
  it("HD-AC01 · 404 của HĐ tenant khác GIỐNG HỆT 404 của id không tồn tại (không lộ tồn tại)", async () => {
    await two();
    for (const suffix of ["", "/source", "/file"]) {
      const other = await get(P.an, `${cid(1)}${suffix}`);
      const ghost = await get(P.an, `${GHOST}${suffix}`);
      expect({ suffix, s: other.status, b: other.json }).toEqual({
        suffix,
        s: ghost.status,
        b: ghost.json,
      });
    }
  });
  it("HD-AC01 · A đọc được HĐ của A (đối chứng); id lạ ⇒ 404", async () => {
    await two();
    expect((await get(P.tam, cid(1))).status).toBe(200);
    const g = await get(P.tam, GHOST);
    expect({ status: g.status, code: g.json?.error?.code }).toEqual(e404);
  });
});

describe("D-13 · GET /:id/source", () => {
  it("D-13 · 200 text/markdown đúng nội dung; HĐ không có source_text ⇒ 404", async () => {
    await arrange(c);
    await insContract(c.sql, {
      id: cid(1),
      tenant: T.acme,
      source: "# Điều 1. Đối tượng\nBên A bán, bên B mua.",
    });
    await insContract(c.sql, { id: cid(2), tenant: T.acme });
    const r = await get(P.tam, `${cid(1)}/source`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type") ?? "").toMatch(/^text\/markdown/);
    expect(r.text).toBe("# Điều 1. Đối tượng\nBên A bán, bên B mua.");
    expect((await get(P.tam, `${cid(2)}/source`)).status).toBe(404);
  });
});

describe("HD-FR-07 · GET /:id/file ⇒ 302 link FileBox", () => {
  async function withFile() {
    await arrange(c);
    const a = c.fb.put(utf8("%PDF-1.4 A"), "hd.pdf", `t_${T.acme}`);
    await insFile(c.sql, T.acme, fileRowId(1), a.file_id);
    await insContract(c.sql, { id: cid(1), tenant: T.acme, fileId: fileRowId(1) });
    await insContract(c.sql, { id: cid(2), tenant: T.beta });
    await insContract(c.sql, { id: cid(3), tenant: T.acme }); // cùng tenant, không có file
    return a.file_id;
  }
  const getFile = async (p: (typeof P)[keyof typeof P], id: string) =>
    fetch(`${c.hub.base}${CBASE}/${id}/file`, {
      headers: { authorization: `Bearer ${await c.tok(p)}` },
      redirect: "manual",
    });
  it("HD-FR-07 · viewer ⇒ 302 tới /d/… cùng origin FileBox; FileBox nhận đúng 1 lời gọi link cho file của A", async () => {
    const fid = await withFile();
    const r = await getFile(P.tam, cid(1));
    expect(r.status).toBe(302);
    const loc = r.headers.get("location") ?? "";
    expect(loc).toMatch(/\/d\/[^/]+$/);
    expect(new URL(loc, c.fb.origin).origin).toBe(new URL(c.fb.origin).origin);
    expect(c.fb.callsTo("link").map((x) => [x.fileId, x.auth, x.status])).toEqual([
      [fid, "ok", 200],
    ]);
    expect(JSON.stringify([...r.headers.entries()]).includes(fid)).toBe(false);
  });
  it("HD-AC01 · user B xin file của A ⇒ 404, FileBox KHÔNG bị gọi; HĐ không có file ⇒ 404", async () => {
    await withFile();
    const other = await c.hubCall(P.an, "GET", `${CBASE}/${cid(1)}/file`);
    const none = await c.hubCall(P.lan, "GET", `${CBASE}/${cid(3)}/file`); // cùng tenant, HĐ không có file
    const foreign = await c.hubCall(P.lan, "GET", `${CBASE}/${cid(2)}/file`); // HĐ của beta, user acme
    expect([other.status, none.status, foreign.status]).toEqual([404, 404, 404]);
    expect(c.fb.calls.filter((x) => x.route !== "health")).toEqual([]);
  });
  it("HD-FR-07 · FileBox 5xx ⇒ fail-closed (5xx của Hub), không có Location", async () => {
    await withFile();
    c.fb.failAlways("link", 503);
    const r = await getFile(P.tam, cid(1));
    c.fb.failAlways("link", null);
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(r.headers.get("location")).toBeNull();
  });
});
