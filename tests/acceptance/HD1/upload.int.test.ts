// HD-FR-08 · HD-AC09 · HD-AC10 · HD-AC11 · D-06 · D-09 · HD-NFR-03 · plan §1 §5: POST /contracts (multipart `file`) — magic bytes,
// 413, quota Redis 30/tenant/ngày (múi tenant) + 300/hệ thống/ngày, FileBox org tenant, DOCX → source_text, event + outbox cùng tx.
// FileBox giả FB1; Redis thật (DB test của ô). Không sleep: chờ theo `await` + tín hiệu cấu hình (`afterReload`).

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { needAdr0024Accepted } from "../N1/_support/load";
import { afterReload, bumpConfig } from "../N1/_support/n1";
import { buildZip, u8 } from "../N1/_support/zip";
import {
  arrange,
  bigPdf,
  CBASE,
  type CtxN1,
  cid,
  dayIn,
  exe,
  insContract,
  jpeg,
  P,
  pdf,
  png,
  quotaKeys,
  quotaOf,
  ROOT,
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
const SAMPLE = join(ROOT, "reference/mgmt-app-contracts/samples/HD-bao-bi-Minh-Phat.docx");
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const rowCount = async () =>
  (await c.sql`select count(*)::int as n from contracts.contracts`)[0]?.n as number;
const eventsOf = (id: string) =>
  c.sql`select type, actor_user_id, data from contracts.contract_events where contract_id = ${id} order by id`;
/** Không để lại dấu vết: không FileBox, không hàng, không outbox, không bộ đếm quota. */
async function expectNothingWritten() {
  expect(c.fb.callsTo("post")).toEqual([]);
  expect(await rowCount()).toBe(0);
  expect((await c.sql`select count(*)::int as n from contracts.index_outbox`)[0]?.n).toBe(0);
}

describe("HD-AC11 · tải DOCX/PDF/ảnh thành công", () => {
  it("HD-AC11 · DOCX mẫu ⇒ 201 HĐ 'extracting', source_text có 'Điều 1', event uploaded, file org=t_<tenant>, 1 outbox", async () => {
    needAdr0024Accepted();
    await arrange(c);
    const bytes = new Uint8Array(readFileSync(SAMPLE));
    const r = await upload(c, P.hoa, { bytes, name: "HD-bao-bi-Minh-Phat.docx", type: DOCX_MIME });
    expect(r.status).toBe(201);
    expect(r.json).toEqual({ id: expect.any(String), status: "extracting", version: 1 });
    const [row] = await c.sql`select * from contracts.contracts where id = ${r.json.id}`;
    expect(row).toMatchObject({
      tenant_id: T.acme,
      kind: "contract",
      status: "extracting",
      version: 1,
      title: "HD-bao-bi-Minh-Phat",
      owner_user_id: P.hoa.id,
      created_by: P.hoa.id,
      error: null,
    });
    expect(row?.source_text).toMatch(/Điều\s*1/);
    expect(Object.keys(row?.fields ?? {})).toHaveLength(23);
    const [f] =
      await c.sql`select org, name, mime, size_bytes, tenant_id from contracts.files where id = ${row?.file_id}`;
    expect(f).toMatchObject({
      org: `t_${T.acme}`,
      name: "HD-bao-bi-Minh-Phat.docx",
      mime: DOCX_MIME,
      tenant_id: T.acme,
    });
    expect(Number(f?.size_bytes)).toBe(bytes.length);
    const ev = await eventsOf(r.json.id);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: "uploaded", actor_user_id: P.hoa.id });
    expect(ev[0]?.data).toMatchObject({
      name: "HD-bao-bi-Minh-Phat.docx",
      mime: DOCX_MIME,
      size: bytes.length,
    });
    expect([
      ...(await c.sql`select entity, op, entity_id, tenant_id from contracts.index_outbox`),
    ]).toEqual([{ entity: "contract", op: "upsert", entity_id: r.json.id, tenant_id: T.acme }]);
    const post = c.fb.callsTo("post");
    expect(post.map((x) => [x.org, x.auth, x.status])).toEqual([[`t_${T.acme}`, "ok", 200]]);
  });
  it("HD-AC11 · DOCX hỏng (zip hợp lệ nhưng word/document.xml không phải XML) ⇒ 201, status 'extract_failed', error 'DOCX_UNREADABLE', vẫn lưu tệp + event", async () => {
    needAdr0024Accepted();
    await arrange(c);
    const bytes = buildZip([
      { name: "[Content_Types].xml", data: u8("<Types/>") },
      { name: "word/document.xml", data: u8("<w:document><w:body><unclosed") },
    ]);
    const r = await upload(c, P.hoa, { bytes, name: "hong.docx", type: DOCX_MIME });
    expect(r.status).toBe(201);
    expect(r.json.status).toBe("extract_failed");
    const [row] =
      await c.sql`select status, error, source_text, file_id from contracts.contracts where id = ${r.json.id}`;
    expect(row).toMatchObject({
      status: "extract_failed",
      error: "DOCX_UNREADABLE",
      source_text: null,
    });
    expect(row?.file_id).toBeTruthy();
    expect((await eventsOf(r.json.id)).map((e) => e.type)).toEqual(["uploaded"]);
  });
  it("HD-FR-08 · PDF ⇒ 201 'extracting', không source_text; nội dung FileBox = đúng byte đã tải", async () => {
    await arrange(c);
    const bytes = pdf(500);
    const r = await upload(c, P.hoa, { bytes, name: "Hop dong.pdf" });
    expect(r.status).toBe(201);
    const [row] =
      await c.sql`select c.title, c.source_text, f.file_id, f.mime from contracts.contracts c join contracts.files f on f.id = c.file_id where c.id = ${r.json.id}`;
    expect(row).toMatchObject({ title: "Hop dong", source_text: null, mime: "application/pdf" });
    expect(c.fb.bytesOf(row?.file_id)).toEqual(bytes);
  });
  it("D-09 · JPEG và PNG ⇒ 201; mime lưu theo nội dung nhận dạng (image/jpeg, image/png)", async () => {
    await arrange(c);
    const j = await upload(c, P.hoa, { bytes: jpeg(), name: "scan.jpg", type: "image/jpeg" });
    const p = await upload(c, P.hoa, { bytes: png(), name: "scan.png", type: "image/png" });
    expect([j.status, p.status]).toEqual([201, 201]);
    const rows =
      await c.sql`select f.mime from contracts.contracts c join contracts.files f on f.id = c.file_id order by f.mime`;
    expect(rows.map((r) => r.mime)).toEqual(["image/jpeg", "image/png"]);
  });
  it("HD-FR-08 · title tuỳ chọn ≤ 200; mặc định = tên tệp bỏ đuôi; title 201 ký tự ⇒ 400", async () => {
    await arrange(c);
    const a = await upload(c, P.hoa, { name: "mac-dinh.pdf", fields: { title: "Tên tuỳ chọn" } });
    const b = await upload(c, P.hoa, { name: "mac-dinh.pdf" });
    const long = await upload(c, P.hoa, { fields: { title: "x".repeat(201) } });
    expect([a.status, b.status, long.status]).toEqual([201, 201, 400]);
    const t = await c.sql`select title from contracts.contracts order by title`;
    expect(t.map((r) => r.title)).toEqual(["Tên tuỳ chọn", "mac-dinh"]);
  });
  it("HD-FR-08 · tải xong, chi tiết thấy tệp (name/mime/size) và /file ⇒ 302; danh sách thấy HĐ 'extracting'", async () => {
    await arrange(c);
    const bytes = pdf(200);
    const r = await upload(c, P.hoa, { bytes, name: "a.pdf" });
    const d = (await c.hubCall(P.tam, "GET", `${CBASE}/${r.json.id}`)).json;
    expect(d.file).toMatchObject({
      name: "a.pdf",
      mime: "application/pdf",
      size_bytes: bytes.length,
    });
    const f = await fetch(`${c.hub.base}${CBASE}/${r.json.id}/file`, {
      headers: { authorization: `Bearer ${await c.tok(P.tam)}` },
      redirect: "manual",
    });
    expect(f.status).toBe(302);
    const l = await c.hubCall(P.tam, "GET", CBASE);
    expect(l.json.items.map((i: { id: string; status: string }) => [i.id, i.status])).toEqual([
      [r.json.id, "extracting"],
    ]);
  });
});

