// CR-139d · dựng cây + chặn vòng lặp của màn «Cơ cấu tổ chức» (admin).
import { describe, expect, test } from "bun:test";
import type { OrgDepartment } from "@ai/contracts/org";
import { buildDeptTree, deptKey, flattenTree, parentChoices } from "./org-edit";

const d = (id: string, parent: string | null = null): OrgDepartment => ({
  group_id: id,
  key: id,
  name: id,
  head_user_id: null,
  parent_group_id: parent,
  member_ids: [],
});
const A = d("a");
const B = d("b", "a");
const C = d("c", "b");
const D = d("d");

describe("dựng cây", () => {
  test("cha trước con, thụt theo độ sâu; cha vắng mặt ⇒ gốc", () => {
    const rows = flattenTree(buildDeptTree([C, D, A, B, d("x", "ngoai")]));
    expect(rows.map((r) => `${r.depth}${r.dept.group_id}`)).toEqual(["0d", "0a", "1b", "2c", "0x"]);
  });
  test("dữ liệu hỏng có vòng không treo và không mất phòng nào", () => {
    const rows = flattenTree(buildDeptTree([d("p", "q"), d("q", "p")]));
    expect(rows.map((r) => r.dept.group_id).sort()).toEqual(["p", "q"]);
  });
});

describe("chọn «Thuộc phòng»", () => {
  test("loại chính nó và mọi con cháu; còn lại giữ thứ tự cây", () => {
    const all = [A, B, C, D];
    expect(parentChoices(all, "a").map((r) => r.dept.group_id)).toEqual(["d"]);
    expect(parentChoices(all, "b").map((r) => r.dept.group_id)).toEqual(["a", "d"]);
    expect(parentChoices(all, "c").map((r) => r.dept.group_id)).toEqual(["a", "b", "d"]);
  });
});

describe("khoá nhóm tự sinh", () => {
  test("bỏ dấu, khớp [a-z0-9-]{2,32}, tên rỗng vẫn hợp lệ", () => {
    const re = /^[a-z0-9-]{2,32}$/;
    expect(deptKey("Phòng Kinh doanh Đông Nam Á", () => 0.5)).toMatch(re);
    expect(deptKey("Phòng Kinh doanh", () => 0)).toBe("phong-kinh-doanh-0000");
    expect(deptKey("  ***  ", () => 0.1)).toMatch(re);
  });
});
