// CR-125 · x4 · câu mô tả của bước "Nếu" chỉ nêu TÊN bước đích ("đi tới Trưởng phòng duyệt"), không kèm "Bước N ·".
import { describe, expect, test } from "bun:test";
import { ifSentence, type SentenceWords } from "./if-sentence";
import { stepNames } from "./step-options";

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
  ops: { gt: "lớn hơn" },
};
const all = [
  { step: 0, name: "Giá trị trên 120 triệu?" },
  { step: 1, name: "Trưởng phòng duyệt" },
  { step: 2, name: "Giám đốc duyệt" },
  { step: 2, name: "Kế toán" },
  { step: 3, name: "  " },
];

describe("CR-125 x4 · câu của bước Nếu dùng tên bước", () => {
  test("đích = tên bước (nhiều giai đoạn nối ' / '), không có 'Bước N ·'", () => {
    const s = ifSentence({
      join: "and",
      conds: [{ from: "fact|v", op: "gt", value: "120000000", type: "number" }],
      fromLabel: () => "Giá trị hợp đồng",
      yes: stepNames(all, 1),
      no: stepNames(all, 2),
      words,
    });
    expect(s).toBe(
      "Nếu Giá trị hợp đồng lớn hơn 120 triệu → đi tới Trưởng phòng duyệt, ngược lại → đi tới Giám đốc duyệt / Kế toán",
    );
    expect(s?.includes("Bước 2")).toBe(false);
  });
  test("bước chưa đặt tên ⇒ tên rỗng (nơi gọi lùi về nhãn 'Bước N')", () => {
    expect(stepNames(all, 3)).toBe("");
  });
});
