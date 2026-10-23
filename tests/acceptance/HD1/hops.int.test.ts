// HD-NFR-01 · HD-NFR-02 · HD-NFR-03 · HD-NFR-04 · plan §5 §6 · CR-093: số câu SQL / lệnh Redis / HTTP nội bộ mỗi route CỐ ĐỊNH, không
// phụ thuộc số hàng/item/event/khoá sửa (set-based). Dữ liệu nhỏ ở đây; quy mô 10.000 HĐ ở `perf/`.
// Đếm: câu SQL của pool hub (đã trừ điều khiển tx; `set_config('app.tenant_id')` TÍNH — nên đọc = 2, ghi PATCH = 4, tải lên = 3),
// lệnh Redis (pipeline đếm riêng), HTTP ra ngoài (FileBox = `httpExt`; mọi HTTP khác = nội bộ ⇒ phải 0).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { utf8 } from "../FB1/_fbfake";
import {
  arrange,
  CBASE,
  type CtxN1,
  catId,
  cid,
  countHops,
  fileRowId,
  insCategory,
  insContract,
  insEvents,
  insFile,
  insItem,
  mkFields,
  P,
  pdf,
  redisOps,
  startHd1,
  T,
  upload,
} from "./_support/hd1";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});
const hops = <R>(fn: () => Promise<R>) => countHops(c, fn, [c.fb.origin]);
const get = (path: string) => c.hubCall(P.tam, "GET", `${CBASE}${path}`);
const patch = (id: string, body: unknown) =>
  c.hubCall(P.hoa, "PATCH", `${CBASE}/${id}/fields`, body);

async function small() {
  await arrange(c);
  await insCategory(c.sql, T.acme, catId(1), "Bao bì");
  await insContract(c.sql, {
    id: cid(1),
    tenant: T.acme,
    title: "A",
    status: "needs_review", // CR-097 K1: HĐ active bị khoá ⇒ PATCH đo trên HĐ Chờ duyệt
    fields: mkFields({ number: "N", notice_days: 30, buyer_representative: "Nguyễn Văn A" }),
    source: "# Điều 1",
  });
  await insContract(c.sql, { id: cid(2), tenant: T.acme, title: "B" });
  await insItem(c.sql, T.acme, cid(1), 0, { category: catId(1) });
}

describe("HD-NFR-01 · danh sách và facets: 2 câu SQL, 0 Redis, 0 HTTP nội bộ", () => {
  it("HD-NFR-01 · danh sách: đúng 2 câu (set_config + câu danh sách) cho không lọc, page_size=1 và 100", async () => {
    await small();
    await get("");
    for (const q of ["", "?page_size=1", "?page_size=100&page=2"]) {
      const h = await hops(() => get(q));
      expect({
        q,
        status: h.r.status,
        sql: h.sql,
        redis: h.redis,
        http: h.http,
        httpExt: h.httpExt,
      }).toEqual({ q, status: 200, sql: 2, redis: [], http: [], httpExt: [] });
    }
  });
  it("HD-NFR-01 · danh sách: MỌI bộ lọc cùng lúc + q + sort vẫn 2 câu (một văn bản SQL cố định)", async () => {
    await small();
    const full = `?status=active&status=expiring&owner=${P.lan.id}&category=${catId(1)}&seller=A&buyer=B&signer=nguyen%20van%20a&direction=sale&kind=contract&value_min=0&value_max=9&q=abc&sort=value&dir=asc&page=2&page_size=10`;
    await get(full);
    const h = await hops(() => get(full));
    expect({ status: h.r.status, sql: h.sql, http: h.http }).toEqual({
      status: 200,
      sql: 2,
      http: [],
    });
  });
  it("HD-NFR-01 · số câu của danh sách KHÔNG tăng theo số HĐ (6 → 600 hàng)", async () => {
    await small();
    await c.sql`insert into contracts.contracts (id, tenant_id, title, created_by)
      select ('c0de0000-0000-4000-8000-' || lpad((100 + g)::text, 12, '0'))::uuid, ${T.acme}::uuid, 'n' || g, ${P.lan.id}::uuid from generate_series(1, 600) g`;
    await get("?page_size=100");
    const h = await hops(() => get("?page_size=100"));
    expect([h.sql, h.r.json.items.length, h.r.json.total]).toEqual([2, 100, 602]);
  });
  it("D-10 · facets: 2 câu, 0 Redis, 0 HTTP", async () => {
    await small();
    await get("/facets");
    const h = await hops(() => get("/facets"));
    expect({ status: h.r.status, sql: h.sql, redis: h.redis, http: h.http }).toEqual({
      status: 200,
      sql: 2,
      redis: [],
      http: [],
    });
  });
});

