// HUB-FR-44 · WRK-BR-07 · H2c-R01, R02, R13, R22 · tên file, đuôi, Content-Disposition (test-plan H2c §1, cases §1.1
// R01–R10; chữ ký plan-rules §1).
import { describe, expect, it } from "bun:test";
import { ATTACH_ALLOWED, AttachmentSchema } from "@ai/contracts/chat";
import {
  type AttachExt,
  contentDisposition,
  difyFileType,
  displayName,
  extOf,
  mimeOf,
  parseFilenameHeader,
  safeName,
  splitExt,
} from "../../../../apps/hub-api/src/modules/attachments/attachment.rules";
import { ch, utf8Bytes } from "./_rules";

const EXTS = Object.keys(ATTACH_ALLOWED) as AttachExt[];
/** U+202E RIGHT-TO-LEFT OVERRIDE (viết bằng mã, không để ký tự vô hình trong source). */
const RLO = ch(0x202e);

describe("HUB-FR-44 · parseFilenameHeader [R01]", () => {
  it("HUB-FR-44 · R01 · vắng/rỗng → null; percent-encode UTF-8 → tên giải mã [H2c-R01 · HUB-H2c-AC-04]", () => {
    expect(parseFilenameHeader(undefined)).toBeNull();
    expect(parseFilenameHeader("")).toBeNull();
    expect(parseFilenameHeader("a%20b.pdf")).toBe("a b.pdf");
    expect(parseFilenameHeader("Ho%C3%A1%20%C4%91%C6%A1n.pdf")).toBe("Hoá đơn.pdf");
  });

  it("HUB-FR-44 · R01 · ký tự thô ngoài 0x20–0x7E, decodeURIComponent ném → null [H2c-R01]", () => {
    for (const raw of ["Hoá.pdf", "a\tb", "a\nb.txt", "a\u007fb", "%E0%A4%A", "%ZZ", "a%"])
      expect(parseFilenameHeader(raw)).toBeNull();
  });

  it("HUB-FR-44 · R01 · %00 giữ (lọc ở displayName); không trim, không NFC [H2c-R01]", () => {
    expect(parseFilenameHeader("%00")).toBe("\u0000");
    expect(parseFilenameHeader("%20a")).toBe(" a");
    expect(parseFilenameHeader("a%CC%81")).toBe(`a${ch(0x301)}`);
  });

  it("HUB-FR-44 · R01 · trần 1 024 byte UTF-8 sau giải mã (đếm byte, không ký tự) [H2c-R01]", () => {
    expect(parseFilenameHeader("a".repeat(1024))).toBe("a".repeat(1024));
    expect(parseFilenameHeader("a".repeat(1025))).toBeNull();
    const ok = `${"ạ".repeat(341)}a`; // 1 023 + 1 = 1 024 byte
    expect(parseFilenameHeader(encodeURIComponent(ok))).toBe(ok);
    expect(parseFilenameHeader(encodeURIComponent("ạ".repeat(342)))).toBeNull(); // 1 026 byte
  });
});

