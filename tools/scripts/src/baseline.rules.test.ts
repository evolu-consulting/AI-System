import { describe, expect, test } from "bun:test";
import {
  type BaselineEntry,
  formatBaseline,
  normalizeBaseline,
  onlyStaleWarning,
} from "./baseline.rules";
import { onlyResolvable, rebaseResolvingLock } from "./slice-rebase";

const e = (name: string, from: string, to: string): BaselineEntry => ({
  type: "dependency",
  from,
  to,
  rule: { severity: "error", name },
});

describe("baseline ổn định", () => {
  test("sắp theo luật, from, to và bỏ trùng", () => {
    const out = normalizeBaseline([
      e("b", "z", "1"),
      e("a", "y", "2"),
      e("a", "x", "9"),
      e("a", "x", "9"),
    ]);
    expect(out.map((x) => `${x.rule.name}:${x.from}`)).toEqual(["a:x", "a:y", "b:z"]);
  });
  test("thứ tự vào khác nhau cho cùng một file", () => {
    const a = [e("a", "x", "1"), e("b", "y", "2")];
    expect(formatBaseline([...a].reverse())).toBe(formatBaseline(a));
    expect(formatBaseline(a).endsWith("]\n")).toBe(true);
  });
});

describe("depcruise chỉ cảnh báo stale", () => {
  test("chỉ dòng baseline cũ thì xanh", () => {
    const out =
      "✔ no dependency violations found (5889 modules)\n‼ 232 known violations ignored.\n‼ 232 stale known violations in the baseline.";
    expect(onlyStaleWarning(out)).toBe(true);
  });
  test("có vi phạm thật thì đỏ", () => {
    expect(onlyStaleWarning("error no-circular: a -> b\n‼ 3 stale known violations")).toBe(false);
    expect(onlyStaleWarning("")).toBe(false);
  });
});

describe("rebase tự giải baseline", () => {
  const BASE = ".dependency-cruiser-known-violations.json";
  test("onlyResolvable", () => {
    expect(onlyResolvable([BASE], true)).toBe(true);
    expect(onlyResolvable([BASE], false)).toBe(false);
    expect(onlyResolvable([BASE, "src/a.ts"], true)).toBe(false);
    expect(onlyResolvable([], true)).toBe(false);
  });

  function fakeGit(conflicts: string[][]) {
    const calls: string[] = [];
    let step = 0;
    const git = (...a: string[]) => {
      calls.push(a.join(" "));
      if (a[0] === "rebase" && a[1] !== "--continue") return { ok: false, out: "conflict" };
      if (a[0] === "diff") return { ok: true, out: (conflicts[step] ?? []).join("\n") };
      if (a.includes("--continue")) {
        step++;
        return step < conflicts.length ? { ok: false, out: "conflict" } : { ok: true, out: "" };
      }
      return { ok: true, out: "" };
    };
    return { git, calls };
  }

  test("chỉ baseline conflict ở mỗi commit lấy upstream, sinh lại, add, continue", () => {
    const { git, calls } = fakeGit([[BASE], [BASE]]);
    let regen = 0;
    const r = rebaseResolvingLock(git, "platform/gd0", () => {
      regen++;
      return true;
    });
    expect(r.ok).toBe(true);
    expect(r.baselineResolved).toBe(2);
    expect(regen).toBe(2);
    expect(calls).toContain(`checkout --ours -- ${BASE}`);
    expect(calls).toContain(`add ${BASE}`);
  });

  test("file khác conflict dừng, không sinh lại", () => {
    const { git } = fakeGit([[BASE, "src/a.ts"]]);
    let regen = 0;
    const r = rebaseResolvingLock(git, "platform/gd0", () => {
      regen++;
      return true;
    });
    expect(r.ok).toBe(false);
    expect(regen).toBe(0);
  });

  test("sinh lại thất bại vi phạm mới dừng báo", () => {
    const { git } = fakeGit([[BASE]]);
    expect(rebaseResolvingLock(git, "platform/gd0", () => false).ok).toBe(false);
  });
});

describe("baseline giữ mọi trường của depcruise", () => {
  const cyc = (via: string): BaselineEntry => ({
    type: "cycle",
    from: "a.ts",
    to: "b.ts",
    rule: { severity: "error", name: "no-circular" },
    cycle: [{ name: via, dependencyTypes: ["import"] }],
  });
  test("mục cycle giữ nguyên đường vòng, không bị cắt trường", () => {
    const out = normalizeBaseline([cyc("c.ts")]);
    expect(out[0]?.cycle).toEqual([{ name: "c.ts", dependencyTypes: ["import"] }]);
  });
  test("hai vòng khác đường đi không bị gộp làm một", () => {
    expect(normalizeBaseline([cyc("c.ts"), cyc("d.ts")])).toHaveLength(2);
  });
});

describe("depcruise hook ngân sách", () => {
  test("lời nhắn nêu số giây và nơi kiểm đầy đủ", async () => {
    const { budgetNote } = await import("./depcruise");
    expect(budgetNote(20)).toContain("quá 20 s");
    expect(budgetNote(20)).toContain("slice:merge");
  });
});
