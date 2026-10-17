// CA-R03 · CA-R04 · ADR-0023 · HUB-FR-143…145 · test-plan §5 PD-C10, PD-C11 + plan-addendum A6 (parity hằng/lý do khai lại
// ở lớp 1): domain KHÔNG import contract ⇒ test này khẳng định bằng nhau. Domain vắng ⇒ "module vắng"; hằng contract mới
// vắng ⇒ đỏ ở expect. `runs/autofix.rules.ts` (P-c, có sẵn, không dời) nạp bằng `tryLoad`.
import { describe, expect, it } from "bun:test";
import { CHAT_RUN_ERROR_CODES, DECISION_OPTIONS, DECISION_REASONS } from "@ai/contracts/chat";
import { JOB_FAIL_REASONS } from "@ai/contracts/hub";
import { domainExport, domainFn, fn, loadChat, PROC, tryLoad } from "../_support/modules";

const chat = await loadChat();

/** plan-domain §2 (phần P-d1) + plan-addendum A6. P-d2 (`TOOL_*`, `BRANCH_*`) không thuộc P-d1. */
const LIMITS = [
  "STAGE_RETRY_MAX",
  "RETRY_BACKOFF_S",
  "REMIND_EVERY_H",
  "REMIND_MAX",
  "REMIND_AFTER_H",
  "ESCALATE_AFTER_H",
  "PROCESS_TTL_DAYS",
  "WAIT_OFFSET_DAYS",
  "WAIT_HORIZON_DAYS",
  "WAIT_TIME_DEFAULT",
  "TIMER_SWEEP_BATCH",
  "REDO_MAX",
  "ASKS_MAX",
  "FORWARD_CHAIN_MAX",
] as const;

describe("PD-C10 · P/domain/limits.ts = hằng contract [CA-R03, plan-domain §2, A6]", () => {
  for (const k of LIMITS) {
    it(`CA-R03 · PD-C10 · limits.${k} toEqual contract chat.${k} (đã định nghĩa)`, async () => {
      const d = await domainExport("limits.ts", k);
      expect({ k, contract: chat[k] === undefined ? "vắng" : "có" }).toEqual({ k, contract: "có" });
      expect({ k, v: d }).toEqual({ k, v: chat[k] });
    });
  }
});

describe("PD-C11 · lỗi tạm của domain ⊆ mã/lý do contract [CA-R04, plan-domain §4.1]", () => {
  it("CA-R04 · PD-C11 · TRANSIENT_JOB_REASONS ⊆ JOB_FAIL_REASONS; đúng 6 lý do tạm", async () => {
    const s = (await domainExport(
      "runs/job-error.rules.ts",
      "TRANSIENT_JOB_REASONS",
    )) as ReadonlySet<string>;
    const all: readonly string[] = JOB_FAIL_REASONS;
    expect([...s].filter((r) => !all.includes(r))).toEqual([]);
    expect([...s].sort()).toEqual(
      ["timeout", "upstream", "crash", "orphaned", "provider_busy", "tenant_slots"].sort(),
    );
  });
  it("CA-R04 · PD-C11 · TRANSIENT_JOB_CODES ⊆ CHAT_RUN_ERROR_CODES; = {TIMEOUT, UPSTREAM_ERROR}", async () => {
    const s = (await domainExport(
      "runs/job-error.rules.ts",
      "TRANSIENT_JOB_CODES",
    )) as ReadonlySet<string>;
    const all: readonly string[] = CHAT_RUN_ERROR_CODES;
    expect([...s].filter((c) => !all.includes(c))).toEqual([]);
    expect([...s].sort()).toEqual(["TIMEOUT", "UPSTREAM_ERROR"]);
  });
});

describe("A6 · tasks/decision.rules.ts khai lại thứ tự lựa chọn + tập lý do autofix [plan-addendum A6]", () => {
  it("CA-R03 · A6 · DECISION_OPTION_ORDER toEqual [...DECISION_OPTIONS] (giữ thứ tự — UI dùng)", async () => {
    const order = await domainExport("tasks/decision.rules.ts", "DECISION_OPTION_ORDER");
    expect(order).toEqual([...DECISION_OPTIONS]);
  });
  it("CA-R04 · A6 · ∀ r ∈ DECISION_REASONS: domain isAutofixReason(r) === runs/autofix.rules isAutofixReason(r)", async () => {
    const dom = await domainFn("tasks/decision.rules.ts", "isAutofixReason");
    const old = fn(await tryLoad(`${PROC}/runs/autofix.rules.ts`), "isAutofixReason");
    const reasons: readonly string[] = DECISION_REASONS;
    expect(reasons.map((r) => [r, dom(r)])).toEqual(reasons.map((r) => [r, old(r)]));
    expect(reasons.filter((r) => dom(r)).sort()).toEqual(
      ["apply_conflict", "apply_failed", "autofix_check_failed", "sandbox_unavailable"].sort(),
    );
  });
});
