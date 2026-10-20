// HD-FR-34 · D3-07 · N2-D06 mở rộng (người dùng chốt 2026-10-19 "Chặn lun"): người bắt đầu run ở stage `exclude_starter`
// không chọn `use_current` (= coi như Đạt, lách cấp 2) ở task `decision` với MỌI lý do; `add_attempt`/`cancel` vẫn được.
import { describe, expect, test } from "bun:test";
import { DECISION_REASONS } from "@ai/contracts/chat";
import { starterDecisionBlocked } from "./task-access.rules";

const on = { kind: "review", exclude_starter: true };

describe("D3-07 · starterDecisionBlocked [HD-FR-34]", () => {
  test("use_current bị chặn với mọi lý do khi người quyết là người bắt đầu", () => {
    for (const reason of DECISION_REASONS)
      expect({
        reason,
        blocked: starterDecisionBlocked(on, "u1", "u1", { reason: reason, option: "use_current" }),
      }).toEqual({
        reason,
        blocked: true,
      });
  });
  test("add_attempt / cancel: chỉ chặn lý do mở quyền Group duyệt (N2-D06 giữ nguyên)", () => {
    expect(
      starterDecisionBlocked(on, "u1", "u1", { reason: "tool_failed", option: "add_attempt" }),
    ).toBe(false);
    expect(
      starterDecisionBlocked(on, "u1", "u1", { reason: "permission_lost", option: "cancel" }),
    ).toBe(false);
    expect(starterDecisionBlocked(on, "u1", "u1", { reason: "redo_limit", option: "cancel" })).toBe(
      true,
    );
    expect(
      starterDecisionBlocked(on, "u1", "u1", { reason: "back_limit", option: "add_attempt" }),
    ).toBe(true);
  });
  test("người khác / cờ tắt / stage auto ⇒ không chặn", () => {
    expect(
      starterDecisionBlocked(on, "u1", "u2", { reason: "permission_lost", option: "use_current" }),
    ).toBe(false);
    expect(
      starterDecisionBlocked({ kind: "review" }, "u1", "u1", {
        reason: "permission_lost",
        option: "use_current",
      }),
    ).toBe(false);
    expect(
      starterDecisionBlocked({ kind: "auto" }, "u1", "u1", {
        reason: "permission_lost",
        option: "use_current",
      }),
    ).toBe(false);
  });
});
