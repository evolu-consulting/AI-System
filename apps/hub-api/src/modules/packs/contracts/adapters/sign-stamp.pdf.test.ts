import { describe, expect, test } from "bun:test";
import type { SignPart } from "@ai/contracts/pack-contracts";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  decodePDFRawStream,
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
} from "pdf-lib";
import { SignError } from "../domain/sign-error";
import { fitLine, layoutLines, sha256Hex, stampPdf, tint } from "./sign-stamp.pdf";

/** PNG nét đen trên nền trong (vạch chéo) — mô phỏng ảnh chữ ký đã cắt sát. */
function sigPng(w = 240, h = 100): Uint8Array {
  const cv = createCanvas(w, h);
  const g = cv.getContext("2d");
  g.strokeStyle = "#000";
  g.lineWidth = 6;
  g.beginPath();
  g.moveTo(5, h - 5);
  g.lineTo(w - 5, 5);
  g.stroke();
  return cv.toBuffer("image/png");
}

async function makePdf(
  n: number,
  o: { rotate?: number[]; crop?: [number, number, number, number] } = {},
): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) {
    const p = d.addPage([600, 800]);
    p.drawText(`Trang ${i + 1}`, { x: 50, y: 700, size: 12 });
    if (o.rotate?.[i]) p.setRotation(degrees(o.rotate[i] as number));
    if (o.crop) p.setCropBox(...o.crop);
  }
  return d.save();
}

const part = (o: Partial<SignPart> = {}): SignPart => ({
  page: 0,
  x: 100,
  y: 100,
  w: 240,
  h: 100,
  cx: 100,
  cy: 100,
  cw: 240,
  ch: 100,
  ...o,
});

/** Nội dung (đã giải nén) của trang i. */
function content(doc: PDFDocument, i: number): string {
  const c = doc.getPage(i).node.Contents();
  const streams = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c];
  return streams
    .map((s) =>
      s instanceof PDFRawStream
        ? Buffer.from(decodePDFRawStream(s).decode()).toString("latin1")
        : "",
    )
    .join("\n");
}
const nums = (re: RegExp, s: string) => [...s.matchAll(re)].map((m) => m.slice(1).map(Number));
const NUM = "(-?[\\d.]+)";
const CM = new RegExp(`${NUM} ${NUM} ${NUM} ${NUM} ${NUM} ${NUM} cm`, "g");
const CLIP = new RegExp(`${NUM} ${NUM} ${NUM} ${NUM} re\\s+W\\s+n`, "g");

/** drawImage của pdf-lib = 4 cm liên tiếp: tịnh tiến, xoay, co giãn [w 0 0 h 0 0], nghiêng. */
function imageCm(doc: PDFDocument, i: number): { at: number[]; size: number[] } {
  const all = nums(CM, content(doc, i));
  return { at: all.at(-4) as number[], size: all.at(-2) as number[] };
}

/** Số ảnh chữ ký (XObject Image không phải SMask) trong tệp. */
function images(doc: PDFDocument): number {
  const smasks = new Set<unknown>();
  const all = doc.context.enumerateIndirectObjects();
  const imgs = all.filter(
    ([, o]) =>
      o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
  );
  for (const [, o] of imgs) smasks.add((o as PDFRawStream).dict.get(PDFName.of("SMask")));
  return imgs.filter(([ref]) => !smasks.has(ref)).length;
}
function hasFont(doc: PDFDocument, re: RegExp): boolean {
  return doc.context.enumerateIndirectObjects().some(([, o]) => {
    if (!(o instanceof PDFDict)) return false;
    const f = o.get(PDFName.of("BaseFont"));
    return f instanceof PDFName && re.test(f.decodeText());
  });
}

