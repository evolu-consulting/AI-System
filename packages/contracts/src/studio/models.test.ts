// HUB-FR-66 · HUB-FR-67 · HUB-FR-78 · spec H4b2 §3 — contract Models + Quyền agent (bổ sung test khoá R70–R81).
import { describe, expect, test } from "bun:test";
import {
  EntitlementCellParamsSchema,
  EntitlementMatrixSchema,
  ModelProfileSchema,
  ProviderDetailSchema,
  ProviderInUseDetailsSchema,
  ProviderVersionConflictDetailsSchema,
  STUDIO_MODEL_ERROR_DETAILS,
  VersionQuerySchema,
} from "./index";

const ID = "a4b20000-0000-4000-8000-000000000001";
const AT = "2026-10-13T08:00:00.000Z";
const detail = {
  id: ID,
  key: "openai-main",
  kind: "api",
  vendor: "openai",
  base_url: null,
  has_secret: true,
  max_concurrency: 1,
  enabled: true,
  dev_only: false,
  version: 2,
  slots_in_use: 0,
  secret: { id: ID, name: "openai-main" },
  readonly: false,
  updated_at: AT,
  state: null,
  used_by_profiles: [{ id: ID, key: "smart" }],
};

describe("HUB-FR-66 · ProviderDetail", () => {
  test("hợp lệ; state đầy đủ (last_error) chỉ ở chi tiết; VERSION_CONFLICT bọc chi tiết", () => {
    expect(ProviderDetailSchema.safeParse(detail).success).toBe(true);
    const state = {
      status: "error",
      cooldown_until: null,
      last_probe_at: AT,
      last_ok_at: null,
      utilization: null,
      last_error: "401",
    };
    expect(ProviderDetailSchema.safeParse({ ...detail, state }).success).toBe(true);
    expect(ProviderDetailSchema.safeParse({ ...detail, secret_id: ID }).success).toBe(false);
    expect(
      ProviderVersionConflictDetailsSchema.safeParse({ current: detail, updated_at: AT }).success,
    ).toBe(true);
  });
  test("PROVIDER_IN_USE cần 1..50 profile; version query ép số ≥ 1", () => {
    expect(ProviderInUseDetailsSchema.safeParse({ profiles: [] }).success).toBe(false);
    expect(STUDIO_MODEL_ERROR_DETAILS.KEY_TAKEN.safeParse({ field: "key" }).success).toBe(true);
    expect(VersionQuerySchema.parse({ version: "3" })).toEqual({ version: 3 });
    expect(VersionQuerySchema.safeParse({ version: "0" }).success).toBe(false);
  });
});

describe("HUB-FR-67 · ModelProfile", () => {
  test("chi tiết = item + updated_at + used_by_agents", () => {
    const p = {
      id: ID,
      key: "smart",
      steps: [{ provider_key: "claude-sub", model: null, on: [] }],
      version: 1,
      active_step: 0,
      all_subscription: true,
      agent_count: 1,
      updated_at: AT,
      used_by_agents: [{ id: ID, key: "assistant" }],
    };
    expect(ModelProfileSchema.safeParse(p).success).toBe(true);
    expect(ModelProfileSchema.safeParse({ ...p, active_step: -1 }).success).toBe(false);
  });
});

describe("HUB-FR-78 · Quyền agent", () => {
  test("ma trận strict; path param phải uuid", () => {
    const m = {
      agents: [
        {
          id: ID,
          key: "assistant",
          name: "Trợ lý",
          enabled: true,
          is_orchestrator: false,
          only_tenant_id: null,
        },
      ],
      tenants: [{ id: ID, key: "acme", name: "Acme", active: true }],
      cells: [
        {
          agent_id: ID,
          tenant_id: ID,
          granted_at: AT,
          grant_count: 2,
          grants: { group: 1, user: 1, tenant: 0 },
        },
      ],
      truncated: false,
      hub_config_version: 7,
    };
    expect(EntitlementMatrixSchema.safeParse(m).success).toBe(true);
    expect(EntitlementMatrixSchema.safeParse({ ...m, extra: 1 }).success).toBe(false);
    expect(EntitlementCellParamsSchema.safeParse({ agent_id: "x", tenant_id: ID }).success).toBe(
      false,
    );
  });
});
