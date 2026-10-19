// PK-FR-07 · ADR-0024: unit adapter DOCX ngoài test qc — khai báo kích thước NHỎ hơn thật (bom giấu), độ sâu XML, mc:Fallback,
// textbox, ô gộp, danh sách đánh số; converter worker: BUSY khi vượt maxPending, close().
import { describe, expect, it } from "bun:test";
import { zipSync } from "fflate";
import { DOCX_MAX_DEPTH, DOCX_MAX_INPUT } from "../../domain/docx.rules";
import { convertDocx } from "./convert";
import { createDocxConverter } from "./index";

const enc = new TextEncoder();
const W = 'xmlns:w="w" xmlns:mc="mc"';
const doc = (body: string, extra: Record<string, string> = {}) =>
  zipSync({
    "word/document.xml": enc.encode(`<w:document ${W}><w:body>${body}</w:body></w:document>`),
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, enc.encode(v)])),
  });
const p = (t: string, pPr = "") => `<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
const md = (bytes: Uint8Array) => {
  const r = convertDocx(bytes);
  return r.ok ? r : { markdown: `!${r.code}`, warnings: [] };
};

describe("PK-FR-07 · convertDocx", () => {
  it("kích thước giải nén thật > khai báo (central directory nói dối) ⇒ DOCX_UNREADABLE", () => {
    const z = doc(p("x".repeat(200_000)));
    const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
    for (let i = 0; i + 4 <= z.length; i++)
      if (dv.getUint32(i, true) === 0x02014b50) dv.setUint32(i + 24, 1000, true);
    expect(md(z).markdown).toBe("!DOCX_UNREADABLE");
  });
  it(`XML lồng sâu > ${DOCX_MAX_DEPTH} ⇒ DOCX_UNREADABLE`, () => {
    const deep = "<w:x>".repeat(DOCX_MAX_DEPTH) + "</w:x>".repeat(DOCX_MAX_DEPTH);
    expect(md(doc(deep)).markdown).toBe("!DOCX_UNREADABLE");
  });
  it("mc:Fallback bị bỏ (không lặp chữ); textbox gộp vào đoạn ngoài + cảnh báo", () => {
    const body =
      `<w:p><w:r><w:t>A</w:t></w:r><mc:AlternateContent><mc:Choice><w:p><w:r><w:t>B</w:t></w:r></w:p></mc:Choice>` +
      `<mc:Fallback><w:p><w:r><w:t>B</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent></w:p>`;
    const r = md(doc(body));
    expect(r.markdown).toBe("AB\n");
    expect(r.warnings).toEqual(["textbox"]);
  });
  it("ô gộp ngang ⇒ bù ô rỗng + cảnh báo merged_cells; danh sách đánh số ⇒ '1. '", () => {
    const tbl =
      "<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val='2'/></w:tcPr><w:p><w:r><w:t>H</w:t></w:r></w:p></w:tc></w:tr>" +
      "<w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>";
    const numbering = `<w:numbering ${W}><w:abstractNum w:abstractNumId="3"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="7"><w:abstractNumId w:val="3"/></w:num></w:numbering>`;
    const body = tbl + p("Một", '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr>');
    const r = md(doc(body, { "word/numbering.xml": numbering }));
    expect(r.markdown).toBe("| H |  |\n| --- | --- |\n| a | b |\n\n1. Một\n");
    expect(r.warnings).toEqual(["merged_cells"]);
  });
});

describe("PK-FR-07 · createDocxConverter", () => {
  it("vượt maxPending ⇒ DOCX_BUSY ngay; sau close() ⇒ DOCX_BUSY", async () => {
    const c = createDocxConverter({ maxPending: 1 });
    const bytes = doc(p("Xin chào"));
    const [a, b] = await Promise.all([c.toMarkdown(bytes), c.toMarkdown(bytes)]);
    expect(a).toEqual({ ok: true, markdown: "Xin chào\n", warnings: [] });
    expect(b).toEqual({ ok: false, code: "DOCX_BUSY" });
    expect(bytes.byteLength).toBeGreaterThan(0); // mảng của người gọi không bị chuyển quyền
    await c.close();
    expect(await c.toMarkdown(bytes)).toEqual({ ok: false, code: "DOCX_BUSY" });
  });
  it("review m-03 · đầu vào > DOCX_MAX_INPUT ⇒ DOCX_UNREADABLE ngay (không vào worker)", async () => {
    const c = createDocxConverter();
    const big = new Uint8Array(DOCX_MAX_INPUT + 1);
    expect(await c.toMarkdown(big)).toEqual({ ok: false, code: "DOCX_UNREADABLE" });
    await c.close();
  });
  it("review m-03 · tenant đã có việc đang chờ ⇒ DOCX_BUSY; tenant khác vẫn vào được", async () => {
    const c = createDocxConverter({ maxPending: 4 });
    const bytes = doc(p("x"));
    const t = (tenantId: string) => c.toMarkdown(bytes, { tenantId });
    const [a1, a2, a3, b1] = await Promise.all([t("a"), t("a"), t("a"), t("b")]);
    expect([a1.ok, a2.ok, b1.ok]).toEqual([true, true, true]); // a1 chạy, a2 chờ, b1 chờ
    expect(a3).toEqual({ ok: false, code: "DOCX_BUSY" });
    await c.close();
  });
});

describe("PK-FR-07 · review m-09 · zip có mục trùng tên", () => {
  it("hai `word/document.xml` ⇒ DOCX_UNREADABLE", () => {
    // Tên cùng độ dài rồi vá byte tên ⇒ zip hợp lệ có 2 mục trùng tên (fflate không cho khoá trùng).
    const z = zipSync({
      "word/document.xml": enc.encode(`<w:document ${W}><w:body>${p("A")}</w:body></w:document>`),
      "word/documenX.xml": enc.encode(`<w:document ${W}><w:body>${p("B")}</w:body></w:document>`),
    });
    const from = enc.encode("word/documenX.xml");
    const to = enc.encode("word/document.xml");
    for (let i = 0; i + from.length <= z.length; i++)
      if (from.every((b, k) => z[i + k] === b)) z.set(to, i);
    expect(md(z).markdown).toBe("!DOCX_UNREADABLE");
  });
});
