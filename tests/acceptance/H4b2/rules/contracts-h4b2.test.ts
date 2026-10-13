// HUB-FR-66 · HUB-FR-67 · HUB-FR-78 · spec H4b2 §3 (kiểu chung, A, B, mã lỗi) · test-plan H4b2 §3 R70–R81: contract
// `@ai/contracts/studio` khối models — strict, mặc định, bất biến key/kind/vendor (Q8), list giữ H4a-R13 (Q6), lỗi mới
// ở hằng riêng. Đỏ trước code: export chưa có ⇒ `expect(typeof …safeParse)`.
import { describe, expect, it } from "bun:test";
import { loadStudio } from "./_rules";

const c = await loadStudio();
const S1 = "a4b20000-0000-4000-8000-000000000001";
const AT = "2026-10-13T08:00:00.000Z";
const schema = (name: string) => {
  expect([name, typeof c[name]?.safeParse]).toEqual([name, "function"]);
  return c[name];
};
const okP = (name: string, v: unknown) => schema(name).safeParse(v).success as boolean;

describe("R70–R72 · hằng [spec §3 Kiểu chung · Mã lỗi]", () => {
  it("HUB-FR-66 · R70 · PROVIDER_KINDS = [subscription, api]; STUDIO_PROVIDER_VENDORS = [anthropic, openai, google, fake] (không dify)", () => {
    expect(c.PROVIDER_KINDS).toEqual(["subscription", "api"]);
    expect(c.STUDIO_PROVIDER_VENDORS).toEqual(["anthropic", "openai", "google", "fake"]);
  });
  it("HUB-FR-66 · R71 · STUDIO_MODEL_ERRORS: 4 mã 409 mới; STUDIO_ERRORS (đã khoá) không đổi các mã cũ", () => {
    expect(c.STUDIO_MODEL_ERRORS).toMatchObject({
      PROVIDER_IN_USE: 409,
      PROVIDER_HAS_HISTORY: 409,
      PROVIDER_READONLY: 409,
      PROFILE_IN_USE: 409,
    });
    expect(c.STUDIO_ERRORS).toMatchObject({
      INVALID_REFERENCE: 400,
      VERSION_CONFLICT: 409,
      KEY_TAKEN: 409,
    });
  });
  it("HUB-FR-66 · R72 · INVALID_REFERENCE thêm field secret_id/steps, index 0..4, reason wrong_kind/readonly (giá trị cũ vẫn hợp)", () => {
    const s = "StudioInvalidReferenceDetailsSchema";
    expect(okP(s, { field: "secret_id", reason: "wrong_kind" })).toBe(true);
    expect(okP(s, { field: "secret_id", reason: "not_found" })).toBe(true);
    expect(okP(s, { field: "steps", index: 4, reason: "readonly" })).toBe(true);
    expect(okP(s, { field: "steps", index: 5, reason: "readonly" })).toBe(false);
    expect(okP(s, { field: "profile_id", reason: "not_found" })).toBe(true);
  });
});

