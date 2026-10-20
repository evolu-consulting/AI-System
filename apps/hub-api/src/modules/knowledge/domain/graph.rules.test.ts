// G1 · luật thuần đồ thị: dựng {nodes, links} từ hàng SQL đúng như graph.neighbourhood / graph.corpus của mgmt-app.
import { describe, expect, it } from "bun:test";
import {
  checkIds,
  checkKeys,
  clampInt,
  GRAPH_LIMITS,
  toCorpus,
  toNeighbourhood,
} from "./graph.rules";
import type { CorpusRow, NbRow } from "./graph.types";

const D = "00000000-0000-4000-8000-000000000001";
const D2 = "00000000-0000-4000-8000-000000000002";
const D3 = "00000000-0000-4000-8000-000000000003";
const nb = (
  row: NbRow["row"],
  src: string,
  dst: string | null,
  label: string,
  ntype: string,
  ltype: string | null,
): NbRow => ({
  row,
  src,
  dst,
  label,
  ntype,
  ltype,
});

describe("G1 · toNeighbourhood", () => {
  it("tài liệu + MENTIONS + REL + ALIAS_OF + SIMILAR/CONFLICTS + LINKS_TO, theo thứ tự của mgmt-app bất kể thứ tự hàng", () => {
    const rows: NbRow[] = [
      nb("doclink", D, D3, "g3", "Document", "LINKS_TO"),
      nb("rel", "Person:an", "Project:apollo", "Apollo", "Project", "LEADS"),
      nb("alias", "Person:an", "Person:an nguyen", "An Nguyễn", "Person", "ALIAS_OF"),
      nb("mention", D, "Project:apollo", "Apollo", "Project", "MENTIONS"),
      nb("doclink", D, D2, "g2", "Document", "SIMILAR"),
      nb("mention", D, "Person:an", "An", "Person", "MENTIONS"),
      nb("doc", D, null, "g1", "Document", null),
      nb("doclink", D, D2, "g2", "Document", "CONFLICTS"),
    ];
    const g = toNeighbourhood(D, rows);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(
      [D, D2, D3, "Person:an", "Person:an nguyen", "Project:apollo"].sort(),
    );
    expect(g.nodes[0]).toEqual({ id: D, label: "g1", type: "Document" });
    expect(g.links.map((l) => l.type)).toEqual([
      "MENTIONS",
      "MENTIONS",
      "LEADS",
      "ALIAS_OF",
      "SIMILAR",
      "CONFLICTS",
      "LINKS_TO",
    ]);
    expect(g.links.find((l) => l.type === "LEADS")).toEqual({
      source: "Person:an",
      target: "Project:apollo",
      type: "LEADS",
    });
    expect(g.links.filter((l) => l.type === "MENTIONS").every((l) => l.source === D)).toBe(true);
    expect(g.links.find((l) => l.type === "LINKS_TO")).toEqual({
      source: D,
      target: D3,
      type: "LINKS_TO",
    });
  });

  it("MENTIONS ghi đè node thực thể; REL/ALIAS chỉ thêm khi chưa có (setdefault)", () => {
    const g = toNeighbourhood(D, [
      nb("rel", "A:x", "B:y", "nhãn từ REL", "B", "R"),
      nb("mention", D, "B:y", "nhãn thật", "B", "MENTIONS"),
      nb("alias", "B:y", "B:z", "z", "B", "ALIAS_OF"),
      nb("alias", "B:y", "B:z", "z khác", "B", "ALIAS_OF"),
    ]);
    expect(g.nodes.find((n) => n.id === "B:y")?.label).toBe("nhãn thật");
    expect(g.nodes.find((n) => n.id === "B:z")?.label).toBe("z");
  });

  it("tài liệu không tồn tại (0 hàng) ⇒ đồ thị rỗng", () => {
    expect(toNeighbourhood(D, [])).toEqual({ nodes: [], links: [] });
  });
});

describe("G1 · toCorpus", () => {
  it("node tài liệu trước, cạnh mang n; giữ thứ tự SQL trong mỗi loại", () => {
    const rows: CorpusRow[] = [
      { row: "shares", a: D, b: D2, label: null, type: "SHARES", n: 3 },
      { row: "node", a: D, b: null, label: "g1", type: "Document", n: 0 },
      { row: "pair", a: D, b: D2, label: null, type: "CONFLICTS", n: 1 },
      { row: "shares", a: D, b: D3, label: null, type: "SHARES", n: 2 },
      { row: "link", a: D2, b: D3, label: null, type: "LINKS_TO", n: 1 },
    ];
    const g = toCorpus(rows);
    expect(g.nodes).toEqual([{ id: D, label: "g1", type: "Document" }]);
    expect(g.links).toEqual([
      { source: D, target: D2, type: "CONFLICTS", n: 1 },
      { source: D2, target: D3, type: "LINKS_TO", n: 1 },
      { source: D, target: D2, type: "SHARES", n: 3 },
      { source: D, target: D3, type: "SHARES", n: 2 },
    ]);
  });
});

describe("G1 · kiểm đầu vào", () => {
  it("clampInt kẹp, vắng/sai ⇒ mặc định", () => {
    expect([
      clampInt(undefined, 1, 10, 5),
      clampInt("x", 1, 10, 5),
      clampInt(99, 1, 10, 5),
      clampInt(0, 1, 10, 5),
    ]).toEqual([5, 5, 10, 1]);
    expect(clampInt("3.7", 1, 10, 5)).toBe(3);
  });
  it("checkKeys / checkIds: rỗng, quá dài, quá nhiều, không phải uuid", () => {
    expect(checkKeys(["Project:apollo"])).toBeNull();
    expect(checkKeys(["  "])).toBe("KEY_INVALID");
    expect(checkKeys(["x".repeat(GRAPH_LIMITS.keyMax + 1)])).toBe("KEY_INVALID");
    expect(checkKeys(Array(GRAPH_LIMITS.keysMax + 1).fill("k"))).toBe("TOO_MANY");
    expect(checkIds([D], 10)).toBeNull();
    expect(checkIds(["g1:0"], 10)).toBe("ID_INVALID");
    expect(checkIds([D, D2], 1)).toBe("TOO_MANY");
  });
});
