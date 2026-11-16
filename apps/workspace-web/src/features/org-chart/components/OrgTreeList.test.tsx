// CR-180 · danh sách cây «Sơ đồ tổ chức» trên điện thoại: thụt lề theo độ sâu, vùng bấm ≥ 44px, chọn layout theo màn.
import { describe, expect, test } from "bun:test";
import type { ContractsOrgDept } from "@ai/contracts/pack-contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { buildOrgTree, flattenOrg, orgViewFor } from "../lib/org-tree";
import { OrgTreeList } from "./OrgTreeList";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const dept = (n: number, name: string, parent: number | null, head: number | null) =>
  ({
    id: id(n),
    name,
    parent_id: parent ? id(parent) : null,
    head: head ? { id: id(100 + head), name: `Trưởng ${head}` } : null,
    members: head ? [{ id: id(100 + head), name: `Trưởng ${head}` }] : [],
  }) as ContractsOrgDept;

const TREE = buildOrgTree([
  dept(1, "Ban Giám đốc", null, 1),
  dept(2, "Kinh doanh", 1, 2),
  dept(3, "Miền Bắc", 2, null),
  dept(4, "Kế toán", 1, 4),
]);

describe("flattenOrg", () => {
  test("duyệt trước, kèm độ sâu", () => {
    expect(flattenOrg(TREE).map((r) => [r.node.name, r.depth])).toEqual([
      ["Ban Giám đốc", 0],
      ["Kinh doanh", 1],
      ["Miền Bắc", 2],
      ["Kế toán", 1],
    ]);
  });
  test("rỗng ⇒ rỗng", () => expect(flattenOrg([])).toEqual([]));
});

describe("orgViewFor", () => {
  test("điện thoại ⇒ danh sách, desktop ⇒ canvas", () => {
    expect(orgViewFor(true)).toBe("list");
    expect(orgViewFor(false)).toBe("canvas");
  });
});

describe("OrgTreeList", () => {
  const html = renderToStaticMarkup(<OrgTreeList tree={TREE} onSelectDept={() => {}} />);
  test("mỗi phòng một nút ≥ 44px, có testid và độ sâu", () => {
    expect(html.match(/data-testid="org-node-/g)?.length).toBe(4);
    expect(html).toContain("min-h-11");
    expect(html).toContain('data-depth="2"');
  });
  test("hiện tên phòng và trưởng phòng; phòng không trưởng dùng nhãn «chưa có trưởng»", () => {
    expect(html).toContain("Kinh doanh");
    expect(html).toContain("Trưởng 2");
    expect(html).toMatch(/Chưa có trưởng phòng|contracts.orgChart.noHead/);
  });
});
