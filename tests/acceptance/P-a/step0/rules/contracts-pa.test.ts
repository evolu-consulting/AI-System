// HUB-FR-105…117 · ADM-FR-65 · R-K01…R-K10 — contract P-a chỉ thêm (plan-contract §1–§6, plan-thread T3). Nạp động
// (`import * as` + truy cập động ⇒ export chưa có = `undefined` ⇒ đỏ ở expect, không lỗi typecheck). R-K03 (khối cũ) xanh
// trước code — chủ ý (test-plan §5). Tên schema request/response chưa chốt trong plan ⇒ `pick` thử theo quy ước `…Schema`.
import { describe, expect, it } from "bun:test";
import { type Loose, loadChat, loadHubAdmin } from "../../_support/modules";
import { allParts, EXECUTOR, outputRef, part } from "../../_support/parts";

const U = (n: number) => `a5a00000-0000-4000-8000-${String(70_000 + n).padStart(12, "0")}`;
const AT = "2026-10-10T01:00:00.000Z";
const user = { id: U(1), display_name: "lan" };
type S = { safeParse?: (v: unknown) => { success: boolean } } | undefined;
const ok = (s: S, v: unknown): boolean | undefined => {
  expect(typeof s?.safeParse).toBe("function");
  return s?.safeParse?.(v).success;
};
/** Schema đầu tiên có trong module theo danh sách tên (quy ước `…RequestSchema` / `…ResponseSchema`). */
function pick(c: Loose, names: string[]): S {
  const n = names.find((k) => c[k] !== undefined);
  expect({ oneOf: names, found: n !== undefined }).toEqual({ oneOf: names, found: true });
  return n ? c[n] : undefined;
}
const taskDetail = (o: Loose = {}) => ({
  id: U(10),
  kind: "review",
  status: "open",
  stage_idx: 0,
  stage_name: "Đọc hoá đơn",
  output: outputRef(U(11)),
  forwards: [],
  can_act: true,
  created_at: AT,
  ...o,
});
const summary = {
  id: U(20),
  process: { key: "hoa-don", name: "Hoá đơn", version: 1 },
  status: "waiting_review",
  current_stage_idx: 0,
  stage_count: 2,
  started_by: user,
  origin: { kind: "room", room_id: U(21) },
  started_at: AT,
  updated_at: AT,
  finished_at: null,
  current_step: 0,
  step_count: 2,
};
const stageView = {
  idx: 0,
  key: "doc",
  name: "Đọc hoá đơn",
  executor: EXECUTOR,
  after: "review",
  real_action: false,
  status: "waiting_review",
  attempt: 1,
  attempt_limit: 4,
  asks_count: 0,
  ask_limit: 3,
  outputs: [outputRef(U(11))],
  current_output_id: U(11),
  passed_by: null,
  passed_at: null,
  step: 0,
  round: 1,
  back_to_steps: [],
};
const fullView = {
  ...summary,
  access: "full",
  input: "HD-12",
  stages: [stageView],
  history: [],
  decision: null,
  my_tasks: [],
  open_tasks: [{ id: U(10), kind: "review", stage_idx: 0, assignees: [user], group: null }],
  thread: null,
  can_cancel: true,
  back_rounds: 0,
  back_limit: 3,
  back_events: [],
};
const taskView = {
  access: "task",
  id: U(20),
  process: { key: "hoa-don", name: "Hoá đơn" },
  status: "waiting_review",
  stages: [{ idx: 0, name: "Đọc hoá đơn", status: "waiting_review", step: 0, round: 1 }],
  my_tasks: [taskDetail()],
};
const notice = {
  id: U(30),
  kind: "review_requested",
  process_run_id: U(20),
  task_id: U(10),
  process_name: "Hoá đơn",
  stage_name: "Đọc hoá đơn",
  created_at: AT,
  read: false,
};
const userMsg = {
  id: U(40),
  room_id: U(21),
  seq: 1,
  sender_type: "user",
  sender: user,
  content: "Chào cả nhóm",
  client_msg_id: U(41),
  created_at: AT,
};

