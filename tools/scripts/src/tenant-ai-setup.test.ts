// tenant-ai-setup: logic thuần của kế hoạch (agent mặc định, mô tả việc, no-op).
import { describe, expect, it } from "bun:test";
import { describePlan, hasWork, type SetupPlan, shouldSetDefault } from "./tenant-ai-setup";

const done: SetupPlan = {
  agentMissing: false,
  entitlement: false,
  agentGrants: 0,
  knowledgePack: 0,
  knowledgeGrants: 0,
  defaultAgent: false,
  currentDefault: "assistant",
};

describe("tenant-ai-setup · kế hoạch", () => {
  it("agent mặc định: chỉ đặt khi chưa có hoặc là orchestrator; không đè mặc định tuỳ chỉnh (trừ force)", () => {
    expect(shouldSetDefault(null)).toBe(true);
    expect(shouldSetDefault("orchestrator")).toBe(true);
    expect(shouldSetDefault("assistant")).toBe(false);
    expect(shouldSetDefault("assistant", true)).toBe(false);
    expect(shouldSetDefault("contract-bot")).toBe(false);
    expect(shouldSetDefault("contract-bot", true)).toBe(true);
  });
  it("đã đủ ⇒ no-op, không dòng kế hoạch", () => {
    expect(hasWork(done)).toBe(false);
    expect(describePlan(done)).toEqual([]);
  });
  it("tenant mới ⇒ liệt kê đủ 4 nhóm việc", () => {
    const p: SetupPlan = {
      ...done,
      entitlement: true,
      agentGrants: 3,
      knowledgePack: 3,
      knowledgeGrants: 9,
      defaultAgent: true,
      currentDefault: null,
    };
    expect(hasWork(p)).toBe(true);
    const lines = describePlan(p).join("\n");
    expect(lines).toContain("entitlement agent assistant");
    expect(lines).toContain("3 Group");
    expect(lines).toContain("3 feature knowledge-*");
    expect(lines).toContain("9 grant knowledge-*");
    expect(lines).toContain("chưa có");
  });
  it("gói knowledge chưa cài (−1) ⇒ báo bỏ qua, không tính là việc; thiếu agent ⇒ báo lỗi", () => {
    const p: SetupPlan = { ...done, knowledgePack: -1 };
    expect(hasWork(p)).toBe(false);
    expect(describePlan(p).join()).toContain("BỎ QUA");
    expect(describePlan({ ...done, agentMissing: true, entitlement: true })[0]).toContain("LỖI");
  });
});
