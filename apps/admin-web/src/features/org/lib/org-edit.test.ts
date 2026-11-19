// CR-139d · CR-189 · dựng cây, chặn vòng khi chuyển phòng cha, đếm trước khi xoá, câu lỗi nghiệp vụ, báo đổi quyền.
import { describe, expect, test } from "bun:test";
import type { OrgDepartment } from "@ai/contracts/org";
import {
  accessNote,
  buildDeptTree,
  canMoveDept,
  deptLoad,
  flattenTree,
  orgErrorSpec,
  parentChoices,
} from "./org-edit";

const d = (
  id: string,
  parent: string | null = null,
  extra: Partial<OrgDepartment> = {},
): OrgDepartment => ({
  group_id: id,
  key: id,
  name: id,
  head_user_id: null,
  parent_group_id: parent,
  member_ids: [],
  ...extra,
});
const A = d("a");
const B = d("b", "a");
const C = d("c", "b");
const D = d("d");

describe("dựng cây", () => {
  test("cha trước con, thụt theo độ sâu, cha vắng mặt ⇒ gốc", () => {
    const rows = flattenTree(buildDeptTree([C, D, A, B, d("x", "ngoai")]));
    expect(rows.map((r) => `${r.depth}${r.dept.group_id}`)).toEqual(["0d", "0a", "1b", "2c", "0x"]);
  });
  test("dữ liệu hỏng có vòng không treo và không mất phòng nào", () => {
    const rows = flattenTree(buildDeptTree([d("p", "q"), d("q", "p")]));
    expect(rows.map((r) => r.dept.group_id).sort()).toEqual(["p", "q"]);
  });
});

describe("chọn «Thuộc phòng»", () => {
  test("loại chính nó và mọi con cháu, còn lại giữ thứ tự cây", () => {
    const all = [A, B, C, D];
    expect(parentChoices(all, "a").map((r) => r.dept.group_id)).toEqual(["d"]);
    expect(parentChoices(all, "b").map((r) => r.dept.group_id)).toEqual(["a", "d"]);
    expect(parentChoices(all, "c").map((r) => r.dept.group_id)).toEqual(["a", "b", "d"]);
  });
});

describe("chuyển phòng cha (kéo thả / menu)", () => {
  const all = [A, B, C, D];
  test("không vào chính nó, không vào con cháu, không vào phòng cha hiện tại", () => {
    expect(canMoveDept(all, "a", "a")).toBe(false);
    expect(canMoveDept(all, "a", "c")).toBe(false);
    expect(canMoveDept(all, "b", "a")).toBe(false);
    expect(canMoveDept(all, "c", "d")).toBe(true);
    expect(canMoveDept(all, "c", null)).toBe(true);
    expect(canMoveDept(all, "d", null)).toBe(false);
    expect(canMoveDept(all, "zzz", "a")).toBe(false);
    expect(canMoveDept(all, "d", "zzz")).toBe(false);
  });
});

describe("đếm trước khi xoá", () => {
  test("người = thành viên ∪ trưởng phòng (không đếm trùng), cộng số phòng con", () => {
    const all = [
      d("a", null, { member_ids: ["u1", "u2"], head_user_id: "u2" }),
      d("b", "a"),
      d("c", "a"),
    ];
    expect(deptLoad(all, "a")).toEqual({ members: 2, children: 2 });
    expect(deptLoad([d("a", null, { head_user_id: "u9" })], "a")).toEqual({
      members: 1,
      children: 0,
    });
    expect(deptLoad(all, "b")).toEqual({ members: 0, children: 0 });
  });
});

describe("câu lỗi nghiệp vụ", () => {
  test("DEPT_NOT_EMPTY chọn câu theo người/phòng con, các mã khác có key riêng, mã lạ ⇒ null", () => {
    expect(orgErrorSpec({ code: "DEPT_NOT_EMPTY", details: { members: 2, children: 1 } })).toEqual({
      key: "orgEdit.err.notEmpty.both",
      params: { members: 2, children: 1 },
    });
    expect(
      orgErrorSpec({ code: "DEPT_NOT_EMPTY", details: { members: 3, children: 0 } })?.key,
    ).toBe("orgEdit.err.notEmpty.members");
    expect(
      orgErrorSpec({ code: "DEPT_NOT_EMPTY", details: { members: 0, children: 2 } })?.key,
    ).toBe("orgEdit.err.notEmpty.children");
    expect(orgErrorSpec({ code: "MEMBER_IS_HEAD" })?.key).toBe("orgEdit.err.memberIsHead");
    expect(orgErrorSpec({ code: "DEPT_IN_USE", details: { open_reviews: 2 } })).toEqual({
      key: "orgEdit.err.inUse",
      params: { count: 2 },
    });
    expect(orgErrorSpec({ code: "NAME_TAKEN" })?.key).toBe("orgEdit.err.nameTaken");
    expect(orgErrorSpec({ code: "VALIDATION_ERROR", details: { reason: "dept_cycle" } })?.key).toBe(
      "orgEdit.cycle",
    );
    expect(orgErrorSpec({ code: "KEY_TAKEN" })).toBeNull();
  });
});

describe("báo đổi quyền theo phòng", () => {
  test("0/0 hoặc vắng ⇒ không báo, có đổi ⇒ trả số được/mất", () => {
    expect(accessNote(undefined)).toBeNull();
    expect(accessNote({ gained: 0, lost: 0 })).toBeNull();
    expect(accessNote({ gained: 2, lost: 1 })).toEqual({ gained: 2, lost: 1 });
  });
});
