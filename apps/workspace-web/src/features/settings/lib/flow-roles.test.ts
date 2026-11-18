// CR-182 · giao việc theo vai: hàm thuần (chữ node, bước dùng chung vai, số vai chưa giao, nháp khác bản lưu, thân PUT).
import { describe, expect, test } from "bun:test";
import type { CurrentFlow, CurrentGraphStage } from "./current-flow";
import {
  assignBody,
  isDirty,
  roleView,
  savedPick,
  stagesOfRole,
  unassignedRoles,
  whoText,
} from "./flow-roles";

const t = (k: string, o?: Record<string, unknown>) => `${k}|${JSON.stringify(o ?? {})}`;
const U = "00000000-0000-4000-8000-000000000001";
const G = "00000000-0000-4000-8000-000000000002";
const stage = (
  key: string,
  role: string | null,
  assigned: CurrentGraphStage["assigned"] = null,
): CurrentGraphStage => ({
  key,
  step: 0,
  name: `Bước ${key}`,
  kind: "review",
  department: null,
  provider: null,
  after: "review",
  backTo: [],
  branch: [],
  ifs: null,
  nextStep: null,
  terminal: false,
  role: role ? { key: role, label: role } : null,
  assigned,
});
const group = { kind: "group" as const, id: G, name: "Pháp chế", members: [{ id: U, name: "An" }] };
const flow = (graph: CurrentGraphStage[]) => ({ defId: "f", graph }) as unknown as CurrentFlow;

describe("flow-roles", () => {
  test("whoText: nhóm kèm số người, người chỉ tên, chưa giao null", () => {
    expect(whoText(group, t)).toContain('"count":1');
    expect(whoText({ kind: "user", id: U, name: "An", members: [] }, t)).toBe("An");
    expect(whoText(null, t)).toBeNull();
  });
  test("roleView: bước không vai ⇒ null; có vai chưa giao ⇒ who null", () => {
    expect(roleView(stage("a", null), t)).toBeNull();
    expect(roleView(stage("a", "gd"), t)?.who).toBeNull();
    expect(roleView(stage("a", "gd", group), t)?.kind).toBe("group");
  });
  test("một vai nhiều bước và đếm vai chưa giao theo khoá khác nhau", () => {
    const f = flow([
      stage("a", "gd"),
      stage("b", "gd"),
      stage("c", "ky", group),
      stage("d", "pc"),
      stage("e", null),
    ]);
    expect(stagesOfRole(f, "gd").map((s) => s.key)).toEqual(["a", "b"]);
    expect(unassignedRoles(f)).toBe(2);
    expect(unassignedRoles(flow([stage("c", "ky", group)]))).toBe(0);
  });
  test("isDirty chỉ bật khi nháp khác bản đã lưu", () => {
    const saved = savedPick(stage("a", "gd", group));
    expect(isDirty(saved, saved)).toBe(false);
    expect(isDirty(saved, { kind: "user", id: U, name: "An" })).toBe(true);
    expect(isDirty(saved, null)).toBe(true);
    expect(isDirty(null, null)).toBe(false);
  });
  test("assignBody: nhóm xor người, bỏ giao ⇒ cả hai null", () => {
    expect(assignBody("f", "gd", { kind: "group", id: G, name: "" })).toEqual({
      flow_id: "f",
      role_key: "gd",
      group_id: G,
      user_id: null,
    });
    expect(assignBody("f", "gd", { kind: "user", id: U, name: "" })).toEqual({
      flow_id: "f",
      role_key: "gd",
      group_id: null,
      user_id: U,
    });
    expect(assignBody("f", "gd", null).group_id).toBeNull();
  });
});