describe("HD-AC10 · loại tệp (magic bytes) và kích thước", () => {
  it("HD-AC10 · tệp '.pdf' nội dung EXE ⇒ 415 FILE_TYPE; không FileBox, không hàng, không quota", async () => {
    await arrange(c);
    const r = await upload(c, P.hoa, {
      bytes: exe(),
      name: "hop-dong.pdf",
      type: "application/pdf",
    });
    expect([r.status, r.json?.error?.code]).toEqual([415, "FILE_TYPE"]);
    await expectNothingWritten();
    expect(await quotaKeys(c.hub.redis)).toEqual([]);
  });
  it("D-09 · không tin đuôi/mime khai báo: '.exe' mime octet-stream nhưng nội dung PDF ⇒ 201; '.pdf' nhưng nội dung JPEG ⇒ 201, mime image/jpeg", async () => {
    await arrange(c);
    const a = await upload(c, P.hoa, {
      bytes: pdf(),
      name: "x.exe",
      type: "application/octet-stream",
    });
    const b = await upload(c, P.hoa, { bytes: jpeg(), name: "y.pdf", type: "application/pdf" });
    expect([a.status, b.status]).toEqual([201, 201]);
    const evs =
      await c.sql`select data->>'mime' as mime from contracts.contract_events order by id`;
    expect(evs.map((e) => e.mime)).toEqual(["application/pdf", "image/jpeg"]);
  });
  it("D-09 · zip KHÔNG phải DOCX (thiếu word/document.xml, vd xlsx) đặt tên .docx ⇒ 415", async () => {
    await arrange(c);
    const bytes = buildZip([
      { name: "[Content_Types].xml", data: u8("<Types/>") },
      { name: "xl/workbook.xml", data: u8("<workbook/>") },
    ]);
    const r = await upload(c, P.hoa, { bytes, name: "bang.docx", type: DOCX_MIME });
    expect([r.status, r.json?.error?.code]).toEqual([415, "FILE_TYPE"]);
    await expectNothingWritten();
  });
  it("D-09 · ngoài phạm vi ⇒ 415: GIF, WebP, HEIC, HTML, tệp rỗng", async () => {
    await arrange(c);
    const cases: [string, Uint8Array][] = [
      ["a.gif", u8("GIF89a....")],
      ["a.webp", u8("RIFF\0\0\0\0WEBPVP8 ")],
      ["a.heic", new Uint8Array([0, 0, 0, 0x18, ...u8("ftypheic")])],
      ["a.html", u8("<html></html>")],
      ["a.pdf", new Uint8Array(0)],
    ];
    for (const [name, bytes] of cases) {
      const r = await upload(c, P.hoa, { bytes, name });
      expect({ name, ok: [400, 415].includes(r.status) }).toEqual({ name, ok: true });
    }
    await expectNothingWritten();
  });
  it("HD-AC10 · 21 MiB ⇒ 413 FILE_TOO_LARGE; không FileBox, không hàng, không quota", async () => {
    await arrange(c);
    const r = await upload(c, P.hoa, { bytes: bigPdf(21), name: "lon.pdf" });
    expect([r.status, r.json?.error?.code]).toEqual([413, "FILE_TOO_LARGE"]);
    await expectNothingWritten();
    expect(await quotaKeys(c.hub.redis)).toEqual([]);
  });
  it("HD-AC10 · 19 MiB PDF (dưới trần 20 MiB) ⇒ 201", async () => {
    await arrange(c);
    const r = await upload(c, P.hoa, { bytes: bigPdf(19), name: "vua.pdf" });
    expect(r.status).toBe(201);
  });
  it("HD-FR-08 · thiếu trường file ⇒ 400/422 VALIDATION, không ghi gì", async () => {
    await arrange(c);
    const r = await upload(c, P.hoa, { noFile: true, fields: { title: "x" } });
    expect([400, 422]).toContain(r.status);
    await expectNothingWritten();
  });
});

