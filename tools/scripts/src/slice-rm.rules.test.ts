import { describe, expect, test } from "bun:test";
import { onlyStaleWarning } from "./baseline.rules";
import { failNote, isNotWorktreeError } from "./slice-rm.rules";

describe("slice:rm", () => {
  test("thư mục không còn là worktree thì bỏ qua lỗi và xoá thư mục", () => {
    expect(isNotWorktreeError("fatal: 'F:/x' is not a working tree")).toBe(true);
    expect(isNotWorktreeError("fatal: contains modified files")).toBe(false);
  });
});

describe("depcruise đỏ", () => {
  const stale =
    "‼ 29 known violations ignored.\n‼ 184 stale known violations in the baseline. Run with '--baseline'";
  test("vi phạm thật thì nêu rõ nguyên nhân, không phải stale", () => {
    const out = `error no-circular: a → b\nx 2 dependency violations (2 errors, 0 warnings). 837 modules\n${stale}`;
    expect(onlyStaleWarning(out)).toBe(false);
    expect(failNote(out)).toContain("2 vi phạm thật");
  });
  test("chỉ stale thì xanh và không có lời nhắn đỏ", () => {
    const out = `✔ no dependency violations found (5889 modules)\n${stale}`;
    expect(onlyStaleWarning(out)).toBe(true);
    expect(failNote(out)).toBeNull();
  });
});
