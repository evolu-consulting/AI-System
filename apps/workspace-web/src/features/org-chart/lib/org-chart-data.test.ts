// CR-142 · bộ chuyển dữ liệu API ⇒ sơ đồ cây.
import { expect, test } from "bun:test";
import { buildOrgGraph } from "@ai/flow-canvas/pure";
import { toChartDepts } from "./org-chart-data";

test("phòng API ⇒ node phòng có trưởng phòng + số người; cha vắng ⇒ dưới gốc", () => {
  const u = { id: "u1", name: "An" };
  const depts = toChartDepts([
    {
      id: "d1",
      name: "Kinh doanh",
      parent_id: "ghost",
      head: u,
      members: [u, { id: "u2", name: "Bình" }],
    },
  ]);
  const g = buildOrgGraph(depts, "Công ty");
  expect(g.edges[0]?.source).toBe("__company__");
  expect(g.nodes.find((n) => n.id === "d1")?.data).toMatchObject({ count: 2, head: u });
});
