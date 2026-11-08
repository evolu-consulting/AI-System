import { describe, expect, test } from "bun:test";
import { onlyLockConflicts, parseLines, postRebaseGates, relockAfterRebase } from "./slice-rebase";

describe("slice-rebase · cổng sau rebase (check:boundaries)", () => {
  test("mặc định chạy check:boundaries rồi check:modules, xanh thì ok", () => {
    const seen: string[][] = [];
    const r = postRebaseGates((cmd) => {
      seen.push(cmd);
      return { ok: true, out: "" };
    });
    expect(r).toEqual({ ok: true });
    expect(seen.map((c) => c.join(" "))).toEqual([
      "bun tools/scripts/src/check-boundaries.ts",
      "bun tools/scripts/src/check-modules.ts",
      "bun tools/scripts/src/check-date-input.ts",
      "bun tools/scripts/src/check-i18n-terms.ts",
      "bun tools/scripts/src/check-settings-path.ts",
      "bun tools/scripts/src/check-shared-limits.ts",
      "bun tools/scripts/src/check-toast.ts",
      "bun tools/scripts/src/check-error-codes.ts",
      "bun tools/scripts/src/depcruise.ts --affected",
    ]);
  });

  test("vi phạm MỚI ⇒ dừng ở cổng đỏ, trả tên cổng + file vi phạm (đuôi ≤ 40 dòng), không chạy cổng sau", () => {
    const out = `${Array.from({ length: 60 }, (_, i) => `dòng ${i}`).join("\n")}\n  cross-module-deep: apps/hub-api/src/modules/a/x.ts → apps/hub-api/src/modules/b/y.ts`;
    let ran = 0;
    const r = postRebaseGates(() => {
      ran++;
      return { ok: false, out };
    }, [
      { name: "check:boundaries", cmd: ["x"] },
      { name: "khác", cmd: ["y"] },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.gate).toBe("check:boundaries");
      expect(r.out).toContain("modules/a/x.ts");
      expect(r.out.split("\n").length).toBe(40);
    }
    expect(ran).toBe(1);
  });
});

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
