import { describe, expect, it } from "bun:test";
import { mergeSeedAgent, type SeedAgentFields } from "./seed.overrides";

const base: SeedAgentFields = {
  name: { vi: "a", en: "a" },
  description: "d",
  runtime: "agentic-cli",
  profile_id: "p-db",
  system_prompt: "db prompt",
  runtime_options: {},
  timeout_s: 600,
  token_budget: null,
  enabled: true,
};
const seed: SeedAgentFields = { ...base, profile_id: "p-yaml", system_prompt: "yaml prompt" };

describe("mergeSeedAgent", () => {
  it("khong override => theo yaml", () => {
    expect(mergeSeedAgent(base, seed, [])).toEqual(seed);
  });
  it("cot bi override giu cua DB, cot khac theo yaml", () => {
    const r = mergeSeedAgent(base, seed, ["profile_id"]);
    expect(r.profile_id).toBe("p-db");
    expect(r.system_prompt).toBe("yaml prompt");
  });
});
