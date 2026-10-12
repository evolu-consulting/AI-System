// HUB-FR-104 · HUB-FR-113 · HUB-FR-118 · HUB-FR-136 · test-plan-cases §3.1 `contracts-pb2` (C-01…C-12): hằng + schema zod
// P-b2 (plan §1.1–§1.3) ở `@ai/contracts/{chat,hub-admin}`. Export vắng ⇒ đỏ ở `expect` (không đỏ ở import).
import { describe, expect, it } from "bun:test";
import { EXECUTOR, outputRef, part } from "../../P-a/_support/parts";
import { type Loose, loadChat, loadHubAdmin } from "../_support/_modules";
import { type Json, st } from "../_support/stages";

const c = await loadChat();
const h = await loadHubAdmin();
const U = (n: number) => `b2b20000-0000-4000-8000-${String(700_000 + n).padStart(12, "0")}`;
const AT = "2026-10-12T01:00:00.000Z";
const user = { id: U(1), display_name: "Hoa" };

type Z = {
  safeParse: (v: unknown) => { success: boolean; error?: { issues: { path: unknown[] }[] } };
};
function schema(m: Loose, name: string): Z {
  const s = m[name] as Z | undefined;
  expect({ [name]: typeof s?.safeParse }).toEqual({ [name]: "function" });
  return s as Z;
}
const ok = (m: Loose, name: string, v: unknown) => schema(m, name).safeParse(v).success;

const summary = (o: Json = {}): Json => ({
  id: U(10),
  process: { key: "pb2-par", name: "Song song", version: 1 },
  status: "running",
  current_stage_idx: 1,
  stage_count: 4,
  started_by: user,
  origin: { kind: "room", room_id: U(11) },
  started_at: AT,
  updated_at: AT,
  finished_at: null,
  current_step: 1,
  step_count: 3,
  ...o,
});
const stageView = (o: Json = {}): Json => ({
  idx: 1,
  key: "ra-soat",
  name: "Rà soát code",
  executor: EXECUTOR,
  after: "review",
  real_action: false,
  status: "waiting_review",
  attempt: 1,
  attempt_limit: 4,
  asks_count: 0,
  ask_limit: 3,
  outputs: [],
  current_output_id: null,
  passed_by: null,
  passed_at: null,
  step: 1,
  round: 1,
  back_to_steps: [],
  ...o,
});
const backEvent = (o: Json = {}): Json => ({
  at: AT,
  task_id: U(20),
  from_stage_idx: 3,
  from_step: 2,
  to_step: 0,
  round: 2,
  feedback: "Thiếu ca hồi quy",
  by: user,
  ...o,
});
const fullView = (o: Json = {}): Json => ({
  ...summary(),
  access: "full",
  input: "HD-12",
  stages: [stageView()],
  history: [],
  decision: null,
  my_tasks: [],
  open_tasks: [],
  thread: null,
  can_cancel: true,
  back_rounds: 1,
  back_limit: 3,
  back_events: [backEvent()],
  ...o,
});
const taskView = (o: Json = {}): Json => ({
  access: "task",
  id: U(10),
  process: { key: "pb2-par", name: "Song song" },
  status: "waiting_review",
  stages: [{ idx: 0, name: "Phân tích", status: "done", step: 0, round: 1 }],
  my_tasks: [],
  ...o,
});
const omit = (o: Json, k: string): Json => {
  const { [k]: _drop, ...rest } = o;
  return rest;
};

describe("C · hằng [HUB-FR-104][HUB-FR-136]", () => {
  it("HUB-FR-104 · C-01 · PROCESS_STEP_MAX 9, …_STAGES_MAX 3, BACK_ROUNDS_MAX 3, BACK_EVENTS_MAX 20, HANDOFF_* ; hub-admin re-export", () => {
    const want = {
      PROCESS_STEP_MAX: 9,
      PROCESS_STEP_STAGES_MAX: 3,
      PROCESS_BACK_ROUNDS_MAX: 3,
      BACK_EVENTS_MAX: 20,
      HANDOFF_SECTION: "Bàn giao",
      HANDOFF_TOKENS_MAX: 200,
      HANDOFF_CHARS_PER_TOKEN: 4,
    };
    const pick = (m: Loose) => Object.fromEntries(Object.keys(want).map((k) => [k, m[k]]));
    expect(pick(c)).toEqual(want);
    expect(pick(h)).toEqual(want);
  });
  it("HUB-FR-118 · C-02 · DECISION_REASONS dài 16, phần tử CUỐI 'back_limit'; DECISION_OPTIONS không đổi", () => {
    const r = [...((c.DECISION_REASONS as string[]) ?? [])];
    expect({ n: r.length, last: r.at(-1) }).toEqual({ n: 16, last: "back_limit" });
    expect([...((c.DECISION_OPTIONS as string[]) ?? [])]).toEqual([
      "add_attempt",
      "use_current",
      "cancel",
    ]);
  });
  it("HUB-FR-118 · C-03 · CHAT_PROCESS_ERRORS 13 mã có BACK_TARGET_INVALID 422; HUB_ADMIN_PROCESS_ERRORS vẫn 5", () => {
    const e = (c.CHAT_PROCESS_ERRORS ?? {}) as Record<string, number>;
    expect({ n: Object.keys(e).length, back: e.BACK_TARGET_INVALID }).toEqual({ n: 13, back: 422 });
    expect(Object.keys(h.HUB_ADMIN_PROCESS_ERRORS ?? {})).toHaveLength(5);
  });
});

