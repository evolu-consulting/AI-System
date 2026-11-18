// CR-185 · sơ đồ Sổ Hợp Tác (`buildDefViewGraph` + `graphOfStages` của server) và trang quản trị (stageViews → collapseModules → linkedEdges + moduleEdges)
// dựng từ CÙNG một def phải ra CÙNG tập nút và CÙNG tập cạnh (Bắt đầu, tiến, Đúng/Sai, nhảy bước, đầu ra Từ chối · Hết hạn, Kết thúc thật).
import { describe, expect, test } from "bun:test";
import { CONTRACTS_MANIFEST } from "@ai/contracts/app-manifest";
import { buildDefViewGraph, type DefViewStage } from "@ai/flow-canvas/pure";
import { graphOfStages } from "../../../../../../hub-api/src/modules/packs/contracts/domain/event-flow-graph.rules";
import { FLOW_TEMPLATES as LIBRARY } from "../../../../../../hub-api/src/modules/processes/library/flow-templates.def";
import { FLOW_TEMPLATES as FIXTURES } from "../../lib/__fixtures__/flow-fixtures";
import { toDraft } from "../../lib/def-form";
import { linkedEdges } from "./linked-edges";
import { collapseModules, moduleEdges, type NodeInfo } from "./module-cluster";
import { stageViews } from "./stage-view";

const esign = CONTRACTS_MANIFEST.nodes.find((n) => n.key === "contracts.esign");
const info = (k: string): NodeInfo | undefined =>
  k === "contracts.esign" && esign
    ? { exits: (esign.exits ?? []).map((x) => ({ key: x.key, label: x.label.vi, on: x.on })) }
    : undefined;

const pairs = (es: { source: string; target: string }[]) =>
  [...new Set(es.map((e) => `${e.source}>${e.target}`))].sort();

/** Phía admin: nút = uid → khoá stage; cạnh = linkedEdges + Bắt đầu + đầu ra có tên (đúng cách ProcessCanvas ghép). */
function adminSide(stages: unknown[]) {
  const d = toDraft({
    key: "k",
    name: "n",
    description: "",
    input_hint: "",
    run_group_ids: [],
    stages,
    token_budget: null,
    enabled: true,
    sources: [],
    inputs: [],
    ttl_days: 7,
  } as never);
  const views = stageViews(d.stages, {}, { agents: [], teams: [], tools: [] } as never);
  const key = new Map(views.map((v) => [v.uid, (stages[v.index] as { key: string }).key]));
  const shown = collapseModules(views, info).views;
  const trig = { label: "x", summary: "y" };
  const edges = [
    ...shown.filter((v) => v.step === 0).map((v) => ({ source: "trigger", target: v.uid })),
    ...linkedEdges(shown, trig),
    ...moduleEdges(shown),
  ].map((e) => ({
    source: key.get(e.source) ?? e.source,
    target: key.get(e.target) ?? e.target,
  }));
  return { nodes: shown.map((v) => key.get(v.uid) as string).sort(), edges: pairs(edges) };
}

/** Phía Sổ Hợp Tác: graph do server dựng → DefViewStage (như `viewStages`) → `buildDefViewGraph`. */
function shtSide(stages: unknown[]) {
  const st: DefViewStage[] = graphOfStages(stages).map((g) => ({
    uid: g.key,
    step: g.step,
    backTo: g.backTo,
    after: g.after,
    branch: g.branch,
    ifs: g.ifs,
    terminal: g.terminal,
    nextStep: g.nextStep,
    end: g.kind === "end",
    title: g.name,
    sub: null,
    badge: null,
    node: g.node,
    exec: g.exec,
    waitBranches: g.waitBranches,
  }));
  const probe = buildDefViewGraph(st, { label: "x", summary: "y" }, null);
  const at = new Map(probe.layout.nodes.map((n) => [n.id, { x: 0, y: 0 }]));
  const g = buildDefViewGraph(st, { label: "x", summary: "y" }, at);
  return { nodes: g.nodes.map((n) => n.id).sort(), edges: pairs(g.edges) };
}

describe("sơ đồ Sổ Hợp Tác = sơ đồ trang quản trị (cùng def ⇒ cùng nút, cùng cạnh)", () => {
  const all = [
    ...LIBRARY.map((t) => ({ name: `Thư viện · ${t.name}`, stages: t.stages() as unknown[] })),
    ...FIXTURES.map((t) => ({ name: `Mẫu · ${t.name}`, stages: t.stages() as unknown[] })),
  ];
  for (const t of all) {
    test(t.name, () => {
      const a = adminSide(t.stages);
      const s = shtSide(t.stages);
      expect(s.nodes.filter((n) => n !== "trigger")).toEqual(a.nodes);
      expect(s.edges).toEqual(a.edges);
    });
  }
  test("Duyệt 2 cấp: cùng một định nghĩa ra cùng tập nút và cùng tập cạnh ở hai bên", () => {
    const t = LIBRARY[0] as NonNullable<(typeof LIBRARY)[number]>;
    const stages = t.stages() as unknown[];
    expect(shtSide(stages)).toEqual({
      nodes: ["trigger", ...adminSide(stages).nodes].sort(),
      edges: adminSide(stages).edges,
    });
  });
  test("Gửi ký + Chờ ký là MỘT ô, nút Kết thúc chỉ là stage có outcome (3 nút ở mẫu Duyệt 2 cấp)", () => {
    const t = LIBRARY[0];
    const s = shtSide((t as NonNullable<typeof t>).stages() as unknown[]);
    expect(s.nodes).not.toContain("cho-ky");
    expect(s.nodes.filter((n) => n.startsWith("ket-thuc-"))).toHaveLength(3);
    expect(s.edges).toContain("ky-so>ket-thuc-rejected");
  });
});
