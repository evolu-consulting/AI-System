// HUB-FR-60 · HUB-FR-62 · HUB-FR-72 · H4a plan §2 — unit contract studio (ngoài test khoá của QC).
import { describe, expect, it } from "bun:test";
import {
  AgentCreateSchema,
  AgentHasAccessDetailsSchema,
  AgentListQuerySchema,
  agentUpdateSchemaFor,
  descriptionOverlap,
  ORCHESTRATOR_RUNTIMES,
  STUDIO_ERRORS,
  similarAgents,
} from "./index";

const P = "e4a00000-0000-4000-8000-000000000311";

describe("studio contract", () => {
  it("ORCHESTRATOR_RUNTIMES chỉ agentic-cli (U2/P9)", () => {
    expect([...ORCHESTRATOR_RUNTIMES]).toEqual(["agentic-cli"]);
  });
  it("status lỗi nằm trong 400/403/409/422", () => {
    for (const s of Object.values(STUDIO_ERRORS)) expect([400, 403, 409, 422]).toContain(s);
  });
  it("dify-workflow: profile_id không gửi; gửi profile ⇒ ✗", () => {
    const b = {
      runtime: "dify-workflow",
      key: "dify-x",
      name: { vi: "a", en: "b" },
      description: "m".repeat(20),
      workflow_ids: [P],
    };
    expect(AgentCreateSchema.safeParse(b).success).toBe(true);
    expect(AgentCreateSchema.safeParse({ ...b, profile_id: P }).success).toBe(false);
  });
  it("update python giữ agent_type_key bắt buộc", () => {
    const S = agentUpdateSchemaFor("python");
    const b = {
      name: { vi: "a", en: "b" },
      description: "m".repeat(20),
      runtime_options: {},
      version: 2,
    };
    expect(S.safeParse({ ...b, agent_type_key: "py-x" }).success).toBe(true);
    expect(S.safeParse(b).success).toBe(false);
  });
  it("list query mặc định limit 200 offset 0; limit 201 ✗", () => {
    expect(AgentListQuerySchema.parse({})).toMatchObject({ limit: 200, offset: 0 });
    expect(AgentListQuerySchema.safeParse({ limit: "201" }).success).toBe(false);
  });
  it("AGENT_HAS_ACCESS details strict", () => {
    expect(AgentHasAccessDetailsSchema.safeParse({ entitlements: 1, grants: 0 }).success).toBe(
      true,
    );
    expect(
      AgentHasAccessDetailsSchema.safeParse({ entitlements: 1, grants: 0, x: 1 }).success,
    ).toBe(false);
  });
  it("overlap: tập rỗng ⇒ 0; similarAgents bỏ chính nó", () => {
    expect(descriptionOverlap("", "")).toBe(0);
    const t = { id: "a", description: "alpha beta gamma" };
    expect(
      similarAgents(t, [{ id: "a", key: "a", description: t.description, enabled: true }]),
    ).toEqual([]);
  });
});