describe("PARENT_INVALID · phụ lục", () => {
  async function arrangeParent() {
    await arrange(c);
    await insContract(c.sql, { id: cid(1), tenant: T.acme, title: "Cha" });
    await insContract(c.sql, { id: cid(2), tenant: T.beta, title: "Cha của beta" });
  }
  const noNew = async () => {
    expect(await rowCount()).toBe(2);
    expect(c.fb.ids()).toEqual([]); // tệp đã put (nếu có) phải được gỡ
    expect((await quotaOf(c.hub.redis, "t", T.acme)).n).toBe(0); // quota hoàn
  };
  it("plan §1 · kind=appendix không có parent_id ⇒ 422 PARENT_INVALID, không để lại gì", async () => {
    await arrangeParent();
    const r = await upload(c, P.hoa, { fields: { kind: "appendix" } });
    expect([r.status, r.json?.error?.code]).toEqual([422, "PARENT_INVALID"]);
    await noNew();
  });
  it("HD-AC02 · phụ lục trỏ HĐ cha của tenant KHÁC / cha không tồn tại ⇒ 422 PARENT_INVALID; tệp đã lưu bị gỡ, quota hoàn", async () => {
    await arrangeParent();
    const a = await upload(c, P.hoa, { fields: { kind: "appendix", parent_id: cid(2) } });
    const b = await upload(c, P.hoa, { fields: { kind: "appendix", parent_id: cid(77) } });
    expect([a.status, a.json?.error?.code, b.status, b.json?.error?.code]).toEqual([
      422,
      "PARENT_INVALID",
      422,
      "PARENT_INVALID",
    ]);
    await noNew();
  });
  it("plan §1 · kind=contract mà có parent_id ⇒ 422 PARENT_INVALID", async () => {
    await arrangeParent();
    const r = await upload(c, P.hoa, { fields: { parent_id: cid(1) } });
    expect([r.status, r.json?.error?.code]).toEqual([422, "PARENT_INVALID"]);
    await noNew();
  });
  it("HD-FR-01 · phụ lục với cha hợp lệ cùng tenant ⇒ 201, kind='appendix', parent_id đúng", async () => {
    await arrangeParent();
    const r = await upload(c, P.hoa, { fields: { kind: "appendix", parent_id: cid(1) } });
    expect(r.status).toBe(201);
    const [row] =
      await c.sql`select kind, parent_id from contracts.contracts where id = ${r.json.id}`;
    expect(row).toEqual({ kind: "appendix", parent_id: cid(1) });
  });
  it("plan §1 · kind lạ ('folder') ⇒ 400", async () => {
    await arrangeParent();
    expect((await upload(c, P.hoa, { fields: { kind: "folder" } })).status).toBe(400);
  });
});