describe("HD-NFR-02 · chi tiết, source, file", () => {
  it("HD-NFR-02 · chi tiết: 2 câu — không đổi khi có 0 hay 30 item và 60 event", async () => {
    await small();
    await get(`/${cid(2)}`);
    const none = await hops(() => get(`/${cid(2)}`));
    for (let i = 1; i < 30; i++) await insItem(c.sql, T.acme, cid(1), i);
    await insEvents(c.sql, T.acme, cid(1), 60);
    const many = await hops(() => get(`/${cid(1)}`));
    expect([none.r.status, none.sql, many.r.status, many.sql, many.http, many.redis]).toEqual([
      200,
      2,
      200,
      2,
      [],
      [],
    ]);
    expect(many.r.json.items).toHaveLength(30);
    expect(many.r.json.events).toHaveLength(50);
  });
  it("HD-NFR-02 · source: 2 câu; file: 2 câu + đúng 1 lời gọi FileBox (httpExt), 0 HTTP nội bộ", async () => {
    await small();
    const fid = c.fb.put(utf8("%PDF-1.4 x"), "a.pdf", `t_${T.acme}`).file_id;
    await insFile(c.sql, T.acme, fileRowId(1), fid);
    await c.sql`update contracts.contracts set file_id = ${fileRowId(1)} where id = ${cid(1)}`;
    await get(`/${cid(1)}/source`);
    const s = await hops(() => get(`/${cid(1)}/source`));
    const tok = await c.tok(P.tam);
    const f = await hops(() =>
      fetch(`${c.hub.base}${CBASE}/${cid(1)}/file`, {
        headers: { authorization: `Bearer ${tok}` },
        redirect: "manual",
      }),
    );
    expect([s.r.status, s.sql, s.http]).toEqual([200, 2, []]);
    expect([f.r.status, f.sql, f.http]).toEqual([302, 2, []]);
    expect(f.httpExt.length).toBe(1);
  });
});

describe("HD-NFR-02 · PATCH: 4 câu cố định, 1 tx", () => {
  it("HD-NFR-02 · PATCH 1 khoá và 10 khoá đều đúng 4 câu (set_config, SELECT FOR UPDATE, CTE update+event, outbox); 0 Redis, 0 HTTP", async () => {
    await small();
    await patch(cid(1), { version: 1, fields: { number: "W" } }); // làm nóng, version 2
    const one = await hops(() => patch(cid(1), { version: 2, fields: { number: "X" } }));
    const ten = await hops(() =>
      patch(cid(1), {
        version: 3,
        fields: {
          title: "t",
          supplier_name: "s",
          supplier_tax_id: "1",
          supplier_address: "a",
          buyer_name: "b",
          buyer_tax_id: "2",
          payment_terms: "p",
          delivery_terms: "d",
          warranty: "w",
          penalty: "p",
        },
      }),
    );
    expect([one.r.status, one.sql, one.redis, one.http]).toEqual([200, 4, [], []]);
    expect([ten.r.status, ten.sql, ten.redis, ten.http]).toEqual([200, 4, [], []]);
  });
  it("HD-NFR-02 · PATCH không thay đổi / 409 / 404 dừng sớm: 2 câu (set_config + SELECT FOR UPDATE), không ghi", async () => {
    await small();
    await patch(cid(1), { version: 1, fields: { number: "W" } });
    const noop = await hops(() => patch(cid(1), { version: 2, fields: { number: "W" } }));
    const stale = await hops(() => patch(cid(1), { version: 1, fields: { number: "Z" } }));
    const gone = await hops(() => patch(cid(99), { version: 1, fields: { number: "Z" } }));
    expect([noop.r.status, noop.sql]).toEqual([200, 2]);
    expect([stale.r.status, stale.sql]).toEqual([409, 2]);
    expect([gone.r.status, gone.sql]).toEqual([404, 2]);
  });
  it("HD-NFR-02 · PATCH 422 (khoá lạ / sai kiểu) và 403 (viewer): 0 câu SQL — chặn trước khi chạm DB", async () => {
    await small();
    const bad = await hops(() => patch(cid(1), { version: 1, fields: { khong_co: 1 } }));
    const wrong = await hops(() => patch(cid(1), { version: 1, fields: { notice_days: "abc" } }));
    const viewer = await hops(() =>
      c.hubCall(P.tam, "PATCH", `${CBASE}/${cid(1)}/fields`, {
        version: 1,
        fields: { number: "A" },
      }),
    );
    expect([bad.r.status, bad.sql, wrong.r.status, wrong.sql, viewer.r.status, viewer.sql]).toEqual(
      [422, 0, 422, 0, 403, 0],
    );
  });
});

