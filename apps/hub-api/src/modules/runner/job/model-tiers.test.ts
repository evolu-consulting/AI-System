// ai-tiers-rag · HUB-FR-31 · unit: bậc model fast/std/deep của seed thật (providers.yaml) + dự phòng `on` lúc giao job
// (`chooseJobStep`): làn provider bị chặn (cooldown ⇒ quota, error/logged_out ⇒ error) chỉ bị bỏ khi trigger ∈ `on`.
import { describe, expect, it } from "bun:test";
import type { ConfigSnapshot, ProfileConfig } from "../../config/config.rules";
import { DEFAULT_SEED_DIR, readSeedDir } from "../../seed/seed";
import { buildSeedPlan } from "../../seed/seed.rules";
import { chooseJobStep, type ProviderStates } from "./job-step.rules";

const NOW = new Date("2026-10-21T00:00:00Z");
const FUT = new Date("2099-01-01T00:00:00Z");
const plan = buildSeedPlan(readSeedDir(DEFAULT_SEED_DIR), { appEnv: "production" });
const providers: ConfigSnapshot["providers"] = plan.providers.map((p) => ({
  key: p.key,
  kind: p.kind,
  vendor: p.vendor,
  maxConcurrency: p.max_concurrency,
  enabled: p.enabled,
  devOnly: p.dev_only,
}));
const profile = (key: string): ProfileConfig => {
  const p = plan.profiles.find((x) => x.key === key);
  if (!p) throw new Error(`thiếu profile ${key}`);
  return { id: key, key, steps: p.steps };
};
const cooldown = (key: string): ProviderStates =>
  new Map([[key, { status: "cooldown", cooldownUntil: FUT }]]);
const errored = (key: string): ProviderStates =>
  new Map([[key, { status: "error", cooldownUntil: null }]]);
const pick = (key: string, states: ProviderStates) => {
  const r = chooseJobStep(profile(key), providers, states, { now: NOW, agentHasOwnModel: false });
  return r.ok
    ? { provider: r.profile.steps[0]?.provider_key, model: r.profile.steps[0]?.model }
    : r;
};

describe("ai-tiers-rag · bậc model + dự phòng [HUB-FR-31]", () => {
  it("không chặn ⇒ bước 0: fast = haiku, std = sonnet, deep = opus (mỗi model một làn provider)", () => {
    const none: ProviderStates = new Map();
    expect(pick("claude-sub-fast", none)).toEqual({ provider: "claude-sub-haiku", model: "haiku" });
    expect(pick("claude-sub-std", none)).toEqual({ provider: "claude-sub", model: "sonnet" });
    expect(pick("claude-sub-deep", none)).toEqual({ provider: "claude-sub-opus", model: "opus" });
  });

  it("fast: làn haiku hết hạn mức HOẶC lỗi ⇒ sonnet", () => {
    const sonnet = { provider: "claude-sub", model: "sonnet" };
    expect(pick("claude-sub-fast", cooldown("claude-sub-haiku"))).toEqual(sonnet);
    expect(pick("claude-sub-fast", errored("claude-sub-haiku"))).toEqual(sonnet);
  });

  it("std: làn sonnet hết hạn mức ⇒ haiku; lỗi (không có trong on) ⇒ không dự phòng", () => {
    expect(pick("claude-sub-std", cooldown("claude-sub"))).toEqual({
      provider: "claude-sub-haiku",
      model: "haiku",
    });
    expect(pick("claude-sub-std", errored("claude-sub"))).toEqual({
      ok: false,
      reason: "provider_unavailable",
    });
  });

  it("deep: làn opus hết hạn mức/lỗi ⇒ sonnet; cả hai làn hết ⇒ quota (ALL_PROVIDERS_EXHAUSTED)", () => {
    expect(pick("claude-sub-deep", cooldown("claude-sub-opus"))).toEqual({
      provider: "claude-sub",
      model: "sonnet",
    });
    const both: ProviderStates = new Map([
      ["claude-sub-opus", { status: "cooldown", cooldownUntil: FUT }],
      ["claude-sub", { status: "cooldown", cooldownUntil: FUT }],
    ]);
    expect(pick("claude-sub-deep", both)).toEqual({ ok: false, reason: "quota" });
  });

  it("agent có model riêng (Studio) ⇒ không dự phòng (CR-054)", () => {
    const r = chooseJobStep(profile("claude-sub-fast"), providers, cooldown("claude-sub-haiku"), {
      now: NOW,
      agentHasOwnModel: true,
    });
    expect(r).toEqual({ ok: false, reason: "quota" });
  });
});
