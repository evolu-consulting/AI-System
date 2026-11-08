// CR-123 · u12 · mũi tên chỉ bị từ chối khi tạo VÒNG LẶP (không theo "số bước" mà người dùng không thấy): đích nằm trước nguồn
// mà không phải tổ tiên ⇒ sắp lại các bước; Bắt đầu khi → Ký số vẫn bị từ chối kèm lý do.
import { describe, expect, test } from "bun:test";
import { arrowOrder, linkableSteps, triggerArrow } from "./arrow-rules";
import { connectPatch } from "./canvas-connect";
import { emptyStage, type StageDraft } from "./def-form";

const st = (uid: string, step: number, o: Partial<StageDraft> = {}): StageDraft => ({
  ...emptyStage(step),
  uid,
  key: `k-${uid}`,
  name: uid,
  ...o,
});
const toCs = (xs: readonly StageDraft[]) =>
  xs.map((s) => ({
    uid: s.uid,
    step: s.step,
    executor: s.executor,
    real: s.real,
    outcome: s.outcome,
    after: s.after,
    ifx: { yes: s.ifx.yes, no: s.ifx.no },
    node: s.node,
    wait: s.wait,
  }));
const uids = (xs: readonly StageDraft[]) => xs.map((s) => s.uid);

// a → b (nextStep nhảy qua f), f là Kết thúc đứng trước b, chưa ai trỏ tới
const flow = () => [st("a", 0, { nextStep: 2 }), st("f", 1, { outcome: "approved" }), st("b", 2)];

describe("arrowOrder", () => {
  test("đích nằm trước nguồn và không phải tổ tiên ⇒ sắp lại, mũi tên nối được", () => {
    const r = arrowOrder(flow(), "b", "f");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(uids(r.stages)).toEqual(["a", "b", "f"]);
    expect(r.stages.map((s) => s.step)).toEqual([0, 1, 2]);
    expect(r.stages[0]?.nextStep).toBe(1); // a → b đổi số theo bước mới
    const c = connectPatch(toCs(r.stages), { source: "b", target: "f" });
    expect(c).toMatchObject({ ok: true, field: "next" });
  });
  test("bước kế ngầm của stage không đổi khi dời ô (x → y vẫn liền nhau)", () => {
    const stages = [
      st("a", 0, { nextStep: 3 }),
      st("x", 1),
      st("y", 2, { outcome: "rejected" }),
      st("b", 3),
    ];
    const r = arrowOrder(stages, "b", "x");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(uids(r.stages)).toEqual(["a", "b", "x", "y"]);
    expect(r.stages.find((s) => s.uid === "x")?.nextStep).toBeUndefined(); // liền kề ⇒ mặc định
  });
  test("đích là tổ tiên (hoặc bước đầu) ⇒ từ chối vì tạo vòng lặp, không đổi gì", () => {
    const line = [st("a", 0), st("b", 1), st("c", 2)];
    expect(arrowOrder(line, "c", "b")).toEqual({ ok: false, error: "loop" });
    expect(arrowOrder(line, "c", "a")).toEqual({ ok: false, error: "loop" });
    expect(arrowOrder(line, "c", "c")).toEqual({ ok: false, error: "loop" });
  });
  test("đích đã đứng sau nguồn ⇒ giữ nguyên", () => {
    const line = [st("a", 0), st("b", 1), st("c", 2)];
    const r = arrowOrder(line, "a", "c");
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(uids(r.stages)).toEqual(["a", "b", "c"]);
  });
  test("Ký số (gửi + chờ) là một ô: dời đích không xen vào giữa cụm", () => {
    const stages = [
      st("a", 0, { nextStep: 3 }),
      st("t", 1, { outcome: "approved" }),
      st("k1", 2, { node: "contracts.esign", executor: "tool" }),
      st("k2", 3, { node: "contracts.esign", executor: "wait_event" }),
    ];
    const r = arrowOrder(stages, "k2", "t");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(uids(r.stages).join(",")).toBe("a,k1,k2,t");
  });
});

describe("Bắt đầu khi → Ký số", () => {
  const stages = [
    st("a", 0),
    st("k", 1, { real: true, node: "contracts.esign", executor: "tool" }),
    st("w", 2, { node: "contracts.esign", executor: "wait_event" }),
  ];
  test("bị từ chối kèm mã lý do `realNeeds` (hook báo toast)", () => {
    expect(triggerArrow(stages, "k")).toEqual({ error: "realNeeds" });
  });
  test("tới bước khác không phải đầu tiên ⇒ `notFirst`; tới bước đầu ⇒ giữ nguyên", () => {
    expect(triggerArrow([st("a", 0), st("b", 1)], "b")).toEqual({ error: "notFirst" });
    expect(triggerArrow([st("a", 0), st("b", 1)], "a")).toMatchObject({
      stages: [{ uid: "a" }, { uid: "b" }],
    });
  });
});

describe("linkableSteps (ô Gộp tới cùng luật với kéo mũi tên)", () => {
  test("mọi bước không phải tổ tiên / chính nó: bước sau luôn được, bước trước chỉ khi không tạo vòng", () => {
    // a → b (nhảy qua f); f đứng trước b, không ai trỏ tới
    const flow = [st("a", 0, { nextStep: 2 }), st("f", 1, { outcome: "approved" }), st("b", 2)];
    expect(linkableSteps(flow, "b")).toEqual([1]); // f nằm trước nhưng không phải tổ tiên ⇒ được; a là tổ tiên ⇒ không
    expect(linkableSteps(flow, "a")).toEqual([1, 2]);
    expect(linkableSteps([st("a", 0), st("b", 1), st("c", 2)], "c")).toEqual([]); // cả hai đều là tổ tiên
  });
});
