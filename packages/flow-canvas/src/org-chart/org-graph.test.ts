// CR-142 · bộ chuyển phòng ban ⇒ nodes/edges của sơ đồ tổ chức + tìm phòng.
import { describe, expect, test } from "bun:test";
import {
  buildOrgGraph,
  ORG_NODE_W,
  ORG_ROOT_ID,
  type OrgChartDept,
  searchDepts,
} from "./org-graph";

const p = (n: number) => ({ id: `u${n}`, name: `Người ${n}` });
const d = (
  id: string,
  name: string,
  parent: string | null,
  head: number | null,
  ms: number[],
): OrgChartDept => ({
  id,
  name,
  parentId: parent,
  head: head ? p(head) : null,
  members: ms.map(p),
});
const ALL = [
  d("a", "Ban Giám đốc", null, 1, [1]),
  d("b", "Kinh doanh", "a", 2, [2, 3]),
  d("c", "Kế toán", "a", null, [3, 4]),
];

describe("buildOrgGraph", () => {
  test("gốc công ty → phòng → phòng con, nối bằng cạnh", () => {
    const g = buildOrgGraph(ALL, "Công ty");
    expect(g.nodes.map((n) => n.id).sort()).toEqual([ORG_ROOT_ID, "a", "b", "c"].sort());
    expect(g.edges.map((e) => e.id).sort()).toEqual([`${ORG_ROOT_ID}>a`, "a>b", "a>c"].sort());
    const at = (id: string) => g.nodes.find((n) => n.id === id);
    expect(at(ORG_ROOT_ID)?.y).toBe(0);
    expect(at("a")?.y).toBeLessThan(at("b")?.y ?? 0);
    expect(at("b")?.y).toBe(at("c")?.y ?? -1);
    // cha ở giữa hai con, hai con không đè nhau
    expect(at("a")?.x).toBe(Math.round(((at("b")?.x ?? 0) + (at("c")?.x ?? 0)) / 2));
    expect(Math.abs((at("c")?.x ?? 0) - (at("b")?.x ?? 0))).toBeGreaterThanOrEqual(ORG_NODE_W);
  });
  test("số người = số người khác nhau cả nhánh; công ty có tên truyền vào", () => {
    const g = buildOrgGraph(ALL, "Công ty");
    expect(g.nodes.find((n) => n.id === "a")?.data.count).toBe(4);
    expect(g.nodes.find((n) => n.id === "b")?.data.count).toBe(2);
    expect(g.nodes.find((n) => n.id === ORG_ROOT_ID)?.data).toMatchObject({
      kind: "company",
      name: "Công ty",
    });
  });
  test("phòng mồ côi (cha không tồn tại) treo dưới gốc", () => {
    const g = buildOrgGraph([d("x", "Mồ côi", "ghost", null, [])], "Công ty");
    expect(g.edges).toEqual([{ id: `${ORG_ROOT_ID}>x`, source: ORG_ROOT_ID, target: "x" }]);
  });
  test("vòng cha–con bị cắt, mọi phòng vẫn hiện đúng một lần", () => {
    const g = buildOrgGraph([d("x", "X", "y", null, []), d("y", "Y", "x", null, [])], "Công ty");
    expect(g.nodes.length).toBe(3);
    expect(g.edges.length).toBe(2);
  });
  test("không có phòng ⇒ chỉ có gốc", () => {
    expect(buildOrgGraph([], "Công ty").nodes.length).toBe(1);
  });
  test("200 phòng dựng nhanh", () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      d(`n${i}`, `P${i}`, i === 0 ? null : `n${Math.floor((i - 1) / 3)}`, null, [i]),
    );
    const t0 = performance.now();
    const g = buildOrgGraph(many, "Công ty");
    expect(g.nodes.length).toBe(201);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe("searchDepts", () => {
  test("không phân biệt dấu; tên phòng xếp trước người", () => {
    expect(searchDepts(ALL, "ke toan")).toEqual(["c"]);
    expect(searchDepts(ALL, "nguoi 3")).toEqual(["b", "c"]);
    expect(searchDepts(ALL, "kinh")).toEqual(["b"]);
  });
  test("rỗng hoặc không khớp ⇒ []", () => {
    expect(searchDepts(ALL, "  ")).toEqual([]);
    expect(searchDepts(ALL, "zzz")).toEqual([]);
  });
});
