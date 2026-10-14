// HUB-FR-104 · D18 · `buildProcessPlan` (thuần): seed mặc định hợp lệ; tham chiếu lạ / real_action sai chỗ ⇒ lỗi trước DB.
import { describe, expect, it } from "bun:test";
import { DEFAULT_SEED_DIR, readSeedDir } from "./seed";
import { buildProcessPlan, upsertTemplates } from "./seed.processes";
import type { Tx } from "./seed.repo";
import { buildSeedPlan, SeedValidationError } from "./seed.rules";
import { SeedStageSchema } from "./seed.schema";

const stage = (o: Record<string, unknown>) => ({
  key: "a",
  name: "A",
  executor: { agent: "x-agent" },
  output: { filename: "a.md", template: "## A\n", required_sections: ["A"] },
  after: "review",
  ...o,
});

describe("seed.processes · buildProcessPlan [HUB-FR-104]", () => {
  it("D18 · K1 T5g · seed mặc định: 4 nhóm, mẫu sdlc 8 + hoa-don + sdlc-delivery 9 + bug-fix 6 + fixbug-apply 1 + fixbug-pr 2 (P-c2 B8) + fixbug-evolu 4 (P-c1 B6); chép cho acme/evolu", () => {
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
      ["sdlc-delivery", 9],
      ["bug-fix", 6],
      ["fixbug-apply", 1],
      ["fixbug-pr", 2],
      ["fixbug-evolu", 4],
    ]);
    expect(p.tenantProcesses).toEqual([
      { tenant_key: "acme", template: "hoa-don", review_group: "ke-toan", enabled: true },
      {
        tenant_key: "evolu",
        template: "sdlc-delivery",
        review_group: "beta-testers",
        enabled: true,
      },
      { tenant_key: "evolu", template: "bug-fix", review_group: "beta-testers", enabled: true },
    ]);
    expect(p.teamEntitlements).toContainEqual({ team: "dev-team", tenant_key: "evolu" });
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

describe("seed.processes · K1 T5g after/step [HUB-FR-104]", () => {
  it("K1 T5g · after { review: { back_to_steps } } + step hợp lệ ⇒ qua", () => {
    const data = {
      process_templates: [
        {
          key: "p-b",
          name: "B",
          stages: [
            stage({ key: "a", step: 0, after: "auto" }),
            stage({ key: "b", step: 1, after: { review: { back_to_steps: [0] } } }),
          ],
        },
      ],
    };
    const p = buildProcessPlan([{ name: "x.yaml", data }], new Set(["x-agent"]));
    expect(p.templates[0]?.stages.map((s) => [s.step, s.after])).toEqual([
      [0, "auto"],
      [1, { review: { back_to_steps: [0] } }],
    ]);
  });

  it("K1 T5g · back_to_steps ≥ bước của stage ⇒ SeedValidationError BACK_TARGET_INVALID", () => {
    const data = {
      process_templates: [
        {
          key: "p-c",
          name: "C",
          stages: [
            stage({ key: "a" }),
            stage({ key: "b", after: { review: { back_to_steps: [1] } } }),
          ],
        },
      ],
    };
    let err: unknown;
    try {
      buildProcessPlan([{ name: "x.yaml", data }], new Set(["x-agent"]));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SeedValidationError);
    expect(String((err as Error).message)).toContain("BACK_TARGET_INVALID");
  });

  it("K1 T5g · after object lạ (back_to_steps ngoài 0..9) ⇒ schema từ chối", () => {
    const after = { review: { back_to_steps: [10] } };
    expect(SeedStageSchema.safeParse(stage({ after })).success).toBe(false);
    expect(SeedStageSchema.safeParse(stage({ after: { review: {} } })).success).toBe(false);
  });
});

describe("seed.processes · upsertTemplates sources jsonb [HUB-FR-119]", () => {
  it("sources đi qua tx.json (mảng jsonb), không phải chuỗi JSON.stringify", async () => {
    const jsonArgs: unknown[] = [];
    const tx = Object.assign(async () => [] as unknown[], {
      json: (v: unknown) => {
        jsonArgs.push(v);
        return { __json: v };
      },
    });
    const sources = [{ key: "repo", kind: "git_remote" }];
    const tpl = { key: "t", name: "T", description: "", input_hint: "", stages: [], sources };
    await upsertTemplates(tx as unknown as Tx, [tpl as never], {
      agents: new Map(),
      teams: new Map(),
    } as never);
    expect(jsonArgs).toContainEqual(sources);
    expect(jsonArgs.some((a) => typeof a === "string")).toBe(false);
  });
});
