// CR-122 · p22 · nhãn "Bước N · tên" của các ô chọn bước.
import { describe, expect, test } from "bun:test";
import { stepNames, stepOptionLabel } from "./step-options";

const fmt = (n: number, names: string) => (names ? `Bước ${n} · ${names}` : `Bước ${n}`);
const all = [
  { step: 0, name: "Soạn" },
  { step: 1, name: "Duyệt A" },
  { step: 1, name: " Duyệt B " },
  { step: 2, name: "  " },
];

describe("stepOptionLabel", () => {
  test("một giai đoạn ⇒ Bước N · tên", () =>
    expect(stepOptionLabel(all, 0, fmt)).toBe("Bước 1 · Soạn"));
  test("nhiều giai đoạn ⇒ nối bằng ' / '", () =>
    expect(stepOptionLabel(all, 1, fmt)).toBe("Bước 2 · Duyệt A / Duyệt B"));
  test("chưa đặt tên ⇒ chỉ Bước N", () => expect(stepOptionLabel(all, 2, fmt)).toBe("Bước 3"));
  test("stepNames bỏ tên trống", () => expect(stepNames(all, 2)).toBe(""));
});
