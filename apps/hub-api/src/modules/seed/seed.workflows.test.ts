// HUB-FR-23 · H2a-R14 · unit luật seed H2a (plan-db §4): `runtime_options` agent `dify-*`, đối chiếu `admin.workflows`.
// Nhánh cần `difyAgentInput` (B4) do acceptance A93–A95 phủ.
import { describe, expect, it } from "bun:test";
import { DEFAULT_SEED_DIR, readSeedDir } from "./seed";
import { buildSeedPlan, type SeedPlan, SeedValidationError } from "./seed.rules";
import { resolveWorkflows, type SeedCatalogWorkflow, workflowKeysOf } from "./seed.workflows";

const plan = (): SeedPlan => buildSeedPlan(readSeedDir(DEFAULT_SEED_DIR), { appEnv: "test" });
const WF = (key: string, appType: SeedCatalogWorkflow["appType"]): SeedCatalogWorkflow => ({
  id: `00000000-0000-4000-8000-0000000000${key.length.toString().padStart(2, "0")}`,
  key,
  appType,
  inputSchema: [],
});

describe("HUB-FR-23 · runtime_options agent dify-*", () => {
  it("H2a-R14 · thừa khoá / thiếu workflow_key / key gạch dưới → SeedValidationError nêu agent", () => {
    for (const opts of [{ workflow_key: "tom", extra: 1 }, {}, { workflow_key: "co_gach" }]) {
      const src = readSeedDir(DEFAULT_SEED_DIR).map((s) => {
        if (s.name !== "agents.yaml") return s;
        const data = structuredClone(s.data) as {
          agents: { key: string; runtime_options?: unknown }[];
        };
        for (const a of data.agents) if (a.key === "dify-tom") a.runtime_options = opts;
        return { name: s.name, data };
      });
      let err: unknown;
      try {
        buildSeedPlan(src, { appEnv: "test" });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(SeedValidationError);
      expect((err as Error).message).toContain("agents.dify-tom.runtime_options");
    }
  });
});

describe("HUB-FR-23 · đối chiếu admin.workflows", () => {
  it("H2a-R14 · workflow vắng → bỏ agent/agent_workflows/cờ + cảnh báo, agent khác giữ", () => {
    const p = {
      ...plan(),
      agentWorkflows: [{ agent: "assistant", workflow: "x-wf" }],
      sideEffect: ["y-wf"],
    };
    expect(workflowKeysOf(p).sort()).toEqual(["tom", "tro-ly", "x-wf", "y-wf"]);
    const r = resolveWorkflows(p, []);
    expect(r.issues).toEqual([]);
    expect(r.agents.map((a) => a.key)).toEqual(["orchestrator", "assistant"]);
    expect([r.agentWorkflows, r.sideEffectIds]).toEqual([[], []]);
    for (const k of ["dify-tom", "dify-tro-ly", "x-wf", "y-wf"])
      expect(r.warnings.join("\n")).toContain(k);
  });

  it("H2a-R14 · app_type không khớp runtime → issue (dify-workflow↔chat, dify-agent↔workflow)", () => {
    const r = resolveWorkflows(plan(), [WF("tom", "chat"), WF("tro-ly", "workflow")]);
    expect(r.issues.map((i) => i.path)).toEqual([
      "agents.dify-tom.runtime_options.workflow_key",
      "agents.dify-tro-ly.runtime_options.workflow_key",
    ]);
    expect(r.issues.map((i) => i.message).join(" ")).toContain("app_type");
  });

  it("HUB-FR-95 · agent_workflows + side_effect có trong catalog → đổi sang id", () => {
    const p = {
      ...plan(),
      agents: [],
      agentWorkflows: [{ agent: "assistant", workflow: "card" }],
      sideEffect: ["card"],
    };
    const wf = WF("card", "workflow");
    const r = resolveWorkflows(p, [wf]);
    expect(r.agentWorkflows).toEqual([{ agent: "assistant", workflowId: wf.id }]);
    expect(r.sideEffectIds).toEqual([wf.id]);
    expect(r.warnings).toEqual([]);
  });
});
