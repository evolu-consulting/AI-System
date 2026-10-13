// HUB-FR-119 · P-c1 · nhãn thuần của khối tự sửa.
import { describe, expect, test } from "bun:test";
import type { AutofixStageView } from "@ai/contracts/chat";
import {
  diffStatLabel,
  failureGroups,
  firstFailureGroup,
  isSecretFailure,
  lastCheck,
  secondsLabel,
  sha7,
  shortBranch,
  sourceLabel,
} from "./autofix-view";

const SHA = "9f3c1a2b4d5e6f708192a3b4c5d6e7f8091a2b3c";
const base = {
  source_key: "repo",
  pin_sha: SHA,
  branch: "ai/9f3c1a2b/fix",
  round: 1,
  status: "ok",
  diff_stats: null,
  diff_file: null,
  test_log_file: null,
  test: { exit_code: 0, duration_ms: 12_449 },
  failures: [],
  created_at: "2026-10-14T00:00:00.000Z",
} satisfies AutofixStageView;

describe("autofix-view", () => {
  test("sha7 / sourceLabel", () => {
    expect(sha7(SHA)).toBe("9f3c1a2");
    expect(sha7(null)).toBeNull();
    expect(sourceLabel(base)).toBe("repo@9f3c1a2");
    expect(sourceLabel({ ...base, pin_sha: null })).toBe("repo");
  });
  test("shortBranch", () => {
    expect(shortBranch("ai/9f3c1a2b/fix")).toBe("ai/9f3c…/fix");
    expect(shortBranch("main")).toBe("main");
    expect(shortBranch("ai/ab/fix")).toBe("ai/ab/fix");
  });
  test("diffStatLabel dùng dấu trừ U+2212", () => {
    expect(diffStatLabel({ insertions: 12, deletions: 3 })).toBe("+12 −3");
  });
  test("secondsLabel theo ngôn ngữ", () => {
    expect(secondsLabel(12_449, "en")).toBe("12.4");
    expect(secondsLabel(12_449, "vi")).toBe("12,4");
  });
  test("failureGroups theo thứ tự cố định, không trùng", () => {
    const f = (check: AutofixStageView["failures"][number]["check"]) => ({ check, detail: "d" });
    const v = { failures: [f("tests"), f("paths"), f("tests"), f("secrets")] };
    expect(failureGroups(v)).toEqual(["paths", "secrets", "tests"]);
    expect(firstFailureGroup(v)).toBe("paths");
    expect(firstFailureGroup({ failures: [] })).toBeNull();
  });
  test("lastCheck", () => {
    expect(lastCheck(base, "en")).toEqual({ kind: "ok", seconds: "12.4" });
    expect(lastCheck({ ...base, status: "no_changes" }, "en")).toEqual({ kind: "no_changes" });
    expect(
      lastCheck(
        { ...base, status: "check_failed", failures: [{ check: "size", detail: "x" }] },
        "en",
      ),
    ).toEqual({ kind: "check_failed", group: "size" });
  });
  test("isSecretFailure", () => {
    expect(isSecretFailure({ check: "secrets" })).toBe(true);
    expect(isSecretFailure({ check: "tests" })).toBe(false);
  });
});
