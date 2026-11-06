// CR-122 p9 · FLOW2-FR-27: đọc hợp đồng mọi định dạng — phân loại định dạng (HEIC/WEBP báo đúng tên), ghép ảnh ⇒ MỘT PDF,
// 3 ảnh ⇒ 1 PDF lưu FileBox (fake), tệp scan đính kèm lời gọi AI (khối document/image). Ảnh tự tạo trong test; không DB/mạng.
import { describe, expect, it } from "bun:test";
import { zlibSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { attachmentBlocks } from "../../../../lib/ai-client/anthropic.provider";
import { cliArgs } from "../../../../lib/ai-client/claude-cli.provider";
import { createUploadContract } from "../application/upload-contract.usecase";
import { imagesToPdf } from "../domain/images-pdf.rules";
import { sniffFileType, unreadableFormat } from "../domain/upload.rules";
import { pdfPageCounter } from "./pdf-pages";

const enc = (s: string) => new TextEncoder().encode(s);
const chunk = (type: string, body: Uint8Array): Uint8Array => {
  const out = new Uint8Array(12 + body.length);
  new DataView(out.buffer).setUint32(0, body.length);
  out.set(enc(type), 4);
  out.set(body, 8); // CRC để 0: trình đọc của ta không kiểm
  return out;
};
/** PNG RGB(A) w×h tự tạo, lọc dòng 0 (không lọc). */
function png(w: number, h: number, alpha = false): Uint8Array {
  const ch = alpha ? 4 : 3;
  const raw = new Uint8Array(h * (1 + w * ch));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w * ch; x++) raw[y * (1 + w * ch) + 1 + x] = (x * 37 + y * 11) & 255;
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, o), (o += p.length);
  return out;
}
/** JPEG tối thiểu: SOI + SOF0 (8 bit, 3 kênh) — đủ để đọc cỡ; không giải mã. */
const jpeg = (w: number, h: number): Uint8Array =>
  new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    h >> 8,
    h & 255,
    w >> 8,
    w & 255,
    0x03,
    1,
    0x11,
    0,
    2,
    0x11,
    0,
    3,
    0x11,
    0,
    0xff,
    0xd9,
  ]);
const text = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");

describe("p9 · phân loại định dạng", () => {
  it("HEIC nhận ra theo chữ ký (để báo đúng tên, không nhận); WEBP/GIF là ảnh; JPG/PNG/PDF vẫn hợp lệ", () => {
    const heic = new Uint8Array([0, 0, 0, 24, ...enc("ftypheic"), 0, 0, 0, 0]);
    const webp = new Uint8Array([...enc("RIFF"), 1, 0, 0, 0, ...enc("WEBPVP8 ")]);
    expect(unreadableFormat(heic)).toBe("heic");
    expect(sniffFileType(heic)).toBeNull();
    expect(sniffFileType(webp)).toBe("webp");
    expect(sniffFileType(enc("GIF89a"))).toBe("gif");
    expect(unreadableFormat(png(1, 1))).toBeNull();
    expect(sniffFileType(png(1, 1))).toBe("png");
    expect(sniffFileType(jpeg(2, 2))).toBe("jpeg");
    expect(sniffFileType(enc("%PDF-1.4"))).toBe("pdf");
  });
});

describe("p9 · ghép ảnh thành PDF (pdf-lib)", () => {
  it("3 ảnh (JPG + PNG + PNG alpha) ⇒ 1 PDF 3 trang, cỡ trang theo cỡ ảnh", async () => {
    const pdf = await imagesToPdf([jpeg(8, 4), png(4, 4), png(3, 5, true)]);
    expect(pdf).not.toBeNull();
    const doc = await PDFDocument.load(pdf as Uint8Array);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPage(0).getSize()).toEqual({ width: 8, height: 4 });
    expect(doc.getPage(2).getSize()).toEqual({ width: 3, height: 5 });
  });
  it("ảnh không đọc được (WEBP, rác, PNG cụt, rỗng) ⇒ null", async () => {
    expect(await imagesToPdf([enc("RIFF....WEBPVP8 ")])).toBeNull();
    expect(await imagesToPdf([jpeg(2, 2), enc("rác")])).toBeNull();
    expect(await imagesToPdf([png(2, 2).subarray(0, 40)])).toBeNull();
    expect(await imagesToPdf([])).toBeNull();
  });
});

