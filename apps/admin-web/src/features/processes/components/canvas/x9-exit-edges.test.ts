// CR-125 · x9 · MỌI cạnh rời ô Ký số bắt đầu đúng ở chấm đầu ra của nó (Ký xong / Từ chối / Hết hạn): cạnh tiến không còn "rơi" về cổng ẩn ở mép trên,
// và bố cục ELK nhận cạnh theo CỔNG đầu ra (không theo node) ở cả hướng Ngang và Dọc.
import { describe, expect, test } from "bun:test";
import { CONTRACTS_MANIFEST } from "@ai/contracts/app-manifest";
import { portId, stepEdges, toElkGraph } from "@ai/flow-canvas/pure";
import type { Edge } from "@xyflow/react";
import { exitHandle } from "../../lib/canvas-connect";
import { collapseModules, moduleEdges, type NodeInfo, withMainExit } from "./module-cluster";
import type { StageView } from "./stage-view";

type Branch = { on: string; step: number | null };
const view = (
  uid: string,
  step: number,
  o: { node?: string; executor?: string; branches?: Branch[] } = {},
): StageView =>
  ({
    uid,
    index: Number(uid.slice(1)),
    step,
    name: uid,
    backTo: [],
    branch: [],
    ifs: null,
    hasError: false,
    errorKey: null,
    slotInfo: null,
    sys: null,
    dlc: null,
    src: {
      uid,
      step,
      executor: o.executor ?? "agent",
      ...(o.node ? { node: o.node } : {}),
      wait: { source: "", offset: "0", time: "09:00", branches: o.branches },
    },
  }) as unknown as StageView;

const esign = CONTRACTS_MANIFEST.nodes.find((n) => n.key === "contracts.esign");
const info = (k: string): NodeInfo | undefined =>
  k === "contracts.esign" && esign
    ? { exits: (esign.exits ?? []).map((x) => ({ key: x.key, label: x.label.vi, on: x.on })) }
    : undefined;

/** Flow demo + bước "Kế toán duyệt chi" thêm SAU Ký xong: Duyệt · Ký số (gửi + chờ) · Kế toán · Kết thúc ×2. */
const demo = (): StageView[] => [
  view("s0", 0),
  view("s1", 1, { node: "contracts.esign", executor: "tool" }),
  view("s2", 2, {
    node: "contracts.esign",
    executor: "wait_event",
    branches: [
      { on: "esign.declined", step: 5 },
      { on: "esign.voided", step: 5 },
      { on: "timeout", step: 5 },
    ],
  }),
  view("s3", 3), // Kế toán duyệt chi
  view("s4", 4), // Kết thúc · Đã duyệt
  view("s5", 5), // Kết thúc · Từ chối
];

describe("cạnh rời ô Ký số bắt đầu ở chấm đầu ra của nó", () => {
  const c = collapseModules(demo(), info);
  const forward: Edge[] = stepEdges(c.views)
    .filter((e) => e.kind === "forward")
    .map((e) => ({ id: e.id, source: e.source, target: e.target }));
  const all = withMainExit([...forward, ...moduleEdges(c.views)], c.views);
  const ky = c.views.find((v) => v.module);
  const exits = ky?.module?.exits ?? [];

  test("Ký xong → Kế toán dùng chấm 'Ký xong' (không phải cổng ẩn ở mép trên)", () => {
    const main = exits.find((x) => x.main);
    const edge = all.find((e) => e.source === "s1" && e.target === "s3");
    expect(edge?.sourceHandle).toBe(exitHandle(main?.key ?? "", main?.on));
    expect(edge?.sourceHandle).not.toBe("back");
  });
  test("Từ chối và Hết hạn đều có cạnh tới Kết thúc · Từ chối, mỗi cạnh ở chấm riêng", () => {
    const toFail = all.filter((e) => e.source === "s1" && e.target === "s5");
    expect(toFail.map((e) => e.sourceHandle).sort()).toEqual(
      exits
        .filter((x) => !x.main)
        .map((x) => exitHandle(x.key, x.on))
        .sort(),
    );
    expect(toFail).toHaveLength(2);
  });
  test("mọi cạnh rời ô Ký số có sourceHandle là một chấm đầu ra của ô", () => {
    const handles = new Set(exits.map((x) => exitHandle(x.key, x.on)));
    const fromKy = all.filter((e) => e.source === "s1");
    expect(fromKy.length).toBe(3);
    for (const e of fromKy) expect(handles.has(e.sourceHandle ?? "")).toBe(true);
  });
  test("không đụng cạnh quay lại hay cạnh của node thường", () => {
    const e: Edge[] = [
      { id: "a", source: "s1", target: "s0", type: "back", sourceHandle: "back" },
      { id: "b", source: "s0", target: "s1" },
    ];
    expect(withMainExit(e, c.views)).toEqual(e);
  });

  for (const direction of ["RIGHT", "DOWN"] as const) {
    test(`ELK (${direction}): mỗi cạnh của một đầu ra dùng CỔNG của đầu ra đó`, () => {
      const ports = exits.map((x) => exitHandle(x.key, x.on));
      const nodes = c.views.map((v) => ({ id: v.uid, ...(v.uid === "s1" ? { ports } : {}) }));
      const g = toElkGraph(
        nodes,
        all.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? null,
        })),
        { direction },
      );
      for (const e of g.edges ?? []) {
        const src = all.find((a) => a.id === e.id);
        if (src?.source !== "s1") continue;
        expect(e.sources).toEqual([portId("s1", src.sourceHandle ?? "")]);
      }
      const side = direction === "DOWN" ? "SOUTH" : "EAST";
      const kyNode = g.children?.find((n) => n.id === "s1");
      expect(kyNode?.ports?.every((p) => p.layoutOptions["elk.port.side"] === side)).toBe(true);
    });
  }
});
