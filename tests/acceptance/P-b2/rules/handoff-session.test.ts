// HUB-FR-136 (SHOULD) · AC-PB2-09/10 · G-5 · G-7 · test-plan-cases §3.1 `handoff-session` (RH-04…RH-09, RR-01…RR-10):
// `runs/handoff.rules.ts` (`handoffBlock`), `runs/session.rules.ts` (`sessionPlan`, `deltaPrompt`), `defs/def.rules.ts`
// (`ensureHandoff`) — plan §4.1–§4.2. Module/hàm vắng ⇒ đỏ ở `fn(...)`. RR-11 (SQL `continuing`) ở int `tok/resume`.
import { describe, expect, it } from "bun:test";
import { fn, loadDefRules, loadHandoffRules, loadSessionRules } from "../_support/_modules";
import { type Json, st } from "../_support/stages";

const ho = await loadHandoffRules();
const se = await loadSessionRules();
const df = await loadDefRules();

describe("RH · khối Bàn giao + ensureHandoff [HUB-FR-136][AC-PB2-09]", () => {
  it("HUB-FR-136 · RH-04 · handoffBlock([]) / mọi handoff null ⇒ null", () => {
    const b = fn(ho, "handoffBlock");
    expect(b([])).toBeNull();
    expect(b([{ name: "Phân tích", file: "s0-v1-a.md", handoff: null }])).toBeNull();
  });
  it("HUB-FR-136 · RH-05 · handoffBlock có tiêu đề 'Bàn giao từ bước trước:', '### Phân tích (s0-v1-phan-tich.md)', nội dung", () => {
    const t = fn(
      ho,
      "handoffBlock",
    )([{ name: "Phân tích", file: "s0-v1-phan-tich.md", handoff: "HANDOFF-OK" }]);
    expect(t).toContain("Bàn giao từ bước trước:");
    expect(t).toContain("### Phân tích (s0-v1-phan-tich.md)");
    expect(t).toContain("HANDOFF-OK");
  });
  it("HUB-FR-136 · RH-06 · handoff 900 ký tự ⇒ khối có 800 ký tự + '…', không có ký tự 801", () => {
    const t = fn(
      ho,
      "handoffBlock",
    )([{ name: "A", file: "s0-v1-a.md", handoff: "H".repeat(900) }]) as string;
    expect(t).toContain(`${"H".repeat(800)}…`);
    expect(t).not.toContain("H".repeat(801));
  });
  it("HUB-FR-136 · RH-07 · ensureHandoff: thiếu ⇒ thêm 'Bàn giao' CUỐI + '\\n\\n## Bàn giao\\n'; ' bàn GIAO ' có sẵn ⇒ không đổi; idempotent", () => {
    const e = fn(df, "ensureHandoff");
    const s = st({ key: "a", review: null });
    const once = e(s);
    expect(once.output.required_sections).toEqual(["Bảng ý", "Tổng tiền", "Bàn giao"]);
    expect(once.output.template).toBe(`${s.output.template}\n\n## Bàn giao\n`);
    expect(e(once)).toEqual(once);
    const has = st({
      key: "b",
      sections: ["Bảng ý", " bàn GIAO "],
      template: "## Bảng ý\n\n## bàn GIAO\n",
    });
    expect(e(has).output).toEqual(has.output);
  });
  it("HUB-FR-136 · RH-08 · required_sections đã 20 mục hoặc template sát trần 20 000 ⇒ không thêm (giữ hợp lệ schema)", () => {
    const e = fn(df, "ensureHandoff");
    const full = st({ key: "a", sections: Array.from({ length: 20 }, (_, i) => `Mục ${i + 1}`) });
    expect(e(full).output).toEqual(full.output);
    const big: Json = st({ key: "b" });
    big.output.template = "x".repeat(19_995);
    expect(e(big).output).toEqual(big.output);
  });
  it("HUB-FR-136 · RH-09 · G-5 · stage `team` ⇒ không đổi; stage `agent` cùng def vẫn được thêm", () => {
    const e = fn(df, "ensureHandoff");
    const team = st({ key: "t", team: "b2b20000-0000-4000-8000-000000000777" });
    expect(e(team).output).toEqual(team.output);
    expect(e(st({ key: "a" })).output.required_sections.at(-1)).toBe("Bàn giao");
  });
});

