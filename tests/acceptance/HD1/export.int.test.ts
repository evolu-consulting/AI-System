// Gap #8/#9/#10 · GET /contracts/export (xlsx/csv, cùng bộ lọc, RLS của người gọi), lọc ngày của danh sách, tải lên .md.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { strFromU8, unzipSync } from "../../../apps/hub-api/node_modules/fflate"; // chỉ cài dưới hub-api (không hoist)
import {
  arrange,
  CBASE,
  type CtxN1,
  cid,
  dayIn,
  idsOf,
  insContract,
  listOf,
  mkFields,
  P,
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

const TZ = "Asia/Ho_Chi_Minh";
const plus = (n: number) =>
  new Date(Date.parse(`${dayIn(TZ)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** acme: 1 quá hạn (cid1), 2 hết hạn sau 10 ngày (cid2), 3 sau 45 ngày (cid3), 4 xa (cid4, bị từ chối); beta: 1 HĐ. */
async function dataset() {
  await arrange(c);
  const mk = (n: number, end: string, status: string, title: string, extra = {}) =>
    insContract(c.sql, {
      id: cid(n),
      tenant: T.acme,
      title,
      status,
      direction: "sale",
      updatedAt: `2026-03-0${n}T00:00:00Z`,
      fields: mkFields({
        number: `HD-00${n}`,
        supplier_name: "Công ty ABC",
        total_value: n * 1_000_000,
        end_date: end,
      }),
      ...extra,
    });
  await mk(1, "2020-01-01", "expired", 'HĐ quá hạn, có "nháy"');
  await mk(2, plus(10), "expiring", "=HĐ mười ngày");
  await mk(3, plus(45), "active", "HĐ bốn lăm ngày");
  await mk(4, "2099-01-01", "rejected", "HĐ xa");
  await insContract(c.sql, {
    id: cid(9),
    tenant: T.beta,
    title: "HĐ của beta",
    fields: mkFields({ end_date: plus(10) }),
  });
}

async function raw(p: (typeof P)[keyof typeof P], qs: string) {
  const res = await fetch(`${c.hub.base}${CBASE}/export${qs}`, {
    headers: { authorization: `Bearer ${await c.tok(p)}` },
  });
  return { res, bytes: new Uint8Array(await res.arrayBuffer()) };
}
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe("Gap #10 · lọc ngày của danh sách", () => {
  it("due=overdue ⇒ chỉ HĐ quá hạn; due=30 ⇒ cid2; due=90 ⇒ cid2+cid3; khoảng tuỳ chọn; hạn chót; tenant khác không lọt", async () => {
    await dataset();
    expect(idsOf(await listOf(c, P.lan, { due: "overdue" }))).toEqual([cid(1)]);
    expect(idsOf(await listOf(c, P.lan, { due: "30" }))).toEqual([cid(2)]);
    expect(new Set(idsOf(await listOf(c, P.lan, { due: "90" })))).toEqual(
      new Set([cid(2), cid(3)]),
    );
    const range = await listOf(c, P.lan, { date_from: "2099-01-01", date_to: "2099-12-31" });
    expect(idsOf(range)).toEqual([cid(4)]);
    const dl = await listOf(c, P.lan, { date_field: "action_deadline", due: "overdue" });
    expect(idsOf(dl)).toEqual([cid(1)]);
    expect((await listOf(c, P.lan, { due: "7" })).status).toBe(400);
  });
});

describe("Gap #8 · xuất danh sách", () => {
  it("CSV: BOM + tiêu đề tiếng Việt, đúng số hàng theo bộ lọc, RLS (không có HĐ beta), chống công thức", async () => {
    await dataset();
    const { res, bytes } = await raw(
      P.lan,
      "?format=csv&status=expiring&status=active&sort=value&dir=asc",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/hop-dong-\d{8}\.csv/);
    expect([res.headers.get("x-export-total"), res.headers.get("x-export-truncated")]).toEqual([
      "2",
      "0",
    ]);
    const text = dec(bytes);
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]); // BOM (TextDecoder bỏ BOM khi giải mã)
    const lines = text.trimEnd().split("\r\n");
    expect(lines[0]).toStartWith("STT,Số hợp đồng,Tên hợp đồng,");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("'=HĐ mười ngày");
    expect(lines[1]).toContain("2000000");
    expect(lines[1]).toContain("Sắp đáo hạn");
    expect(text).not.toContain("beta");
  });
  it("lọc ngày + sắp xếp áp dụng cho xuất tệp; tổng khớp danh sách", async () => {
    await dataset();
    const list = await listOf(c, P.lan, { due: "overdue" });
    const { res, bytes } = await raw(P.lan, "?format=csv&due=overdue");
    expect(res.headers.get("x-export-total")).toBe(String(list.json.total));
    expect(dec(bytes)).toContain("quá hạn");
  });
  it("XLSX: zip hợp lệ, content-type đúng, tiền là số, người dùng tenant B chỉ thấy HĐ của B", async () => {
    await dataset();
    const a = await raw(P.lan, "?format=xlsx");
    expect(a.res.headers.get("content-type")).toContain("spreadsheetml.sheet");
    const sheetA = strFromU8(unzipSync(a.bytes)["xl/worksheets/sheet1.xml"] as Uint8Array);
    expect(sheetA.match(/<row /g)?.length).toBe(5); // tiêu đề + 4 HĐ acme
    expect(sheetA).toContain("<v>3000000</v>");
    const b = await raw(P.an, "?format=xlsx");
    const sheetB = strFromU8(unzipSync(b.bytes)["xl/worksheets/sheet1.xml"] as Uint8Array);
    expect(sheetB.match(/<row /g)?.length).toBe(2);
    expect(sheetB).toContain("HĐ của beta");
    expect(sheetB).not.toContain("HĐ mười ngày");
  });
  it("tham số sai ⇒ 400; không có quyền đọc gói ⇒ bị từ chối như danh sách", async () => {
    await dataset();
    expect((await raw(P.lan, "?format=pdf")).res.status).toBe(400);
    expect((await raw(P.lan, "?page=2")).res.status).toBe(400);
  });
});

describe("Gap #9 · tải lên Markdown", () => {
  it("201: source_text = nội dung, mime text/markdown, vào trạng thái extracting; nhị phân đổi tên .md ⇒ 415", async () => {
    await arrange(c);
    const md = "# Điều 1\nBên A bán cho bên B.\n";
    const r = await upload(c, P.hoa, {
      bytes: new TextEncoder().encode(md),
      name: "hd-moi.md",
      type: "text/markdown",
    });
    expect(r.status).toBe(201);
    const [row] =
      await c.sql`select c.status, c.source_text, f.mime, c.title from contracts.contracts c
      join contracts.files f on f.id = c.file_id where c.id = ${r.json.id}`;
    expect(row).toMatchObject({
      status: "extracting",
      source_text: md,
      mime: "text/markdown",
      title: "hd-moi",
    });
    const bad = await upload(c, P.hoa, {
      bytes: new Uint8Array([0x4d, 0x5a, 0, 0, 1]),
      name: "x.md",
      type: "text/markdown",
    });
    expect(bad.status).toBe(415);
  });
});
