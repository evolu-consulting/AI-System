// gap-a2 #3 · định vị + tô sáng trích dẫn trong văn bản gốc.
import { describe, expect, test } from "bun:test";
import { locateQuote, splitHighlight } from "./quote";

const TEXT =
  "# Điều 1. Đối tượng\n\nBên A bán cho **Bên B** lô hàng\ntrị giá 120.000.000 đồng.\n\n## Điều 2. Thanh toán\nThanh toán trong vòng 30 ngày kể từ ngày giao hàng.";

describe("gap-a2 · locateQuote / splitHighlight", () => {
  test("khớp đúng; khác hoa/thường, xuống dòng, dấu Markdown, ngoặc kép bao quanh", () => {
    const r = locateQuote(TEXT, "“bên a bán cho bên b lô hàng trị giá 120.000.000 đồng”");
    expect(r && TEXT.slice(r.start, r.end)).toBe(
      "Bên A bán cho **Bên B** lô hàng\ntrị giá 120.000.000 đồng",
    );
  });

  test("có '…' giữa câu ⇒ dùng mảnh dài nhất; không thấy / rỗng ⇒ null", () => {
    const r = locateQuote(TEXT, "Thanh toán … 30 ngày kể từ ngày giao hàng");
    expect(r && TEXT.slice(r.start, r.end)).toBe("30 ngày kể từ ngày giao hàng");
    expect(locateQuote(TEXT, "điều khoản bảo hành 24 tháng")).toBeNull();
    expect(locateQuote(TEXT, "  ")).toBeNull();
    expect(locateQuote("", "abc")).toBeNull();
  });

  test("splitHighlight cắt 3 đoạn; không vùng ⇒ nguyên văn ở before", () => {
    expect(splitHighlight("abcdef", { start: 2, end: 4 })).toEqual({
      before: "ab",
      hit: "cd",
      after: "ef",
    });
    expect(splitHighlight("abc", null)).toEqual({ before: "abc", hit: "", after: "" });
  });
});
