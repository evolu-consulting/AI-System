import { describe, expect, test } from "bun:test";
import { friendlyNumber, ifSentence, type SentenceWords } from "./if-sentence";

const words: SentenceWords = {
  if: "Nếu",
  and: "và",
  or: "hoặc",
  goTo: "đi tới",
  otherwise: "ngược lại",
  nextStep: "Bước tiếp theo",
  blank: "…",
  million: "triệu",
  billion: "tỷ",
  ops: { eq: "bằng", gt: "lớn hơn", lt: "nhỏ hơn" },
};
const cond = (op: string, value: string, from = "fact|value") => ({
  from,
  op,
  value,
  type: "number",
});

describe("CR-123 FR-13 · If đọc thành câu", () => {
  test("ví dụ chuẩn: giá trị lớn hơn 100 triệu", () => {
    const s = ifSentence({
      join: "and",
      conds: [cond("gt", "100000000")],
      fromLabel: () => "Giá trị hợp đồng",
      yes: "Bước 3 · Giám đốc duyệt",
      no: null,
      words,
    });
    expect(s).toBe(
      "Nếu Giá trị hợp đồng lớn hơn 100 triệu → đi tới Bước 3 · Giám đốc duyệt, ngược lại → đi tới Bước tiếp theo",
    );
  });
  test("nhiều điều kiện nối bằng và/hoặc; nhánh chưa chọn hiện …", () => {
    const base = {
      conds: [cond("gt", "1000000"), cond("eq", "5", "fact|n")],
      fromLabel: (c: { from: string }) => (c.from === "fact|n" ? "Số lần" : "Giá trị"),
      yes: null,
      no: "Bước 4 · Kết thúc",
      words,
    };
    expect(ifSentence({ ...base, join: "or" })).toBe(
      "Nếu Giá trị lớn hơn 1 triệu hoặc Số lần bằng 5 → đi tới …, ngược lại → đi tới Bước 4 · Kết thúc",
    );
    expect(ifSentence({ ...base, join: "and" })?.includes(" và ")).toBe(true);
  });
  test("chưa chọn nguồn nào ⇒ chưa có câu", () => {
    expect(
      ifSentence({
        join: "and",
        conds: [cond("gt", "1", "")],
        fromLabel: () => "",
        yes: null,
        no: null,
        words,
      }),
    ).toBeNull();
  });
  test("friendlyNumber: triệu/tỷ, số lẻ giữ nguyên", () => {
    expect(friendlyNumber("100000000", words)).toBe("100 triệu");
    expect(friendlyNumber("2500000000", words)).toBe("2,5 tỷ");
    expect(friendlyNumber("1234567", words)).toBe("1234567");
    expect(friendlyNumber("abc", words)).toBe("abc");
  });
});