describe("R73–R77 · provider [spec §3 A · Q6 · Q8]", () => {
  const create = {
    key: "anthropic-api",
    kind: "api",
    vendor: "anthropic",
    base_url: null,
    secret_id: S1,
  };
  it("HUB-FR-66 · R73 · ProviderCreate: mặc định max_concurrency 1, enabled true; vendor dify / max 0, 101 / key sai ⇒ không hợp", () => {
    const p = schema("ProviderCreateSchema").safeParse(create);
    expect(p.success).toBe(true);
    expect(p.data).toMatchObject({ max_concurrency: 1, enabled: true });
    for (const bad of [
      { ...create, vendor: "dify" },
      { ...create, max_concurrency: 0 },
      { ...create, max_concurrency: 101 },
      { ...create, key: "Anthropic_API" },
      { ...create, kind: "subscription-cli" },
    ])
      expect([bad, okP("ProviderCreateSchema", bad)]).toEqual([bad, false]);
  });
  it("HUB-FR-66 · R74 · ProviderCreate strict: thêm `value`/`api_key` ⇒ không hợp (Q7: không nhận key thô)", () => {
    expect(okP("ProviderCreateSchema", { ...create, value: "sk-x" })).toBe(false);
    expect(okP("ProviderCreateSchema", { ...create, api_key: "sk-x" })).toBe(false);
  });
  it("HUB-FR-66 · R75 · ProviderUpdate: có version; key/kind/vendor ⇒ không hợp (Q8 bất biến)", () => {
    const u = { version: 1, base_url: null, secret_id: S1, max_concurrency: 2, enabled: true };
    expect(okP("ProviderUpdateSchema", u)).toBe(true);
    for (const extra of [{ key: "x-y" }, { kind: "api" }, { vendor: "openai" }])
      expect([extra, okP("ProviderUpdateSchema", { ...u, ...extra })]).toEqual([extra, false]);
    expect(okP("ProviderEnabledPatchSchema", { version: 3, enabled: false })).toBe(true);
    expect(okP("ProviderEnabledPatchSchema", { enabled: false })).toBe(false);
  });
  it("HUB-FR-66 · R76 · ProviderItemSchema thêm version, slots_in_use; vẫn KHÔNG nhận secret_id/last_error (H4a-R13)", () => {
    const item = {
      id: S1,
      key: "claude-sub",
      kind: "subscription",
      vendor: "anthropic",
      base_url: null,
      has_secret: false,
      max_concurrency: 2,
      enabled: true,
      dev_only: false,
      state: { status: "ok", cooldown_until: null, utilization: null },
      version: 1,
      slots_in_use: 0,
    };
    expect(okP("ProviderItemSchema", item)).toBe(true);
    expect(okP("ProviderItemSchema", { ...item, secret_id: S1 })).toBe(false);
    expect(okP("ProviderItemSchema", { ...item, last_error: "x" })).toBe(false);
  });
  it("HUB-FR-66 · R77 · ProviderCheckResult: status 4 giá trị, error_code enum, message ≤ 500", () => {
    const r = {
      status: "error",
      error_code: "auth_failed",
      http_status: 401,
      message: "invalid x-api-key (fake)",
      latency_ms: 3,
      checked_at: AT,
    };
    expect(okP("ProviderCheckResultSchema", r)).toBe(true);
    for (const s of ["ok", "unsupported", "requested"])
      expect(
        okP("ProviderCheckResultSchema", {
          ...r,
          status: s,
          error_code: null,
          http_status: null,
          message: null,
          latency_ms: null,
        }),
      ).toBe(true);
    expect(okP("ProviderCheckResultSchema", { ...r, error_code: "boom" })).toBe(false);
    expect(okP("ProviderCheckResultSchema", { ...r, message: "m".repeat(501) })).toBe(false);
    expect(okP("ProviderCheckResultSchema", { ...r, key: "sk" })).toBe(false);
  });
});

describe("R78–R81 · model profile + ProviderState [spec §3 B]", () => {
  const steps = [{ provider_key: "claude-sub", model: null, on: ["quota"] }];
  it("HUB-FR-67 · R78 · ModelProfileWrite: steps 1..5; 0 hoặc 6 bước ⇒ không hợp; key sai ⇒ không hợp", () => {
    expect(okP("ModelProfileWriteSchema", { key: "smart", steps })).toBe(true);
    expect(okP("ModelProfileWriteSchema", { key: "smart", steps: [] })).toBe(false);
    expect(okP("ModelProfileWriteSchema", { key: "smart", steps: Array(6).fill(steps[0]) })).toBe(
      false,
    );
    expect(okP("ModelProfileWriteSchema", { key: "Smart Profile", steps })).toBe(false);
  });
  it("HUB-FR-67 · R79 · ModelProfileUpdate: {version, steps}; key ⇒ không hợp (Q8)", () => {
    expect(okP("ModelProfileUpdateSchema", { version: 1, steps })).toBe(true);
    expect(okP("ModelProfileUpdateSchema", { version: 1, steps, key: "x-y" })).toBe(false);
  });
  it("HUB-FR-67 · R80 · ModelProfileItemSchema thêm version, active_step (int|null), all_subscription, agent_count", () => {
    const item = {
      id: S1,
      key: "smart",
      steps: [{ provider_key: "claude-sub", model: "sonnet", on: ["quota"] }],
      version: 2,
      active_step: null,
      all_subscription: true,
      agent_count: 0,
    };
    expect(okP("ModelProfileItemSchema", item)).toBe(true);
    expect(okP("ModelProfileItemSchema", { ...item, active_step: 1 })).toBe(true);
  });
  it("HUB-FR-66 · R81 · ProviderStateSchema: status 5 giá trị, last_error ≤ 500", () => {
    const s = {
      status: "cooldown",
      cooldown_until: AT,
      last_probe_at: AT,
      last_ok_at: null,
      utilization: 0.5,
      last_error: "rate limited",
    };
    expect(okP("ProviderStateSchema", s)).toBe(true);
    expect(okP("ProviderStateSchema", { ...s, status: "down" })).toBe(false);
    expect(okP("ProviderStateSchema", { ...s, last_error: "e".repeat(501) })).toBe(false);
  });
});
