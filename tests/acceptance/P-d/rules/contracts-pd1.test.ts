// HUB-FR-143…145 · HUB-FR-115 · AC-H39…H43 · P-d1 contract (plan-contract §1–§4, §7; plan-addendum A2, A8) · test-plan §5
// PD-C01…C06, PD-C08 + test-plan-addendum §2 PD-C15 (hàng WAIT) + ESCALATE_INVALID phía contract (A8 #57). Không DB/env.
// Export MỚI truy cập qua module lỏng (`loadChat`/`loadHubAdmin`) ⇒ vắng = đỏ ở expect. Enum P-d2 nối thêm ⇒ so theo vị trí.
import { describe, expect, it } from "bun:test";
import { fn, loadChat, loadHubAdmin } from "../_support/modules";
import {
  AG,
  agentDef,
  defInput,
  fieldOf,
  G_CAP,
  G_DUYET,
  ok,
  schemaOf,
  TS,
  WAIT_EXEC,
  waitDef,
  X,
} from "./_contracts";

const chat = await loadChat();
const ha = await loadHubAdmin();

const OLD_RUN = ["running", "waiting_review", "waiting_answer", "needs_decision"];

describe("PD-C01 · enum thêm CUỐI mảng [plan-contract §1, §2, §3]", () => {
  it("AC-H41 · PD-C01 · PROCESS_RUN_STATUSES (9) / PROCESS_RUN_ACTIVE (5) thêm waiting_timer cuối; PROCESS_RUN_CAP_COUNTED = 4 trạng thái cũ", () => {
    expect(chat.PROCESS_RUN_STATUSES).toEqual([
      ...OLD_RUN,
      "done",
      "cancelled",
      "failed",
      "expired",
      "waiting_timer",
    ]);
    expect(chat.PROCESS_RUN_ACTIVE).toEqual([...OLD_RUN, "waiting_timer"]);
    expect(chat.PROCESS_RUN_CAP_COUNTED).toEqual(OLD_RUN);
  });
  it("AC-H41 · PD-C01 · STAGE_RUN_STATUSES vị trí 9 = waiting_timer (10 phần tử ở P-d1; P-d2 nối skipped sau)", () => {
    expect(chat.STAGE_RUN_STATUSES.slice(0, 10)).toEqual([
      "pending",
      "queued",
      "running",
      "waiting_answer",
      "waiting_review",
      "needs_decision",
      "done",
      "cancelled",
      "failed",
      "waiting_timer",
    ]);
  });
  it("HUB-FR-115 · PD-C01 · DECISION_REASONS vị trí 20–21 = retry_exhausted, timer_invalid (22; 20 cũ giữ thứ tự)", () => {
    const r = chat.DECISION_REASONS as string[];
    expect(r.slice(18, 22)).toEqual([
      "apply_conflict",
      "apply_failed",
      "retry_exhausted",
      "timer_invalid",
    ]);
    expect(r.slice(0, 2)).toEqual(["redo_limit", "ask_limit"]);
  });
  it("AC-H42 · PD-C01 · NOTICE_KINDS thêm escalated cuối (7); EXECUTOR_KINDS 4 đầu = [agent, team, apply, wait_until]", () => {
    expect(chat.NOTICE_KINDS).toEqual([
      "review_requested",
      "ask_requested",
      "decision_requested",
      "reminder",
      "task_closed",
      "run_finished",
      "escalated",
    ]);
    expect(chat.EXECUTOR_KINDS.slice(0, 4)).toEqual(["agent", "team", "apply", "wait_until"]);
  });
  it("AC-H41 · AC-H42 · PD-C01 · PROCESS_DEF_RULES vị trí 14–15 = WAIT_INVALID, ESCALATE_INVALID (16); INPUT_TYPES (sources) thêm date cuối", () => {
    const rules = ha.PROCESS_DEF_RULES as string[];
    expect(rules.slice(9, 16)).toEqual([
      "APPLY_REAL",
      "APPLY_AFTER",
      "APPLY_NO_AUTOFIX",
      "APPLY_MAX",
      "APPLY_FIELDS",
      "WAIT_INVALID",
      "ESCALATE_INVALID",
    ]);
    expect(ha.INPUT_TYPES).toEqual(["text", "select", "file", "source_ref", "date"]);
  });
  it("AC-H42 · PD-C01 · HistoryItemSchema.kind nhận escalate (cũ vẫn nhận; lạ ⇒ chặn)", () => {
    const k = fieldOf(schemaOf(chat, "HistoryItemSchema"), "kind");
    expect([ok(k, "escalate"), ok(k, "review"), ok(k, "expire"), ok(k, "leo_thang")]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});

describe("PD-C02 · hằng P-d1 [plan-contract §1]", () => {
  it("AC-H39 · AC-H41 · AC-H42 · AC-H43 · PD-C02 · giá trị hằng đúng plan-contract §1", () => {
    expect({
      STAGE_RETRY_MAX: chat.STAGE_RETRY_MAX,
      RETRY_BACKOFF_S: chat.RETRY_BACKOFF_S,
      REMIND_EVERY_H: chat.REMIND_EVERY_H,
      REMIND_MAX: chat.REMIND_MAX,
      ESCALATE_AFTER_H: chat.ESCALATE_AFTER_H,
      PROCESS_TTL_DAYS: chat.PROCESS_TTL_DAYS,
      PROCESS_RUN_TTL_DAYS: chat.PROCESS_RUN_TTL_DAYS,
      WAIT_OFFSET_DAYS: chat.WAIT_OFFSET_DAYS,
      WAIT_HORIZON_DAYS: chat.WAIT_HORIZON_DAYS,
      WAIT_TIME_DEFAULT: chat.WAIT_TIME_DEFAULT,
      TIMER_KINDS: chat.TIMER_KINDS,
      TIMER_SWEEP_BATCH: chat.TIMER_SWEEP_BATCH,
    }).toEqual({
      STAGE_RETRY_MAX: 3,
      RETRY_BACKOFF_S: [30, 120, 480],
      REMIND_EVERY_H: { min: 4, max: 168 },
      REMIND_MAX: 10,
      ESCALATE_AFTER_H: { min: 4, max: 2160 },
      PROCESS_TTL_DAYS: { min: 1, max: 365, default: 7 },
      PROCESS_RUN_TTL_DAYS: 7,
      WAIT_OFFSET_DAYS: { min: -365, max: 365 },
      WAIT_HORIZON_DAYS: 730,
      WAIT_TIME_DEFAULT: "09:00",
      TIMER_KINDS: ["wait_until", "retry"],
      TIMER_SWEEP_BATCH: 100,
    });
  });
  it("AC-H41 · PD-C02 · WAIT_TIME_RE / ISO_DATE_RE: 00:00, 23:59 ok; 24:00, 9:00, 12:60 sai; 2026-02-28 ok, 2026-2-28 sai", () => {
    const t = chat.WAIT_TIME_RE as RegExp;
    expect(t).toBeInstanceOf(RegExp);
    expect(["00:00", "23:59", "24:00", "9:00", "12:60"].map((v) => t.test(v))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    const d = chat.ISO_DATE_RE as RegExp;
    expect(d).toBeInstanceOf(RegExp);
    expect([d.test("2026-02-28"), d.test("2026-2-28")]).toEqual([true, false]);
  });
});

describe("PD-C03 · executor wait_until [plan-contract §3]", () => {
  it("AC-H41 · PD-C03 · ProcessStageDefSchema nhận wait_until (from input / field); time vắng ⇒ 09:00", () => {
    const s = schemaOf(ha, "ProcessStageDefSchema");
    const r = s.safeParse(waitDef());
    expect(r.success).toBe(true);
    expect(r.data?.executor).toEqual({
      kind: "wait_until",
      from: { kind: "input", key: "ngay-ky" },
      offset_days: 3,
      time: "09:00",
    });
    const field = WAIT_EXEC({
      from: { kind: "field", stage_key: "doc", field: "ngay_hd" },
      offset_days: -365,
      time: "17:30",
    });
    expect(ok(s, waitDef({ executor: field }))).toBe(true);
    expect(ok(s, waitDef({ executor: WAIT_EXEC({ offset_days: 365, time: "00:00" }) }))).toBe(true);
  });
  it("AC-H41 · PD-C03 · wait_until chặn: time 24:00 / 9:00; offset_days 366 / -366 / 1.5; from lạ; khoá thừa", () => {
    const s = schemaOf(ha, "ProcessStageDefSchema");
    expect(ok(s, waitDef())).toBe(true);
    const bad = [
      WAIT_EXEC({ time: "24:00" }),
      WAIT_EXEC({ time: "9:00" }),
      WAIT_EXEC({ offset_days: 366 }),
      WAIT_EXEC({ offset_days: -366 }),
      WAIT_EXEC({ offset_days: 1.5 }),
      WAIT_EXEC({ from: { kind: "const", value: "2026-10-18" } }),
      WAIT_EXEC({ from: { kind: "field", stage_key: "doc", field: "Ngay HD" } }),
      WAIT_EXEC({ agent_id: AG }),
    ];
    expect(bad.map((e) => ok(s, waitDef({ executor: e })))).toEqual(bad.map(() => false));
  });
});

describe("PD-C04 · after.review nhắc lặp + chuyển cấp [plan-contract §3]", () => {
  const review = (o: Record<string, unknown> = {}) =>
    agentDef({ after: { kind: "review", group_id: G_DUYET, ...o } });
  it("AC-H42 · PD-C04 · after.review vắng remind_every_h / escalate ⇒ null; biên 4/168 và 4/2160 nhận", () => {
    const s = schemaOf(ha, "ProcessStageDefSchema");
    const r = s.safeParse(review());
    expect(r.success).toBe(true);
    expect({
      remind: r.data?.after?.remind_every_h,
      escalate: r.data?.after?.escalate,
    }).toEqual({ remind: null, escalate: null });
    const good = [
      review({ remind_every_h: 4 }),
      review({ remind_every_h: 168, escalate: { after_h: 4, group_id: G_CAP } }),
      review({ escalate: { after_h: 2160, group_id: G_CAP } }),
    ];
    expect(good.map((v) => ok(s, v))).toEqual(good.map(() => true));
  });
  it("AC-H42 · PD-C04 · chặn: remind_every_h 3/169/4.5; escalate.after_h 3/2161; group_id không uuid; escalate ở after auto (strict)", () => {
    const s = schemaOf(ha, "ProcessStageDefSchema");
    expect(ok(s, review({ remind_every_h: 24 }))).toBe(true);
    const bad = [
      review({ remind_every_h: 3 }),
      review({ remind_every_h: 169 }),
      review({ remind_every_h: 4.5 }),
      review({ escalate: { after_h: 3, group_id: G_CAP } }),
      review({ escalate: { after_h: 2161, group_id: G_CAP } }),
      review({ escalate: { after_h: 24, group_id: "ke-toan" } }),
      review({ escalate: { after_h: 24 } }),
      agentDef({ after: { kind: "auto", escalate: { after_h: 24, group_id: G_CAP } } }),
      agentDef({ after: { kind: "auto", remind_every_h: 24 } }),
    ];
    expect(bad.map((v) => ok(s, v))).toEqual(bad.map(() => false));
  });
});

describe("PD-C05 · ttl_days [plan-contract §3]", () => {
  it("AC-H43 · PD-C05 · ProcessDefInputSchema ttl_days vắng/null/1/365 nhận; 0/366/1.5/'7' chặn", () => {
    const s = schemaOf(ha, "ProcessDefInputSchema");
    const good = [
      defInput(),
      defInput({ ttl_days: null }),
      defInput({ ttl_days: 1 }),
      defInput({ ttl_days: 365 }),
    ];
    expect(good.map((v) => ok(s, v))).toEqual(good.map(() => true));
    const bad = [0, 366, 1.5, "7"].map((t) => defInput({ ttl_days: t }));
    expect(bad.map((v) => ok(s, v))).toEqual(bad.map(() => false));
  });
  it("AC-H43 · PD-C05 · ProcessDefSchema (response) luôn có ttl_days (vắng ⇒ chặn; null/7 nhận); TtlDaysSchema", () => {
    const s = schemaOf(ha, "ProcessDefSchema");
    const def = (o: Record<string, unknown> = {}) => ({
      ...defInput(),
      sources: [],
      inputs: [],
      id: X(31),
      tenant_id: X(32),
      is_template: false,
      source_template_id: null,
      version: 1,
      created_at: TS,
      updated_at: TS,
      ...o,
    });
    expect([ok(s, def({ ttl_days: null })), ok(s, def({ ttl_days: 7 })), ok(s, def())]).toEqual([
      true,
      true,
      false,
    ]);
    const t = schemaOf(chat, "TtlDaysSchema");
    expect([1, 365, null, 0, 366].map((v) => ok(t, v))).toEqual([true, true, true, false, false]);
  });
});

describe("PD-C06 · input date + ngày lịch [plan-contract §1]", () => {
  it("AC-H41 · PD-C06 · ProcessInputValueSchema {type:'date'} nhận 2026-02-28; value 11 ký tự / rỗng / khoá thừa chặn", () => {
    const s = schemaOf(ha, "ProcessInputValueSchema");
    const v = (o: Record<string, unknown> = {}) => ({
      type: "date",
      key: "ngay-ky",
      value: "2026-02-28",
      ...o,
    });
    expect(ok(s, v())).toBe(true);
    const bad = [
      v({ value: "2026-02-288" }),
      v({ value: "" }),
      v({ text: "x" }),
      v({ key: "Ngay" }),
    ];
    expect(bad.map((x) => ok(s, x))).toEqual(bad.map(() => false));
  });
  it("AC-H41 · PD-C06 · isIsoCalendarDate: 2026-02-30 / 2025-02-29 / 2026-13-01 false; 2024-02-29 / 2026-02-28 true; IsoCalendarDateSchema từ chối ngày không có thật", () => {
    const f = fn(chat, "isIsoCalendarDate");
    const days = [
      "2026-02-30",
      "2025-02-29",
      "2026-13-01",
      "2026-2-28",
      "2024-02-29",
      "2026-02-28",
    ];
    expect(days.map((d) => f(d))).toEqual([false, false, false, false, true, true]);
    const s = schemaOf(chat, "IsoCalendarDateSchema");
    expect(days.map((d) => ok(s, d))).toEqual([false, false, false, false, true, true]);
    const w = schemaOf(chat, "WaitTimeSchema");
    expect(["09:00", "24:00"].map((t) => ok(w, t))).toEqual([true, false]);
  });
});

describe("PD-C08 · view + editor context [plan-contract §2, §4; A4]", () => {
  it("AC-H39 · AC-H41 · PD-C08 · StageViewSchema: retry_count 0…3, next_retry_at, last_error_code, wait{due_at,timezone} (optional)", () => {
    const s = schemaOf(chat, "StageViewSchema");
    const rc = fieldOf(s, "retry_count");
    expect([undefined, 0, 3, 4, -1, 1.5].map((v) => ok(rc, v))).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
    const nr = fieldOf(s, "next_retry_at");
    expect([undefined, TS, "mai"].map((v) => ok(nr, v))).toEqual([true, true, false]);
    const le = fieldOf(s, "last_error_code");
    expect([undefined, "TIMEOUT", "", "E".repeat(65)].map((v) => ok(le, v))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    const w = fieldOf(s, "wait");
    const tz = "Asia/Ho_Chi_Minh";
    expect([
      ok(w, undefined),
      ok(w, { due_at: TS, timezone: tz }),
      ok(w, { due_at: TS, timezone: "" }),
      ok(w, { due_at: TS, timezone: "x".repeat(65) }),
      ok(w, { due_at: TS }),
      ok(w, { due_at: TS, timezone: tz, kind: "wait_until" }),
    ]).toEqual([true, true, false, false, false, false]);
  });
  it("AC-H42 · AC-H43 · PD-C08 · TaskDetail.escalated/remind_count; OpenTask.escalated_group; RunSummary.expires_at; ExecutorRef kind wait_until; HistoryItem.group", () => {
    const td = schemaOf(chat, "TaskDetailSchema");
    expect([undefined, true, false, "x"].map((v) => ok(fieldOf(td, "escalated"), v))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect([undefined, 0, 10, 11].map((v) => ok(fieldOf(td, "remind_count"), v))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    const og = fieldOf(schemaOf(chat, "OpenTaskSchema"), "escalated_group");
    const grp = { id: G_CAP, name: "Giám đốc" };
    expect([undefined, null, grp, { id: "x", name: "G" }].map((v) => ok(og, v))).toEqual([
      true,
      true,
      true,
      false,
    ]);
    const ex = fieldOf(schemaOf(chat, "ProcessRunSummarySchema"), "expires_at");
    expect([undefined, null, TS, "x"].map((v) => ok(ex, v))).toEqual([true, true, true, false]);
    const ek = fieldOf(schemaOf(chat, "ExecutorRefSchema"), "kind");
    expect(ok(ek, "wait_until")).toBe(true);
    const hg = fieldOf(schemaOf(chat, "HistoryItemSchema"), "group");
    expect([undefined, grp, { id: G_CAP, name: "" }].map((v) => ok(hg, v))).toEqual([
      true,
      true,
      false,
    ]);
  });
  it("AC-H41 · PD-C08 · ProcessEditorContextSchema {timezone} (tools optional); Query {tenant_id?: uuid}", () => {
    const s = schemaOf(ha, "ProcessEditorContextSchema");
    expect([
      ok(s, { timezone: "Asia/Ho_Chi_Minh" }),
      ok(s, { timezone: "Europe/Berlin", tools: [] }),
      ok(s, {}),
      ok(s, { timezone: "" }),
      ok(s, { timezone: "x".repeat(65) }),
      ok(s, { timezone: "UTC", tenant_id: G_DUYET }),
    ]).toEqual([true, true, false, false, false, false]);
    const q = schemaOf(ha, "ProcessEditorContextQuerySchema");
    expect([ok(q, {}), ok(q, { tenant_id: X(32) }), ok(q, { tenant_id: "acme" })]).toEqual([
      true,
      true,
      false,
    ]);
  });
});
