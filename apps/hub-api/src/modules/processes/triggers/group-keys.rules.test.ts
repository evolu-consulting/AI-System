// CR-122 · E1b · đổi Group theo mã → id công ty (flow Thư viện chạy thẳng / sao chép) + nhận đúng lỗi trùng sự kiện × flow.
import { describe, expect, test } from "bun:test";
import { isFlowEventDup } from "./flow-launch";
import { bindGroupKeys, groupKeysOf } from "./group-keys.rules";

const st = [
  {
    key: "a",
    after: {
      kind: "review",
      group_key: "kd",
      also_group_keys: ["kt"],
      escalate: { group_key: "gd", after_h: 4 },
    },
    answerer: { kind: "group", group_key: "kd" },
  },
  { key: "b", after: { kind: "auto" }, answerer: { kind: "starter" } },
];

describe("CR-122 E1b · group-keys", () => {
  test("gom mã, đổi sang id; thiếu ⇒ missing", () => {
    expect(groupKeysOf(st).sort()).toEqual(["gd", "kd", "kt"]);
    const ids = new Map([
      ["kd", "id-kd"],
      ["kt", "id-kt"],
    ]);
    const b = bindGroupKeys(st, ids);
    const a = b.stages[0] as Record<string, Record<string, unknown>>;
    expect(a.after?.group_id).toBe("id-kd");
    expect(a.after?.also_group_ids).toEqual(["id-kt"]);
    expect(a.answerer?.group_id).toBe("id-kd");
    expect(b.missing).toEqual(["gd"]);
    expect(b.stages[1]).toEqual(st[1]);
  });
});

describe("CR-122 E1b · isFlowEventDup (soát E1 #3)", () => {
  test("chỉ 23505 của process_runs_flow_event_uq (trực tiếp hoặc trong cause)", () => {
    expect(isFlowEventDup({ code: "23505", constraint_name: "process_runs_flow_event_uq" })).toBe(
      true,
    );
    expect(
      isFlowEventDup({ cause: { code: "23505", constraint_name: "process_runs_flow_event_uq" } }),
    ).toBe(true);
    expect(isFlowEventDup({ code: "23505", constraint_name: "process_runs_pkey" })).toBe(false);
    expect(isFlowEventDup(new Error("x"))).toBe(false);
  });
});
