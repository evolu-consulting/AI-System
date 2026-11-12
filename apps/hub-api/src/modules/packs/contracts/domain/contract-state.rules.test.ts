// CR-127 K1a · BR-01/02 · spec §3: bảng chuyển trạng thái HĐ (mọi dòng + chuyển bị cấm + initialState).
import { describe, expect, it } from "bun:test";
import {
  CONTRACT_STATES,
  type ContractEv,
  type ContractState,
  FROM_OF,
  INITIAL_KINDS,
  initialState,
  isContractState,
  transition,
} from "./contract-state.rules";

const ok = (from: ContractState, ev: ContractEv, ctx = {}) => {
  const r = transition(from, ev, ctx);
  if ("error" in r) throw new Error(`${from}+${ev} ⇒ ${r.error}`);
  return r;
};

describe("CR-127 K1a contract-state.rules — bảng §3", () => {
  it("4 trạng thái", () => {
    expect([...CONTRACT_STATES]).toEqual(["draft", "processing", "reject", "done"]);
    expect(isContractState("done")).toBe(true);
    expect(isContractState("active")).toBe(false);
  });

  const rows: [string, ContractState, ContractEv, Record<string, unknown>, ContractState][] = [
    ["#2 extracted", "draft", "extracted", {}, "draft"],
    ["#2 extract_failed", "draft", "extract_failed", {}, "draft"],
    ["#3 submit có quy trình", "draft", "submit", { hasFlow: true }, "processing"],
    ["#4 submit không quy trình", "draft", "submit", { hasFlow: false }, "done"],
    ["#5 flow_approved", "processing", "flow_approved", {}, "done"],
    ["#6 flow_rejected", "processing", "flow_rejected", {}, "reject"],
    ["#7 flow_returned", "processing", "flow_returned", {}, "draft"],
    ["#7b flow_cancelled", "processing", "flow_cancelled", {}, "draft"],
    ["#7b flow_failed", "processing", "flow_failed", {}, "draft"],
    ["#7b flow_not_launched", "processing", "flow_not_launched", {}, "draft"],
    ["#8 withdraw", "processing", "withdraw", {}, "draft"],
    ["#9b inbox_accept", "processing", "inbox_accept", {}, "done"],
    ["#9b inbox_return", "processing", "inbox_return", {}, "draft"],
    ["#9b inbox_reject", "processing", "inbox_reject", {}, "reject"],
    ["#10 partner_returned", "processing", "partner_returned", {}, "draft"],
    ["#11 partner_revised", "draft", "partner_revised", {}, "processing"],
    ["#12 sign_session_done", "processing", "sign_session_done", {}, "done"],
    ["#13 sign_session_declined", "processing", "sign_session_declined", {}, "reject"],
    ["#14a sign_session_cancelled", "processing", "sign_session_cancelled", {}, "draft"],
    ["#14b sign_session_expired_resend", "processing", "sign_session_expired_resend", {}, "draft"],
    ["#14c sign_session_expired_stop", "processing", "sign_session_expired_stop", {}, "reject"],
  ];
  for (const [name, from, ev, ctx, to] of rows)
    it(name, () => {
      expect(ok(from, ev, ctx).to).toBe(to);
      expect(FROM_OF[ev] as ContractState).toBe(from);
    });

  it("cột phụ: extract_state", () => {
    expect(ok("draft", "extracted").cols.extractState).toBe("ready");
    expect(ok("draft", "extract_failed").cols.extractState).toBe("failed");
  });

  it("submit: round+1, người gửi; có quy trình ⇒ phát contract.submitted + lưu bản gửi", () => {
    const r = ok("draft", "submit", { hasFlow: true });
    expect(r.cols).toMatchObject({ submitRoundInc: true, submittedBy: true });
    expect(r.cols.confirm).toBeUndefined();
    expect(r.sideEffects).toEqual(["emit_submitted", "record_submission"]);
  });

  it("submit không quy trình ⇒ DONE + khoá + hiệu lực + hook + event no_flow", () => {
    const r = ok("draft", "submit", { hasFlow: false });
    expect(r.cols).toMatchObject({ submitRoundInc: true, submittedBy: true, confirm: true });
    expect(r.sideEffects).toEqual([
      "record_submission",
      "event_no_flow",
      "refresh_effect",
      "done_hook",
    ]);
  });

  it("mọi chuyển vào DONE ⇒ confirm + refresh_effect + done_hook", () => {
    for (const ev of ["flow_approved", "inbox_accept", "sign_session_done"] as const) {
      const r = ok("processing", ev);
      expect(r.cols.confirm).toBe(true);
      expect(r.sideEffects).toContain("refresh_effect");
      expect(r.sideEffects).toContain("done_hook");
    }
  });

  it("withdraw ⇒ báo người đã nhận việc; partner_revised ⇒ round+1 + contract.received", () => {
    expect(ok("processing", "withdraw").sideEffects).toEqual(["notify_claimed"]);
    const r = ok("draft", "partner_revised");
    expect(r.cols.submitRoundInc).toBe(true);
    expect(r.sideEffects).toEqual(["emit_received"]);
  });

  it("chuyển bị cấm ⇒ STATE_CONFLICT (DONE/REJECT kết thúc, sai trạng thái nguồn)", () => {
    const evs = Object.keys(FROM_OF) as ContractEv[];
    for (const from of ["done", "reject"] as const)
      for (const ev of evs) expect(transition(from, ev, {})).toEqual({ error: "STATE_CONFLICT" });
    expect(transition("processing", "submit", { hasFlow: true })).toEqual({
      error: "STATE_CONFLICT",
    });
    expect(transition("draft", "flow_approved", {})).toEqual({ error: "STATE_CONFLICT" });
    expect(transition("draft", "withdraw", {})).toEqual({ error: "STATE_CONFLICT" });
    expect(transition("processing", "extracted", {})).toEqual({ error: "STATE_CONFLICT" });
  });
});

describe("CR-127 K1a initialState (R#2)", () => {
  it("HĐ thường/khung/gia hạn/tạo lại/từ bước ⇒ draft (đang đọc khi có tệp chờ AI)", () => {
    for (const k of ["upload", "framework", "recreate", "renewal", "create_from_step"] as const) {
      expect(initialState(k)).toEqual({
        ev: "created",
        status: "draft",
        extractState: "ready",
        sideEffects: [],
      });
      expect(initialState(k, { reading: true }).extractState).toBe("reading");
    }
  });
  it("deal, promote, create-manual, mgmt-import, cks ⇒ done (created_done) + hiệu lực", () => {
    for (const k of ["deal", "promote", "create_manual", "mgmt_import", "cks"] as const)
      expect(initialState(k)).toEqual({
        ev: "created_done",
        status: "done",
        extractState: "ready",
        sideEffects: ["refresh_effect"],
      });
  });
  it("CR-127 K8 · HĐ nhận từ đối tác ⇒ processing (partner_received) + phát contract.received (#9)", () => {
    expect(initialState("partner_inbox")).toEqual({
      ev: "partner_received",
      status: "processing",
      extractState: "ready",
      sideEffects: ["emit_received"],
    });
  });
  it("đủ 11 loại tạo", () => {
    expect(INITIAL_KINDS.length).toBe(11);
  });
});