describe("HUB-FR-44 · WRK-BR-07 · displayName [R02–R04]", () => {
  it("WRK-BR-07 · R02 · NFC, phần sau / hoặc \\ cuối, rỗng → file [H2c-R02 · HUB-H2c-AC-04]", () => {
    expect(displayName(`a${ch(0x301)}.txt`)).toBe(`${ch(0xe1)}.txt`);
    expect(displayName("../../etc/passwd.txt")).toBe("passwd.txt");
    expect(displayName("a\\b.txt")).toBe("b.txt");
    expect(displayName("x/")).toBe("file");
  });

  it("WRK-BR-07 · R02 · bỏ ký tự điều khiển/bidi/zero-width ở mọi vị trí [H2c-R02]", () => {
    const cases: [string, string][] = [
      [`a${ch(0x200b)}b.txt`, "ab.txt"],
      [`${RLO}gnp.exe.txt`, "gnp.exe.txt"],
      ["a\u0000b\u001Fc.txt", "abc.txt"],
      ["a\u007Fb\u0085c\u009F.md", "abc.md"],
      [`${ch(0x200e, 0x200f)}x${ch(0x202a, 0x202b, 0x202c, 0x202d)}.md`, "x.md"],
      [`${ch(0x2066)}a${ch(0x2067)}b${ch(0x2068)}c${ch(0x2069)}.md`, "abc.md"],
    ];
    for (const [raw, want] of cases) expect(displayName(raw)).toBe(want);
  });

  it("HUB-FR-44 · R03 · trim hai đầu \\s Unicode và `.` lặp; giữa tên giữ [H2c-R02]", () => {
    const cases: [string, string][] = [
      ["  .. a.md . ", "a.md"],
      [`${ch(0x3000)}a.md`, "a.md"],
      [".env.md", "env.md"],
      ["   ", "file"],
      ["...", "file"],
      ["", "file"],
      ["a  b.md", "a  b.md"],
    ];
    for (const [raw, want] of cases) expect(displayName(raw)).toBe(want);
  });

  it("HUB-FR-44 · R04 · > 200 đơn vị UTF-16: giữ đuôi, cắt thân theo code point (PL12) [H2c-R02]", () => {
    const long = displayName(`${"a".repeat(300)}.pdf`);
    expect(long).toBe(`${"a".repeat(196)}.pdf`);
    expect(long.length).toBe(200);
    const emoji = displayName(`${"😀".repeat(199)}.md`);
    expect(emoji).toBe(`${"😀".repeat(98)}.md`);
    expect(emoji.length).toBe(199);
    expect(displayName("a".repeat(300))).toBe("a".repeat(200));
    const noExt = displayName("😀".repeat(150));
    expect(noExt).toBe("😀".repeat(100));
    for (const v of [long, emoji, noExt])
      expect(AttachmentSchema.shape.filename.safeParse(v).success).toBe(true);
  });
});

describe("HUB-FR-44 · splitExt, extOf, mimeOf [R05, R06]", () => {
  it("HUB-FR-44 · R05 · splitExt: `.` cuối > 0, 1–10 chữ/số Unicode, giữ hoa [H2c-R02]", () => {
    const cases: [string, { stem: string; ext: string | null }][] = [
      ["a.pdf", { stem: "a", ext: "pdf" }],
      ["a.PDF", { stem: "a", ext: "PDF" }],
      [".env", { stem: ".env", ext: null }],
      ["a.", { stem: "a.", ext: null }],
      ["a.tar.gz", { stem: "a.tar", ext: "gz" }],
      ["a.abcdefghij", { stem: "a", ext: "abcdefghij" }],
      ["a.abcdefghijk", { stem: "a.abcdefghijk", ext: null }],
      ["a.p-f", { stem: "a.p-f", ext: null }],
      ["a.đ", { stem: "a", ext: "đ" }],
      ["noext", { stem: "noext", ext: null }],
    ];
    for (const [name, want] of cases) expect(splitExt(name)).toEqual(want);
  });

  it("HUB-FR-44 · R06 · extOf không phân biệt hoa ∈ ATTACH_ALLOWED; mimeOf = bảng [H2c-R03 · HUB-H2c-AC-03]", () => {
    expect(extOf("x.PDF")).toBe("pdf");
    expect(extOf("x.JPG")).toBe("jpg");
    expect(extOf("x.jpeg")).toBe("jpeg");
    for (const bad of ["x.exe", "x.html", "x.svg", "x", "x.pdf.exe", ".pdf"])
      expect(extOf(bad)).toBeNull();
    expect(EXTS).toHaveLength(14);
    for (const ext of EXTS) {
      expect(extOf(`file.${ext}`)).toBe(ext);
      expect(mimeOf(ext)).toBe(ATTACH_ALLOWED[ext]);
    }
    expect(mimeOf("jpg")).toBe("image/jpeg");
    expect(mimeOf("jpeg")).toBe("image/jpeg");
  });
});

