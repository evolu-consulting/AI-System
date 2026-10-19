// N4-FR-02 · N4-FR-03 · luật thuần: bỏ dấu, tách term câu hỏi, chia đoạn (port mgmt-app chunk.py / contracts/chunk.py).
import { describe, expect, it } from "bun:test";
import {
  boundary,
  chunkContract,
  chunkDocument,
  chunkMarkdown,
  MAX_CHARS,
  splitChars,
} from "./chunk.rules";
import { codeAliases, foldVi, queryTerms, tokenize } from "./text.rules";

describe("N4-FR-03 · text.rules", () => {
  it("foldVi bỏ dấu, đ → d, chữ thường", () => {
    expect(foldVi("Thời hạn THANH TOÁN Đông Á ưu đãi")).toBe("thoi han thanh toan dong a uu dai");
  });
  it("tokenize giữ mã có / - . : và bỏ dấu câu bao quanh", () => {
    expect(tokenize("Hợp đồng 01/2026/HĐMB-PN (số 149.202.83.5:9443)?")).toEqual([
      "hop",
      "dong",
      "01/2026/hdmb-pn",
      "so",
      "149.202.83.5:9443",
    ]);
  });
  it("queryTerms bỏ từ dừng, (bật) thêm bigram không chứa từ dừng, không trùng; mặc định không bigram", () => {
    expect(queryTerms("thanh toán ngay").map((x) => x.term)).toEqual(["thanh", "toan", "ngay"]);
    const t = queryTerms("Thời hạn thanh toán của hợp đồng là bao nhiêu ngày?", { bigrams: true });
    expect(t.map((x) => x.term)).toEqual([
      "thoi",
      "han",
      "thanh",
      "toan",
      "hop",
      "dong",
      "ngay",
      "thoi han",
      "han thanh",
      "thanh toan",
      "hop dong",
    ]);
    expect(t.find((x) => x.term === "thanh toan")?.w).toBe(1.5);
    expect(queryTerms("là gì?", {})).toEqual([]);
    expect(queryTerms("a b c d", { bigrams: false, maxTerms: 2 }).length).toBeLessThanOrEqual(2);
  });
  it("codeAliases tách đuôi mã sau /", () => {
    expect(codeAliases("Số: 01/2026/HĐMB-PN")).toEqual(["hdmb-pn hdmb pn"]);
    expect(codeAliases("không có mã")).toEqual([]);
  });
});

describe("N4-FR-02 · chunk.rules", () => {
  it("boundary nhận Điều N / Phụ lục N, bỏ câu thân bài nhắc Điều", () => {
    expect(boundary("**Điều 6. Phạt vi phạm**")).toEqual(["6", "Phạt vi phạm"]);
    expect(boundary("PHỤ LỤC 01 Bảng giá")).toEqual(["PL01", "Bảng giá"]);
    expect(boundary("Điều 5 nêu rằng bên mua phải trả")).toBeNull();
    expect(boundary(`Điều 1. ${"x".repeat(130)}`)).toBeNull();
  });
  it("chunkContract: một đoạn mỗi điều + Mở đầu, nhãn 'Điều N. …'", () => {
    const md = "# HĐ\nSố: 01\n**Điều 1. Hàng**\nThùng 8.500\n**Điều 2. Thời hạn**\nĐến 31/12/2026";
    const c = chunkContract(md);
    expect(c.map((x) => x.clauseNo)).toEqual(["0", "1", "2"]);
    expect(c[1]?.body).toBe("Điều 1. Hàng\nThùng 8.500");
    expect(c[2]?.heading).toBe("Thời hạn");
  });
  it("chunkContract không có Điều ⇒ chia Markdown", () => {
    expect(chunkContract("# A\nmột\n## B\nhai").length).toBe(1);
  });
  it("chunkMarkdown gộp mục ngắn, tách mục dài ≤ MAX_CHARS có chồng lấn", () => {
    const long = `# T\n${"chữ ".repeat(1200)}`;
    const parts = chunkMarkdown(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= MAX_CHARS)).toBe(true);
    expect(splitChars("", "abc")).toEqual(["abc"]);
  });
  it("chunkDocument gắn ngữ cảnh tài liệu (tiêu đề + Số + các bên + mã) vào mọi đoạn", () => {
    const md =
      "# HỢP ĐỒNG\nSố: 01/2026/HĐMB-PN\n**BÊN BÁN (Bên B): Phương Nam**\n**Điều 5. Bảo hành**\nĐổi 30 ngày";
    const c = chunkDocument("HĐ Phương Nam", md, "contract");
    expect(c.every((x) => x.context.includes("Số: 01/2026/HĐMB-PN"))).toBe(true);
    expect(c[0]?.context).toContain("BÊN BÁN (Bên B): Phương Nam");
    expect(c[0]?.context).toContain("hdmb-pn hdmb pn");
  });
});
