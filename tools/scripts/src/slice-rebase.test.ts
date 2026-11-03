import { describe, expect, test } from "bun:test";
import { onlyLockConflicts, parseLines, relockAfterRebase } from "./slice-rebase";

describe("slice-rebase (phần thuần)", () => {
  test("onlyLockConflicts: chỉ tests/.lock ⇒ true; lẫn file khác hoặc rỗng ⇒ false", () => {
    expect(onlyLockConflicts(["tests/.lock"])).toBe(true);
    expect(onlyLockConflicts(["tests/.lock", "packages/i18n/locales/vi.json"])).toBe(false);
    expect(onlyLockConflicts([])).toBe(false);
  });

  test("parseLines: bỏ dòng trống, đổi \\ thành /", () => {
    expect(parseLines("tests\\.lock\r\n\n a.ts \n")).toEqual(["tests/.lock", "a.ts"]);
  });

  test("relockAfterRebase: lock không đổi ⇒ không commit; đổi ⇒ add + commit; relock lỗi ⇒ báo lỗi", () => {
    const calls: string[][] = [];
    const mk =
      (porcelain: string) =>
      (...a: string[]) => {
        calls.push(a);
        return { ok: true, out: a[0] === "status" ? porcelain : "" };
      };
    expect(relockAfterRebase(mk(""), () => true)).toEqual({ committed: false });
    expect(calls.some((c) => c[0] === "commit")).toBe(false);
    expect(relockAfterRebase(mk(" M tests/.lock"), () => true)).toEqual({ committed: true });
    expect(calls.some((c) => c[0] === "commit")).toBe(true);
    expect(relockAfterRebase(mk(""), () => false).error).toBeDefined();
  });
});