describe("HD-AC09 · quyền tải lên", () => {
  it("HD-AC09 · viewer (tam) và không Group (cuc) ⇒ 403 PACK_FORBIDDEN; không FileBox/hàng/quota; editor và owner được", async () => {
    await arrange(c);
    const v = await upload(c, P.tam, {});
    const n = await upload(c, P.cuc, {});
    expect([v.status, v.json?.error?.code, n.status]).toEqual([403, "PACK_FORBIDDEN", 403]);
    await expectNothingWritten();
    expect(await quotaKeys(c.hub.redis)).toEqual([]);
    expect([(await upload(c, P.hoa, {})).status, (await upload(c, P.lan, {})).status]).toEqual([
      201, 201,
    ]);
  });
  it("HD-AC09 · không token ⇒ 401 (chưa chạm FileBox)", async () => {
    await arrange(c);
    const res = await fetch(`${c.hub.base}${CBASE}`, { method: "POST", body: new FormData() });
    expect(res.status).toBe(401);
  });
});

describe("D-06 · HD-AC10 · quota 30 tệp/tenant/ngày + 300/hệ thống/ngày (Redis, nguyên tử)", () => {
  it("HD-AC10 · tenant đã 30 tệp: tệp thứ 31 ⇒ 429 UPLOAD_QUOTA {scope:'tenant', limit:30, resets_at}; DB 30 hàng, FileBox 30 tệp, bộ đếm 30", async () => {
    await arrange(c);
    for (let i = 0; i < 30; i++) {
      const r = await upload(c, i % 2 ? P.hoa : P.lan, { bytes: pdf(), name: `f${i}.pdf` });
      if (r.status !== 201) throw new Error(`tệp ${i + 1} ⇒ ${r.status} ${r.text.slice(0, 120)}`);
    }
    const over = await upload(c, P.hoa, { bytes: pdf(), name: "thu-31.pdf" });
    expect([over.status, over.json?.error?.code]).toEqual([429, "UPLOAD_QUOTA"]);
    expect(over.json.error.details).toMatchObject({ scope: "tenant", limit: 30 });
    expect(new Date(over.json.error.details.resets_at).getTime()).toBeGreaterThan(Date.now());
    expect([
      await rowCount(),
      c.fb.callsTo("post").length,
      (await quotaOf(c.hub.redis, "t", T.acme)).n,
    ]).toEqual([30, 30, 30]);
  });
  it("HD-AC10 · tenant khác (beta) vẫn tải được khi acme đã hết hạn mức", async () => {
    await arrange(c);
    for (let i = 0; i < 30; i++) await upload(c, P.hoa, { bytes: pdf(), name: `f${i}.pdf` });
    expect((await upload(c, P.hoa, {})).status).toBe(429);
    const r = await upload(c, P.an, { bytes: pdf(), name: "beta.pdf" });
    expect(r.status).toBe(201);
    expect(
      (await c.sql`select tenant_id from contracts.contracts where id = ${r.json.id}`)[0]
        ?.tenant_id,
    ).toBe(T.beta);
  });
  it("D-06 · 40 tải ĐỒNG THỜI cùng tenant ⇒ đúng 30×201 và 10×429 (INCR nguyên tử, không vượt trần); bộ đếm cuối = 30", async () => {
    await arrange(c);
    const rs = await Promise.all(
      Array.from({ length: 40 }, (_, i) => upload(c, P.hoa, { bytes: pdf(), name: `p${i}.pdf` })),
    );
    const codes = rs.map((r) => (r.status === 429 ? r.json?.error?.code : r.status));
    expect({
      ok: codes.filter((x) => x === 201).length,
      quota: codes.filter((x) => x === "UPLOAD_QUOTA").length,
    }).toEqual({ ok: 30, quota: 10 });
    expect([await rowCount(), (await quotaOf(c.hub.redis, "t", T.acme)).n]).toEqual([30, 30]);
  });
  it("D-06 · toàn hệ thống 300/ngày: bộ đếm toàn cục ở 299 ⇒ tệp kế còn được, tệp sau ⇒ 429 {scope:'global', limit:300}; tenant refund", async () => {
    await arrange(c);
    expect((await upload(c, P.an, { bytes: pdf(), name: "mo.pdf" })).status).toBe(201); // tạo khoá toàn cục
    const g = await quotaOf(c.hub.redis, "g");
    expect(g.key).not.toBeNull();
    await c.hub.redis.set(g.key as string, "299");
    expect((await upload(c, P.hoa, { bytes: pdf(), name: "300.pdf" })).status).toBe(201);
    const acmeBefore = (await quotaOf(c.hub.redis, "t", T.acme)).n;
    const over = await upload(c, P.hoa, { bytes: pdf(), name: "301.pdf" });
    expect([over.status, over.json?.error?.code]).toEqual([429, "UPLOAD_QUOTA"]);
    expect(over.json.error.details).toMatchObject({ scope: "global", limit: 300 });
    expect(await c.hub.redis.get(g.key as string)).toBe("300"); // đã DECR phần vượt
    expect((await quotaOf(c.hub.redis, "t", T.acme)).n).toBe(acmeBefore); // tenant cũng hoàn
    expect(c.fb.callsTo("post")).toHaveLength(2);
  });
  it("D-06 · ngày của tenant theo múi giờ tenant (mặc định Asia/Ho_Chi_Minh); ngày toàn cục theo UTC; khoá có hạn (EXPIRE ≤ 172800 s)", async () => {
    await arrange(c);
    await upload(c, P.hoa, { bytes: pdf() });
    const t = await quotaOf(c.hub.redis, "t", T.acme);
    const g = await quotaOf(c.hub.redis, "g");
    expect(t.key?.endsWith(`:${dayIn("Asia/Ho_Chi_Minh")}`)).toBe(true);
    expect(g.key?.endsWith(`:${dayIn("UTC")}`)).toBe(true);
    for (const k of [t.key, g.key]) {
      const ttl = await c.hub.redis.ttl(k as string);
      expect({ k, ok: ttl > 0 && ttl <= 172_800 }).toEqual({ k, ok: true });
    }
  });
  it("D-06 · D-16 · đổi múi giờ tenant (TenantState.timezone) sang Pacific/Kiritimati ⇒ khoá ngày của tenant đổi theo múi mới", async () => {
    await arrange(c);
    try {
      await afterReload(c.hub, async () => {
        await c.sql`update admin.tenants set timezone = 'Pacific/Kiritimati' where id = ${T.acme}`;
        await bumpConfig(c.sql, T.acme);
      });
      await upload(c, P.hoa, { bytes: pdf() });
      const t = await quotaOf(c.hub.redis, "t", T.acme);
      expect(t.key?.endsWith(`:${dayIn("Pacific/Kiritimati")}`)).toBe(true);
    } finally {
      await c.sql`update admin.tenants set timezone = 'Asia/Ho_Chi_Minh' where id = ${T.acme}`;
      await bumpConfig(c.sql, T.acme);
    }
  });
});