describe("p9 · 3 ảnh ⇒ 1 PDF lưu FileBox (đường tải lên)", () => {
  it("PDF ghép đi qua tải lên: FileBox nhận đúng 1 tệp PDF, hàng HĐ mime pdf, trích được xếp lượt", async () => {
    const pdf = (await imagesToPdf([jpeg(8, 4), png(4, 4), png(3, 5)])) as Uint8Array;
    const puts: { name: string; size: number }[] = [];
    const rows: { mime: string; name: string; status: string }[] = [];
    const started: string[] = [];
    const upload = createUploadContract({
      uow: {
        tenant: async (_w: unknown, fn: (r: unknown) => Promise<unknown>) =>
          fn({
            upload: {
              insert: async (row: { mime: string; name: string; status: string }) => {
                rows.push(row);
                return { id: "c1", status: row.status, version: 1 };
              },
            },
            outbox: { enqueue: async () => {} },
          }),
      } as never,
      counter: { take: async () => ({ tenant: 1, global: 1 }), refund: async () => {} } as never,
      files: {
        put: async (_o: string, name: string, bytes: Uint8Array) => {
          puts.push({ name, size: bytes.length });
          return { fileId: "f1", versionId: "v1" };
        },
        remove: async () => {},
      },
      docx: { toMarkdown: async () => ({ ok: false, code: "DOCX_UNREADABLE" }) } as never,
      starter: { start: async (_w: unknown, id: string) => void started.push(id) } as never,
      zipNames: () => [],
      limits: { tenant: 100, global: 100 },
      newId: () => crypto.randomUUID(),
    });
    const r = await upload({
      who: { tenantId: "t", userId: "u" },
      timeZone: "UTC",
      bytes: pdf,
      name: "hop-dong.pdf",
      title: "hop-dong",
      kind: "contract",
      parentId: null,
    });
    expect(r.status).toBe("extracting");
    expect(puts).toEqual([{ name: "hop-dong.pdf", size: pdf.length }]);
    expect(rows).toEqual([
      expect.objectContaining({ mime: "application/pdf", status: "extracting" }),
    ]);
    expect(started).toEqual(["c1"]);
  });
  it("HEIC ⇒ FILE_TYPE kèm format=heic (không chạm FileBox)", async () => {
    const upload = createUploadContract({
      uow: {} as never,
      counter: {} as never,
      files: { put: async () => ({ fileId: "x", versionId: "y" }), remove: async () => {} },
      docx: {} as never,
      starter: {} as never,
      zipNames: () => [],
      limits: { tenant: 1, global: 1 },
      newId: () => "id",
    });
    const heic = new Uint8Array([0, 0, 0, 24, ...enc("ftypheic"), 0, 0, 0, 0]);
    const err = await upload({
      who: { tenantId: "t", userId: "u" },
      timeZone: "UTC",
      bytes: heic,
      name: "a.heic",
      title: "a",
      kind: "contract",
      parentId: null,
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "FILE_TYPE", details: { format: "heic" } });
  });
});

describe("p9 · giới hạn trang lúc tải lên", () => {
  it("PDF 72 trang (trần 50) ⇒ 422 FILE_TOO_MANY_PAGES {pages, limit}, KHÔNG quota/FileBox/HĐ", async () => {
    let touched = 0;
    const upload = createUploadContract({
      uow: { tenant: async () => void touched++ } as never,
      counter: { take: async () => void touched++ } as never,
      files: { put: async () => void touched++ as never, remove: async () => {} },
      docx: {} as never,
      starter: {} as never,
      zipNames: () => [],
      pdfPages: Object.assign(async () => 72, { limit: 50 }),
      limits: { tenant: 1, global: 1 },
      newId: () => "id",
    });
    const err = await upload({
      who: { tenantId: "t", userId: "u" },
      timeZone: "UTC",
      bytes: enc("%PDF-1.4"),
      name: "scan.pdf",
      title: "scan",
      kind: "contract",
      parentId: null,
    }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "FILE_TOO_MANY_PAGES", details: { pages: 72, limit: 50 } });
    expect(touched).toBe(0);
  });
  it("bộ đếm trang đọc đúng PDF do server ghép (3 ảnh ⇒ 3 trang) và rác ⇒ null", async () => {
    const count = pdfPageCounter(50);
    expect(await count((await imagesToPdf([jpeg(8, 4), png(4, 4), png(3, 5)])) as Uint8Array)).toBe(
      3,
    );
    expect(await count(enc("not a pdf"))).toBeNull();
  });
});

describe("p9 · tệp đính kèm lời gọi AI", () => {
  it("PDF ⇒ khối document, PNG/JPG ⇒ khối image (base64); loại lạ ⇒ null", () => {
    const b = attachmentBlocks([
      { mime: "application/pdf", bytes: enc("%PDF-1.4") },
      { mime: "image/png", bytes: png(1, 1) },
    ]);
    expect(b?.map((x) => x.type)).toEqual(["document", "image"]);
    expect(attachmentBlocks([{ mime: "text/plain", bytes: enc("x") }])).toBeNull();
  });
  it("CLI gói: có tệp ⇒ đúng một công cụ Read; không tệp ⇒ không công cụ như trước", () => {
    const withFiles = cliArgs("m", "s", false, true);
    expect(withFiles[withFiles.indexOf("--tools") + 1]).toBe("Read");
    expect(cliArgs("m", "s")[cliArgs("m", "s").indexOf("--tools") + 1]).toBe("");
  });
});