describe("R-K01–K03 · hằng + mã lỗi [plan-contract §1, §4]", () => {
  it("HUB-FR-105 · R-K01 · hằng §1 đúng giá trị + mảng trạng thái đúng thứ tự", async () => {
    const c = await loadChat();
    expect({
      REDO_MAX: c.REDO_MAX,
      ASKS_MAX: c.ASKS_MAX,
      FORWARD_CHAIN_MAX: c.FORWARD_CHAIN_MAX,
      PROCESS_RUNS_PER_TENANT: c.PROCESS_RUNS_PER_TENANT,
      PROCESS_RUN_TTL_DAYS: c.PROCESS_RUN_TTL_DAYS,
      REMIND_AFTER_H: c.REMIND_AFTER_H,
      PROCESS_INPUT_MAX: c.PROCESS_INPUT_MAX,
      PROCESS_STAGES_MAX: c.PROCESS_STAGES_MAX,
      FEEDBACK_MAX: c.FEEDBACK_MAX,
      FORWARD_NOTE_MAX: c.FORWARD_NOTE_MAX,
      OPEN_TASKS_COUNT_MAX: c.OPEN_TASKS_COUNT_MAX,
      PROCESS_RUN_ID_HEADER: c.PROCESS_RUN_ID_HEADER,
      ROOM_PROCESS_CONTENT_MAX: c.ROOM_PROCESS_CONTENT_MAX,
    }).toEqual({
      REDO_MAX: 3,
      ASKS_MAX: 3,
      FORWARD_CHAIN_MAX: 3,
      PROCESS_RUNS_PER_TENANT: 5,
      PROCESS_RUN_TTL_DAYS: 7,
      REMIND_AFTER_H: 24,
      PROCESS_INPUT_MAX: 8_000,
      PROCESS_STAGES_MAX: 10,
      FEEDBACK_MAX: 4_000,
      FORWARD_NOTE_MAX: 500,
      OPEN_TASKS_COUNT_MAX: 100,
      PROCESS_RUN_ID_HEADER: "X-Process-Run-Id",
      ROOM_PROCESS_CONTENT_MAX: 500,
    });
    expect(c.TEAM_LIMITS_DEFAULT).toEqual({
      max_calls: 10,
      max_tokens: 200_000,
      max_active_s: 600,
      summary_tokens: 200,
      max_plan_steps: 5,
    });
    expect(c.PROCESS_KEY_RE?.test("hoa-don")).toBe(true);
    expect(c.PROCESS_KEY_RE?.test("Ab")).toBe(false);
    // P-d (T5, K13): +`waiting_timer` ở CUỐI ⇒ so tiền tố 8 trạng thái gốc (đuôi kiểm ở PD-C01).
    expect([...(c.PROCESS_RUN_STATUSES ?? [])].slice(0, 8)).toEqual([
      "running",
      "waiting_review",
      "waiting_answer",
      "needs_decision",
      "done",
      "cancelled",
      "failed",
      "expired",
    ]);
    // P-d (T5, K14): +`waiting_timer` ⇒ so tiền tố 4 mục gốc (đủ 5 ở PD-C01).
    expect([...(c.PROCESS_RUN_ACTIVE ?? [])].slice(0, 4)).toEqual([
      "running",
      "waiting_review",
      "waiting_answer",
      "needs_decision",
    ]);
    expect([...(c.TEAM_MODES ?? [])]).toEqual(["sequential", "lead_plan", "parallel_merge"]);
    // P-b2 (plan §1.1, CR-064): +`back_limit` ở CUỐI mảng ⇒ 16.
    // P-c (PC-R10) thêm 2 mã CUỐI ⇒ kiểm tiền tố 16 mã.
    expect([...(c.DECISION_REASONS ?? [])].slice(0, 16)).toHaveLength(16);
    expect([...(c.DECISION_REASONS ?? [])][15]).toBe("back_limit");
    expect([...(c.DECISION_OPTIONS ?? [])]).toEqual(["add_attempt", "use_current", "cancel"]);
    expect([...(c.ROOM_PROCESS_KINDS ?? [])]).toEqual([
      "block",
      "output",
      "ask",
      "decision",
      "task_result",
      "forward",
      "run_end",
    ]);
    expect(c.PROCESS_SYSTEM_SENDER).toEqual({
      key: "process",
      name: { vi: "Quy trình", en: "Processes" },
    });
  });
  it("HUB-FR-105 · R-K02 · CHAT_PROCESS_ERRORS đúng 13 mã (gồm PROCESS_THREAD_NO_AGENT 422; P-b2 thêm BACK_TARGET_INVALID 422); HUB_ADMIN_PROCESS_ERRORS 5 mã", async () => {
    const c = await loadChat();
    expect(c.CHAT_PROCESS_ERRORS).toEqual({
      PROCESS_NOT_FOUND: 404,
      PROCESS_THREAD_NO_AGENT: 422,
      TOO_MANY_PROCESS_RUNS: 429,
      FEEDBACK_REQUIRED: 422,
      FORWARD_TARGET_INVALID: 422,
      REVIEW_TASK_CLOSED: 409,
      TASK_KIND_MISMATCH: 409,
      PROCESS_RUN_STATE: 409,
      NO_OUTPUT: 409,
      FORWARD_LIMIT: 409,
      FORWARD_OUT_OF_GROUP: 403,
      NOT_PROCESS_DECIDER: 403,
      BACK_TARGET_INVALID: 422,
    });
    const h = await loadHubAdmin();
    expect(h.HUB_ADMIN_PROCESS_ERRORS).toEqual({
      PROCESS_KEY_TAKEN: 409,
      PROCESS_DEF_INVALID: 422,
      PROCESS_DEF_INCOMPLETE: 422,
      PROCESS_REF_INVALID: 422,
      TEMPLATE_READ_ONLY: 403,
    });
  });
  it("HUB-FR-105 · R-K03 · khối X2a/X2b/C1 giữ nguyên số lượng (xanh trước code — chủ ý)", async () => {
    const c = await loadChat();
    const n = (o: unknown) => (Array.isArray(o) ? o.length : Object.keys(o ?? {}).length);
    expect({
      api: n(c.CHAT_API_ERRORS),
      routing: n(c.CHAT_ROUTING_ERRORS),
      room: n(c.CHAT_ROOM_ERRORS),
      roomAgent: n(c.CHAT_ROOM_AGENT_ERRORS),
      me: n(c.ME_STREAM_EVENTS),
      meRun: n(c.ME_STREAM_RUN_EVENTS),
      kinds: n(c.ROOM_KINDS),
    }).toEqual({ api: 6, routing: 2, room: 8, roomAgent: 1, me: 8, meRun: 3, kinds: 2 });
    for (const k of Object.keys(c.CHAT_PROCESS_ERRORS ?? {})) {
      expect(Object.keys(c.CHAT_API_ERRORS)).not.toContain(k);
      expect(Object.keys(c.CHAT_ROOM_ERRORS)).not.toContain(k);
    }
  });
  it("HUB-FR-113 · R-K03 · ROOM_SENDER_TYPES = [user, agent, process] (chỉ nối thêm, T3)", async () => {
    const c = await loadChat();
    expect([...c.ROOM_SENDER_TYPES]).toEqual(["user", "agent", "process"]);
  });
});

