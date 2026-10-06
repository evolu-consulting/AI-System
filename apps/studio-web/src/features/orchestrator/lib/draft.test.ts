import { describe, expect, it } from "bun:test";
import { agentOptions, validateDraft } from "./draft";
import { classifySaveError } from "./save-error";

const ID = "11111111-1111-4111-8111-111111111111";
const ok = {
  agentId: ID,
  maxSteps: "5",
  tokenBudget: "200000",
  historyN: "10",
  onNoMatch: "answer" as const,
};

describe("validateDraft", () => {
  it("hợp lệ → input số", () => {
    expect(validateDraft(ok).input).toEqual({
      agent_id: ID,
      max_steps: 5,
      token_budget: 200000,
      history_n: 10,
      on_no_match: "answer",
    });
  });
  it("lỗi gắn đúng trường", () => {
    const { errors, input } = validateDraft({
      ...ok,
      agentId: "",
      maxSteps: "21",
      tokenBudget: "999",
      historyN: "",
    });
    expect(input).toBeUndefined();
    expect(errors).toEqual({
      agent_id: "orch.err.agent",
      max_steps: "orch.err.maxSteps",
      token_budget: "orch.err.tokenBudget",
      history_n: "orch.err.historyN",
    });
  });
});

describe("agentOptions", () => {
  const a = (id: string, key: string, runtime: string, enabled = true) => ({
    id,
    key,
    runtime,
    enabled,
    name: { vi: `V ${key}`, en: `E ${key}` },
  });
  it("chỉ agent bật + runtime cho phép; nhãn {name} ({key}) · {runtime}", () => {
    const list = [
      a("1", "x", "agentic-cli"),
      a("2", "y", "llm"),
      a("3", "z", "agentic-cli", false),
    ];
    const o = agentOptions(list, ["agentic-cli"], "vi");
    expect(o.map((x) => x.label)).toEqual(["V x (x) · agentic-cli"]);
  });
  it("giữ agent đang chọn dù không còn hợp lệ", () => {
    const cur = { id: "9", key: "old", name: "Old", runtime: "llm", enabled: false } as never;
    expect(agentOptions([], ["agentic-cli"], "vi", cur)[0]?.id).toBe("9");
  });
});

describe("classifySaveError", () => {
  it("ORCHESTRATOR_EXISTS → lỗi ở ô tenant", () => {
    expect(classifySaveError({ code: "ORCHESTRATOR_EXISTS" }).errors.tenant_id).toBe(
      "errors.ORCHESTRATOR_EXISTS",
    );
  });
  it("AGENT_NOT_ORCHESTRATABLE → lỗi ở ô agent", () => {
    expect(classifySaveError({ code: "AGENT_NOT_ORCHESTRATABLE" }).errors.agent_id).toBeDefined();
  });
});