describe("HD-NFR-03 · tải lên: kiểm quota 1 pipeline Redis, ghi 1 tx 3 câu", () => {
  it("HD-NFR-03 · tải PDF thành công: 3 câu SQL (set_config, CTE files+contracts+event, outbox); đúng 1 pipeline Redis, 0 lệnh Redis lẻ; 1 lời gọi FileBox; 0 HTTP nội bộ", async () => {
    await arrange(c);
    await upload(c, P.hoa, {}); // làm nóng
    const h = await countHops(
      c,
      () => redisOps(c, () => upload(c, P.hoa, { bytes: pdf(300), name: "dem.pdf" })),
      [c.fb.origin],
    );
    expect(h.r.r.status).toBe(201);
    expect({
      sql: h.sql,
      http: h.http,
      ext: h.httpExt.length,
      pipelines: h.r.pipelines.length,
      single: h.r.single,
    }).toEqual({
      sql: 3,
      http: [],
      ext: 1,
      pipelines: 1,
      single: [],
    });
    expect(h.r.pipelines[0]).toBe(4); // INCR tenant, INCR toàn cục, EXPIRE ×2
  });
  it("HD-NFR-03 · 415 (sai loại): 0 SQL, 0 Redis, 0 FileBox — từ chối trước mọi I/O", async () => {
    await arrange(c);
    const h = await countHops(
      c,
      () =>
        redisOps(c, () =>
          upload(c, P.hoa, {
            bytes: new Uint8Array([0x4d, 0x5a, 1, 2, 3, 4, 5, 6]),
            name: "x.pdf",
          }),
        ),
      [c.fb.origin],
    );
    expect([h.r.r.status, h.sql, h.r.pipelines, h.r.single, h.httpExt]).toEqual([
      415,
      0,
      [],
      [],
      [],
    ]);
  });
  it("HD-NFR-03 · 429 vượt hạn mức: 0 SQL, 0 FileBox; 2 pipeline Redis (INCR… rồi DECR hoàn)", async () => {
    await arrange(c);
    for (let i = 0; i < 30; i++) await upload(c, P.hoa, { bytes: pdf(), name: `f${i}.pdf` });
    c.fb.reset();
    const h = await countHops(
      c,
      () => redisOps(c, () => upload(c, P.hoa, { bytes: pdf(), name: "qua.pdf" })),
      [c.fb.origin],
    );
    expect([h.r.r.status, h.sql, h.r.pipelines.length, h.r.single, h.httpExt]).toEqual([
      429,
      0,
      2,
      [],
      [],
    ]);
  });
  it("HD-NFR-04 · 403 (viewer): 0 SQL, 0 Redis, 0 FileBox", async () => {
    await arrange(c);
    const h = await countHops(c, () => redisOps(c, () => upload(c, P.tam, {})), [c.fb.origin]);
    expect([h.r.r.status, h.sql, h.r.pipelines, h.r.single, h.httpExt]).toEqual([
      403,
      0,
      [],
      [],
      [],
    ]);
  });
});