describe("C · schema def [HUB-FR-104][AC-PB2-04]", () => {
  it("HUB-FR-104 · C-04 · ProcessStepSchema: −1, 10, 1.5 lỗi; 0, 9 ok", () => {
    expect([-1, 10, 1.5, 0, 9].map((v) => ok(c, "ProcessStepSchema", v))).toEqual([
      false,
      false,
      false,
      true,
      true,
    ]);
  });
  it("HUB-FR-104 · C-05 · ProcessStageDefSchema: có/không `step` ok; review không back_to_steps ⇒ []; 10 phần tử lỗi", () => {
    const s = schema(h, "ProcessStageDefSchema") as Z & { parse: (v: unknown) => Json };
    expect(s.safeParse(st({ key: "a", review: null })).success).toBe(true);
    expect(s.safeParse(st({ key: "a", step: 0, review: null })).success).toBe(true);
    expect(s.safeParse(st({ key: "a", step: 9, review: null })).success).toBe(true);
    const parsed = s.parse(st({ key: "a", step: 1, review: null }));
    expect(parsed.after.back_to_steps).toEqual([]);
    expect(
      s.safeParse(st({ key: "a", step: 9, review: null, back: [0, 1, 2, 3, 4, 5, 6, 7, 8, 0] }))
        .success,
    ).toBe(false);
  });
  it("AC-PB2-04 · C-06 · ProcessDefInputSchema: 4 stage cùng bước ⇒ lỗi, issue path stages.3.step", () => {
    const stages = ["a", "b", "c", "d"].map((k) => st({ key: k, step: 0, review: null }));
    const body = {
      key: "pb2-wide",
      name: "Rộng",
      description: "",
      input_hint: "",
      run_group_ids: [],
      stages,
      token_budget: null,
      enabled: true,
    };
    const r = schema(h, "ProcessDefInputSchema").safeParse(body);
    expect(r.success).toBe(false);
    expect((r.error?.issues ?? []).map((i) => i.path.join("."))).toContain("stages.3.step");
  });
  it("AC-PB2-04 · C-07 · ProcessDefPathsDetailsSchema nhận `rules` (enum PROCESS_DEF_RULES); rule lạ ⇒ lỗi", () => {
    expect([...((h.PROCESS_DEF_RULES as string[]) ?? [])]).toEqual([
      "KEY_DUP",
      "REAL_ACTION",
      "STEP_INCOMPLETE",
      "STEP_ORDER",
      "STEP_TOO_WIDE",
      "BACK_TARGET_INVALID",
    ]);
    expect(
      ok(h, "ProcessDefPathsDetailsSchema", { paths: ["stages.4.step"], rules: ["STEP_TOO_WIDE"] }),
    ).toBe(true);
    expect(ok(h, "ProcessDefPathsDetailsSchema", { paths: ["stages.0.key"] })).toBe(true);
    expect(ok(h, "ProcessDefPathsDetailsSchema", { paths: ["stages.0.key"], rules: ["XYZ"] })).toBe(
      false,
    );
  });
});

