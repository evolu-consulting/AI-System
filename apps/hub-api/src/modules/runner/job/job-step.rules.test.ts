// HUB-FR-31 · HUB-FR-67 · AC-H4b2-07 · plan H4b2 §3.4 — unit `chooseJobStep` (giao job theo `pickStep`).
import { describe, expect, it } from "bun:test";
import type { ConfigSnapshot, ProfileConfig } from "../../config/config.rules";
import { chooseJobStep, type ProviderStates, stepProviderKeys } from "./job-step.rules";

const NOW = new Date("2026-10-13T00:00:00Z");
const FUT = new Date("2099-01-01T00:00:00Z");
const prov = (key: string, enabled = true): ConfigSnapshot["providers"][number] => ({
  key,
  kind: "subscription",
  vendor: "anthropic",
  maxConcurrency: 1,
  enabled,
  devOnly: false,
});
const S0 = { provider_key: "claude-sub", model: "opus", on: ["quota"] };
const S1 = { provider_key: "fake-cli", model: null, on: [] };
const profile: ProfileConfig = { id: "p1", key: "fake-1", steps: [S0, S1] };
const cooldown: ProviderStates = new Map([
  ["claude-sub", { status: "cooldown", cooldownUntil: FUT }],
]);
const none: ProviderStates = new Map();
const both = [prov("claude-sub"), prov("fake-cli")];

describe("chooseJobStep [HUB-FR-67 · Q4]", () => {
  it("không chặn ⇒ bước 0, profile còn đúng bước 0, skipped rỗng (hành vi cũ)", () => {
    const r = chooseJobStep(profile, both, none, { now: NOW, agentHasOwnModel: false });
    expect(r).toEqual({
      ok: true,
      profile: { ...profile, steps: [S0] },
      skipped: [],
    });
  });

  it("bước 0 cooldown + on quota ⇒ bước 1, skipped có provider_key", () => {
    const r = chooseJobStep(profile, both, cooldown, { now: NOW, agentHasOwnModel: false });
    expect(r.ok && r.profile.steps).toEqual([S1]);
    expect(r.ok && r.skipped).toEqual([{ index: 0, why: "quota", provider_key: "claude-sub" }]);
  });

  it("provider vắng khỏi ảnh ⇒ coi như tắt, bỏ qua", () => {
    const r = chooseJobStep(profile, [prov("fake-cli")], none, {
      now: NOW,
      agentHasOwnModel: false,
    });
    expect(r.ok && r.skipped).toEqual([{ index: 0, why: "disabled", provider_key: "claude-sub" }]);
  });

  it("agent có model riêng + bước 0 tắt ⇒ ok:false provider_unavailable, không chuyển bước", () => {
    const off = [prov("claude-sub", false), prov("fake-cli")];
    const r = chooseJobStep(profile, off, none, { now: NOW, agentHasOwnModel: true });
    expect(r).toEqual({ ok: false, reason: "provider_unavailable" });
  });

  it("agent có model riêng + bước 0 cooldown ⇒ ok:false quota", () => {
    const r = chooseJobStep(profile, both, cooldown, { now: NOW, agentHasOwnModel: true });
    expect(r).toEqual({ ok: false, reason: "quota" });
  });

  it("stepProviderKeys bỏ trùng", () => {
    const p = {
      ...profile,
      steps: [...profile.steps, { provider_key: "fake-cli", model: null, on: [] }],
    };
    expect(stepProviderKeys(p)).toEqual(["claude-sub", "fake-cli"]);
  });
});
