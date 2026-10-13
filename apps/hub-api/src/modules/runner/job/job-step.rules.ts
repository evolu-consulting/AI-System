// HUB-FR-31 (phần lúc giao job) · HUB-FR-67 · AC-H4b2-07 · spec H4b2 §9 Q4 · plan H4b2 §3.4 — hàm thuần: chọn bước
// profile cho job theo `pickStep` (enabled từ ảnh cấu hình, `provider_state` đọc lúc giao). Kết quả `ok` mang profile chỉ
// còn bước đã chọn ⇒ `buildJobPayload` giữ contract (`profile_steps` = [bước đó], `step_index` 0).
import type { ConfigSnapshot, ProfileConfig } from "../../config/config.rules";
import { pickStep, type SkipWhy, type StepView } from "../profile-step.rules";

export type ProviderStates = ReadonlyMap<string, StepView["state"]>;
export type SkippedStep = { index: number; why: SkipWhy; provider_key: string };
export type JobStep =
  | { ok: true; profile: ProfileConfig; skipped: SkippedStep[] }
  | { ok: false; reason: "quota" | "provider_unavailable" };

/** Khoá provider (không trùng) của mọi bước — đầu vào cho một câu đọc `provider_state`. */
export const stepProviderKeys = (profile: ProfileConfig): string[] => [
  ...new Set(profile.steps.map((s) => s.provider_key)),
];

/** Agent có `model` riêng ⇒ chỉ bước 0 (Q4 "Không dự phòng"); không ⇒ dự phòng theo `on`, payload dùng `step.model`. */
export function chooseJobStep(
  profile: ProfileConfig,
  providers: ConfigSnapshot["providers"],
  states: ProviderStates,
  p: { now: Date; agentHasOwnModel: boolean },
): JobStep {
  const view = (key: string): StepView | undefined => {
    const prov = providers.find((x) => x.key === key);
    return prov ? { enabled: prov.enabled, state: states.get(key) } : undefined;
  };
  const r = pickStep(profile.steps, view, p.now, p.agentHasOwnModel);
  if (!r.ok) return r;
  const step = profile.steps[r.index];
  if (!step) return { ok: false, reason: "provider_unavailable" };
  const skipped = r.skipped.map((s) => ({
    ...s,
    provider_key: profile.steps[s.index]?.provider_key ?? "",
  }));
  return { ok: true, profile: { ...profile, steps: [step] }, skipped };
}
