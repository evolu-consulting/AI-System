// HUB-FR-31 (phần lúc giao job) · HUB-FR-67 · AC-H4b2-07 · spec H4b2 §9 Q4 · plan H4b2 §2.3, D10 — chọn bước model
// profile lúc giao job: bỏ bước provider vắng/tắt; bỏ bước provider đang chặn khi `on` của bước có trigger tương ứng.
// Agent có model riêng (CR-054, "Không dự phòng") ⇒ chỉ bước 0. Dùng chung cho `active_step` (Studio) và giao job.
import { blockedReason } from "./runner.rules";

export type StepView = {
  enabled: boolean;
  state: { status: string; cooldownUntil: Date | null } | undefined;
};
export type SkipWhy = "disabled" | "quota" | "error";
export type Pick =
  | { ok: true; index: number; skipped: { index: number; why: SkipWhy }[] }
  | { ok: false; reason: "quota" | "provider_unavailable" };
type Step = { provider_key: string; on: readonly string[] };
type Trigger = "quota" | "error";

/** Trigger khi provider đang chặn (khớp `providerBlocked`/`blockedReason`): cooldown chưa hết ⇒ quota; logged_out|error ⇒ error. */
export function blockedTrigger(s: StepView["state"], now: Date): Trigger | null {
  const r = blockedReason(s, now);
  if (r === null) return null;
  return r === "quota" ? "quota" : "error";
}

const reasonOf = (t: Trigger): "quota" | "provider_unavailable" =>
  t === "quota" ? "quota" : "provider_unavailable";

/** Agent có model riêng: chỉ xét bước 0, không chuyển bước, `skipped` luôn rỗng. */
function pickOwnModel(
  steps: readonly Step[],
  view: (key: string) => StepView | undefined,
  now: Date,
): Pick {
  const first = steps[0];
  const v = first ? view(first.provider_key) : undefined;
  if (!v?.enabled) return { ok: false, reason: "provider_unavailable" };
  const t = blockedTrigger(v.state, now);
  return t === null ? { ok: true, index: 0, skipped: [] } : { ok: false, reason: reasonOf(t) };
}

/**
 * Duyệt bước theo thứ tự: vắng/tắt ⇒ bỏ (why "disabled"); không chặn ⇒ chọn; trigger ∈ `on` ⇒ bỏ; trigger ∉ `on` ⇒ dừng
 * `{ok:false}`. Hết bước ⇒ lý do của bước bị chặn cuối (chỉ có bước tắt ⇒ provider_unavailable).
 */
export function pickStep(
  steps: readonly Step[],
  view: (key: string) => StepView | undefined,
  now: Date,
  agentHasOwnModel: boolean,
): Pick {
  if (agentHasOwnModel) return pickOwnModel(steps, view, now);
  const skipped: { index: number; why: SkipWhy }[] = [];
  let last: Trigger | null = null;
  for (const [index, step] of steps.entries()) {
    const v = view(step.provider_key);
    if (!v?.enabled) {
      skipped.push({ index, why: "disabled" });
      continue;
    }
    const t = blockedTrigger(v.state, now);
    if (t === null) return { ok: true, index, skipped };
    if (!step.on.includes(t)) return { ok: false, reason: reasonOf(t) };
    skipped.push({ index, why: t });
    last = t;
  }
  return { ok: false, reason: last === null ? "provider_unavailable" : reasonOf(last) };
}
