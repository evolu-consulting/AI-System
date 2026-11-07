// arch-a1 · tóm tắt ngắn của `depcruise --affected`: đếm mới/cảnh báo/đã biết + vài vi phạm đầu.
import { describe, expect, it } from "bun:test";
import { summarizeCruise } from "./depcruise";

const v = (name: string, severity: string, n = 1) => ({
  rule: { name, severity },
  from: `a${n}.ts`,
  to: `b${n}.ts`,
});

describe("summarizeCruise", () => {
  it("chỉ đếm severity error là MỚI; ignore = đã biết", () => {
    const s = summarizeCruise({
      summary: {
        totalCruised: 7,
        violations: [v("r1", "error"), v("r2", "warn"), v("r3", "ignore"), v("r3", "ignore", 2)],
      },
    });
    expect(s.errors).toBe(1);
    expect(s.text).toContain("7 module quét · 1 MỚI · 1 cảnh báo · 2 đã biết");
    expect(s.text).toContain("r1: a1.ts -> b1.ts");
    expect(s.text).not.toContain("r2: ");
  });

  it("sạch ⇒ một dòng; nhiều lỗi ⇒ cắt ở 10", () => {
    expect(
      summarizeCruise({ summary: { totalCruised: 1, violations: [] } }).text.split("\n"),
    ).toHaveLength(1);
    const many = Array.from({ length: 13 }, (_, i) => v("r", "error", i));
    const s = summarizeCruise({ summary: { totalCruised: 1, violations: many } });
    expect(s.errors).toBe(13);
    expect(s.text).toContain("+3 vi phạm nữa");
  });
});
