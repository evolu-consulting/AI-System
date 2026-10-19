// PK-FR-07 · unit cho phần luật DOCX ngoài test qc: tỉ lệ nén, tiêu đề, danh sách, bảng, đậm, cắt Markdown.
import { describe, expect, it } from "bun:test";
import {
  canQueueDocx,
  checkZipEntries,
  DOCX_MAX_MD,
  type DocxPara,
  emptyNumbering,
  headingLevel,
  inlineText,
  listMarker,
  renderMarkdown,
  tableMarkdown,
} from "./docx.rules";

const MiB = 1024 * 1024;
const para = (text: string, extra: Partial<DocxPara> = {}): DocxPara => ({
  kind: "p",
  runs: [{ text, bold: false }],
  ilvl: 0,
  ...extra,
});

describe("PK-FR-07 · docx.rules", () => {
  it("tỉ lệ nén > 500:1 ở phần ≥ 1 MiB ⇒ TOO_LARGE; phần nhỏ thì bỏ qua tỉ lệ", () => {
    expect(checkZipEntries([{ name: "a", originalSize: 10 * MiB, size: 10 * 1024 }])).toBe(
      "TOO_LARGE",
    );
    expect(checkZipEntries([{ name: "a", originalSize: 10 * MiB, size: 100 * 1024 }])).toBe("ok");
    expect(checkZipEntries([{ name: "a", originalSize: 500_000, size: 1 }])).toBe("ok");
  });
  it("tiêu đề: outlineLvl đoạn, style theo basedOn, tên 'heading N', styleId không có trong styles", () => {
    const styles = new Map([
      ["H2", { name: "heading 2" }],
      ["Mine", { basedOn: "Out" }],
      ["Out", { outline: 2 }],
    ]);
    expect(headingLevel(para("x", { outline: 0 }), styles)).toBe(1);
    expect(headingLevel(para("x", { styleId: "H2" }), styles)).toBe(2);
    expect(headingLevel(para("x", { styleId: "Mine" }), styles)).toBe(3);
    expect(headingLevel(para("x", { styleId: "Heading4" }), new Map())).toBe(4);
    expect(headingLevel(para("x", { styleId: "Normal" }), new Map())).toBe(0);
  });
  it("danh sách: bullet / đánh số / thụt theo ilvl; numId 0 không phải danh sách", () => {
    const n = emptyNumbering();
    n.nums.set("1", "0");
    n.formats.set("0", new Map([[0, "decimal"]]));
    expect(listMarker(para("x", { numId: "1" }), n)).toBe("1. ");
    expect(listMarker(para("x", { numId: "9", ilvl: 1 }), n)).toBe("  - ");
    expect(listMarker(para("x", { numId: "0" }), n)).toBeNull();
  });
  it("đậm: khoảng trắng ra ngoài dấu; bảng: escape '|', bù cột thiếu", () => {
    expect(
      inlineText([
        { text: "Giá ", bold: false },
        { text: " 10 đ ", bold: true },
        { text: "/kg", bold: false },
      ]),
    ).toBe("Giá  **10 đ** /kg");
    expect(tableMarkdown([["a|b", "c"], ["d"]])).toBe("| a\\|b | c |\n| --- | --- |\n| d |  |");
  });
  it("Markdown vượt DOCX_MAX_MD ⇒ cắt ở ranh giới khối + cảnh báo truncated", () => {
    const big = "x".repeat(DOCX_MAX_MD / 2);
    const r = renderMarkdown([para(big), para(big), para(big)], new Map(), emptyNumbering());
    expect(r.markdown.length).toBeLessThanOrEqual(DOCX_MAX_MD);
    expect(r.warnings).toEqual(["truncated"]);
  });
});

describe("PK-FR-07 · review m-03 · canQueueDocx (hàng đợi công bằng theo tenant)", () => {
  it("tổng đạt maxPending ⇒ từ chối; tenant đã có việc đang chờ ⇒ từ chối; tenant khác / vắng tenant ⇒ nhận", () => {
    const s = { total: 1, waitingTenants: ["a"] };
    expect(canQueueDocx({ total: 2, waitingTenants: [] }, 2, "x")).toBe(false);
    expect(canQueueDocx(s, 3, "a")).toBe(false);
    expect(canQueueDocx(s, 3, "b")).toBe(true);
    expect(canQueueDocx(s, 3)).toBe(true);
  });
});
