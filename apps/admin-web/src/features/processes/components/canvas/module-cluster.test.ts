// CR-123 · FLOW3-FR-14 · gộp cụm stage của node module thành MỘT ô (mẫu "Duyệt theo giá trị": Ký số = gửi + chờ, 3 đầu ra).
import { describe, expect, test } from "bun:test";
import { CONTRACTS_MANIFEST } from "@ai/contracts/app-manifest";
import { stepCount, stepEdges } from "@ai/flow-canvas/pure";
import { collapseModules, connectStages, moduleEdges, type NodeInfo } from "./module-cluster";
import type { StageView } from "./stage-view";

type Branch = { on: string; step: number | null };
const view = (
  uid: string,
  step: number,
  o: { node?: string; executor?: string; branches?: Branch[]; err?: string } = {},
): StageView =>
  ({
    uid,
    index: Number(uid.slice(1)),
    step,
    name: uid,
    backTo: [],
    branch: [],
    ifs: null,
    hasError: o.err !== undefined,
    errorKey: o.err ?? null,
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
    ? {
        exits: (esign.exits ?? []).map((x) => ({ key: x.key, label: x.label.vi, on: x.on })),
      }
    : undefined;

/** Mô phỏng flow mẫu "Duyệt theo giá trị" (flow-templates.def.ts): Nếu · 2 nhánh duyệt · Ký số (gửi + chờ) · 3 Kết thúc. */
const template = (): StageView[] => [
  { ...view("s0", 0, { executor: "if" }), ifs: { yes: 1, no: 2 } },
  view("s1", 1),
  view("s2", 2),
  view("s3", 3, { node: "contracts.esign", executor: "tool" }),
  view("s4", 4, {
    node: "contracts.esign",
    executor: "wait_event",
    branches: [
      { on: "esign.declined", step: 6 },
      { on: "esign.voided", step: 6 },
      { on: "timeout", step: 6 },
    ],
  }),
  view("s5", 5),
  view("s6", 6),
  view("s7", 7),
];

describe("FLOW3-FR-14 · collapseModules (mẫu Duyệt theo giá trị)", () => {
  const c = collapseModules(template(), info);
  test("đúng MỘT ô Ký số với 3 đầu ra Ký xong · Từ chối · Hết hạn", () => {
    const mods = c.views.filter((v) => v.module);
    expect(mods.length).toBe(1);
    expect(mods[0]?.uid).toBe("s3");
    expect(mods[0]?.module?.uids).toEqual(["s3", "s4"]);
    expect(mods[0]?.module?.exits.map((x) => x.label)).toEqual(["Ký xong", "Từ chối", "Hết hạn"]);
    expect(c.views.some((v) => v.uid === "s4")).toBe(false);
  });
  test("ô chiếm một cột: cột sau dồn trái, số cột đếm ô một lần", () => {
    expect(c.views.map((v) => v.step)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(Math.max(...c.views.map((v) => v.step)) + 1).toBe(7);
    expect(c.fromStep(4)).toBe(5); // cột 4 đã gộp = bước thật 5 (Kết thúc · Đã duyệt)
    expect(c.fromStep(7)).toBe(8); // vượt cuối ⇒ bước mới
    expect(c.head.get("s4")).toBe("s3");
  });
  test("nhánh Nếu và cạnh Từ chối/Hết hạn đổi theo cột đã gộp", () => {
    expect(c.views[0]?.ifs).toEqual({ yes: 1, no: 2 });
    const edges = moduleEdges(c.views);
    expect(edges.map((e) => [e.source, e.sourceHandle, e.target, e.label])).toEqual([
      ["s3", "exit:declined:esign.declined,esign.voided", "s6", "Từ chối"],
      ["s3", "exit:expired:timeout", "s6", "Hết hạn"],
    ]);
  });
  test("số stage thật (trần số bước) khác số ô: ô Ký số = 2 stage", () => {
    expect(c.views.length).toBe(7);
    expect(connectStages(c.views).length).toBe(8);
  });
  test("lỗi của stage chờ hiện trên ô gộp", () => {
    const xs = template();
    xs[4] = view("s4", 4, { node: "contracts.esign", executor: "wait_event", err: "k.err" });
    const m = collapseModules(xs, info).views.find((v) => v.module);
    expect([m?.hasError, m?.errorKey]).toEqual([true, "k.err"]);
  });
  test("đồ thị: vào ô tới stage đầu, ra ô đi thẳng bước kế, số cột = 7", () => {
    expect(stepCount(c.views)).toBe(7);
    const fwd = stepEdges(c.views)
      .filter((e) => e.kind === "forward")
      .map((e) => `${e.source}>${e.target}`);
    expect(fwd).toContain("s2>s3");
    expect(fwd).toContain("s3>s5");
    expect(fwd.some((e) => e.includes("s4"))).toBe(false);
  });
  test("không có cụm ⇒ giữ nguyên views", () => {
    const xs = [view("s0", 0), view("s1", 1)];
    const r = collapseModules(xs, info);
    expect(r.views).toEqual(xs);
    expect(r.head.size).toBe(0);
  });
});
