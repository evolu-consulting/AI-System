import { describe, expect, test } from "bun:test";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { sha256Hex, stampPdf } from "../adapters/sign-stamp.pdf";
import { type DigitalSigner, noDigitalSigner, produceSigned } from "./digital-signer";

const png = (): Uint8Array => {
  const cv = createCanvas(60, 25);
  cv.getContext("2d").fillRect(5, 5, 50, 5);
  return cv.toBuffer("image/png");
};
const blank = async () => {
  const d = await PDFDocument.create();
  d.addPage([600, 800]);
  return d.save();
};
const marks = [
  {
    png: png(),
    parts: [{ page: 0, x: 10, y: 10, w: 120, h: 50, cx: 10, cy: 10, cw: 120, ch: 50 }],
  },
];
const base = { marks, ink: "blue" as const, stamp: stampPdf, sha256: sha256Hex };
const hasImage = (d: PDFDocument) =>
  d.context
    .enumerateIndirectObjects()
    .some(
      ([, o]) =>
        o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
    );

describe("produceSigned (BR-L5, Q12)", () => {
  test("internal: chỉ in hình, không gọi bộ ký", async () => {
    let called = 0;
    const signer: DigitalSigner = {
      sign: async (b) => {
        called++;
        return b;
      },
    };
    const r = await produceSigned({ ...base, pdf: await blank(), kind: "internal", signer });
    expect(called).toBe(0);
    expect(hasImage(await PDFDocument.load(r.bytes))).toBe(true);
  });

  test("digital: bộ ký thấy bản ĐÃ in hình, kết quả là bytes bộ ký trả, sha256 trên bytes đó", async () => {
    let seen: Uint8Array | undefined;
    let ctxSeen: unknown;
    const signer: DigitalSigner = {
      async sign(b, ctx) {
        seen = b;
        ctxSeen = ctx;
        return new Uint8Array([...b, 0x0a, 0x25, 0x25, 0x53]); // giả «ghi nối chữ ký số»
      },
    };
    const r = await produceSigned({
      ...base,
      pdf: await blank(),
      kind: "digital",
      signer,
      ctx: { userId: "u1" },
    });
    expect(seen).toBeDefined();
    expect(hasImage(await PDFDocument.load(seen as Uint8Array))).toBe(true); // hình đã in trước khi ký số
    expect(ctxSeen).toEqual({ userId: "u1" });
    expect(r.bytes.length).toBe((seen as Uint8Array).length + 4);
    expect(r.sha256).toBe(sha256Hex(r.bytes));
    expect(r.pages).toBe(1);
  });

  test("digital + noDigitalSigner ⇒ DIGITAL_SIGN_NOT_ENABLED, không có bytes", async () => {
    let got: unknown;
    let err: unknown;
    try {
      got = await produceSigned({
        ...base,
        pdf: await blank(),
        kind: "digital",
        signer: noDigitalSigner,
      });
    } catch (e) {
      err = e;
    }
    expect(got).toBeUndefined();
    expect(err).toMatchObject({ code: "DIGITAL_SIGN_NOT_ENABLED" });
  });

  test("bộ ký lỗi ⇒ lỗi lan ra, không có bytes", async () => {
    const signer: DigitalSigner = { sign: () => Promise.reject(new Error("hsm down")) };
    await expect(
      produceSigned({ ...base, pdf: await blank(), kind: "digital", signer }),
    ).rejects.toThrow("hsm down");
  });

  test("noDigitalSigner với internal vẫn in bình thường", async () => {
    const r = await produceSigned({
      ...base,
      pdf: await blank(),
      kind: "internal",
      signer: noDigitalSigner,
    });
    expect(r.pages).toBe(1);
  });
});
