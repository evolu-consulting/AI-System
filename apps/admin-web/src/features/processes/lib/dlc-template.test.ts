// dlc-step-library · chép bước DLC mẫu vào Canvas (phân giải "Từ chối ⇒"), cổng "Từ chối" kéo nối (mọi bước có cổng, chỉ bước đứng
// trước), đích vẽ trên canvas, chuẩn hoá giữ `backTo`, form bước mẫu (khoá từ tên, cổng, lỗi ô).
import { describe, expect, it } from "bun:test";
import { DLC_STEP_ACTIONS, type DlcStepTemplate } from "@ai/contracts/hub-admin";
import {
  DLC_ACTIONS,
  type DlcSlot,
  dlcBackSteps,
  dlcOf,
  linkDlcReject,
  newDlcSlot,
  normalizeDlcStages,
} from "./dlc-slot";
import { blankDlcStep, dlcStepErrors, keyFromName, withGate, withName } from "./dlc-step-form";
import { dlcSlotFromTemplate, resolveRejectTo } from "./dlc-template";
import type { StageDraft } from "./draft-types";
import { freshDlcStage } from "./fresh-stages";
import { emptyStage } from "./stage-convert";

const slot = (key: string, action: string): DlcSlot =>
  ({ ...newDlcSlot(key, key), action }) as DlcSlot;
const stage = (
  key: string,
  action: string,
  gate: DlcSlot["gate"] = null,
  step = 0,
): StageDraft => ({
  ...emptyStage(),
  executor: "tool",
  tool: { ...emptyStage().tool, key: "dlc-step" },
  key,
  name: key,
  step,
  slotRaw: { ...slot(key, action), gate } as unknown as Record<string, unknown>,
});
const g = (back_to: string[] = []) => ({ group_key: "dlc-editor", back_to });
const flow = () => [
  stage("intake", "intake", null, 0),
  stage("spec", "spec", g(), 1),
  stage("qc", "qc", g(["spec"]), 2),
  stage("build", "build", null, 3),
  stage("report", "report", g(), 4),
];
const tpl: DlcStepTemplate = {
  id: "11111111-1111-4111-8111-111111111111",
  key: "review",
  name: "Duyệt kết quả",
  action: "report",
  agent_key: null,
  instruction: "Kiểm kỹ",
  gate_group: "dlc-qa",
  reject_to: "build",
  max_rounds: 2,
  timeout_min: 30,
  version: 1,
  updated_at: "2026-11-05T00:00:00.000Z",
};

describe("dlc-step-library · resolveRejectTo", () => {
  const before = [slot("a", "spec"), slot("b", "build"), slot("c", "spec"), slot("d", "qc")];
  it("self / null ⇒ [] (engine làm lại chính bước); prev ⇒ bước ngay trước", () => {
    expect(resolveRejectTo("self", before)).toEqual([]);
    expect(resolveRejectTo(null, before)).toEqual([]);
    expect(resolveRejectTo("prev", before)).toEqual(["d"]);
    expect(resolveRejectTo("prev", [])).toEqual([]);
  });
  it("<việc> ⇒ bước GẦN NHẤT đứng trước làm việc đó; không có ⇒ []", () => {
    expect(resolveRejectTo("spec", before)).toEqual(["c"]);
    expect(resolveRejectTo("build", before)).toEqual(["b"]);
    expect(resolveRejectTo("deploy", before)).toEqual([]);
  });
  it("việc của admin-web = contract (= gói DLC, test hub)", () => {
    expect([...DLC_ACTIONS]).toEqual([...DLC_STEP_ACTIONS]);
  });
});

