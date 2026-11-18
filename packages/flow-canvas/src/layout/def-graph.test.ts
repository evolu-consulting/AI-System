// CR-184 · sơ đồ chỉ xem của quy trình đang chạy: cạnh Đúng/Sai, Gửi đối tác, Kết thúc, nhảy bước, node/cạnh xyflow.
import { describe, expect, test } from "bun:test";
import { buildDefViewGraph, DEF_TRIGGER_ID, type DefViewStage, defEdges } from "./def-graph";

const st = (uid: string, step: number, extra: Partial<DefViewStage> = {}): DefViewStage => ({
  uid,
  step,
  backTo: [],
  after: "auto",
  branch: [],
  ifs: null,
  terminal: false,
  nextStep: null,
  end: false,
  title: uid,
  sub: null,
  badge: null,
  ...extra,
});
/** duyệt → Nếu (Đúng → ký, Sai → gửi đối tác) → Ký → Kết thúc; gửi đối tác đi tiếp tới Ký. */
const FLOW: DefViewStage[] = [
  st("duyet", 0, { after: "review" }),
  st("neu", 1, { ifs: { yes: 3, no: 2 } }),
  st("gui", 2, { badge: "Gửi đối tác" }),
  st("ky", 3, { badge: "Ký trên tài liệu" }),
  st("ketthuc", 4, { end: true, terminal: true }),
];
const ids = (e: { source: string; target: string }[]) => e.map((x) => `${x.source}>${x.target}`);

describe("defEdges", () => {
  const e = defEdges(FLOW, true);
  test("Bắt đầu nối tới mọi bước đầu", () => {
    expect(ids(e)).toContain(`${DEF_TRIGGER_ID}>duyet`);
  });
  test("node Nếu có đúng hai cạnh có nhãn Đúng / Sai tới bước đích", () => {
    const branch = e.filter((x) => x.source === "neu");
    expect(branch.map((x) => [x.target, x.side])).toEqual([
      ["ky", "yes"],
      ["gui", "no"],
    ]);
  });
  test("Gửi đối tác đi tiếp tới Ký, Ký tới Kết thúc, Kết thúc không đi tiếp", () => {
    expect(ids(e)).toContain("gui>ky");
    expect(ids(e)).toContain("ky>ketthuc");
    expect(e.some((x) => x.source === "ketthuc")).toBe(false);
  });
  test("Sai vắng đích ⇒ bước kế, có Bắt đầu ⇒ không vẽ cạnh quay lại", () => {
    const f = [st("a", 0, { ifs: { yes: 2, no: null } }), st("b", 1), st("c", 2)];
    expect(defEdges(f, true).filter((x) => x.source === "a")).toHaveLength(2);
    const back = [st("a", 0), st("b", 1, { after: "review", backTo: [0] })];
    expect(defEdges(back, true).some((x) => x.kind === "back")).toBe(false);
    expect(defEdges(back, false).some((x) => x.kind === "back")).toBe(true);
  });
  test("nhảy bước (next_step) thay cạnh tới bước kế", () => {
    const f = [st("a", 0, { nextStep: 2 }), st("b", 1), st("c", 2)];
    const out = ids(defEdges(f, false));
    expect(out).toContain("a>c");
    expect(out).not.toContain("a>b");
  });
});

describe("buildDefViewGraph", () => {
  const pos = new Map(
    [DEF_TRIGGER_ID, ...FLOW.map((s) => s.uid)].map((id, i) => [id, { x: 0, y: i * 100 }]),
  );
  const g = buildDefViewGraph(FLOW, { label: "Bắt đầu", summary: "Bắt đầu khi: …" }, pos);
  test("loại node: Bắt đầu / bước / Nếu / Kết thúc, bước thường đánh số", () => {
    const t = Object.fromEntries(g.nodes.map((n) => [n.id, n.type]));
    expect(t).toEqual({
      trigger: "defTrigger",
      duyet: "defStage",
      neu: "defIf",
      gui: "defStage",
      ky: "defStage",
      ketthuc: "defEnd",
    });
    expect(g.nodes.filter((n) => n.type === "defStage").map((n) => n.data.index)).toEqual([
      1, 2, 3,
    ]);
  });
  test("cạnh Đúng/Sai là kiểu branch có cổng yes/no, cạnh thường là routed", () => {
    const yes = g.edges.find((x) => x.source === "neu" && x.target === "ky");
    expect(yes?.type).toBe("branch");
    expect(yes?.sourceHandle).toBe("yes");
    expect(g.edges.find((x) => x.id === "gui>ky")?.type).toBe("routed");
  });
  test("đầu vào ELK: Nếu có hai cổng, Kết thúc ở tầng cuối, Bắt đầu ở tầng đầu", () => {
    const n = Object.fromEntries(g.layout.nodes.map((x) => [x.id, x]));
    expect(n.neu?.ports).toEqual(["yes", "no"]);
    expect(n.ketthuc?.layer).toBe("last");
    expect(n.trigger?.layer).toBe("first");
  });
  test("chưa có toạ độ ELK ⇒ chưa có node nào (host chờ)", () => {
    expect(buildDefViewGraph(FLOW, null, null).nodes).toHaveLength(0);
  });
});

describe("CR-182 · vai trên node", () => {
  const role = {
    line: "Vai · Giám đốc",
    who: null,
    warn: "⚠ Chưa giao người",
    kind: null,
  } as const;
  test("node mang vai + người, bước đang chọn đánh dấu selected", () => {
    const stages = [
      st("a", 0, { role }),
      st("b", 1, { role: { ...role, who: "Nhóm A · 3 người", kind: "group" } }),
    ];
    const auto = new Map([
      ["trigger", { x: 0, y: 0 }],
      ["a", { x: 0, y: 1 }],
      ["b", { x: 0, y: 2 }],
    ]);
    const g = buildDefViewGraph(stages, { label: "Bắt đầu", summary: "" }, auto, "b");
    const a = g.nodes.find((n) => n.id === "a");
    const b = g.nodes.find((n) => n.id === "b");
    expect(a?.data.role?.who).toBeNull();
    expect(a?.data.selected).toBe(false);
    expect(b?.data.role?.who).toBe("Nhóm A · 3 người");
    expect(b?.data.selected).toBe(true);
  });
  test("bước không có vai ⇒ role null", () => {
    const g = buildDefViewGraph([st("a", 0)], null, new Map([["a", { x: 0, y: 0 }]]));
    expect(g.nodes[0]?.data.role).toBeNull();
  });
});
