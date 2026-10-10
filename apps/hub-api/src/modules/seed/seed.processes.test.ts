// HUB-FR-104 · D18 · `buildProcessPlan` (thuần): seed mặc định hợp lệ; tham chiếu lạ / real_action sai chỗ ⇒ lỗi trước DB.
import { describe, expect, it } from "bun:test";
import { DEFAULT_SEED_DIR, readSeedDir } from "./seed";
import { buildProcessPlan } from "./seed.processes";
import { buildSeedPlan, SeedValidationError } from "./seed.rules";

const stage = (o: Record<string, unknown>) => ({
  key: "a",
  name: "A",
  executor: { agent: "x-agent" },
  output: { filename: "a.md", template: "## A\n", required_sections: ["A"] },
  after: "review",
  ...o,
});

describe("seed.processes · buildProcessPlan [HUB-FR-104]", () => {
  it("D18 · seed mặc định: 4 nhóm, mẫu sdlc 8 stage + hoa-don, chép hoa-don cho acme", () => {
    const src = readSeedDir(DEFAULT_SEED_DIR);
    const agents = new Set(buildSeedPlan(src, { appEnv: "development" }).agents.map((a) => a.key));
    const p = buildProcessPlan(src, agents);
    expect(p.teams.map((t) => t.key).sort()).toEqual([
      "ba-team",
      "dev-team",
      "plan-team",
      "test-team",
    ]);
    expect(p.templates.map((t) => [t.key, t.stages.length])).toEqual([
      ["sdlc", 8],
      ["hoa-don", 2],
    ]);
    expect(p.tenantProcesses).toEqual([
      { tenant_key: "acme", template: "hoa-don", review_group: "ke-toan", enabled: true },
    ]);
  });

  it("agent lạ trong mẫu + real_action ở stage 0 ⇒ SeedValidationError", () => {
    const data = {
      process_templates: [
        {
          key: "p-x",
          name: "X",
          stages: [stage({ executor: { agent: "khong-co" }, real_action: true })],
        },
      ],
    };
    expect(() => buildProcessPlan([{ name: "x.yaml", data }], new Set(["x-agent"]))).toThrow(
      SeedValidationError,
    );
  });
});
