// CR-118 §11.2 · unit: sửa danh sách luật chọn quy trình + ánh xạ lỗi.
import { describe, expect, test } from "bun:test";
import {
  addRule,
  affectedRules,
  fromServer,
  moveRule,
  patchRule,
  RULES_MAX,
  type RuleDraft,
  removeRule,
  routingErrorOf,
  ruleIssues,
  sameRules,
  setDefault,
  toggleDepartment,
  toPutBody,
} from "./routing-rules";

const P1 = "00000000-0000-4000-8000-000000000001";
const P2 = "00000000-0000-4000-8000-000000000002";
const D1 = "00000000-0000-4000-8000-0000000000d1";
const D2 = "00000000-0000-4000-8000-0000000000d2";
const mk = (key: string, defId = P1, depts: string[] = [], isDefault = false): RuleDraft => ({
  key,
  defId,
  departmentIds: depts,
  isDefault,
});

describe("sửa danh sách luật", () => {
  test("fromServer sắp theo priority; toPutBody giữ thứ tự, mặc định xuống cuối, không phòng ban", () => {
    const d = fromServer([
      { id: "b", priority: 1, condition: { departmentIds: [D2] }, def_id: P2, is_default: false },
      { id: "a", priority: 0, condition: {}, def_id: P1, is_default: true },
    ]);
    expect(d.map((r) => r.key)).toEqual(["a", "b"]);
    const body = toPutBody(3, d);
    expect(body.version).toBe(3);
    expect(body.rules).toEqual([
      { condition: { departmentIds: [D2] }, def_id: P2, is_default: false },
      { condition: {}, def_id: P1, is_default: true },
    ]);
  });

  test("thêm xoá đổi thứ tự sửa luật và trần 50 luật", () => {
    let l = addRule([], P1, "k1");
    l = addRule(l, P2, "k2");
    expect(l.map((r) => r.key)).toEqual(["k1", "k2"]);
    l = moveRule(l, "k2", -1);
    expect(l.map((r) => r.key)).toEqual(["k2", "k1"]);
    expect(moveRule(l, "k2", -1).map((r) => r.key)).toEqual(["k2", "k1"]);
    expect(moveRule(l, "k1", 1).map((r) => r.key)).toEqual(["k2", "k1"]);
    l = patchRule(l, "k1", { defId: P2 });
    expect(l[1]?.defId).toBe(P2);
    expect(removeRule(l, "k2").map((r) => r.key)).toEqual(["k1"]);
    const full = Array.from({ length: RULES_MAX }, (_, i) => mk(`x${i}`));
    expect(addRule(full, P1, "over")).toHaveLength(RULES_MAX);
  });

  test("chọn phòng ban bật/tắt; mặc định duy nhất và xoá phòng ban", () => {
    let l = [mk("a"), mk("b", P2, [D1])];
    l = toggleDepartment(l, "a", D1);
    l = toggleDepartment(l, "a", D2);
    expect(l[0]?.departmentIds).toEqual([D1, D2]);
    l = toggleDepartment(l, "a", D1);
    expect(l[0]?.departmentIds).toEqual([D2]);
    l = setDefault(l, "b", true);
    expect(l[1]).toMatchObject({ isDefault: true, departmentIds: [] });
    l = setDefault(l, "a", true);
    expect(l.map((r) => r.isDefault)).toEqual([true, false]);
    expect(toggleDepartment(l, "a", D1)[0]?.departmentIds).toEqual([]);
    expect(setDefault(l, "a", false).map((r) => r.isDefault)).toEqual([false, false]);
  });

  test("sameRules phát hiện đổi", () => {
    expect(sameRules([mk("a", P1, [D1])], [mk("z", P1, [D1])])).toBe(true);
    expect(sameRules([mk("a", P1, [D1])], [mk("a", P1, [D2])])).toBe(false);
    expect(sameRules([mk("a")], [])).toBe(false);
  });

  test("ruleIssues: thiếu phòng ban, quy trình bị bỏ gán, phòng ban đã xoá; mặc định không cần phòng ban", () => {
    const list = [mk("a"), mk("b", P2, [D1]), mk("c", P1, [D1, D2]), mk("d", P1, [], true)];
    const issues = ruleIssues(list, new Set([P1]), new Set([D1]));
    expect(issues).toEqual([
      { key: "a", code: "noDepartment" },
      { key: "b", code: "notAssigned" },
      { key: "c", code: "deptGone" },
    ]);
  });
});

