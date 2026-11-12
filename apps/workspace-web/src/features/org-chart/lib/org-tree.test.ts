// CR-139 · Q13 · dựng cây + tìm trong sơ đồ tổ chức.
import { describe, expect, test } from "bun:test";
import type { ContractsOrgDept } from "@ai/contracts/pack-contracts";
import { buildOrgTree, filterOrg, headcount } from "./org-tree";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const p = (n: number) => ({ id: id(n), name: `Người ${n}` });
const d = (
  n: number,
  name: string,
  parent: number | null,
  head: number | null,
  ms: number[],
): ContractsOrgDept => ({
  id: id(n),
  name,
  parent_id: parent ? id(parent) : null,
  head: head ? p(head) : null,
  members: ms.map(p),
});

const ALL = [
  d(1, "Ban Giám đốc", null, 10, [10]),
  d(2, "Kinh doanh", 1, 11, [11, 12]),
  d(3, "Kế toán – Tài chính", 1, null, [13, 12]),
];

describe("buildOrgTree", () => {
  test("gốc + con theo parent_id", () => {
    const t = buildOrgTree(ALL);
    expect(t.map((n) => n.name)).toEqual(["Ban Giám đốc"]);
    expect(t[0]?.children.map((n) => n.name)).toEqual(["Kinh doanh", "Kế toán – Tài chính"]);
  });
  test("cha không còn trong danh sách ⇒ thành gốc; vòng cha–con không treo", () => {
    const t = buildOrgTree([
      d(2, "A", 9, null, []),
      d(3, "B", 4, null, []),
      d(4, "C", 3, null, []),
    ]);
    expect(t.length).toBeGreaterThanOrEqual(2);
  });
  test("headcount đếm mỗi người một lần", () => {
    const [root] = buildOrgTree(ALL);
    expect(root && headcount(root)).toBe(4);
  });
});

describe("filterOrg", () => {
  const roots = buildOrgTree(ALL);
  test("tìm không dấu theo tên phòng", () => {
    expect(filterOrg(roots, "ke toan")[0]?.children.map((n) => n.name)).toEqual([
      "Kế toán – Tài chính",
    ]);
  });
  test("tìm theo người ⇒ giữ tổ tiên", () => {
    const r = filterOrg(roots, "người 13");
    expect(r[0]?.name).toBe("Ban Giám đốc");
    expect(r[0]?.children.map((n) => n.name)).toEqual(["Kế toán – Tài chính"]);
  });
  test("không khớp ⇒ rỗng; query trống ⇒ cả cây", () => {
    expect(filterOrg(roots, "zzz")).toEqual([]);
    expect(filterOrg(roots, " ")).toHaveLength(1);
  });
});
