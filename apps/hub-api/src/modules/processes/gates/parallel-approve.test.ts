// CR-125 · «A + B cùng duyệt» — luật thuần: chốt bước theo luật, nhóm của bước, luật lưu def, gắn mã nhóm, nhóm cần của mẫu.
import { describe, expect, it } from "bun:test";
import { parallelStageIssues } from "@ai/contracts/hub-admin";
import { MODULES, templateNeeds } from "@ai/contracts/modules";
import { bindGroupKeys, groupKeysOf } from "../triggers/group-keys.rules";
import { parallelVerdict } from "./parallel-approve";
import { parallelGroupIds } from "./parallel-open";

const g3 = [{}, {}, {}];
const approve = (parallel: unknown) => ({
  executor: { kind: "approve" },
  after: { kind: "review", parallel } as never,
});

describe("CR-125 · cùng duyệt — luật thuần", () => {
  it("parallelVerdict: all / any / min — Từ chối, Trả lại chốt ngay", () => {
    expect(parallelVerdict({ groups: g3, rule: "all" }, 1, "pass")).toBe("partial");
    expect(parallelVerdict({ groups: g3, rule: "all" }, 2, "pass")).toBe("final");
    expect(parallelVerdict({ groups: g3, rule: "any" }, 0, "pass")).toBe("final");
    expect(parallelVerdict({ groups: g3, rule: { min: 2 } }, 0, "pass")).toBe("partial");
    expect(parallelVerdict({ groups: g3, rule: { min: 2 } }, 1, "pass")).toBe("final");
    expect(parallelVerdict({ groups: g3, rule: "all" }, 0, "reject")).toBe("final");
    expect(parallelVerdict({ groups: g3, rule: "all" }, 0, "fail")).toBe("final");
  });

  it("parallelGroupIds: chỉ bước Duyệt có ≥ 2 nhóm", () => {
    const p = { groups: [{ group_id: "a" }, { group_id: "b" }], rule: "all" };
    expect(parallelGroupIds(approve(p))).toEqual(["a", "b"]);
    expect(parallelGroupIds(approve(undefined))).toBeNull();
    expect(
      parallelGroupIds({ executor: { kind: "agent" }, after: { kind: "review", parallel: p } }),
    ).toBeNull();
  });

  it("parallelStageIssues: < 2 nhóm ⇒ MIN2 — min > số nhóm / trùng nhóm / không phải Duyệt ⇒ RULE_INVALID", () => {
    const k = (key: string) => ({ group_key: key, label: key });
    expect(parallelStageIssues([approve({ groups: [k("a")], rule: "all" })])).toEqual([
      { path: "stages.0.after.parallel.groups", rule: "PARALLEL_GROUPS_MIN2" },
    ]);
    expect(parallelStageIssues([approve({ groups: [k("a"), k("b")], rule: { min: 3 } })])).toEqual([
      { path: "stages.0.after.parallel.rule", rule: "PARALLEL_RULE_INVALID" },
    ]);
    expect(parallelStageIssues([approve({ groups: [k("a"), k("a")], rule: "any" })])).toEqual([
      { path: "stages.0.after.parallel.rule", rule: "PARALLEL_RULE_INVALID" },
    ]);
    const agent = {
      executor: { kind: "agent" },
      after: approve({ groups: [k("a"), k("b")], rule: "all" }).after,
    };
    expect(parallelStageIssues([agent])).toEqual([
      { path: "stages.0.after.parallel", rule: "PARALLEL_RULE_INVALID" },
    ]);
    expect(parallelStageIssues([approve({ groups: [k("a"), k("b")], rule: { min: 2 } })])).toEqual(
      [],
    );
  });

  it("mã nhóm của `parallel`: cần có (mẫu) và gắn id khi mở lượt / sao chép", () => {
    const st = [
      {
        key: "d",
        name: "Duyệt",
        ...approve({
          groups: [
            { group_key: "pb-a", label: "A" },
            { group_key: "pb-b", label: "B" },
          ],
          rule: "all",
        }),
      },
    ];
    expect(groupKeysOf(st).sort()).toEqual(["pb-a", "pb-b"]);
    expect(templateNeeds(st, MODULES).groups.sort()).toEqual(["pb-a", "pb-b"]);
    const out = bindGroupKeys(st, new Map([["pb-a", "id-a"]]), { strip: true });
    expect(out.missing).toEqual(["pb-b"]);
    const groups = (out.stages[0] as { after: { parallel: { groups: unknown[] } } }).after.parallel
      .groups;
    expect(groups).toEqual([
      { label: "A", group_id: "id-a" },
      { label: "B", group_id: null },
    ]);
  });
});