describe("R-K04–K10 · schema [plan-contract §2–§5]", () => {
  it("HUB-BR-25 · R-K04 · ProcessRunView task hợp lệ; thêm input/history/decision ⇒ fail (strict, không rò)", async () => {
    const s = (await loadChat()).ProcessRunViewSchema;
    expect(ok(s, taskView)).toBe(true);
    for (const extra of [{ input: "x" }, { history: [] }, { decision: null }])
      expect(ok(s, { ...taskView, ...extra })).toBe(false);
  });
  it("HUB-BR-25 · R-K05 · ProcessNotice hợp lệ; thêm content/output ⇒ fail", async () => {
    const s = (await loadChat()).ProcessNoticeSchema;
    expect(ok(s, notice)).toBe(true);
    expect(ok(s, { ...notice, content: "Nội dung" })).toBe(false);
    expect(ok(s, { ...notice, output: "x" })).toBe(false);
  });
  it("HUB-FR-112 · R-K06 · parseMeStreamProcessEvent: 4 sự kiện parse; tên lạ / khoá thừa ⇒ null", async () => {
    const c = await loadChat();
    expect(typeof c.parseMeStreamProcessEvent).toBe("function");
    const p = c.parseMeStreamProcessEvent;
    const evs: [string, unknown][] = [
      ["process.updated", { process_run_id: U(20), status: "running", stage_idx: 1 }],
      ["review_task.created", { task_id: U(10), kind: "review", process_run_id: U(20) }],
      ["review_task.closed", { task_id: U(10), result: "pass" }],
      ["process.notice", { notice, unread: 1 }],
    ];
    for (const [e, d] of evs) expect(p(e, d)).not.toBeNull();
    expect([...(c.ME_STREAM_PROCESS_EVENTS ?? [])]).toHaveLength(4);
    expect(p("process.unknown", { process_run_id: U(20) })).toBeNull();
    expect(
      p("process.updated", { process_run_id: U(20), status: "running", stage_idx: 1, x: 1 }),
    ).toBeNull();
  });
  it("HUB-FR-105 · R-K07 · RoomMessage cũ / có process_run_id đều parse", async () => {
    const s = (await loadChat()).RoomMessageSchema;
    expect(ok(s, userMsg)).toBe(true);
    expect(ok(s, { ...userMsg, content: "!hoa-don HD-12", process_run_id: U(20) })).toBe(true);
  });
  it("HUB-FR-113 · R-K09 · RoomProcessPart 7 kind parse; forward kèm note / kind lạ ⇒ fail; RoomMessage sender process parse", async () => {
    const c = await loadChat();
    const s = c.RoomProcessPartSchema;
    for (const p of allParts(U(20))) expect(ok(s, p)).toBe(true);
    expect(ok(s, { ...part.forward(U(20)), note: "x" })).toBe(false);
    expect(ok(s, { ...part.block(U(20)), kind: "mystery" })).toBe(false);
    const msg = {
      ...userMsg,
      sender_type: "process",
      sender: { id: U(50), display_name: "Hoá đơn" },
      client_msg_id: null,
      flow_id: U(51),
      placement: "main",
      process_run_id: U(20),
      process: part.block(U(20)),
    };
    expect(ok(c.RoomMessageSchema, msg)).toBe(true);
  });
  it("HUB-FR-115 · R-K10 · TaskDetail decision (options+has_output); full view (open_tasks, thread null); open_count > 100 ⇒ fail", async () => {
    const c = await loadChat();
    const dec = taskDetail({
      kind: "decision",
      output: undefined,
      reason: "redo_limit",
      options: ["add_attempt", "use_current", "cancel"],
      has_output: true,
    });
    const { output: _o, ...decNoOutput } = dec;
    expect(ok(c.TaskDetailSchema, decNoOutput)).toBe(true);
    expect(ok(c.ProcessRunViewSchema, fullView)).toBe(true);
    const list = pick(c, [
      "ReviewTaskListResponseSchema",
      "MeReviewTasksResponseSchema",
      "ReviewTasksResponseSchema",
    ]);
    const item = {
      task: taskDetail(),
      process_run: {
        id: U(20),
        process: { key: "hoa-don", name: "Hoá đơn" },
        status: "waiting_review",
        started_by: user,
      },
    };
    expect(ok(list, { items: [item], open_count: 100, next_cursor: null })).toBe(true);
    expect(ok(list, { items: [item], open_count: 101, next_cursor: null })).toBe(false);
  });
  it("HUB-FR-105 · R-K08 · zod body: input 8 001 / key 'Ab' fail; origin none ok; feedback 4 001 / note 501 fail; stages 0/11, real_action không kèm review fail", async () => {
    const c = await loadChat();
    const start = pick(c, [
      "CreateProcessRunRequestSchema",
      "StartProcessRunRequestSchema",
      "ProcessRunCreateRequestSchema",
    ]);
    const body = { process_key: "hoa-don", input: "HD-12", origin: { kind: "none" } };
    expect(ok(start, body)).toBe(true);
    expect(ok(start, { ...body, input: "x".repeat(8_001) })).toBe(false);
    expect(ok(start, { ...body, process_key: "Ab" })).toBe(false);
    const dec = pick(c, ["ReviewDecisionRequestSchema", "ReviewTaskDecisionRequestSchema"]);
    expect(ok(dec, { result: "fail", feedback: "x".repeat(4_001) })).toBe(false);
    const fwd = pick(c, [
      "ForwardReviewTaskRequestSchema",
      "ReviewTaskForwardRequestSchema",
      "ForwardTaskRequestSchema",
    ]);
    expect(ok(fwd, { to_user_id: U(60), note: "x".repeat(501) })).toBe(false);
    const h = await loadHubAdmin();
    const d = h.ProcessDefInputSchema;
    const st = (i: number, o: Loose = {}) => ({
      key: `s${i}`,
      name: `Giai đoạn ${i}`,
      executor: { kind: "agent", agent_id: U(70) },
      instruction: "",
      output: { filename: "out.md", template: "## A\n", required_sections: ["A"], fields: [] },
      after: { kind: "review", group_id: null },
      real_action: false,
      answerer: { kind: "starter" },
      timeout_s: 600,
      token_budget: null,
      ...o,
    });
    const def = (stages: unknown[]) => ({
      key: "p-thu",
      name: "Thử",
      description: "",
      input_hint: "",
      run_group_ids: [],
      stages,
      token_budget: null,
      enabled: false,
    });
    expect(ok(d, def([st(0)]))).toBe(true);
    expect(ok(d, def([]))).toBe(false);
    expect(ok(d, def(Array.from({ length: 11 }, (_, i) => st(i))))).toBe(false);
    expect(ok(d, def([st(0, { after: { kind: "auto" } }), st(1, { real_action: true })]))).toBe(
      false,
    );
  });
});
