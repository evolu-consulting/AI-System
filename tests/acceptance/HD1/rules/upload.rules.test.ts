// HD-FR-08 · HD-AC10 · D-06 · D-09 · plan §4: `sniffFileType` (magic bytes), `uploadDay` (múi giờ tenant), `quotaVerdict`. Không DB.
import { describe, expect, it } from "bun:test";
import { domainFn } from "../_support/pure";

type Sniff = (
  head: Uint8Array,
  zipNames?: readonly string[],
) => "pdf" | "docx" | "jpeg" | "png" | null;
type Day = (now: Date, timeZone: string) => string;
type Verdict = (
  c: { tenant: number; global: number },
  l: { tenant: number; global: number },
) => "ok" | "tenant" | "global";
const sniff = () => domainFn<Sniff>("sniffFileType");
const day = () => domainFn<Day>("uploadDay");
const verdict = () => domainFn<Verdict>("quotaVerdict");
const b = (...n: number[]) => new Uint8Array(n);
const ascii = (s: string) => new TextEncoder().encode(s);
const PNG = b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13);

describe("HD-FR-08 · sniffFileType — nhận dạng theo magic bytes, không tin đuôi/mime", () => {
  it("HD-AC10 · PDF: '%PDF-' ⇒ pdf", async () => {
    expect((await sniff())(ascii("%PDF-1.7\n..."))).toBe("pdf");
  });
  it("HD-FR-08 · JPEG: FF D8 FF ⇒ jpeg · PNG: 89 50 4E 47 0D 0A 1A 0A ⇒ png", async () => {
    const s = await sniff();
    expect(s(b(0xff, 0xd8, 0xff, 0xe0, 0, 16))).toBe("jpeg");
    expect(s(b(0xff, 0xd8, 0xff, 0xdb))).toBe("jpeg");
    expect(s(PNG)).toBe("png");
  });
  it("HD-FR-08 · DOCX: 'PK\\x03\\x04' + central directory có word/document.xml ⇒ docx", async () => {
    const s = await sniff();
    expect(
      s(b(0x50, 0x4b, 3, 4, 20, 0), ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]),
    ).toBe("docx");
  });
  it("HD-FR-08 · zip KHÔNG có word/document.xml (xlsx, zip thường) ⇒ null (415)", async () => {
    const s = await sniff();
    expect(s(b(0x50, 0x4b, 3, 4), ["[Content_Types].xml", "xl/workbook.xml"])).toBeNull();
    expect(s(b(0x50, 0x4b, 3, 4), [])).toBeNull();
  });
  it("HD-FR-08 · zip không kèm danh sách phần ⇒ null (không đoán là docx từ chữ 'PK')", async () => {
    expect((await sniff())(b(0x50, 0x4b, 3, 4, 20, 0))).toBeNull();
  });
  it("HD-AC10 · EXE ('MZ…') đặt tên .pdf ⇒ null", async () => {
    expect((await sniff())(b(0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0))).toBeNull();
  });
  it("D-09 · ngoài phạm vi: GIF, WebP (RIFF…WEBP), HEIC (ftypheic), HTML, rỗng ⇒ null", async () => {
    const s = await sniff();
    expect(s(ascii("GIF89a...."))).toBeNull();
    expect(s(ascii("RIFF\0\0\0\0WEBPVP8 "))).toBeNull();
    expect(s(b(0, 0, 0, 0x18, ...ascii("ftypheic")))).toBeNull();
    expect(s(ascii("<html><body>"))).toBeNull();
    expect(s(new Uint8Array(0))).toBeNull();
  });
  it("HD-FR-08 · chữ ký bị cắt ngắn ⇒ null: '%PDF' (4 byte), 'FF D8' (2), PNG thiếu byte cuối", async () => {
    const s = await sniff();
    expect(s(ascii("%PDF"))).toBeNull();
    expect(s(b(0xff, 0xd8))).toBeNull();
    expect(s(PNG.slice(0, 7))).toBeNull();
  });
});