type Ctx = {
  executor: "agent" | "team";
  rerun: boolean;
  continuing: boolean;
  sameAgentInStep: boolean;
  lastWriterIsSelf: boolean;
  sessionExists: boolean;
};
const ctx = (o: Partial<Ctx>): Ctx => ({
  executor: "agent",
  rerun: true,
  continuing: false,
  sameAgentInStep: false,
  lastWriterIsSelf: true,
  sessionExists: true,
  ...o,
});
const P = (useSession: boolean, resume: boolean, clearSession: boolean) => ({
  useSession,
  resume,
  clearSession,
});

describe("RR · sessionPlan + deltaPrompt [HUB-FR-136][AC-PB2-10]", () => {
  it("AC-PB2-10 · RR-01 · team ⇒ {true,false,false} (giữ cũ)", () => {
    expect(fn(se, "sessionPlan")(ctx({ executor: "team" }))).toEqual(P(true, false, false));
  });
  it("AC-PB2-10 · RR-02 · sameAgentInStep ⇒ {false,false,false}", () => {
    expect(fn(se, "sessionPlan")(ctx({ sameAgentInStep: true }))).toEqual(P(false, false, false));
  });
  it("AC-PB2-10 · RR-03 · rerun ∧ lastWriterIsSelf ∧ sessionExists ⇒ {true,true,false}", () => {
    expect(fn(se, "sessionPlan")(ctx({}))).toEqual(P(true, true, false));
  });
  it("AC-PB2-10 · RR-04 · lần đầu (rerun:false) ⇒ {true,false,true} (chạy mới, xoá session)", () => {
    expect(fn(se, "sessionPlan")(ctx({ rerun: false }))).toEqual(P(true, false, true));
  });
  it("AC-PB2-10 · RR-05 · rerun ∧ ¬lastWriterIsSelf / ¬sessionExists ⇒ {true,false,true}", () => {
    const p = fn(se, "sessionPlan");
    expect(p(ctx({ lastWriterIsSelf: false }))).toEqual(P(true, false, true));
    expect(p(ctx({ sessionExists: false }))).toEqual(P(true, false, true));
  });
  it("AC-PB2-10 · RR-06 · deltaPrompt: 'Góp ý cần sửa:\\n' + góp ý; có mục ⇒ 'Mục cần sửa: Tổng tiền'", () => {
    const d = fn(se, "deltaPrompt");
    const a = d("Thiếu MST", null) as string;
    expect(a.startsWith("Góp ý cần sửa:\n")).toBe(true);
    expect(a).toContain("Thiếu MST");
    expect(a).not.toContain("Mục cần sửa");
    expect(d("x", ["Tổng tiền"])).toContain("Mục cần sửa: Tổng tiền");
  });
  it("AC-PB2-10 · RR-07 · deltaPrompt chỉ delta: không chứa 'Đầu vào' / 'Bàn giao'", () => {
    const a = fn(se, "deltaPrompt")("Thiếu MST", ["Bảng ý"]) as string;
    expect(a).not.toContain("Đầu vào");
    expect(a).not.toContain("Bàn giao");
  });
  it("AC-PB2-10 · RR-08 · continuing (vừa trả lời cùng attempt; rerun:false, lastWriterIsSelf:false) ⇒ {true,true,false}", () => {
    expect(
      fn(se, "sessionPlan")(ctx({ continuing: true, rerun: false, lastWriterIsSelf: false })),
    ).toEqual(P(true, true, false));
  });
  it("AC-PB2-10 · RR-10 · continuing ∧ ¬sessionExists ⇒ {true,false,true}", () => {
    expect(
      fn(se, "sessionPlan")(ctx({ continuing: true, rerun: false, sessionExists: false })),
    ).toEqual(P(true, false, true));
  });
  it("AC-PB2-10 · RR-09 · thứ tự ưu tiên team → sameAgentInStep → continuing", () => {
    const p = fn(se, "sessionPlan");
    expect(p(ctx({ continuing: true, sameAgentInStep: true }))).toEqual(P(false, false, false));
    expect(p(ctx({ continuing: true, executor: "team" }))).toEqual(P(true, false, false));
  });
  it("AC-PB2-10 · G-7 · SESSION_RESUME_MAX_AGE_S = 86400", () => {
    expect(se.SESSION_RESUME_MAX_AGE_S).toBe(86_400);
  });
});
