// CR-188 · BR-188-3 · mỗi phông «Gõ họ tên»: tệp tự host có mặt, kèm giấy phép OFL, và ĐỦ glyph tiếng Việt có dấu (đọc bảng cmap của tệp, không cần canvas).
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_FONT, fontCss, fontOf, SIGNATURE_FONTS } from "./signature-fonts";

const dir = (f: string) => fileURLToPath(new URL(`../../../../public/fonts/${f}`, import.meta.url));

type Reader = {
  u16: (o: number) => number;
  u32: (o: number) => number;
  i16: (o: number) => number;
};

function cmap12(r: Reader, t: number, out: Set<number>): void {
  const g = r.u32(t + 12);
  for (let k = 0; k < g; k++)
    for (let c = r.u32(t + 16 + k * 12); c <= r.u32(t + 20 + k * 12); c++) out.add(c);
}

function cmap4(r: Reader, t: number, out: Set<number>): void {
  const segs = r.u16(t + 6) / 2;
  const end = t + 14;
  const start = end + segs * 2 + 2;
  const delta = start + segs * 2;
  const range = delta + segs * 2;
  for (let k = 0; k < segs; k++) {
    const ro = r.u16(range + k * 2);
    for (let c = r.u16(start + k * 2); c <= r.u16(end + k * 2) && c < 0xffff; c++) {
      const g =
        ro === 0
          ? (c + r.i16(delta + k * 2)) & 0xffff
          : r.u16(range + k * 2 + ro + (c - r.u16(start + k * 2)) * 2);
      if (g !== 0) out.add(c);
    }
  }
}

/** Tập mã ký tự có glyph (cmap định dạng 4 và 12). */
function cmapOf(buf: Buffer): Set<number> {
  const r: Reader = {
    u16: (o) => buf.readUInt16BE(o),
    u32: (o) => buf.readUInt32BE(o),
    i16: (o) => buf.readInt16BE(o),
  };
  const tables = Array.from({ length: r.u16(4) }, (_, i) => ({
    tag: buf.toString("latin1", 12 + i * 16, 16 + i * 16),
    off: r.u32(20 + i * 16),
  }));
  const off = tables.find((x) => x.tag === "cmap")?.off ?? 0;
  const out = new Set<number>();
  for (let i = 0; i < r.u16(off + 2); i++) {
    const t = off + r.u32(off + 8 + i * 8);
    const fmt = r.u16(t);
    if (fmt === 12) cmap12(r, t, out);
    else if (fmt === 4) cmap4(r, t, out);
  }
  return out;
}

const VI =
  "aàáảãạăằắẳẵặâầấẩẫậeèéẻẽẹêềếểễệiìíỉĩịoòóỏõọôồốổỗộơờớởỡợuùúủũụưừứửữựyỳýỷỹỵđ" +
  "AÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬEÈÉẺẼẸÊỀẾỂỄỆIÌÍỈĨỊOÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢUÙÚỦŨỤƯỪỨỬỮỰYỲÝỶỸỴĐ ";

describe("phông «Gõ họ tên» (BR-188-3)", () => {
  test("sáu phông, khoá và họ phông không trùng; phông mặc định có trong danh sách", () => {
    expect(SIGNATURE_FONTS.map((f) => f.family)).toEqual([
      "Dancing Script",
      "Pacifico",
      "Great Vibes",
      "Allura",
      "Lobster",
      "Charm",
    ]);
    expect(new Set(SIGNATURE_FONTS.map((f) => f.key)).size).toBe(6);
    expect(fontOf(DEFAULT_FONT).key).toBe(DEFAULT_FONT);
    expect(fontCss("pacifico", 110)).toBe('400 110px "Pacifico", "Segoe Script", cursive');
  });
  for (const f of SIGNATURE_FONTS) {
    test(`${f.family}: có tệp + OFL, đủ glyph «Nguyễn Thị Ánh Ngọc» và mọi chữ có dấu`, () => {
      expect(existsSync(dir(f.file))).toBe(true);
      const cm = cmapOf(readFileSync(dir(f.file)));
      const missing = [..."Nguyễn Thị Ánh Ngọc", ...VI].filter(
        (c) => !cm.has(c.codePointAt(0) as number),
      );
      expect(missing.join("")).toBe("");
    });
  }
  test("giấy phép OFL kèm theo", () => {
    for (const f of [
      "OFL.txt",
      "OFL-pacifico.txt",
      "OFL-greatvibes.txt",
      "OFL-allura.txt",
      "OFL-lobster.txt",
      "OFL-charm.txt",
    ])
      expect(readFileSync(dir(f), "utf8")).toContain("SIL Open Font License");
  });
});