describe("C · schema API/view [HUB-FR-113][HUB-FR-118]", () => {
  it("HUB-FR-118 · C-08 · ReviewDecisionRequest + back_to_step (0…9); DecideProcessRunRequest + stage_idx", () => {
    expect(
      ok(c, "ReviewDecisionRequestSchema", { result: "fail", feedback: "x", back_to_step: 1 }),
    ).toBe(true);
    expect(
      ok(c, "ReviewDecisionRequestSchema", { result: "fail", feedback: "x", back_to_step: 10 }),
    ).toBe(false);
    expect(ok(c, "ReviewDecisionRequestSchema", { result: "pass" })).toBe(true);
    expect(ok(c, "DecideProcessRunRequestSchema", { option: "add_attempt", stage_idx: 2 })).toBe(
      true,
    );
    expect(ok(c, "DecideProcessRunRequestSchema", { option: "cancel" })).toBe(true);
  });
  it("HUB-FR-113 · C-09 · BackEventSchema strict: round 1 lỗi; feedback ''/4001 lỗi; khoá lạ lỗi", () => {
    expect(ok(c, "BackEventSchema", backEvent())).toBe(true);
    expect(ok(c, "BackEventSchema", backEvent({ round: 1 }))).toBe(false);
    expect(ok(c, "BackEventSchema", backEvent({ feedback: "" }))).toBe(false);
    expect(ok(c, "BackEventSchema", backEvent({ feedback: "x".repeat(4001) }))).toBe(false);
    expect(ok(c, "BackEventSchema", backEvent({ extra: 1 }))).toBe(false);
  });
  it("HUB-FR-104 · C-10 · ProcessRunSummary bắt buộc current_step/step_count; step_count 0/11 lỗi", () => {
    expect(ok(c, "ProcessRunSummarySchema", summary())).toBe(true);
    expect(ok(c, "ProcessRunSummarySchema", omit(summary(), "current_step"))).toBe(false);
    expect(ok(c, "ProcessRunSummarySchema", omit(summary(), "step_count"))).toBe(false);
    expect(ok(c, "ProcessRunSummarySchema", summary({ step_count: 0 }))).toBe(false);
    expect(ok(c, "ProcessRunSummarySchema", summary({ step_count: 11 }))).toBe(false);
  });
  it("HUB-FR-113 · C-11 · StageView bắt buộc step/round≥1/back_to_steps; FullView bắt buộc back_*; TaskView không có back_events", () => {
    expect(ok(c, "StageViewSchema", stageView())).toBe(true);
    for (const k of ["step", "round", "back_to_steps"])
      expect({ k, ok: ok(c, "StageViewSchema", omit(stageView(), k)) }).toEqual({ k, ok: false });
    expect(ok(c, "StageViewSchema", stageView({ round: 0 }))).toBe(false);
    expect(ok(c, "ProcessRunFullViewSchema", fullView())).toBe(true);
    for (const k of ["back_rounds", "back_limit", "back_events"])
      expect({ k, ok: ok(c, "ProcessRunFullViewSchema", omit(fullView(), k)) }).toEqual({
        k,
        ok: false,
      });
    const many = Array.from({ length: 21 }, () => backEvent());
    expect(ok(c, "ProcessRunFullViewSchema", fullView({ back_events: many }))).toBe(false);
    expect(ok(c, "ProcessRunTaskViewSchema", taskView())).toBe(true);
    expect(ok(c, "ProcessRunTaskViewSchema", taskView({ back_events: [] }))).toBe(false);
    expect(
      ok(
        c,
        "ProcessRunTaskViewSchema",
        taskView({ stages: [{ idx: 0, name: "Phân tích", status: "done" }] }),
      ),
    ).toBe(false);
  });
  it("HUB-FR-136 · C-12 · trường optional mới không phá dữ liệu cũ (OutputRef, HistoryItem, task_result, process.updated)", () => {
    expect(ok(c, "OutputRefSchema", outputRef(U(30)))).toBe(true);
    expect(
      ok(c, "OutputRefSchema", { ...outputRef(U(30)), round: 2, handoff_truncated: true }),
    ).toBe(true);
    const hist = {
      at: AT,
      kind: "review",
      task_id: U(31),
      stage_idx: 3,
      actor: user,
      result: "fail",
    };
    expect(ok(c, "HistoryItemSchema", hist)).toBe(true);
    expect(ok(c, "HistoryItemSchema", { ...hist, to_step: 1 })).toBe(true);
    const tr = part.task_result(U(32), user, U(33), { result: "fail" });
    expect(ok(c, "RoomProcessPartSchema", tr)).toBe(true);
    expect(ok(c, "RoomProcessPartSchema", { ...tr, to_step: 1 })).toBe(true);
    const ev = { process_run_id: U(32), status: "running", stage_idx: 1 };
    expect(ok(c, "ProcessUpdatedEventDataSchema", ev)).toBe(true);
    expect(ok(c, "ProcessUpdatedEventDataSchema", { ...ev, step: 1 })).toBe(true);
  });
});
