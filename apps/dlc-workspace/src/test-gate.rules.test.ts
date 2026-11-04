import { describe, expect, test } from "bun:test";
import { baselineUsable, gateOk, testCounts } from "./test-gate.rules";

describe("dlc-dify · cổng test khi merge", () => {
  test("đếm Jest (bỏ dòng Test Suites, bỏ mã màu)", () => {
    const out =
      "Test Suites: 6 failed, 2 passed, 8 total\n\x1b[1mTests:\x1b[22m       33 failed, 9 passed, 42 total\n";
    expect(testCounts(out)).toEqual({ passed: 9, failed: 33 });
  });
  test("đếm node:test và pytest", () => {
    expect(testCounts("# tests 4\n# pass 3\n# fail 1\n")).toEqual({ passed: 3, failed: 1 });
    expect(testCounts("....\n===== 2 failed, 40 passed in 1.2s =====\n")).toEqual({
      passed: 40,
      failed: 2,
    });
    expect(testCounts("Tests: 5 passed, 5 total")).toEqual({ passed: 5, failed: 0 });
    expect(testCounts("npm ERR! missing script: test")).toBeNull();
  });
  test("đếm Python unittest (skipped không tính đạt)", () => {
    const red =
      "test_a (t.T.test_a) ... FAIL\n----------------------------------------------------------------------\nRan 57 tests in 0.412s\n\nFAILED (failures=40, errors=12, skipped=1)\n";
    expect(testCounts(red)).toEqual({ passed: 4, failed: 52 });
    expect(testCounts("Ran 57 tests in 0.2s\n\nOK\n")).toEqual({ passed: 57, failed: 0 });
    expect(testCounts("Ran 5 tests in 0.0s\n\nOK (skipped=2)\n")).toEqual({ passed: 3, failed: 0 });
    expect(testCounts("Ran 0 tests in 0.000s\n\nNO TESTS RAN\n")).toBeNull();
  });
  test("mốc cache: đỏ không số liệu ⇒ chạy lại; khác sha ⇒ chạy lại", () => {
    expect(baselineUsable({ sha: "a", exit: 1, counts: null }, "a")).toBe(false);
    expect(baselineUsable({ sha: "a", exit: 0, counts: null }, "a")).toBe(true);
    expect(baselineUsable({ sha: "a", exit: 1, counts: { passed: 1, failed: 55 } }, "a")).toBe(
      true,
    );
    expect(baselineUsable({ sha: "a", exit: 1, counts: { passed: 1, failed: 55 } }, "b")).toBe(
      false,
    );
    expect(baselineUsable(undefined, "a")).toBe(false);
  });
  test("thoát 0 ⇒ đạt; không thụt lùi ⇒ đạt; thụt lùi / không đọc được ⇒ không đạt", () => {
    const base = { exit: 1, counts: { passed: 9, failed: 33 } };
    expect(gateOk(null, { exit: 0, counts: null })).toBe(true);
    expect(gateOk(base, { exit: 1, counts: { passed: 15, failed: 27 } })).toBe(true);
    expect(gateOk(base, { exit: 1, counts: { passed: 9, failed: 33 } })).toBe(true);
    expect(gateOk(base, { exit: 1, counts: { passed: 8, failed: 33 } })).toBe(false);
    expect(gateOk(base, { exit: 1, counts: { passed: 12, failed: 34 } })).toBe(false);
    expect(gateOk(base, { exit: 1, counts: null })).toBe(false);
    expect(gateOk(null, { exit: 1, counts: { passed: 9, failed: 1 } })).toBe(false);
  });
});
