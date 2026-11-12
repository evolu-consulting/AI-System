import { describe, expect, test } from "bun:test";
import { previewLines, stepText } from "./submit-preview";

const h = (n: number) => `${n} giờ`;
describe("M4 · xem trước đường đi", () => {
  test("bước có hạn + người; bỏ phần trống", () => {
    expect(
      stepText({ kind: "review", label: "Duyệt", who_label: "Phòng Pháp chế", due_h: 48 }, h),
    ).toBe("Duyệt · Phòng Pháp chế · 48 giờ");
    expect(stepText({ kind: "esign", label: "Ký số", who_label: "" }, h)).toBe("Ký số");
  });
  test("đánh số từ 1; block no_flow / không bước ⇒ rỗng", () => {
    const steps = [
      { kind: "review" as const, label: "Duyệt", who_label: "A" },
      { kind: "esign" as const, label: "Ký số", who_label: "Các bên ký" },
    ];
    expect(previewLines({ flow_name: "Q", steps }, h).map((l) => l.n)).toEqual([1, 2]);
    expect(previewLines({ flow_name: null, steps: [], block: "no_flow" }, h)).toEqual([]);
    expect(previewLines({ flow_name: "Q", steps: [] }, h)).toEqual([]);
    expect(previewLines(undefined, h)).toEqual([]);
  });
});
