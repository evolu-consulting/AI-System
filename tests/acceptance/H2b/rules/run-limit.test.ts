// HUB-FR-94 · HUB-H2b-AC-03 · H2b-R16 · overLimit, parseMaxConcurrentRuns (test-plan H2b §4 R36, cases §1.9;
// chữ ký plan-rules).
import { describe, expect, it } from "bun:test";
import {
  overLimit,
  parseMaxConcurrentRuns,
} from "../../../../apps/hub-api/src/modules/runs/run-limit.rules";

describe("HUB-FR-94 · giới hạn run đang chạy [R36]", () => {
  it("HUB-FR-94 · R36 · overLimit khi running ≥ limit [H2b-R16]", () => {
    expect(overLimit(1, 2)).toBe(false);
    expect(overLimit(2, 2)).toBe(true);
    expect(overLimit(3, 2)).toBe(true);
    expect(overLimit(0, 1)).toBe(false);
  });

  it("HUB-FR-94 · R36 · parseMaxConcurrentRuns: vắng → 2; nguyên 1–20; khác → ném [H2b-R16]", () => {
    expect(parseMaxConcurrentRuns(undefined)).toBe(2);
    expect(parseMaxConcurrentRuns("1")).toBe(1);
    expect(parseMaxConcurrentRuns("20")).toBe(20);
    for (const bad of ["0", "21", "2.5", "abc", "-1"]) {
      expect(() => parseMaxConcurrentRuns(bad), bad).toThrow();
    }
  });
});
