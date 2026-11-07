// CR-123 · u5 · FLOW3-FR-04: node thả từ menu đứng RIÊNG (một nguồn `StageDraft.free`), Lưu bị chặn kèm lý do, nối mũi tên gỡ cờ,
// mũi tên sai luật (Bắt đầu khi → Ký số) bị từ chối.
import { describe, expect, test } from "bun:test";
import { type ConnectStage, connectPatch } from "./canvas-connect";
import { emptyStage, validateDraft } from "./def-form";
import {
  clearFree,
  collapseLoneJoins,
  dropFreeEdges,
  FREE_ERR,
  freeErrors,
  isFree,
  markFree,
} from "./free-nodes";
import { blockedInfo } from "./save-blocked";

const st = (uid: string, step: number, o: Record<string, unknown> = {}) => ({
  ...emptyStage(step),
  uid,
  key: `k-${uid}`,
  name: `Bước ${uid}`,
  ...o,
});

describe("node đứng riêng", () => {
  const base = [st("a", 0), st("b", 1)];
  test("markFree chỉ đánh dấu uid vừa thả, clearFree gỡ cờ của cả cụm node module", () => {
    const m = markFree(base, ["b"]);
    expect(m.map(isFree)).toEqual([false, true]);
    expect(clearFree(m, "b").map(isFree)).toEqual([false, false]);
    const esign = [
      st("a", 0),
      st("k1", 1, { node: "contracts.esign", executor: "tool", free: true }),
      st("k2", 2, { node: "contracts.esign", executor: "wait_event", free: true }),
    ];
    expect(clearFree(esign, "k1").some(isFree)).toBe(false);
  });
  test("cùng một nguồn: freeErrors, validateDraft, blockedInfo (tên bước + chỉ số)", () => {
    const stages = markFree(base, ["b"]);
    expect(freeErrors(stages)).toEqual({ "stages.1.free": FREE_ERR });
    const e = validateDraft({
      key: "ky-so",
      name: "Quy trình",
      description: "",
      hint: "",
      groupIds: [],
      budget: "",
      enabled: false,
      stages,
      sources: [],
      inputs: [],
      ttl: "7",
      noExpiry: false,
    });
    expect(e["stages.1.free"]).toBe(FREE_ERR);
    expect(blockedInfo({ "stages.1.free": FREE_ERR }, stages)).toMatchObject({
      stepName: "Bước b",
      reasonKey: FREE_ERR,
      index: 1,
    });
  });
  test("không vẽ cạnh vào / ra node đứng riêng", () => {
    const edges = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
      { source: "a", target: "c" },
    ];
    expect(dropFreeEdges(edges, new Set(["b"]))).toEqual([{ source: "a", target: "c" }]);
    expect(dropFreeEdges(edges, new Set())).toHaveLength(3);
  });
});

test("cột có node đứng riêng: nút gộp thừa bị bỏ, nối thẳng nguồn tới đích", () => {
  const nodes = [{ id: "a" }, { id: "j0" }, { id: "n" }];
  const edges = [
    { id: "a>j0", source: "a", target: "j0" },
    { id: "j0>n", source: "j0", target: "n" },
  ];
  const r = collapseLoneJoins(nodes, edges);
  expect(r.nodes.map((n) => n.id)).toEqual(["a", "n"]);
  expect(r.edges.map((e) => e.id)).toEqual(["a>n"]);
  const two = collapseLoneJoins(nodes, [...edges, { id: "b>j0", source: "b", target: "j0" }]);
  expect(two.nodes).toHaveLength(3);
});

describe("mũi tên sai luật bị từ chối kèm lý do", () => {
  const s = (uid: string, step: number, o: Partial<ConnectStage> = {}): ConnectStage => ({
    uid,
    step,
    executor: "agent",
    real: false,
    ifx: { yes: null, no: null },
    ...o,
  });
  const flow = [
    s("duyet", 0, { after: "review" }),
    s("tb", 1, { after: "auto" }),
    s("ky", 2, { real: true }),
  ];
  test("Bắt đầu khi tới Ký số bị từ chối, tới bước thường thì không làm gì", () => {
    expect(connectPatch(flow, { source: "trigger", target: "ky" })).toMatchObject({
      ok: false,
      error: "realNeeds",
    });
    expect(connectPatch(flow, { source: "trigger", target: "tb" })).toBeNull();
  });
  test("bước tự động tới Ký số bị từ chối, bước duyệt tới Ký số nối được", () => {
    expect(connectPatch(flow, { source: "tb", target: "ky" })).toMatchObject({
      ok: false,
      error: "realNeeds",
    });
    expect(connectPatch(flow, { source: "duyet", target: "ky" })).toMatchObject({ ok: true });
  });
});
