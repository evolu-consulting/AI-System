// agents-background · bậc model suy từ khoá profile; agent nền (không phải Orchestrator) không làm mặc định / dự phòng.
import { describe, expect, it } from "bun:test";
import { type AgentState, defaultsProblem, tierOf } from "./agent-settings.rules";

describe("tierOf", () => {
  it("lấy bậc ở đuôi khoá profile; không theo bậc ⇒ null", () => {
    expect(tierOf("claude-sub-fast")).toBe("fast");
    expect(tierOf("claude-sub-std")).toBe("std");
    expect(tierOf("claude-sub-deep")).toBe("deep");
    expect(tierOf("fake-1")).toBeNull();
    expect(tierOf(null)).toBeNull();
  });
});

describe("defaultsProblem · agent nền", () => {
  const st = (id: string, o: Partial<AgentState> = {}): AgentState => ({
    id,
    enabled: true,
    entitled: true,
    isOrchestrator: false,
    ...o,
  });
  it("agent nền không phải Orchestrator ⇒ INVALID_REFERENCE; Orchestrator nền vẫn làm mặc định được", () => {
    const m = new Map([
      ["bg", st("bg", { background: true })],
      ["orch", st("orch", { background: true, isOrchestrator: true })],
    ]);
    const d = (id: string) => ({
      default_agent_id: id,
      fallback_agent_id: null,
      on_no_match: "answer" as const,
    });
    expect(defaultsProblem(d("bg"), (id) => m.get(id))).toEqual({
      code: "INVALID_REFERENCE",
      field: "default_agent_id",
    });
    expect(defaultsProblem(d("orch"), (id) => m.get(id))).toBeNull();
  });
});
