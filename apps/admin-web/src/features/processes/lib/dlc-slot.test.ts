// dlc-engine · bước DLC trên Canvas thư viện: thêm bước từ khung có sẵn, chuẩn hoá (bước = vị trí, khoá = khoá bước, cổng ⇒
// after review), luật form + KIND_MIX khi trộn bước duyệt với bước DLC.
import { describe, expect, it } from "bun:test";
import {
  diagramKind,
  dlcDraftErrors,
  dlcOf,
  freshDlcStage,
  newDlcSlot,
  normalizeDlcStages,
  stageFamily,
} from "./dlc-slot";
import type { StageDraft } from "./draft-types";
import { defaultReviewSlot, normalizeSlotStages } from "./slot-canvas";
import { emptyStage } from "./stage-convert";

const dlcStage = (
  key: string,
  action: string,
  extra: Record<string, unknown> = {},
): StageDraft => ({
  ...emptyStage(),
  executor: "tool",
  tool: { ...emptyStage().tool, key: "dlc-step" },
  key,
  name: key,
  slotRaw: { ...newDlcSlot(key, key), action, agent_key: null, ...extra },
});

const flow = (): StageDraft[] => [
  dlcStage("intake", "intake"),
  dlcStage("spec", "spec", { gate: { group_key: "dlc-editor", back_to: [] } }),
  dlcStage("qc", "qc", { gate: { group_key: "dlc-editor", back_to: ["spec"] } }),
];

describe("dlc-slot", () => {
  it("sơ đồ DLC hợp lệ ⇒ không lỗi", () => {
    expect(diagramKind(flow())).toBe("dlc");
    expect(dlcDraftErrors(flow())).toEqual({});
  });

  it("thêm bước duyệt vào sơ đồ DLC ⇒ KIND_MIX ở bước duyệt", () => {
    const review = { ...emptyStage(), name: "Duyệt", slotRaw: defaultReviewSlot("Duyệt") };
    const e = dlcDraftErrors([...flow(), review]);
    expect(e["stages.3.dlc.kind"]).toBe("process.admin.library.dlc.err.KIND_MIX");
    expect(stageFamily(review)).toBe("review");
  });

  it("thêm bước DLC vào sơ đồ duyệt ⇒ KIND_MIX ở bước DLC", () => {
    const review = { ...emptyStage(), name: "Duyệt", slotRaw: defaultReviewSlot("Duyệt") };
    const e = dlcDraftErrors([review, dlcStage("d2", "agent", { agent_key: "x" })]);
    expect(e["stages.1.dlc.kind"]).toBe("process.admin.library.dlc.err.KIND_MIX");
  });

  it("luật form: thiếu agent, sai thứ tự, quay lại bước sau", () => {
    const st = [
      dlcStage("a", "agent"),
      dlcStage("b", "build", { gate: { group_key: "dlc-editor", back_to: ["c"] } }),
      dlcStage("c", "spec"),
    ];
    const e = dlcDraftErrors(st);
    expect(e["stages.0.dlc.agent_key"]).toBe("process.admin.library.dlc.err.AGENT_REQUIRED");
    expect(e["stages.1.dlc.action"]).toBe("process.admin.library.dlc.err.ORDER_INVALID");
    expect(e["stages.1.dlc.back_to"]).toBe("process.admin.library.dlc.err.BACK_TARGET_INVALID");
  });

  it("thêm bước DLC: khung executor từ bước có sẵn, khoá mới, slot = bước mới", () => {
    const st = flow();
    const s = freshDlcStage(st, "Bước DLC 4");
    expect(s.tool.key).toBe("dlc-step");
    expect(s.key).toBe("d4");
    expect(dlcOf(s)).toMatchObject({ kind: "dlc", key: "d4", action: "agent", gate: null });
    expect(s.uid).not.toBe(st[0]?.uid);
  });

  it("chuẩn hoá: bước = vị trí, khoá stage = khoá bước, cổng ⇒ after review; normalizeSlotStages chuyển sang DLC", () => {
    const st = flow().map((s) => ({ ...s, step: 7, key: "zz" }));
    const n = normalizeDlcStages(st);
    expect(n.map((s) => s.step)).toEqual([0, 1, 2]);
    expect(n.map((s) => s.key)).toEqual(["intake", "spec", "qc"]);
    expect(n.map((s) => s.after)).toEqual(["auto", "review", "review"]);
    expect(normalizeSlotStages(st).map((s) => s.key)).toEqual(["intake", "spec", "qc"]);
  });
});