describe("HUB-FR-44 · WRK-BR-07 · safeName [R07, R08]", () => {
  it("WRK-BR-07 · R07 · bảng AC-04 safeName(displayName(x)) [H2c-R02 · HUB-H2c-AC-04]", () => {
    const table: [string, string, string][] = [
      ["../../etc/passwd.txt", "passwd.txt", "passwd.txt"],
      ["a\\b.txt", "b.txt", "b.txt"],
      [`${RLO}gnp.exe.txt`, "gnp.exe.txt", "gnp.exe.txt"],
      ["CON.txt", "CON.txt", "CON_.txt"],
      [".env.md", "env.md", "env.md"],
      ["-x.md", "-x.md", "_-x.md"],
      ["Hoá đơn tháng 9.pdf", "Hoá đơn tháng 9.pdf", "Hoá đơn tháng 9.pdf"],
      ["a<b>|c.csv", "a<b>|c.csv", "a_b_c.csv"],
      ["   ", "file", "file"],
    ];
    for (const [raw, disp, safe] of table) {
      expect(displayName(raw)).toBe(disp);
      expect(safeName(displayName(raw))).toBe(safe);
    }
    const long = safeName(displayName(`${"a".repeat(300)}.pdf`));
    expect(utf8Bytes(long)).toBeLessThanOrEqual(120);
    expect(long).toBe(`${"a".repeat(116)}.pdf`);
  });

  it("WRK-BR-07 · R08 · tên thiết bị Windows, gộp `_`, ≤ 120 byte không cắt giữa code point [H2c-R02]", () => {
    const cases: [string, string][] = [
      ["con.md", "con_.md"],
      ["Com1.txt", "Com1_.txt"],
      ["LPT9.csv", "LPT9_.csv"],
      ["nul", "nul_"],
      ["PRN.pdf", "PRN_.pdf"],
      ["aux.json", "aux_.json"],
      ["COM10.txt", "COM10.txt"],
      ["CONX.txt", "CONX.txt"],
      ["a__b.md", "a_b.md"],
      ["a$$b.md", "a_b.md"],
      ["", "file"],
    ];
    for (const [raw, want] of cases) expect(safeName(raw)).toBe(want);
    const viet = safeName(`${"ạ".repeat(60)}.md`); // 183 byte
    expect(utf8Bytes(viet)).toBeLessThanOrEqual(120);
    expect(viet).toBe(`${"ạ".repeat(39)}.md`);
  });
});

describe("HUB-FR-44 · contentDisposition, difyFileType [R09, R10]", () => {
  it('HUB-FR-44 · R09 · filename ASCII (NFKD bỏ dấu, ngoài ASCII/"/\\ → _) + filename* RFC 5987 [H2c-R13 · HUB-H2c-AC-04]', () => {
    expect(contentDisposition("report.pdf")).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
    expect(contentDisposition("Hoá đơn.pdf")).toBe(
      `attachment; filename="Hoa _on.pdf"; filename*=UTF-8''Ho%C3%A1%20%C4%91%C6%A1n.pdf`,
    );
    expect(contentDisposition('a"b\\c.txt')).toContain('filename="a_b_c.txt"');
    const star = contentDisposition("it's (1)*.md").split("filename*=UTF-8''")[1] ?? "";
    expect(star).toBe("it%27s%20%281%29%2A.md");
    const crlf = contentDisposition("a\r\nb.txt");
    expect(crlf).not.toContain("\r");
    expect(crlf).not.toContain("\n");
  });

  it("HUB-FR-44 · R10 · image/* → image; còn lại → document [H2c-R22]", () => {
    for (const m of ["image/png", "image/jpeg", "image/gif", "image/webp"] as const)
      expect(difyFileType(m)).toBe("image");
    for (const ext of EXTS) {
      const mime = ATTACH_ALLOWED[ext];
      if (!mime.startsWith("image/")) expect(difyFileType(mime)).toBe("document");
    }
  });
});