describe("HD-NFR-03 · lỗi giữa chừng ⇒ hoàn tác sạch (quota hoàn, tệp gỡ, không hàng)", () => {
  it("D-06 · FileBox 5xx lúc lưu ⇒ 5xx của Hub; không hàng/outbox; bộ đếm hoàn về 0", async () => {
    await arrange(c);
    c.fb.failAlways("post", 503);
    const r = await upload(c, P.hoa, { bytes: pdf() });
    c.fb.failAlways("post", null);
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(await rowCount()).toBe(0);
    expect((await c.sql`select count(*)::int as n from contracts.index_outbox`)[0]?.n).toBe(0);
    expect([
      (await quotaOf(c.hub.redis, "t", T.acme)).n,
      (await quotaOf(c.hub.redis, "g")).n,
    ]).toEqual([0, 0]);
  });
  it("plan §5 · ghi DB lỗi sau khi đã lưu FileBox ⇒ 5xx, tệp đã lưu bị GỠ, quota hoàn, không hàng", async () => {
    await arrange(c);
    await c.sql.unsafe(
      `create or replace function contracts.hd1_boom() returns trigger language plpgsql as $$ begin raise exception 'hd1 boom'; end $$`,
    );
    await c.sql.unsafe(
      "create trigger hd1_boom before insert on contracts.contract_events for each row execute function contracts.hd1_boom()",
    );
    try {
      const r = await upload(c, P.hoa, { bytes: pdf() });
      expect(r.status).toBeGreaterThanOrEqual(500);
      expect(await rowCount()).toBe(0);
      expect((await c.sql`select count(*)::int as n from contracts.files`)[0]?.n).toBe(0);
      expect(c.fb.callsTo("post")).toHaveLength(1);
      expect(c.fb.ids()).toEqual([]);
      expect([
        (await quotaOf(c.hub.redis, "t", T.acme)).n,
        (await quotaOf(c.hub.redis, "g")).n,
      ]).toEqual([0, 0]);
    } finally {
      await c.sql.unsafe("drop trigger if exists hd1_boom on contracts.contract_events");
      await c.sql.unsafe("drop function if exists contracts.hd1_boom()");
    }
  });
});