describe("D-06 · uploadDay — ngày theo múi giờ tenant (Intl, không phụ thuộc TZ tiến trình)", () => {
  it("HD-FR-08 · cùng một thời điểm, ngày khác nhau theo múi: 2026-10-19T17:30Z", async () => {
    const d = await day();
    const t = new Date("2026-10-19T17:30:00Z");
    expect(d(t, "Asia/Ho_Chi_Minh")).toBe("2026-10-20"); // UTC+7
    expect(d(t, "UTC")).toBe("2026-10-19");
    expect(d(t, "America/Los_Angeles")).toBe("2026-10-19"); // PDT UTC-7
    expect(d(new Date("2026-10-19T10:00:00Z"), "Pacific/Kiritimati")).toBe("2026-10-20"); // UTC+14
    expect(d(new Date("2026-10-19T10:00:00Z"), "Pacific/Pago_Pago")).toBe("2026-10-18"); // UTC-11
  });
  it("HD-FR-08 · ranh giới nửa đêm HCM: 16:59:59.999Z ⇒ ngày 19, 17:00:00.000Z ⇒ ngày 20", async () => {
    const d = await day();
    expect(d(new Date("2026-10-19T16:59:59.999Z"), "Asia/Ho_Chi_Minh")).toBe("2026-10-19");
    expect(d(new Date("2026-10-19T17:00:00.000Z"), "Asia/Ho_Chi_Minh")).toBe("2026-10-20");
  });
  it("HD-FR-08 · chuyển giờ mùa hè New York 2026-11-01 (EDT→EST lúc 06:00Z): ranh giới ngày đúng cả hai phía", async () => {
    const d = await day();
    expect(d(new Date("2026-11-01T03:59:00Z"), "America/New_York")).toBe("2026-10-31"); // 23:59 EDT
    expect(d(new Date("2026-11-01T04:00:00Z"), "America/New_York")).toBe("2026-11-01"); // 00:00 EDT
    expect(d(new Date("2026-11-02T04:59:00Z"), "America/New_York")).toBe("2026-11-01"); // 23:59 EST
    expect(d(new Date("2026-11-02T05:00:00Z"), "America/New_York")).toBe("2026-11-02"); // 00:00 EST
  });
  it("HD-FR-08 · định dạng YYYY-MM-DD đệm số 0 (tháng/ngày 1 chữ số)", async () => {
    expect((await day())(new Date("2026-01-05T03:00:00Z"), "UTC")).toBe("2026-01-05");
  });
});

describe("D-06 · quotaVerdict — nhận giá trị bộ đếm SAU INCR (plan §5): vượt ⇒ DECR + 429", () => {
  const L = { tenant: 30, global: 300 };
  it("HD-AC10 · tệp thứ 30 của tenant còn được (30 ≤ 30); tệp thứ 31 ⇒ 'tenant'", async () => {
    const v = await verdict();
    expect(v({ tenant: 30, global: 30 }, L)).toBe("ok");
    expect(v({ tenant: 31, global: 31 }, L)).toBe("tenant");
  });
  it("HD-FR-08 · toàn hệ thống: 300 còn được, 301 ⇒ 'global' (tenant vẫn trong hạn)", async () => {
    const v = await verdict();
    expect(v({ tenant: 1, global: 300 }, L)).toBe("ok");
    expect(v({ tenant: 1, global: 301 }, L)).toBe("global");
  });
  it("HD-FR-08 · vượt cả hai ⇒ báo 'tenant' trước (trần theo tenant ưu tiên)", async () => {
    expect((await verdict())({ tenant: 31, global: 301 }, L)).toBe("tenant");
  });
  it("HD-FR-08 · giới hạn lấy từ tham số (cấu hình env), không gõ cứng 30/300", async () => {
    const v = await verdict();
    expect(v({ tenant: 3, global: 3 }, { tenant: 2, global: 10 })).toBe("tenant");
    expect(v({ tenant: 1, global: 11 }, { tenant: 2, global: 10 })).toBe("global");
    expect(v({ tenant: 2, global: 10 }, { tenant: 2, global: 10 })).toBe("ok");
  });
});
