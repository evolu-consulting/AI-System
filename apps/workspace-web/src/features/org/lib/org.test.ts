// M1D-FR-02 · ứng viên cấp quản lý loại chính mình và cấp dưới mọi tầng (tránh vòng); dữ liệu có vòng không treo.
import { describe, expect, test } from "bun:test";
import type { OrgDepartment, OrgMember, OrgResponse } from "@ai/contracts/org";
import {
  headCandidates,
  headIdsOf,
  managerNotHead,
  managerOptions,
  reportsOf,
  suggestedHeadOf,
} from "./org";

const m = (id: string, manager: string | null): OrgMember => ({
  user_id: id,
  username: id,
  display_name: id,
  manager_id: manager,
});
const tree = [m("a", null), m("b", "a"), m("c", "b"), m("d", null)];

describe("org rules", () => {
  test("cấp dưới mọi tầng", () => {
    expect([...reportsOf(tree, "a")].sort()).toEqual(["b", "c"]);
    expect([...reportsOf(tree, "c")]).toEqual([]);
  });
  test("ứng viên quản lý của a = d (không a, b, c); của c = a, b, d", () => {
    expect(managerOptions(tree, "a").map((x) => x.user_id)).toEqual(["d"]);
    expect(managerOptions(tree, "c").map((x) => x.user_id)).toEqual(["a", "b", "d"]);
  });
  test("dữ liệu vòng không treo", () => {
    expect([...reportsOf([m("x", "y"), m("y", "x")], "x")]).toEqual(["y"]);
  });
});

const dept = (key: string, head: string | null, members: string[]): OrgDepartment => ({
  group_id: key,
  key,
  name: key,
  head_user_id: head,
  parent_group_id: null,
  member_ids: members,
});
// a, d = trưởng phòng; b, c thuộc phòng của a; d là trưởng phòng kế toán (có e).
const org: OrgResponse = {
  members: [m("a", null), m("b", "a"), m("c", "b"), m("d", null), m("e", "d")],
  departments: [dept("kd", "a", ["b", "c"]), dept("kt", "d", ["e"])],
};

describe("CR-189 · cấp quản lý chỉ trưởng phòng", () => {
  test("ứng viên là trưởng phòng, trừ chính mình và cấp dưới, gợi ý đứng đầu", () => {
    expect([...headIdsOf(org.departments)].sort()).toEqual(["a", "d"]);
    expect(headCandidates(org, "e", "").map((x) => x.id)).toEqual(["d", "a"]);
    expect(headCandidates(org, "b", "").map((x) => x.id)).toEqual(["a", "d"]);
    expect(headCandidates(org, "a", "").map((x) => x.id)).toEqual(["d"]); // không tự chọn mình
    expect(headCandidates(org, "d", "").map((x) => x.id)).toEqual(["a"]);
    expect(headCandidates(org, "b", "ĐỖ")).toEqual([]);
  });
  test("gợi ý: trưởng phòng của phòng người đó; trưởng phòng không tự gợi ý mình; chưa vào phòng ⇒ không gợi ý", () => {
    expect(suggestedHeadOf(org.departments, "c")).toBe("a");
    expect(suggestedHeadOf(org.departments, "a")).toBeNull();
    expect(suggestedHeadOf(org.departments, "zzz")).toBeNull();
  });
  test("cảnh báo vàng chỉ khi có cấp quản lý mà người đó không phải trưởng phòng", () => {
    expect(managerNotHead(org, "a")).toBe(false);
    expect(managerNotHead(org, "c")).toBe(true);
    expect(managerNotHead(org, null)).toBe(false);
  });
});
