import { describe, expect, test } from "bun:test";
import { decideScope, isSliceWorktree, scopeLine, splitFilter } from "./evotest-scope.rules";

const base = { slice: true, wave: false, hasFilter: true, intFiles: 2, e2eJobs: 1, e2eSpecs: 5 };

describe("decideScope", () => {
  test("lát có filter nhỏ ⇒ cho", () => expect(decideScope(base).allow).toBe(true));
  test("lát không filter ⇒ chặn", () => {
    const v = decideScope({ ...base, hasFilter: false });
    expect(v.allow).toBe(false);
    expect(!v.allow && v.reason).toContain("-Filter");
  });
  test("ngưỡng: 30 int ok, 31 chặn", () => {
    expect(decideScope({ ...base, intFiles: 30 }).allow).toBe(true);
    expect(decideScope({ ...base, intFiles: 31 }).allow).toBe(false);
  });
  test("ngưỡng: 3 job ok, 4 chặn", () => {
    expect(decideScope({ ...base, e2eJobs: 3 }).allow).toBe(true);
    expect(decideScope({ ...base, e2eJobs: 4 }).allow).toBe(false);
  });
  test("ngưỡng: 60 spec ok, 61 chặn", () => {
    expect(decideScope({ ...base, e2eSpecs: 60 }).allow).toBe(true);
    expect(decideScope({ ...base, e2eSpecs: 61 }).allow).toBe(false);
  });
  test("wave hoặc không phải lát ⇒ luôn cho", () => {
    const wide = { ...base, hasFilter: false, intFiles: 999, e2eJobs: 99, e2eSpecs: 999 };
    expect(decideScope({ ...wide, wave: true }).allow).toBe(true);
    expect(decideScope({ ...wide, slice: false }).allow).toBe(true);
  });
});

test("isSliceWorktree", () => {
  expect(isSliceWorktree("F:\\workspace\\evolu-wt\\x", "main")).toBe(true);
  expect(isSliceWorktree("F:\\workspace\\evolu-platform", "slice/x")).toBe(true);
  expect(isSliceWorktree("F:\\workspace\\evolu-platform", "platform/gd0")).toBe(false);
});

test("splitFilter + scopeLine", () => {
  expect(splitFilter("all", "a/b.int.test.ts jobx")).toEqual({
    int: ["a/b.int.test.ts"],
    e2e: ["jobx"],
  });
  expect(splitFilter("e2e", "root,N1").e2e).toEqual(["root", "N1"]);
  expect(scopeLine({ intFiles: 1, e2eJobs: 2, e2eSpecs: 3 })).toBe(
    "phạm vi: 1 file int / 2 job e2e (3 spec)",
  );
});
