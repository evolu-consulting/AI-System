// HUB-FR-67 · bản nháp profile ở client: id cục bộ cho bước (sắp xếp ổn định), validate (khớp contract), dựng body, ánh xạ lỗi 400.
import { FALLBACK_TRIGGERS, PROFILE_STEPS_MAX } from "@ai/contracts/hub";
import { ProviderKeySchema } from "@ai/contracts/studio";
import type { ProfileItem } from "../api";

export type Trigger = (typeof FALLBACK_TRIGGERS)[number];
export type DraftStep = { uid: number; provider_key: string; model: string; on: Trigger[] };
export type Draft = { key: string; steps: DraftStep[] };
export type DraftErrors = {
  key?: string;
  steps?: string;
  step: Record<number, { provider?: string; model?: string }>;
};

export const TRIGGERS: readonly Trigger[] = FALLBACK_TRIGGERS;
export const MAX_STEPS: number = PROFILE_STEPS_MAX;
let seq = 0;
export const blankStep = (): DraftStep => ({ uid: ++seq, provider_key: "", model: "", on: [] });

export const draftOf = (p: ProfileItem | null): Draft =>
  p
    ? {
        key: p.key,
        steps: p.steps.map((s) => ({
          uid: ++seq,
          provider_key: s.provider_key,
          model: s.model ?? "",
          on: [...s.on],
        })),
      }
    : { key: "", steps: [blankStep()] };

const sig = (d: Draft) => JSON.stringify(d.steps.map((s) => [s.provider_key, s.model, s.on]));
export const isDirty = (d: Draft, base: ProfileItem | null) =>
  !base || sig(d) !== sig(draftOf(base));

export function validate(d: Draft, create: boolean): DraftErrors {
  const e: DraftErrors = { step: {} };
  if (create && !ProviderKeySchema.safeParse(d.key.trim()).success) e.key = "models.err.key";
  if (d.steps.length === 0) e.steps = "models.profile.err.steps";
  d.steps.forEach((s, i) => {
    const m = s.model.trim().length;
    const f: { provider?: string; model?: string } = {};
    if (s.provider_key === "") f.provider = "models.profile.err.provider";
    if (m < 1 || m > 100) f.model = "models.profile.err.model";
    if (f.provider || f.model) e.step[i] = f;
  });
  return e;
}
export const hasErrors = (e: DraftErrors) => !!e.key || !!e.steps || Object.keys(e.step).length > 0;

/** `on` theo thứ tự chuẩn của contract. */
export const stepsBody = (d: Draft) =>
  d.steps.map((s) => ({
    provider_key: s.provider_key,
    model: s.model.trim(),
    on: TRIGGERS.filter((t) => s.on.includes(t)),
  }));

type Detailed = {
  code?: unknown;
  details?: { issues?: unknown; field?: unknown; index?: unknown } | null;
};
const STEP_PATH = /^steps\.(\d+)/;
function stepIndex(e: Detailed): number | null {
  if (
    e.code === "INVALID_REFERENCE" &&
    e.details?.field === "steps" &&
    typeof e.details.index === "number"
  )
    return e.details.index;
  if (e.code !== "VALIDATION_ERROR" || !Array.isArray(e.details?.issues)) return null;
  for (const i of e.details.issues as { path?: unknown }[]) {
    const p = Array.isArray(i.path) ? i.path.join(".") : String(i.path ?? "");
    const m = STEP_PATH.exec(p);
    if (m) return Number(m[1]);
  }
  return null;
}
/** Lỗi 400/409 gắn vào trường: `KEY_TAKEN` → tên; `steps.<i>` → "Provider không dùng được"; còn lại null (nơi gọi toast). */
export function fieldError(err: unknown): DraftErrors | null {
  const e = (err ?? {}) as Detailed;
  if (e.code === "KEY_TAKEN") return { key: "models.errors.keyTaken", step: {} };
  const i = stepIndex(e);
  return i === null ? null : { step: { [i]: { provider: "models.profile.err.providerBad" } } };
}
