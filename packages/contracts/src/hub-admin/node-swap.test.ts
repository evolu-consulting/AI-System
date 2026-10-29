// CR-103 · R3 fnr-swap: luật đổi node cùng họ (canSwap / fieldRefsTo).
import { describe, expect, test } from "bun:test";
import type { ExecutorKind } from "./node-family";
import { canSwap, fieldRefsTo } from "./node-swap";
import type { ProcessStageDef } from "./processes";

const st = (key: string, executor: unknown, extra: Record<string, unknown> = {}) =>
  ({
    key,
    name: key,
    executor,
    output: { fields: [{ key: "amount", type: "number", required: true }] },
    after: { kind: "auto", branch: [] },
    ...extra,
  }) as unknown as ProcessStageDef;
const agent = { kind: "agent", agent_id: "a" };
const wait = (from: unknown) => ({ kind: "wait_until", from });
const def = (...stages: ProcessStageDef[]) => ({ stages });

describe("fieldRefsTo", () => {
  test("gom branch của chính nó, wait_until.from, tool arg và cond if của stage khác", () => {
    const d = def(
      st("a", agent, {
        after: { kind: "auto", branch: [{ field: "amount", op: "gt", value: 1, goto_step: 2 }] },
      }),
      st("w", wait({ kind: "field", stage_key: "a", field: "amount" })),
      st("t", {
        kind: "tool",
        tool_key: "x",
        args: {
          p: { from: "field", stage_key: "a", field: "amount" },
          q: { from: "const", value: 1 },
        },
      }),
      st("i", {
        kind: "if",
        when: { conds: [{ from: { kind: "field", stage_key: "a", field: "amount" } }] },
      }),
      st("z", wait({ kind: "field", stage_key: "other", field: "d" })),
    );
    expect(fieldRefsTo(d, "a").map((r) => r.via)).toEqual([
      "branch",
      "wait_from",
      "tool_arg",
      "cond",
    ]);
  });
});

describe("canSwap", () => {
  const refd = def(
    st("a", agent),
    st("w", wait({ kind: "field", stage_key: "a", field: "amount" })),
  );
  const free = def(st("a", agent), st("b", agent));
  const cases: [string, ReturnType<typeof def>, number, ExecutorKind, string][] = [
    ["agent -> tool, không tham chiếu", free, 0, "tool", "ok"],
    ["agent -> team, field vẫn khai báo", refd, 0, "team", "ok"],
    ["agent -> wait_until khác họ", free, 0, "wait_until", "family"],
    ["agent -> apply khác họ", free, 0, "apply", "family"],
    [
      "wait_until -> tool khác họ",
      def(st("w", wait({ kind: "input", key: "d" }))),
      0,
      "tool",
      "family",
    ],
    [
      "field bước sau dùng không còn khai báo",
      def(st("a", agent, { output: { fields: [] } }), refd.stages[1] as ProcessStageDef),
      0,
      "tool",
      "field_ref",
    ],
    ["chỉ số sai", free, 9, "tool", "family"],
  ];
  test("stage mới chưa lưu (skipFamily): agent -> wait_until/apply chọn được; field_ref vẫn áp", () => {
    expect(canSwap(free, 0, "wait_until", { skipFamily: true }).ok).toBe(true);
    expect(canSwap(free, 0, "apply", { skipFamily: true }).ok).toBe(true);
    const r = canSwap(refd, 0, "wait_until", { skipFamily: true });
    expect(r.ok ? "ok" : r.reason).toBe("field_ref");
  });
  test.each(cases)("%s", (_n, d, i, k, want) => {
    const r = canSwap(d, i, k);
    expect(r.ok ? "ok" : r.reason).toBe(want);
  });
});
