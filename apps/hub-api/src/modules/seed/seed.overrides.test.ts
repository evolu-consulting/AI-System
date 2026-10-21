import { describe, expect, it } from "bun:test";
import { mergeSeedAgent, type SeedAgentFields, sameAgentValue } from "./seed.overrides";

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

describe("sameAgentValue", () => {
  it("khong tinh thu tu khoa object (jsonb sap lai khoa), tinh thu tu mang va gia tri", () => {
    expect(
      sameAgentValue(
        { allowed_tools: [], pack_tools: ["a", "b"], x: { vi: "v", en: "e" } },
        { x: { en: "e", vi: "v" }, pack_tools: ["a", "b"], allowed_tools: [] },
      ),
    ).toBe(true);
    expect(sameAgentValue({ p: ["a", "b"] }, { p: ["b", "a"] })).toBe(false);
    expect(sameAgentValue(null, null)).toBe(true);
    expect(sameAgentValue({ a: 1 }, { a: 2 })).toBe(false);
  });
});
