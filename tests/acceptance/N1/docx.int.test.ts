// PK-FR-07 · PK-AC08 · plan §7 · ADR-0024: DOCX → Markdown (tiêu đề, danh sách, bảng); PDF/ảnh không chuyển; file hỏng / mã hoá /
// macro / zip bomb ⇒ `{ok:false, code:'DOCX_UNREADABLE'}` KHÔNG ném. PHỤ THUỘC ADR-0024 Accepted (Gate Q3/D-10): chưa duyệt ⇒
// đỏ NGAY ở `needAdr0024Accepted` (qc đếm riêng). Không DB. File mẫu thật: reference/mgmt-app-contracts/samples.
import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadDocxAdapter, needAdr0024Accepted, ROOT } from "./_support/load";
import { buildZip, minimalDocx, u8 } from "./_support/zip";

type Conv = {
  toMarkdown(
    b: Uint8Array,
  ): Promise<{ ok: boolean; markdown?: string; warnings?: string[]; code?: string }>;
  close?: () => Promise<void> | void;
};
let conv: Conv | undefined;
async function converter(): Promise<Conv> {
  needAdr0024Accepted();
  const m = await loadDocxAdapter();
  conv ??= m.createDocxConverter() as Conv;
  return conv;
}
afterAll(async () => {
  await conv?.close?.();
});
const SAMPLE = join(ROOT, "reference/mgmt-app-contracts/samples/HD-bao-bi-Minh-Phat.docx");
const MiB = 1024 * 1024;