describe("tint (Q18)", () => {
  test("nét đen ⇒ màu mực, nền trong suốt giữ nguyên", async () => {
    const out = await tint(sigPng(40, 20), "#1f3a8a");
    const img = await loadImage(Buffer.from(out));
    const cv = createCanvas(img.width, img.height);
    const g = cv.getContext("2d");
    g.drawImage(img, 0, 0);
    const px = (x: number, y: number) => [...g.getImageData(x, y, 1, 1).data];
    expect(px(20, 10).slice(0, 3)).toEqual([31, 58, 138]);
    expect(px(20, 10)[3]).toBe(255);
    expect(px(35, 18)[3]).toBe(0);
  });
  test("PNG khai kích thước vượt 2000×1000 (IHDR) ⇒ SIGN_IMAGE_TOO_LARGE trước khi cấp canvas", async () => {
    const big = new Uint8Array(sigPng(40, 20));
    const v = new DataView(big.buffer, big.byteOffset);
    v.setUint32(16, 20000);
    v.setUint32(20, 20000);
    await expect(tint(big, "#000")).rejects.toMatchObject({ code: "SIGN_IMAGE_TOO_LARGE" });
    v.setUint32(16, 2001);
    v.setUint32(20, 10);
    await expect(tint(big, "#000")).rejects.toMatchObject({ code: "SIGN_IMAGE_TOO_LARGE" });
  });
  test("ảnh hỏng ⇒ SIGN_IMAGE_INVALID", async () => {
    await expect(tint(new Uint8Array([1, 2, 3]), "#000")).rejects.toMatchObject({
      code: "SIGN_IMAGE_INVALID",
    });
  });
});

