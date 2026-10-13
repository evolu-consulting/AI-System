// HUB-FR-67 · AC-H4b2-07 (vế Studio) · spec H4b2 §3 B · plan §3.3, D10 · hàng DB → item/chi tiết model profile (hàm
// thuần, test cạnh file). `active_step` = `pickStep(…, false)` theo `enabled` + `provider_state` lúc đọc — cùng luật giao
// job; `all_subscription` = mọi bước là provider `subscription`. Dựng từ danh sách trường cho phép (không spread hàng DB).
import type { ProfileStep } from "@ai/contracts/hub";
import type { ModelProfile, Ref } from "@ai/contracts/studio";
import { pickStep, type StepView } from "../../runner/profile-step.rules";
import { allSubscription } from "./models.rules";
import type { ModelProfileStep, ProfileDbRow, ProviderView } from "./profiles.repo";

export type ModelProfileItem = Omit<ModelProfile, "updated_at" | "used_by_agents">;
export type ProviderIndex = ReadonlyMap<string, ProviderView>;

export const indexProviders = (rows: readonly ProviderView[]): ProviderIndex =>
  new Map(rows.map((r) => [r.key, r]));

/** Bước theo thứ tự trường contract (jsonb trả khoá theo thứ tự riêng) — dùng cho response, audit và so sánh. */
export function normSteps(steps: readonly ModelProfileStep[]): ProfileStep[] {
  return steps.map((s) => ({
    provider_key: s.provider_key,
    model: s.model,
    on: [...s.on] as ProfileStep["on"],
  }));
}

export const sameSteps = (
  a: readonly ModelProfileStep[],
  b: readonly ModelProfileStep[],
): boolean => JSON.stringify(normSteps(a)) === JSON.stringify(normSteps(b));

/** Provider vắng ⇒ undefined (pickStep coi như tắt); không có `provider_state` ⇒ state undefined (không chặn). */
export function stepView(p: ProviderView | undefined): StepView | undefined {
  if (!p) return undefined;
  const state =
    p.status === null ? undefined : { status: p.status, cooldownUntil: p.cooldownUntil };
  return { enabled: p.enabled, state };
}

/** Bước Studio hiển thị "lúc này chạy bằng" (agent không có model riêng); hết bước dùng được ⇒ null. */
export function activeStep(
  steps: readonly ModelProfileStep[],
  providers: ProviderIndex,
  now: Date,
): number | null {
  const r = pickStep(steps, (k) => stepView(providers.get(k)), now, false);
  return r.ok ? r.index : null;
}

export function toModelProfileItem(
  r: ProfileDbRow,
  ctx: { providers: ProviderIndex; agentCount: number; now: Date },
): ModelProfileItem {
  return {
    id: r.id,
    key: r.key,
    steps: normSteps(r.steps),
    version: r.version,
    active_step: activeStep(r.steps, ctx.providers, ctx.now),
    all_subscription: allSubscription(r.steps, (k) => ctx.providers.get(k)?.kind),
    agent_count: ctx.agentCount,
  };
}

export function toModelProfile(
  r: ProfileDbRow,
  ctx: { providers: ProviderIndex; agentCount: number; now: Date; usedBy: readonly Ref[] },
): ModelProfile {
  return {
    ...toModelProfileItem(r, ctx),
    updated_at: new Date(r.updatedAt).toISOString(),
    used_by_agents: [...ctx.usedBy],
  };
}
