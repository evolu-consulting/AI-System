// HUB-FR-67 · AC-H4b2-07 (vế Studio) · spec H4b2 §3 B · `active_step` (= pickStep(…, false)), `all_subscription`,
// chuẩn hoá bước (thứ tự khoá jsonb) và hình dạng `ModelProfileSchema` (P12/P13 ở mức hàm thuần).
import { describe, expect, it } from "bun:test";
import { ModelProfileSchema } from "@ai/contracts/studio";
import {
  activeStep,
  indexProviders,
  normSteps,
  sameSteps,
  stepView,
  toModelProfile,
} from "./profiles.map";
import type { ProviderView } from "./profiles.repo";

const NOW = new Date("2026-10-13T00:00:00Z");
const FUT = new Date("2099-01-01T00:00:00Z");
const PAST = new Date("2020-01-01T00:00:00Z");
const pv = (key: string, o: Partial<ProviderView> = {}): ProviderView => ({
  key,
  vendor: "anthropic",
  kind: "subscription",
  enabled: true,
  status: null,
  cooldownUntil: null,
  ...o,
});
const st = (provider_key: string, on: string[] = [], model: string | null = null) => ({
  provider_key,
  model,
  on,
});

describe("activeStep", () => {
  it("P12 · không state ⇒ 0; bước 0 cooldown + on [quota] ⇒ 1; on [] ⇒ null", () => {
    const ok = indexProviders([pv("a"), pv("b")]);
    expect(activeStep([st("a", ["quota"]), st("b")], ok, NOW)).toBe(0);
    const cd = indexProviders([pv("a", { status: "cooldown", cooldownUntil: FUT }), pv("b")]);
    expect(activeStep([st("a", ["quota"]), st("b")], cd, NOW)).toBe(1);
    expect(activeStep([st("a"), st("b")], cd, NOW)).toBeNull();
  });

  it("P13 · bước 0 tắt ⇒ 1 (vô điều kiện); logged_out + on [error] ⇒ 1; cooldown đã hết ⇒ 0", () => {
    const off = indexProviders([pv("a", { enabled: false }), pv("b")]);
    expect(activeStep([st("a"), st("b")], off, NOW)).toBe(1);
    const lo = indexProviders([pv("a", { status: "logged_out" }), pv("b")]);
    expect(activeStep([st("a", ["error"]), st("b")], lo, NOW)).toBe(1);
    const past = indexProviders([pv("a", { status: "cooldown", cooldownUntil: PAST })]);
    expect(activeStep([st("a")], past, NOW)).toBe(0);
  });

  it("provider vắng ⇒ coi như tắt; hết bước ⇒ null", () => {
    expect(activeStep([st("x"), st("b")], indexProviders([pv("b")]), NOW)).toBe(1);
    expect(activeStep([st("x")], indexProviders([]), NOW)).toBeNull();
    expect(stepView(undefined)).toBeUndefined();
    expect(stepView(pv("a"))).toEqual({ enabled: true, state: undefined });
  });
});

describe("normSteps / sameSteps", () => {
  it("thứ tự khoá jsonb không ảnh hưởng; đổi thứ tự bước hoặc `on` ⇒ khác", () => {
    const a = [{ on: ["quota"], model: null, provider_key: "a" }];
    expect(sameSteps(a, [st("a", ["quota"])])).toBe(true);
    expect(Object.keys(normSteps(a)[0] ?? {})).toEqual(["provider_key", "model", "on"]);
    expect(sameSteps([st("a"), st("b")], [st("b"), st("a")])).toBe(false);
    expect(sameSteps([st("a", ["quota", "error"])], [st("a", ["error", "quota"])])).toBe(false);
  });
});

describe("toModelProfile", () => {
  it("P01/P11 · hợp ModelProfileSchema; all_subscription theo kind; agent_count + used_by_agents", () => {
    const providers = indexProviders([pv("pa"), pv("pk", { kind: "api", vendor: "openai" })]);
    const row = {
      id: "a4b20000-0000-4000-8000-000000000001",
      key: "qc",
      steps: [st("pa", ["quota", "error"], "m1"), st("pk")],
      version: 2,
      updatedAt: NOW,
    };
    const usedBy = [{ id: "a4b20000-0000-4000-8000-000000000009", key: "hoadon" }];
    const p = toModelProfile(row, { providers, agentCount: 1, now: NOW, usedBy });
    expect(ModelProfileSchema.safeParse(p).success).toBe(true);
    expect(p).toMatchObject({
      version: 2,
      active_step: 0,
      all_subscription: false,
      agent_count: 1,
    });
    expect(p.used_by_agents).toEqual(usedBy);
    const sub = toModelProfile(
      { ...row, steps: [st("pa")] },
      { providers, agentCount: 0, now: NOW, usedBy: [] },
    );
    expect(sub.all_subscription).toBe(true);
  });
});
