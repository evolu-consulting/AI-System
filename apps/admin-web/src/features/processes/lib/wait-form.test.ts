// ADM-FR-71 · HUB-FR-143/144/115 · P-d1 T11b: test hàm thuần form "Chờ tới ngày", nhắc/chuyển cấp, ttl_days, nhãn trạng thái giai đoạn.
import { describe, expect, test } from "bun:test";
import type { StageView } from "@ai/contracts/chat";
import { type DefDraft, emptyDraft, emptyStage, toDraft, toInput, validateDraft } from "./def-form";
import { serverErrors } from "./errors";
import { stageLabel } from "./stage-label";
import { TEAM_SECTION_KEY, type TeamSections, WAIT_PATCH } from "./wait-form";

const A = "11111111-1111-4111-8111-111111111111";
const G = "22222222-2222-4222-8222-222222222222";
const G2 = "33333333-3333-4333-8333-333333333333";
const T = "44444444-4444-4444-8444-444444444444";
const W = "process.admin.editor.stage.wait.err.";
const E = "process.admin.editor.stage.err.";

/** Giai đoạn 1 (agent, field `due` kiểu date) → giai đoạn 2 chờ tới ngày ở bước 2. */
function waitDraft(): DefDraft {
  const s1 = Object.assign(emptyStage(0), {
    key: "soat",
    name: "Soát",
    executor: `agent:${A}`,
    filename: "soat.md",
    template: "# Soát",
    sections: ["Tóm tắt"],
    fields: [{ key: "due", type: "date" as const, required: true }],
  });
  const s2 = Object.assign(emptyStage(1), {
    key: "cho",
    name: "Chờ",
    ...WAIT_PATCH,
    wait: { source: "field:soat:due", offset: "-3", time: "09:00" },
  });
  return { ...emptyDraft(), key: "hop-dong", name: "Hợp đồng", stages: [s1, s2] };
}

describe("wait_until · def ⇄ nháp", () => {
  test("gửi executor + output do FE ép; toDraft(toInput(x)) giữ ô nhập", () => {
    const input = toInput(waitDraft());
    const s = input.stages[1];
    expect(s?.executor).toEqual({
      kind: "wait_until",
      from: { kind: "field", stage_key: "soat", field: "due" },
      offset_days: -3,
      time: "09:00",
    });
    expect(s?.after).toEqual({ kind: "auto" });
    expect(s?.real_action).toBe(false);
    expect(s?.output).toEqual({
      filename: "cho.md",
      template: "# Chờ\n\n## Bàn giao\n",
      required_sections: ["Bàn giao"],
      fields: [],
    });
    expect(s?.answerer).toEqual({ kind: "starter" });
    expect(s?.token_budget).toBeNull();
    const back = toDraft(input).stages[1];
    expect(back?.executor).toBe("wait_until");
    expect(back?.wait).toEqual({ source: "field:soat:due", offset: "-3", time: "09:00" });
  });
  test("nguồn input: from.kind = input", () => {
    const d = waitDraft();
    d.stages[1] = { ...(d.stages[1] as never as DefDraft["stages"][0]) };
    (d.stages[1] as DefDraft["stages"][0]).wait.source = "input:han";
    expect(toInput(d).stages[1]?.executor).toMatchObject({ from: { kind: "input", key: "han" } });
  });
});

describe("wait_until · validate", () => {
  test("hợp lệ ⇒ không lỗi", () => {
    expect(validateDraft(waitDraft())).toEqual({});
  });
  test("nguồn trống / ngoài danh sách / chênh ±365 / giờ 24:00", () => {
    const d = waitDraft();
    const w = (d.stages[1] as DefDraft["stages"][0]).wait;
    w.source = "";
    expect(validateDraft(d)["stages.1.executor.from"]).toBe(`${W}source`);
    w.source = "field:soat:khac";
    expect(validateDraft(d)["stages.1.executor.from"]).toBe(`${W}source`);
    w.source = "field:soat:due";
    w.offset = "366";
    expect(validateDraft(d)["stages.1.executor.offset_days"]).toBe(`${W}offset`);
    w.offset = "-365";
    w.time = "24:00";
    const e = validateDraft(d);
    expect(e["stages.1.executor.time"]).toBe(`${W}time`);
    expect(e["stages.1.executor.offset_days"]).toBeUndefined();
  });
  test("nguồn là field của giai đoạn CÙNG bước ⇒ lỗi (PD-R13)", () => {
    const d = waitDraft();
    (d.stages[1] as DefDraft["stages"][0]).step = 0;
    expect(validateDraft(d)["stages.1.executor.from"]).toBeDefined();
  });
  test("422 WAIT_INVALID / ESCALATE_INVALID theo path ⇒ câu riêng", () => {
    const e = serverErrors(
      "PROCESS_DEF_INVALID",
      ["stages.1.executor.from", "stages.0.after.escalate"],
      ["WAIT_INVALID", "ESCALATE_INVALID"],
    );
    expect(e["stages.1.executor.from"]).toBe(`${W}WAIT_INVALID`);
    expect(e["stages.0.after.escalate"]).toBe(`${E}ESCALATE_INVALID`);
  });
});

