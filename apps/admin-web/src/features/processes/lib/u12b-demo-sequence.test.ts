// CR-123 · u12b · đúng trình tự demo (tools/demo/cr122-steps-canvas.ts) trên bản nháp: thả Duyệt (dính cột của bước khác) → Ký xong → nó → Thông báo →
// Kết thúc. Trước đây: mũi tên giữa hai bước CÙNG CỘT bị báo "vòng lặp" (sai) và bước Duyệt còn chung cột ⇒ Hub 422 APPROVE_INVALID khi Lưu.
import { describe, expect, test } from "bun:test";
import { applyConnect, isolateApprovals, triggerArrow } from "./arrow-rules";
import { connectPatch } from "./canvas-connect";
import { placeFresh } from "./canvas-edit";
import { emptyStage, type StageDraft } from "./def-form";
import { approveAloneErrors, endNextErrors, markFree, safeDropStep } from "./free-nodes";

const st = (uid: string, step: number, o: Partial<StageDraft> = {}): StageDraft => ({
  ...emptyStage(step),
  uid,
  key: `k-${uid}`,
  name: uid,
  ...o,
});
const approve = (uid: string, step: number): StageDraft =>
  st(uid, step, { executor: "approve", after: "review", approve: { reject: null, ret: null } });
/** Trưởng phòng duyệt → Nếu → Ký số (gửi + chờ) → Thông báo chuông → Kết thúc · Đã duyệt / Từ chối. */
const baseline = (): StageDraft[] => [
  approve("tp", 0),
  st("if", 1, { executor: "if", ifx: { op: "and", conds: [], yes: 3, no: 6 } }),
  st("ky1", 2, { node: "contracts.esign", executor: "tool", real: true }),
  st("ky2", 3, { node: "contracts.esign", executor: "wait_event" }),
  st("tb", 4, { executor: "notify" }),
  st("kt", 5, { outcome: "approved" }),
  st("tc", 6, { outcome: "rejected" }),
];
const uids = (xs: readonly StageDraft[]) => xs.map((s) => s.uid);
const ok = (r: ReturnType<typeof applyConnect>) => {
  if (!r || "error" in r) throw new Error(`mũi tên bị từ chối: ${JSON.stringify(r)}`);
  return r.stages;
};

describe("trình tự demo: thả Duyệt, nối Ký xong → Duyệt → Thông báo → Kết thúc", () => {
  // thả gần Ký số ⇒ rơi vào CỘT của Thông báo (bước ngay sau cụm Ký số)
  const dropped = () => {
    const base = baseline();
    const r = placeFresh(base, [approve("d", 0)], safeDropStep(base, 2), 300, 900);
    if ("error" in r) throw new Error("thả không được");
    return markFree(r.stages, ["d"]);
  };

  test("điều kiện của lỗi: node vừa thả chung cột với bước khác", () => {
    const s = dropped();
    expect(s.find((x) => x.uid === "d")?.step).toBe(s.find((x) => x.uid === "tb")?.step);
    expect(Object.keys(approveAloneErrors(s))).not.toEqual([]);
  });

  test("Ký xong → Duyệt: Duyệt thành bước RIÊNG ngay sau Ký số (đứng một mình)", () => {
    const s = ok(
      applyConnect(dropped(), { source: "ky1", target: "d", sourceHandle: "exit:done" }),
    );
    expect(uids(s)).toEqual(["tp", "if", "ky1", "ky2", "d", "tb", "kt", "tc"]);
    expect(approveAloneErrors(s)).toEqual({});
    expect(s.some((x) => x.free === true)).toBe(false);
  });

  test("Duyệt → Thông báo và Thông báo → Kết thúc đều nối được (không báo vòng lặp sai)", () => {
    let s = ok(applyConnect(dropped(), { source: "ky1", target: "d", sourceHandle: "exit:done" }));
    s = ok(applyConnect(s, { source: "d", target: "tb" }));
    s = ok(applyConnect(s, { source: "tb", target: "kt" }));
    expect(uids(s)).toEqual(["tp", "if", "ky1", "ky2", "d", "tb", "kt", "tc"]);
    expect(approveAloneErrors(s)).toEqual({});
  });

  test("Duyệt và Thông báo đang CÙNG cột: nối Duyệt → Thông báo tách Thông báo ra bước sau, không phải vòng lặp", () => {
    const s = ok(applyConnect(dropped(), { source: "d", target: "tb" }));
    const step = (u: string) => s.find((x) => x.uid === u)?.step as number;
    expect(step("tb")).toBeGreaterThan(step("d"));
  });

  test("thả lên chính node nguồn ⇒ bỏ qua (không toast vòng lặp)", () => {
    expect(applyConnect(baseline(), { source: "tb", target: "tb" })).toBeNull();
  });

  test("Bắt đầu khi → Ký số vẫn bị từ chối kèm lý do", () => {
    expect(triggerArrow(baseline(), "ky1")).toEqual({ error: "realNeeds" });
  });
});

describe("bước Duyệt luôn đứng một mình", () => {
  test("isolateApprovals tách Duyệt chung cột ra cột riêng ngay sau; không đổi khi đã đứng một mình", () => {
    const shared = [st("a", 0), approve("d", 1), st("b", 1), st("c", 2)];
    const out = isolateApprovals(shared);
    expect(approveAloneErrors(out)).toEqual({});
    expect(out.find((x) => x.uid === "d")?.step).toBeGreaterThan(
      out.find((x) => x.uid === "b")?.step as number,
    );
    expect(isolateApprovals(baseline())).toEqual(baseline());
  });
  test("approveAloneErrors chặn Lưu kèm lý do tại stages.i.step", () => {
    const e = approveAloneErrors([st("a", 0), approve("d", 1), st("b", 1)]);
    expect(Object.keys(e)).toEqual(["stages.1.step"]);
  });
});

describe("u14 · Kết thúc là điểm cuối", () => {
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
  test("mũi tên xuất phát từ Kết thúc luôn bị từ chối (kể cả tới bước nằm trước / sau)", () => {
    const s = baseline();
    for (const target of ["tp", "if", "tb", "tc"])
      expect(connectPatch(toCs(s), { source: "kt", target })).toMatchObject({
        ok: false,
        error: "noNext",
      });
    expect(applyConnect(s, { source: "kt", target: "tb" })).toEqual({ error: "noNext" });
    expect(applyConnect(s, { source: "kt", target: "tc" })).toEqual({ error: "noNext" });
  });
  test("bản nháp còn 'Gộp tới' ở Kết thúc ⇒ lỗi chặn Lưu tại stages.i.nextStep", () => {
    const s = baseline().map((x) => (x.uid === "kt" ? { ...x, nextStep: 6 } : x));
    expect(Object.keys(endNextErrors(s))).toEqual(["stages.5.nextStep"]);
    expect(endNextErrors(baseline())).toEqual({});
  });
});