describe("dlc-step-library · chèn bước mẫu", () => {
  it("slot chép mọi thuộc tính, khoá mới, cổng quay lại theo bước đứng trước", () => {
    expect(dlcSlotFromTemplate(tpl, "d9", [slot("x", "build")])).toEqual({
      kind: "dlc",
      key: "d9",
      name: "Duyệt kết quả",
      action: "report",
      agent_key: null,
      instruction: "Kiểm kỹ",
      gate: { group_key: "dlc-qa", back_to: ["x"] },
      max_rounds: 2,
      timeout_min: 30,
    });
    expect(dlcSlotFromTemplate({ ...tpl, gate_group: null, reject_to: null }, "d1", []).gate).toBe(
      null,
    );
  });
  it("freshDlcStage có mẫu ⇒ tên mẫu, after review, slot từ mẫu; không mẫu ⇒ bước trống", () => {
    const s = freshDlcStage(flow(), "Bước DLC 6", tpl);
    expect(s.name).toBe("Duyệt kết quả");
    expect(s.after).toBe("review");
    expect(dlcOf(s)).toMatchObject({
      key: "d6",
      gate: { group_key: "dlc-qa", back_to: ["build"] },
    });
    expect(dlcOf(freshDlcStage(flow(), "Bước DLC 6"))).toMatchObject({
      action: "agent",
      gate: null,
    });
  });
});

describe("dlc-step-library · cổng Từ chối trên canvas", () => {
  it("đích vẽ = bước (cột) của `gate.back_to`, chỉ bước đứng trước; không cổng ⇒ []", () => {
    const st = flow();
    expect(dlcBackSteps(st[2] as StageDraft, st)).toEqual([1]);
    expect(dlcBackSteps(st[1] as StageDraft, st)).toEqual([]);
    expect(dlcBackSteps(st[3] as StageDraft, st)).toEqual([]);
  });
  it("kéo cổng của BẤT KỲ bước có cổng tới bước đứng trước ⇒ back_to = [đích]; sau / chính nó / không cổng ⇒ lỗi", () => {
    const st = flow();
    const uid = (i: number) => (st[i] as StageDraft).uid;
    const ok = linkDlcReject(st, uid(4), uid(0));
    expect(ok && "slot" in ok ? [ok.index, ok.slot.gate?.back_to] : null).toEqual([4, ["intake"]]);
    expect(linkDlcReject(st, uid(1), uid(2))).toEqual({ error: "notEarlier" });
    expect(linkDlcReject(st, uid(1), uid(1))).toEqual({ error: "notEarlier" });
    expect(linkDlcReject(st, uid(3), uid(0))).toEqual({ error: "noGate" });
    expect(linkDlcReject(st, uid(1), "nope")).toBeNull();
  });
  it("chuẩn hoá giữ backTo = vị trí bước quay lại (khớp back_to_steps Hub dựng)", () => {
    const n = normalizeDlcStages(flow().map((s) => ({ ...s, step: 9, backTo: [] })));
    expect(n.map((s) => s.backTo)).toEqual([[], [], [1], [], []]);
  });
});

describe("dlc-step-library · form bước mẫu", () => {
  it("khoá tự sinh từ tên (bỏ dấu, đ ⇒ d, số đầu ⇒ b-), sửa tay thì giữ", () => {
    expect(keyFromName("Báo cáo · duyệt Deploy")).toBe("bao-cao-duyet-deploy");
    expect(keyFromName("Đội 2")).toBe("doi-2");
    expect(keyFromName("2 bước")).toBe("b-2-buoc");
    expect(withName(blankDlcStep(), "Spec mới").key).toBe("spec-moi");
    expect(withName({ ...blankDlcStep(), keyAuto: false, key: "x" }, "Spec").key).toBe("x");
  });
  it("bật cổng ⇒ dlc-editor + làm lại chính bước; tắt ⇒ bỏ cả hai; lỗi ô theo contract", () => {
    const on = withGate(blankDlcStep(), true);
    expect([on.gate_group, on.reject_to]).toEqual(["dlc-editor", "self"]);
    expect(withGate(on, false)).toMatchObject({ gate_group: null, reject_to: null });
    const e = dlcStepErrors({ ...blankDlcStep(), max_rounds: 0 });
    expect(Object.keys(e).sort()).toEqual(["agent_key", "key", "max_rounds", "name"]);
    expect(e.name).toBe("process.admin.library.dlc.steps.err.name");
  });
});
