// CR-125 · cr125-parallel-approval-ui · unit: «A + B cùng duyệt» — nháp ⇄ after.parallel, lỗi hiện ngay (cùng luật máy chủ), tóm tắt canvas, đi qua stage-convert.
import { describe, expect, test } from "bun:test";
import { emptyDraft, validateDraft } from "./def-form";
import {
  parallelErrors,
  parallelFromDef,
  parallelNames,
  parallelNeeded,
  parallelToDef,
  ruleText,
  startParallel,
} from "./parallel-form";
import { emptyStage, stageToDraft, stageToInput } from "./stage-convert";

const G1 = "00000000-0000-4000-8000-000000000001";
const G2 = "00000000-0000-4000-8000-000000000002";
const two = () => ({
  ...startParallel({ groupId: G1, label: "Trưởng bộ phận" }),
  groups: [
    { groupId: G1, label: "Trưởng bộ phận" },
    { groupId: G2, label: "Tài chính" },
  ],
});

describe("nháp ⇄ after.parallel", () => {
  test("đi về giữ nhóm + nhãn + luật (all / any / min)", () => {
    const d = two();
    const def = parallelToDef(d);
    expect(def.groups).toEqual([
      { group_id: G1, label: "Trưởng bộ phận" },
      { group_id: G2, label: "Tài chính" },
    ]);
    expect(def.rule).toBe("all");
    expect(parallelFromDef(def)).toEqual({ ...d, min: "2" });
    expect(parallelToDef({ ...d, rule: "any" }).rule).toBe("any");
    expect(parallelToDef({ ...d, rule: "min", min: "2" }).rule).toEqual({ min: 2 });
    expect(parallelFromDef(parallelToDef({ ...d, rule: "min", min: "1" })).rule).toBe("min");
  });

  test("mẫu Thư viện giữ group_key; nhóm chưa chọn ⇒ group_id null; nhãn trống ⇒ «Nhóm n»", () => {
    const def = parallelToDef({
      groups: [
        { groupId: "", groupKey: "tai-chinh", label: "Tài chính" },
        { groupId: "", label: "" },
      ],
      rule: "all",
      min: "2",
    });
    expect(def.groups[0]).toEqual({ group_key: "tai-chinh", label: "Tài chính" });
    expect(def.groups[1]).toEqual({ group_id: null, label: "Nhóm 2" });
  });

  test("stage Duyệt đi qua stageToInput / stageToDraft nguyên vẹn", () => {
    const s = {
      ...emptyStage(0),
      key: "duyet",
      name: "Duyệt",
      executor: "approve",
      after: "review" as const,
    };
    const input = stageToInput({ ...s, parallel: two() });
    expect(input.after.kind === "review" && input.after.parallel?.rule).toBe("all");
    expect(stageToDraft(input, 0).parallel).toEqual(parallelFromDef(parallelToDef(two())));
    expect(stageToInput(s).after).not.toHaveProperty("parallel"); // vắng ⇒ bước Duyệt một nhóm như cũ
  });
});

describe("lỗi hiện ngay", () => {
  const st = (parallel: ReturnType<typeof two> | undefined, executor = "approve") => ({
    executor,
    parallel,
  });
  test("một nhóm ⇒ PARALLEL_GROUPS_MIN2 ở …parallel.groups", () => {
    const d = { ...two(), groups: [{ groupId: G1, label: "A" }] };
    expect(parallelErrors([st(d)], false)["stages.0.after.parallel.groups"]).toBe(
      "process.admin.parallel.err.PARALLEL_GROUPS_MIN2",
    );
  });
  test("min vượt số nhóm / trùng nhóm ⇒ PARALLEL_RULE_INVALID ở …parallel.rule", () => {
    expect(parallelErrors([st({ ...two(), rule: "min", min: "3" })], false)).toHaveProperty(
      ["stages.0.after.parallel.rule"],
      "process.admin.parallel.err.PARALLEL_RULE_INVALID",
    );
    const dup = {
      ...two(),
      groups: [two().groups[0], two().groups[0]] as ReturnType<typeof two>["groups"],
    };
    expect(parallelErrors([st(dup)], false)["stages.0.after.parallel.rule"]).toBeDefined();
  });
  test("hợp lệ ⇒ không lỗi; khi bật, hàng chưa chọn nhóm bị báo", () => {
    expect(parallelErrors([st(two())], true)).toEqual({});
    const blank = {
      ...two(),
      groups: [two().groups[0], { groupId: "", label: "" }] as ReturnType<typeof two>["groups"],
    };
    expect(parallelErrors([st(blank)], true)["stages.0.after.parallel.groups"]).toBe(
      "process.admin.parallel.groupMissing",
    );
    expect(parallelErrors([st(blank)], false)).toEqual({});
  });
  test("validateDraft đưa lỗi lên; bước Cùng duyệt không đòi «Ai duyệt» một nhóm khi bật", () => {
    const s = {
      ...emptyStage(0),
      key: "d",
      name: "D",
      executor: "approve",
      after: "review" as const,
      parallel: two(),
    };
    const e = validateDraft(
      { ...emptyDraft(), name: "Cùng duyệt", key: "cung-duyet", stages: [s] },
      true,
    );
    expect(e["stages.0.after.group_id"]).toBeUndefined();
    expect(Object.keys(e).filter((k) => k.includes("parallel"))).toEqual([]);
  });
});

describe("tóm tắt trên canvas", () => {
  test("«A + B» + luật + số nhóm cần", () => {
    const d = two();
    expect(parallelNames(d)).toBe("Trưởng bộ phận + Tài chính");
    expect(ruleText(d)).toEqual({ key: "process.admin.parallel.rule.all", params: { n: 2 } });
    expect(parallelNeeded({ ...d, rule: "any" })).toBe(1);
    expect(parallelNeeded({ ...d, rule: "min", min: "2" })).toBe(2);
  });
});