describe("ánh xạ lỗi", () => {
  test("mã 409/422 của hợp đồng", () => {
    expect(routingErrorOf({ status: 409, code: "VERSION_CONFLICT" }).kind).toBe("conflict");
    expect(routingErrorOf({ status: 422, code: "ROUTING_PROCESS_NOT_ASSIGNED" }).kind).toBe(
      "notAssigned",
    );
    expect(routingErrorOf({ status: 422, code: "ROUTING_DEPARTMENT_INVALID" }).kind).toBe(
      "deptInvalid",
    );
    expect(routingErrorOf({ status: 422, code: "ROUTING_RULES_INVALID" }).kind).toBe(
      "rulesInvalid",
    );
    expect(routingErrorOf({ status: 403, code: "FORBIDDEN" }).kind).toBe("forbidden");
    expect(routingErrorOf(new Error("x")).kind).toBe("other");
    expect(routingErrorOf(null).kind).toBe("other");
  });

  test("IN_USE: số thứ tự luật = priority + 1, bỏ trùng, bỏ phần tử sai", () => {
    const e = {
      status: 409,
      code: "ROUTING_PROCESS_IN_USE",
      details: {
        rules: [
          { id: "x", priority: 2 },
          { id: "y", priority: 0 },
          { id: "z", priority: 2 },
          { id: "w" },
        ],
      },
    };
    expect(routingErrorOf(e)).toEqual({ kind: "inUse", rules: [1, 3] });
    expect(affectedRules(undefined)).toEqual([]);
    expect(affectedRules({ rules: "x" })).toEqual([]);
  });
});

describe("cr118-routing-deleted · quy trình không chạy được", () => {
  const server = (unavailable?: "deleted" | "unpublished") => ({
    id: "r1",
    priority: 0,
    condition: { departmentIds: [D1] },
    def_id: P1,
    is_default: false,
    ...(unavailable ? { unavailable } : {}),
  });
  test("fromServer mang cờ unavailable; vắng ⇒ không có khoá", () => {
    expect(fromServer([server("deleted")])[0]?.unavailable).toBe("deleted");
    expect("unavailable" in (fromServer([server()])[0] ?? {})).toBe(false);
  });
  test("ruleIssues: luật unavailable ⇒ mã 'unavailable' (chặn lưu); đổi quy trình thì hết", () => {
    const [r] = fromServer([server("unpublished")]);
    if (!r) throw new Error("no rule");
    const assigned = new Set([P1, P2]);
    const depts = new Set([D1]);
    expect(ruleIssues([r], assigned, depts)).toEqual([{ key: "r1", code: "unavailable" }]);
    const fixed = patchRule([r], "r1", { defId: P2 });
    expect(fixed[0]?.unavailable).toBeUndefined();
    expect(ruleIssues(fixed, assigned, depts)).toEqual([]);
  });
  test("toPutBody không gửi cờ unavailable", () => {
    const [r] = fromServer([server("deleted")]);
    expect(JSON.stringify(toPutBody(1, r ? [r] : []))).not.toContain("unavailable");
  });
  test("422 ROUTING_PROCESS_UNAVAILABLE ⇒ kind 'unavailable'", () => {
    expect(routingErrorOf({ status: 422, code: "ROUTING_PROCESS_UNAVAILABLE" }).kind).toBe(
      "unavailable",
    );
  });
});