describe("PK-AC08 · DOCX hợp lệ ⇒ Markdown", () => {
  it("PK-AC08 · file mẫu HD-bao-bi-Minh-Phat.docx ⇒ ok, có dòng tiêu đề 'Điều 1…4' và ≥ 2 bảng (hàng hoá…)", async () => {
    const c = await converter();
    expect(existsSync(SAMPLE)).toBe(true);
    const r = await c.toMarkdown(new Uint8Array(readFileSync(SAMPLE)));
    expect(r.ok).toBe(true);
    const md = r.markdown ?? "";
    for (const n of [1, 2, 3, 4])
      expect(md).toMatch(new RegExp(`^(#{1,6}\\s+|\\*\\*)?Điều\\s+${n}\\.`, "m"));
    expect((md.match(/^\|[\s:|-]*---[\s:|-]*\|?\s*$/gm) ?? []).length).toBeGreaterThanOrEqual(2); // dòng phân cách bảng GFM
    expect(md.length).toBeGreaterThan(1000);
  });
  it("PK-FR-07 · DOCX tối thiểu: tiêu đề Heading1 ⇒ '# …', danh sách ⇒ '- …', bảng ⇒ GFM có dòng phân cách", async () => {
    const c = await converter();
    const r = await c.toMarkdown(minimalDocx());
    expect(r.ok).toBe(true);
    const md = r.markdown ?? "";
    expect(md).toMatch(/^#{1,6} Điều 1\. Hàng hoá$/m);
    expect(md).toMatch(/^[-*] Giao hàng đúng hạn$/m);
    expect(md).toMatch(/^\| Tên hàng \| Số lượng \|$/m);
    expect(md).toMatch(/^\| -{3,} \| -{3,} \|$/m);
    expect(md).toMatch(/^\| Thùng carton \| 1000 \|$/m);
  });
  it("PK-FR-07 · đầu ra ≤ DOCX_MAX_MD (5.000.000) và warnings là mảng ≤ 50 mục", async () => {
    const c = await converter();
    const r = await c.toMarkdown(minimalDocx());
    expect((r.markdown ?? "").length).toBeLessThanOrEqual(5_000_000);
    expect(Array.isArray(r.warnings)).toBe(true);
    expect((r.warnings ?? []).length).toBeLessThanOrEqual(50);
  });
});

describe("PK-AC08 · DOCX hỏng / độc ⇒ DOCX_UNREADABLE, không 500", () => {
  const bad = async (bytes: Uint8Array) => {
    const c = await converter();
    let threw = false;
    let r: Awaited<ReturnType<Conv["toMarkdown"]>> = { ok: true };
    try {
      r = await c.toMarkdown(bytes);
    } catch {
      threw = true;
    }
    return { threw, ok: r.ok, code: r.code };
  };
  const UNREADABLE = { threw: false, ok: false, code: "DOCX_UNREADABLE" };
  it("PK-AC08 · byte rác / rỗng / không phải zip ⇒ DOCX_UNREADABLE", async () => {
    expect(await bad(new Uint8Array())).toEqual(UNREADABLE);
    expect(await bad(u8("không phải zip"))).toEqual(UNREADABLE);
    expect(await bad(new Uint8Array(readFileSync(SAMPLE)).slice(0, 5000))).toEqual(UNREADABLE); // cắt cụt
  });
  it("PK-AC08 · zip hợp lệ nhưng thiếu word/document.xml ⇒ DOCX_UNREADABLE", async () => {
    expect(await bad(buildZip([{ name: "a.txt", data: u8("x") }]))).toEqual(UNREADABLE);
  });
  it("PK-AC08 · XML hỏng trong document.xml ⇒ DOCX_UNREADABLE", async () => {
    expect(
      await bad(buildZip([{ name: "word/document.xml", data: u8("<w:document><w:body><w:p>") }])),
    ).toEqual(UNREADABLE);
  });
  it("PK-FR-07 · có macro (word/vbaProject.bin) ⇒ DOCX_UNREADABLE", async () => {
    expect(await bad(minimalDocx([{ name: "word/vbaProject.bin", data: u8("MZ") }]))).toEqual(
      UNREADABLE,
    );
  });
  it("PK-FR-07 · mã hoá (OLE2 'EncryptedPackage', không phải zip) ⇒ DOCX_UNREADABLE", async () => {
    const ole = new Uint8Array([
      0xd0,
      0xcf,
      0x11,
      0xe0,
      0xa1,
      0xb1,
      0x1a,
      0xe1,
      ...new Array(600).fill(0),
    ]);
    expect(await bad(ole)).toEqual(UNREADABLE);
  });
  it("PK-FR-07 · PDF / ảnh KHÔNG chuyển ⇒ DOCX_UNREADABLE (giữ file gốc cho agent)", async () => {
    expect(await bad(u8("%PDF-1.7\n1 0 obj\n"))).toEqual(UNREADABLE);
    expect(
      await bad(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])),
    ).toEqual(UNREADABLE);
  });
  it("PK-AC08 · > 2.000 phần zip ⇒ DOCX_UNREADABLE và CHẶN ≤ 1 s", async () => {
    const parts = Array.from({ length: 2001 }, (_, i) => ({
      name: `word/media/p${i}.xml`,
      data: new Uint8Array(),
      method: 0 as const,
    }));
    const bytes = minimalDocx(parts);
    const t0 = performance.now();
    const r = await bad(bytes);
    expect(r).toEqual(UNREADABLE);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
  it("PK-AC08 · zip bomb KHAI BÁO > 100 MiB (central directory) ⇒ DOCX_UNREADABLE ≤ 1 s, không giải nén", async () => {
    const bytes = buildZip([
      { name: "word/document.xml", data: u8("<w:document/>"), declaredSize: 200 * MiB },
    ]);
    const t0 = performance.now();
    const r = await bad(bytes);
    expect(r).toEqual(UNREADABLE);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
  it("PK-AC08 · zip bomb THẬT (150 MiB số 0 nén vài trăm KB, khai báo đúng) ⇒ DOCX_UNREADABLE ≤ 1 s", async () => {
    const zeros = new Uint8Array(150 * MiB);
    const bytes = buildZip([{ name: "word/document.xml", data: zeros }]);
    expect(bytes.length).toBeLessThan(1 * MiB);
    const t0 = performance.now();
    const r = await bad(bytes);
    expect(r).toEqual(UNREADABLE);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
  it("PK-FR-07 · XXE / billion laughs trong document.xml: không đọc file/mạng, ⇒ DOCX_UNREADABLE hoặc ok nhưng KHÔNG chứa nội dung file ngoài", async () => {
    const xml =
      '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>';
    const c = await converter();
    const r = await c.toMarkdown(buildZip([{ name: "word/document.xml", data: u8(xml) }]));
    expect((r.markdown ?? "").includes("root:")).toBe(false);
  });
});
