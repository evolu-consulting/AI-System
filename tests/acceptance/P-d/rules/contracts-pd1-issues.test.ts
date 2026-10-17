// HUB-FR-144/145 · AC-H41/H42 · P-d1 contract — hàm thuần `processDefStageIssues` (FE validate live): test-plan-addendum §2
// PD-C15 (hàng WAIT, path theo bảng plan-addendum A2/A8 #58) + ESCALATE_INVALID phía contract (A8 #57). Tách từ
// `contracts-pd1.test.ts` (≤ 400 dòng). Không DB/env. Export mới vắng ⇒ đỏ ở expect của `fn`.
import { describe, expect, it } from "bun:test";
import { fn, loadHubAdmin } from "../_support/modules";
import { agentDraft, DRAFT_INPUTS, G_CAP, G_DUYET, WAIT_EXEC, waitDraft } from "./_contracts";

const ha = await loadHubAdmin();
/** `processDefStageIssues(stages, {inputs})` lọc theo luật. */
async function issuesOf(stages: unknown[], rule: string, ctx: unknown = { inputs: DRAFT_INPUTS }) {
  const f = fn(ha, "processDefStageIssues");
  return (f(stages, ctx) as { path: string; rule: string }[]).filter((i) => i.rule === rule);
}
const W = (path: string) => ({ path, rule: "WAIT_INVALID" });
const fieldExec = (field = "ngay_hd") => ({
  kind: "wait_until",
  from: { kind: "field", stage_key: "doc", field },
  offset_days: -2,
  time: "17:30",
});

describe("PD-C15 · processDefStageIssues hàng WAIT — path theo bảng A2 [plan-addendum A2, A8 #58]", () => {
  it("AC-H41 · PD-C15 · hợp lệ (nguồn input date; nguồn field date ở bước trước) ⇒ []", () => {
    const f = fn(ha, "processDefStageIssues");
    const ctx = { inputs: DRAFT_INPUTS };
    expect(f([waitDraft()], ctx)).toEqual([]);
    expect(f([agentDraft(), waitDraft({ executor: fieldExec() })], ctx)).toEqual([]);
  });
  it("AC-H41 · PD-C15 · after ≠ auto ⇒ WAIT_INVALID path stages.<i>.after", async () => {
    const after = { kind: "review", group_id: G_DUYET, back_to_steps: [] };
    expect(await issuesOf([waitDraft({ after })], "WAIT_INVALID")).toEqual([W("stages.0.after")]);
  });
  it("AC-H41 · PD-C15 · nguồn sai (input không có / không date; field ở bước không nhỏ hơn / không có / không date) ⇒ stages.<i>.executor.from", async () => {
    const inp = (key: string) =>
      waitDraft({ executor: { ...WAIT_EXEC({ from: { kind: "input", key } }), time: "09:00" } });
    expect(await issuesOf([inp("khong-co")], "WAIT_INVALID")).toEqual([
      W("stages.0.executor.from"),
    ]);
    expect(await issuesOf([inp("ghi-chu")], "WAIT_INVALID")).toEqual([W("stages.0.executor.from")]);
    const sameStep = [agentDraft({ step: 0 }), waitDraft({ step: 0, executor: fieldExec() })];
    expect(await issuesOf(sameStep, "WAIT_INVALID")).toEqual([W("stages.1.executor.from")]);
    expect(
      await issuesOf(
        [agentDraft(), waitDraft({ executor: fieldExec("ngay_khac") })],
        "WAIT_INVALID",
      ),
    ).toEqual([W("stages.1.executor.from")]);
    const numField = agentDraft({
      output: { fields: [{ key: "ngay_hd", type: "number", required: true }] },
    });
    expect(
      await issuesOf([numField, waitDraft({ executor: fieldExec() })], "WAIT_INVALID"),
    ).toEqual([W("stages.1.executor.from")]);
    // vắng ctx ⇒ bỏ kiểm nguồn input (plan-contract §3 — giữ test khoá cũ)
    expect(await issuesOf([inp("khong-co")], "WAIT_INVALID", undefined)).toEqual([]);
  });
  it("AC-H41 · PD-C15 · offset_days ∉ −365…365 (bản nháp) ⇒ stages.<i>.executor.offset_days", async () => {
    for (const d of [366, -366]) {
      const st = waitDraft({ executor: { ...WAIT_EXEC({ offset_days: d }), time: "09:00" } });
      expect({ d, v: await issuesOf([st], "WAIT_INVALID") }).toEqual({
        d,
        v: [W("stages.0.executor.offset_days")],
      });
    }
  });
  it("AC-H41 · PD-C15 · time không khớp WAIT_TIME_RE (bản nháp) ⇒ stages.<i>.executor.time", async () => {
    for (const t of ["24:00", "9:00"]) {
      const st = waitDraft({ executor: WAIT_EXEC({ time: t }) });
      expect({ t, v: await issuesOf([st], "WAIT_INVALID") }).toEqual({
        t,
        v: [W("stages.0.executor.time")],
      });
    }
  });
  it("AC-H41 · PD-C15 · real_action / sources / must_know / autofix ⇒ stages.<i>.executor", async () => {
    expect(
      await issuesOf([agentDraft(), waitDraft({ real_action: true })], "WAIT_INVALID"),
    ).toEqual([W("stages.1.executor")]);
    const cases: Record<string, unknown>[] = [
      { sources: [{ source_key: "app-repo" }] },
      { must_know: ["Kiểm hạn hợp đồng"] },
      { autofix: { source_key: "app-repo" } },
    ];
    for (const o of cases)
      expect({ o, v: await issuesOf([waitDraft(o)], "WAIT_INVALID") }).toEqual({
        o,
        v: [W("stages.0.executor")],
      });
  });
});

describe("ESCALATE_INVALID phía contract — processDefStageIssues [plan-addendum A8 #57, plan-domain §4.7]", () => {
  const E = { path: "stages.0.after.escalate", rule: "ESCALATE_INVALID" };
  const rv = (escalate: unknown) =>
    agentDraft({ after: { kind: "review", group_id: G_DUYET, back_to_steps: [], escalate } });
  it("AC-H42 · PD-C15 · escalate trùng Group duyệt ⇒ ESCALATE_INVALID path stages.<i>.after.escalate", async () => {
    expect(await issuesOf([rv({ after_h: 24, group_id: G_DUYET })], "ESCALATE_INVALID")).toEqual([
      E,
    ]);
  });
  it("AC-H42 · PD-C15 · escalate ở stage after auto ⇒ ESCALATE_INVALID", async () => {
    const st = agentDraft({ after: { kind: "auto", escalate: { after_h: 24, group_id: G_CAP } } });
    expect(await issuesOf([st], "ESCALATE_INVALID")).toEqual([E]);
  });
  it("AC-H42 · PD-C15 · after_h 3 / 2161 ⇒ ESCALATE_INVALID; 4 / 2160 / null với Group khác ⇒ []", async () => {
    for (const h of [3, 2161])
      expect({
        h,
        v: await issuesOf([rv({ after_h: h, group_id: G_CAP })], "ESCALATE_INVALID"),
      }).toEqual({ h, v: [E] });
    const f = fn(ha, "processDefStageIssues");
    for (const e of [{ after_h: 4, group_id: G_CAP }, { after_h: 2160, group_id: G_CAP }, null])
      expect({ e, v: f([rv(e)], { inputs: DRAFT_INPUTS }) }).toEqual({ e, v: [] });
  });
});