describe("nhắc lặp + chuyển cấp", () => {
  const review = (): DefDraft => {
    const d = waitDraft();
    Object.assign(d.stages[0] as DefDraft["stages"][0], { after: "review", groupId: G });
    return d;
  };
  test("round-trip: remind + escalate; tắt ⇒ null; auto ⇒ null", () => {
    const d = review();
    const s = d.stages[0] as DefDraft["stages"][0];
    Object.assign(s, { remind: "4", escalate: { on: true, afterH: "24", groupId: G2 } });
    const a = toInput(d).stages[0]?.after;
    expect(a).toMatchObject({ remind_every_h: 4, escalate: { after_h: 24, group_id: G2 } });
    expect(toInput(toDraft(toInput(d)))).toEqual(toInput(d));
    s.escalate.on = false;
    s.remind = "";
    expect(toInput(d).stages[0]?.after).toMatchObject({ remind_every_h: null, escalate: null });
    s.after = "auto";
    expect(toInput(d).stages[0]?.after).toEqual({ kind: "auto" });
  });
  test("khoảng 4..168 / 4..2160; nhóm bắt buộc, khác nhóm kiểm", () => {
    const d = review();
    const s = d.stages[0] as DefDraft["stages"][0];
    s.remind = "3";
    expect(validateDraft(d)["stages.0.after.remind_every_h"]).toBe(`${E}remind`);
    s.remind = "168";
    expect(validateDraft(d)["stages.0.after.remind_every_h"]).toBeUndefined();
    s.escalate = { on: true, afterH: "2161", groupId: "" };
    let e = validateDraft(d);
    expect(e["stages.0.after.escalate.after_h"]).toBe(`${E}escalateAfter`);
    expect(e["stages.0.after.escalate.group_id"]).toBe(`${E}escalateGroup`);
    s.escalate = { on: true, afterH: "4", groupId: G };
    e = validateDraft(d);
    expect(e["stages.0.after.escalate.group_id"]).toBe(`${E}escalateGroup`);
    expect(e["stages.0.after.escalate"]).toBeUndefined();
  });
});

describe("ttl_days", () => {
  test("mới ⇒ 7; null ⇒ Không hết hạn; luôn gửi ttl_days", () => {
    expect(toInput(emptyDraft()).ttl_days).toBe(7);
    const d = { ...emptyDraft(), noExpiry: true };
    expect(toInput(d).ttl_days).toBeNull();
    const back = toDraft({ ...toInput(waitDraft()), ttl_days: null });
    expect(back.noExpiry).toBe(true);
    expect(toDraft({ ...toInput(waitDraft()), ttl_days: 30 }).ttl).toBe("30");
  });
  test("0 / 366 ⇒ lỗi; Không hết hạn bỏ qua ô số", () => {
    const d = waitDraft();
    for (const bad of ["0", "366", "", "1.5"])
      expect(validateDraft({ ...d, ttl: bad }).ttl_days).toBe("process.admin.editor.err.ttl");
    expect(validateDraft({ ...d, ttl: "365" }).ttl_days).toBeUndefined();
    expect(validateDraft({ ...d, ttl: "x", noExpiry: true }).ttl_days).toBeUndefined();
  });
});

describe("TEAM_SECTION_UNOWNED (ctx.teams)", () => {
  const withTeam = (): DefDraft => {
    const d = waitDraft();
    Object.assign(d.stages[0] as DefDraft["stages"][0], { executor: `team:${T}` });
    return d;
  };
  const teams = (mode: string): TeamSections =>
    new Map([[T, { mode, memberSections: [["Khác"], ["Mục khác"]] }]]);
  test("mục không ai phụ trách ⇒ lỗi tại required_sections; lead_plan miễn; thiếu teams ⇒ bỏ kiểm", () => {
    const d = withTeam();
    expect(validateDraft(d, false, teams("sequential"))["stages.0.output.required_sections"]).toBe(
      TEAM_SECTION_KEY,
    );
    expect(validateDraft(d, false, teams("lead_plan"))).toEqual({});
    expect(validateDraft(d)).toEqual({});
    const owned = new Map([[T, { mode: "sequential", memberSections: [["Tóm tắt"]] }]]);
    expect(validateDraft(d, false, owned)).toEqual({});
  });
});

describe("stageLabel", () => {
  const t = (k: string, p?: Record<string, unknown>) => `${k}|${JSON.stringify(p ?? {})}`;
  const base = { status: "pending", retry_count: 0 } as Pick<
    StageView,
    "status" | "retry_count" | "next_retry_at" | "wait"
  >;
  test("chờ ngày: theo múi giờ server trả; thử lại: giờ theo máy xem; bỏ qua; mặc định", () => {
    const wait = { due_at: "2026-12-14T02:00:00.000Z", timezone: "Asia/Ho_Chi_Minh" };
    const w = stageLabel({ ...base, status: "waiting_timer", wait }, t, "vi", "UTC");
    expect(w.tone).toBe("info");
    expect(w.text).toContain("14/12/2026 09:00");
    expect(w.text).toContain("Asia/Ho_Chi_Minh");
    const r = stageLabel(
      { ...base, status: "running", retry_count: 2, next_retry_at: "2026-12-14T10:42:00.000Z" },
      t,
      "en",
      "UTC",
    );
    expect(r.tone).toBe("warn");
    expect(r.text).toContain('"n":2,"max":3,"time":"10:42"');
    expect(stageLabel({ ...base, status: "skipped" as never }, t, "vi", "UTC").text).toContain(
      "stage.skipped",
    );
    expect(stageLabel({ ...base, status: "waiting_timer" }, t, "vi", "UTC").text).toContain(
      "status.waiting_timer",
    );
    expect(stageLabel({ ...base, status: "done" }, t, "vi", "UTC")).toEqual({
      text: "process.common.status.done|{}",
      tone: "none",
    });
  });
});
