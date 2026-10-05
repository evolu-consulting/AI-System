// HUB-FR-44 · H2c-R03 · kiểm nội dung theo đuôi: chữ ký đầu file, chặn file chạy được, nhóm chữ UTF-8 (test-plan H2c §1,
// cases §1.2 R11–R16; chữ ký plan-rules §2).
import { describe, expect, it } from "bun:test";
import {
  type AttachExt,
  extOf,
} from "../../../../apps/hub-api/src/modules/attachments/attachment.rules";
import {
  FileInspector,
  headOk,
  isExecutableHead,
  SNIFF_HEAD,
} from "../../../../apps/hub-api/src/modules/attachments/sniff.rules";
import { cat, hex, pad, SIG, u8 } from "./_rules";

/** Đẩy lần lượt các chunk; trả kết quả mọi `push` rồi `end`. */
function inspect(ext: AttachExt, chunks: Uint8Array[]): { pushes: boolean[]; end: boolean } {
  const f = new FileInspector(ext);
  const pushes = chunks.map((c) => f.push(c));
  return { pushes, end: f.end() };
}
const whole = (ext: AttachExt, bytes: Uint8Array): boolean => {
  const r = inspect(ext, [bytes]);
  return r.pushes.every(Boolean) && r.end;
};

const TEXT_EXTS: AttachExt[] = ["txt", "md", "csv", "xml", "json"];

describe("HUB-FR-44 · isExecutableHead, headOk [R11–R13]", () => {
  it("HUB-FR-44 · R11 · MZ, ELF, #!, BOM + #! → true; còn lại false; SNIFF_HEAD = 16 [H2c-R03 · HUB-H2c-AC-03]", () => {
    expect(SNIFF_HEAD).toBe(16);
    for (const h of [SIG.mz, SIG.elf, SIG.shebang, cat(SIG.bom, u8("#!/usr/bin/env node"))])
      expect(isExecutableHead(h)).toBe(true);
    for (const h of [u8("M"), u8("#"), u8("%PDF-"), new Uint8Array(), u8("# tiêu đề")])
      expect(isExecutableHead(h)).toBe(false);
  });

  it("HUB-FR-44 · R12 · chữ ký theo đuôi; ngắn hơn chữ ký → false; nhóm chữ → true [H2c-R03]", () => {
    const ok: [AttachExt, Uint8Array][] = [
      ["pdf", u8("%PDF-1.7")],
      ["png", hex("89 50 4E 47 0D 0A 1A 0A")],
      ["jpg", hex("FF D8 FF E0")],
      ["jpeg", hex("FF D8 FF E0")],
      ["gif", u8("GIF87a")],
      ["gif", u8("GIF89a")],
      ["webp", u8("RIFF\u0001\u0002\u0003\u0004WEBP")],
      ["docx", SIG.zip],
      ["xlsx", SIG.zip],
      ["pptx", SIG.zip],
    ];
    for (const [ext, h] of ok) expect(headOk(ext, h)).toBe(true);
    const bad: [AttachExt, Uint8Array][] = [
      ["pdf", u8("%PDF")],
      ["png", hex("89 50 4E 47 0D 0A 1A")],
      ["gif", u8("GIF88a")],
      ["webp", u8("RIFF\u0001\u0002\u0003\u0004WAVE")],
      ["docx", hex("50 4B 05 06")],
      ["xlsx", hex("50 4B 05 06")],
      ["pptx", hex("50 4B 05 06")],
    ];
    for (const [ext, h] of bad) expect(headOk(ext, h)).toBe(false);
    for (const ext of TEXT_EXTS) expect(headOk(ext, u8("xin chào"))).toBe(true);
  });

  it("HUB-FR-44 · R13 · chéo loại: nội dung khác đuôi, file chạy được đội lốt → false [H2c-R03 · HUB-H2c-AC-03]", () => {
    expect(headOk("pdf", SIG.png)).toBe(false);
    expect(headOk("png", u8("%PDF-1.4"))).toBe(false);
    expect(headOk("pdf", SIG.mz)).toBe(false);
    expect(headOk("txt", SIG.mz)).toBe(false);
    expect(headOk("md", SIG.shebang)).toBe(false);
    expect(headOk("md", cat(SIG.bom, SIG.shebang))).toBe(false);
  });
});