describe("stampPdf", () => {
  test("trả bytes mở lại được, sha256 trên bytes ra, đủ số trang", async () => {
    const r = await stampPdf({
      pdf: await makePdf(3),
      marks: [{ png: sigPng(), parts: [part()] }],
      ink: "blue",
    });
    expect(r.pages).toBe(3);
    expect(r.sha256).toBe(sha256Hex(r.bytes));
    const d = await PDFDocument.load(r.bytes);
    expect(d.getPageCount()).toBe(3);
    expect(nums(CLIP, content(d, 0))).toEqual([[100, 100, 240, 100]]);
    expect(content(d, 0)).toContain("Do");
    expect(content(d, 1)).not.toContain(" Do");
  });

  test("ảnh vừa khung giữ tỉ lệ: khung 100×100, ảnh 240×100 ⇒ rộng 100, cao 41,67, căn giữa", async () => {
    const r = await stampPdf({
      pdf: await makePdf(1),
      marks: [{ png: sigPng(), parts: [part({ w: 100, h: 100, cw: 100 })] }],
      ink: "black",
    });
    const { size, at } = imageCm(await PDFDocument.load(r.bytes), 0);
    expect(size[0]).toBeCloseTo(100, 3);
    expect(size[3]).toBeCloseTo(100 * (100 / 240), 3);
    expect(at[4]).toBeCloseTo(100, 3);
    expect(at[5]).toBeCloseTo(100 + (100 - (100 * 100) / 240) / 2, 3);
  });

  test("trang xoay 90/180/270: ma trận hiển thị → gốc đúng", async () => {
    for (const [rot, m] of [
      [90, [0, 1, -1, 0, 600, 0]],
      [180, [-1, 0, 0, -1, 600, 800]],
      [270, [0, -1, 1, 0, 0, 800]],
    ] as const) {
      const r = await stampPdf({
        pdf: await makePdf(1, { rotate: [rot] }),
        marks: [{ png: sigPng(), parts: [part()] }],
        ink: "blue",
      });
      const cms = nums(CM, content(await PDFDocument.load(r.bytes), 0));
      expect(cms.some((x) => x.join() === m.join())).toBe(true);
    }
  });

  test("CropBox lệch gốc: ma trận cộng độ lệch", async () => {
    const r = await stampPdf({
      pdf: await makePdf(1, { crop: [20, 30, 500, 700] }),
      marks: [{ png: sigPng(), parts: [part()] }],
      ink: "blue",
    });
    const cms = nums(CM, content(await PDFDocument.load(r.bytes), 0));
    expect(cms.some((x) => x.join() === [1, 0, 0, 1, 20, 30].join())).toBe(true);
  });

  test("giáp lai 2 trang: clip 100 + 90 = khung 190, ảnh embed MỘT lần, ghép đúng một hình", async () => {
    // trang rộng 600: khung 190 bắt đầu x=500 ⇒ 100 ở trang 1, 90 ở trang 2 (x = 500 - 600 = -100).
    const parts = [
      part({ page: 0, x: 500, y: 300, w: 190, h: 100, cx: 500, cy: 300, cw: 100, ch: 100 }),
      part({ page: 1, x: -100, y: 300, w: 190, h: 100, cx: 0, cy: 300, cw: 90, ch: 100 }),
    ];
    const r = await stampPdf({
      pdf: await makePdf(2),
      marks: [{ png: sigPng(), parts, caption: "A · 01/01" }],
      ink: "blue",
    });
    const d = await PDFDocument.load(r.bytes);
    expect(nums(CLIP, content(d, 0))).toEqual([[500, 300, 100, 100]]);
    expect(nums(CLIP, content(d, 1))).toEqual([[0, 300, 90, 100]]);
    const img0 = imageCm(d, 0);
    const img1 = imageCm(d, 1);
    expect(img0.size[0]).toBeCloseTo(img1.size[0] as number, 6); // cùng cỡ ảnh
    expect((img0.at[4] as number) - (img1.at[4] as number)).toBeCloseTo(600, 6); // lệch đúng một rộng trang ⇒ liền một hình
    expect(images(d)).toBe(1);
    expect(hasFont(d, /BeVietnamPro/)).toBe(true); // CR-188 · giáp lai cũng in dòng chữ (ở phần cuối)
  });

  test("phần ngoài trang bị cắt: clip chỉ còn phần trong trang", async () => {
    const r = await stampPdf({
      pdf: await makePdf(1),
      marks: [{ png: sigPng(), parts: [part({ x: 500, cx: 500, cw: 240 })] }],
      ink: "blue",
    });
    expect(nums(CLIP, content(await PDFDocument.load(r.bytes), 0))).toEqual([[500, 100, 100, 100]]);
  });

  test("hoàn toàn ngoài trang ⇒ SIGN_OUTSIDE_PAGE", async () => {
    await expect(
      stampPdf({
        pdf: await makePdf(1),
        marks: [{ png: sigPng(), parts: [part({ cx: 700, cw: 50 })] }],
        ink: "blue",
      }),
    ).rejects.toMatchObject({ code: "SIGN_OUTSIDE_PAGE" });
  });

  test("caption một phần: nhúng Be Vietnam Pro và ảnh giống nhau chỉ nhúng một lần", async () => {
    const png = sigPng();
    const marks = [0, 1, 2].map((page) => ({
      png,
      parts: [part({ page })],
      caption: page === 0 ? "Nguyễn Văn Ấn · 17/11/2026" : undefined,
    }));
    const d = await PDFDocument.load(
      (await stampPdf({ pdf: await makePdf(3), marks, ink: "blue" })).bytes,
    );
    expect(hasFont(d, /BeVietnamPro/)).toBe(true);
    expect(images(d)).toBe(1);
  });

  test("CR-188 · dấu một phần in HAI dòng (caption + «Ký ngày …»); thiếu caption vẫn in dòng ngày", async () => {
    const tj = async (m: { caption?: string; signedOn?: string; parts?: SignPart[] }, page = 0) => {
      const r = await stampPdf({
        pdf: await makePdf(2),
        marks: [{ png: sigPng(), parts: m.parts ?? [part()], ...m }],
        ink: "blue",
      });
      // mỗi dòng chữ = một khối BT…ET (trừ khối chữ sẵn có của trang mẫu)
      return content(await PDFDocument.load(r.bytes), page).split(/\sBT\s/).length - 1;
    };
    const base = await tj({});
    const on = "Ký ngày 18/11/2026 00:05";
    expect(await tj({ caption: "Nguyễn Văn Ấn · Giám đốc · Kinh doanh", signedOn: on })).toBe(
      base + 2,
    );
    expect(await tj({ signedOn: on })).toBe(base + 1);
    expect(await tj({ caption: "A" })).toBe(base + 1);
    // Khung sát đáy trang: không đủ chỗ cho hai dòng ⇒ bỏ caption, giữ dòng ngày (BR-188-2).
    expect(await tj({ caption: "A", signedOn: on, parts: [part({ y: 6, cy: 6 })] })).toBe(base + 1);
  });

  test("CR-188 · dấu nhiều phần (giáp lai/xoè quạt): «Ký ngày …» + caption in ở PHẦN CUỐI, các phần trước không in", async () => {
    const parts = [
      part({ page: 0, x: 500, y: 300, w: 190, h: 100, cx: 500, cy: 300, cw: 100, ch: 100 }),
      part({ page: 1, x: -100, y: 300, w: 190, h: 100, cx: 0, cy: 300, cw: 90, ch: 100 }),
    ];
    const mk = async (m: { caption?: string; signedOn?: string }) => {
      const r = await stampPdf({
        pdf: await makePdf(2),
        marks: [{ png: sigPng(), parts, ...m }],
        ink: "blue",
      });
      const d = await PDFDocument.load(r.bytes);
      const n = (i: number) => content(d, i).split(/\sBT\s/).length - 1;
      return [n(0), n(1)] as [number, number];
    };
    const [b0, b1] = await mk({});
    const on = "Ký ngày 18/11/2026 00:05";
    expect(await mk({ caption: "A · B", signedOn: on })).toEqual([b0, b1 + 2]);
    expect(await mk({ signedOn: on })).toEqual([b0, b1 + 1]);
  });

  test("CR-188 · layoutLines: đủ chỗ giữ cả hai dòng, không đè nhau; thiếu chỗ bỏ dòng đầu giữ dòng cuối", () => {
    const ok = layoutLines(100, [7.5, 7.5]);
    expect(ok.from).toBe(0);
    expect(ok.ys).toEqual([91, 82]);
    const tight = layoutLines(8, [7.5, 7.5]); // dòng 2 sẽ ở y < 4
    expect(tight.from).toBe(1);
    expect(tight.ys).toHaveLength(1);
    expect(layoutLines(0, [7.5]).ys).toEqual([4]); // một dòng: kẹp sát đáy
  });

  test("CR-188 · fitLine: vừa khung giữ cỡ 7,5; dài thì co tới 5 rồi cắt «…»", () => {
    const font = { widthOfTextAtSize: (t: string, s: number) => t.length * s * 0.5 };
    expect(fitLine(font, "abcd", 100)).toEqual({ text: "abcd", size: 7.5 });
    const co = fitLine(font, "a".repeat(30), 100); // 30*7.5*.5=112 > 100 ⇒ co ~6,67
    expect(co.text).toBe("a".repeat(30));
    expect(co.size).toBeCloseTo(6.667, 2);
    const cat = fitLine(font, "a".repeat(80), 100); // co chạm sàn 5 vẫn dài ⇒ cắt
    expect(cat.size).toBe(5);
    expect(cat.text.endsWith("…")).toBe(true);
    expect(font.widthOfTextAtSize(cat.text, cat.size)).toBeLessThanOrEqual(100);
  });

  test("màu mực: blue và black cho kết quả khác nhau", async () => {
    const pdf = await makePdf(1);
    const mk = (ink: "blue" | "black") =>
      stampPdf({ pdf, marks: [{ png: sigPng(), parts: [part()] }], ink });
    expect((await mk("blue")).sha256).not.toBe((await mk("black")).sha256);
  });

  test("PDF có mật khẩu ⇒ SIGN_PDF_ENCRYPTED", async () => {
    const d = await PDFDocument.create();
    d.addPage();
    d.context.trailerInfo.Encrypt = d.context.register(
      d.context.obj({ Filter: "Standard", V: 1, R: 2 }),
    );
    const enc = await d.save();
    await expect(stampPdf({ pdf: enc, marks: [], ink: "blue" })).rejects.toMatchObject({
      code: "SIGN_PDF_ENCRYPTED",
    });
  });

  test("quá 50 trang ⇒ SIGN_TOO_MANY_PAGES, rác ⇒ SignError", async () => {
    await expect(
      stampPdf({ pdf: await makePdf(51), marks: [], ink: "blue" }),
    ).rejects.toMatchObject({
      code: "SIGN_TOO_MANY_PAGES",
    });
    await expect(
      stampPdf({ pdf: new Uint8Array([1, 2, 3, 4]), marks: [], ink: "blue" }),
    ).rejects.toBeInstanceOf(SignError);
  });

  test("perf: 50 trang + 60 dấu < 3 s", async () => {
    const pdf = await makePdf(50);
    const initials = sigPng(120, 50);
    const main = sigPng();
    const marks = [
      ...Array.from({ length: 50 }, (_, page) => ({
        png: initials,
        parts: [part({ page, x: 480, y: 40, w: 96, h: 40, cx: 480, cy: 40, cw: 96, ch: 40 })],
      })),
      ...Array.from({ length: 10 }, (_, k) => ({
        png: main,
        parts: [part({ page: 49 })],
        caption: `Người ${k} · 17/11/2026`,
      })),
    ];
    const t0 = performance.now();
    const r = await stampPdf({ pdf, marks, ink: "blue" });
    const ms = performance.now() - t0;
    console.log(
      `PERF stampPdf 50 trang + ${marks.length} dấu: ${ms.toFixed(0)} ms, ${r.bytes.length} bytes`,
    );
    expect(r.pages).toBe(50);
    expect(ms).toBeLessThan(3000);
  });
});