describe("HUB-FR-44 · FileInspector [R14, R15]", () => {
  it("HUB-FR-44 · R14 · nhị phân: push từng byte, quyết định khi đủ 16 byte hoặc end [H2c-R03]", () => {
    const pdf = cat(u8("%PDF-1.4\n"), pad(new Uint8Array(), 40, 0x20));
    const bytes = [...pdf.slice(0, 5)].map((b) => Uint8Array.of(b));
    const r = inspect("pdf", [...bytes, pdf.slice(5)]);
    expect(r.pushes.every(Boolean)).toBe(true);
    expect(r.end).toBe(true);

    const f = new FileInspector("pdf");
    expect(f.push(SIG.png.slice(0, 3))).toBe(true); // chưa đủ 16 byte: chưa quyết định
    expect(f.push(SIG.png.slice(3))).toBe(false);
    expect(f.end()).toBe(false);

    const g = new FileInspector("pdf");
    expect(g.push(SIG.png.slice(0, 3))).toBe(true);
    expect(g.end()).toBe(false);

    expect(inspect("pdf", [u8("%PD")]).end).toBe(false);
    expect(inspect("pdf", []).end).toBe(true);
    expect(inspect("txt", []).end).toBe(true);
  });

  it("HUB-FR-44 · R15 · chữ: UTF-8 hợp lệ, BOM ok; byte 00 / UTF-8 sai → false và giữ false [H2c-R03]", () => {
    expect(whole("txt", u8("Xin chào"))).toBe(true);
    expect(whole("csv", cat(SIG.bom, u8("a,b\n1,2\n")))).toBe(true);

    const f = new FileInspector("txt");
    expect(f.push(u8("dòng một\n"))).toBe(true);
    expect(f.push(cat(u8("a"), hex("00"), u8("b")))).toBe(false);
    expect(f.push(u8("hợp lệ"))).toBe(false);
    expect(f.end()).toBe(false);

    expect(whole("txt", hex("C3 28"))).toBe(false);
    expect(whole("txt", hex("FF FE 61 00"))).toBe(false);
  });

  it("HUB-FR-44 · R15 · ký tự nhiều byte cắt giữa hai chunk ok; cắt dở ở cuối file → end false [H2c-R03]", () => {
    const split = inspect("md", [cat(u8("x"), hex("E1 BA")), hex("A1")]);
    expect(split).toEqual({ pushes: [true, true], end: true });
    const cut = inspect("md", [cat(u8("x"), hex("E1 BA"))]);
    expect(cut).toEqual({ pushes: [true], end: false });
  });
});

describe("HUB-FR-44 · bảng mẫu AC-03 [R16]", () => {
  it("HUB-FR-44 · R16 · extOf + FileInspector theo bảng plan-rules §2 [H2c-R03 · HUB-H2c-AC-03]", () => {
    for (const name of ["setup.exe", "a.html", "a.svg"]) expect(extOf(name)).toBeNull();
    const table: [string, Uint8Array, boolean][] = [
      ["virus.pdf", SIG.mz, false],
      ["anh.pdf", SIG.png, false],
      ["ghi.txt", u8("abc\u0000def"), false],
      ["run.md", SIG.shebang, false],
      ["hop-dong.docx", pad(SIG.zip, 64, 0), true],
      ["bang.csv", cat(SIG.bom, u8("tên,tuổi\nAn,3\n")), true],
      ["ANH.JPG", pad(SIG.jpg, 64, 0), true],
      ["utf16.txt", cat(hex("FF FE"), hex("61 00 62 00")), false],
    ];
    for (const [name, bytes, want] of table) {
      const ext = extOf(name);
      expect(ext).not.toBeNull();
      if (ext) expect(whole(ext, bytes)).toBe(want);
    }
  });
});
