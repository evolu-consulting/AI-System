// Phần đọc nhỏ của `stepsView` (tách khỏi pack-runs-view.ts cho ≤ 400 dòng): lý do quyết định mở của run, mã máy của stage kẹt, và
// dữ liệu bước «Điền thông tin» (form) của thẻ — trường theo snapshot run + giá trị đã gửi. Thuần.
import type { FormField } from "@ai/contracts/hub-admin";
import { formPrefillRegistry, type PackStepView } from "../../packs/kit/public";

/** Khoá node module của stage snapshot (vắng ⇒ undefined). */
export const nodeKeyOf = (s: unknown): string | undefined => {
  const n = (s as { node?: unknown } | null)?.node;
  return typeof n === "string" ? n : undefined;
};

/**
 * CR-126 · bước form ĐANG MỞ thuộc node module có resolver (`formPrefillRegistry`) ⇒ gắn `form.prefill` (giá trị điền sẵn + lựa chọn).
 * Mỗi lượt tối đa MỘT lời gọi (bước mở đầu tiên); resolver lỗi ⇒ bỏ prefill (form vẫn nhập tay được).
 */
export async function withFormPrefill(
  steps: PackStepView[],
  nodeOf: (idx: number) => string | undefined,
  q: { tenantId: string; userId: string; recordId: string | null },
): Promise<PackStepView[]> {
  const at = steps.findIndex((s) => s.form && s.task && s.status === "open");
  const step = steps[at];
  const resolve = step ? formPrefillRegistry.of(nodeOf(step.idx)) : undefined;
  if (!step?.form || !resolve) return steps;
  const prefill = await resolve(q).catch(() => null);
  if (!prefill) return steps;
  const out = [...steps];
  out[at] = { ...step, form: { ...step.form, prefill } };
  return out;
}

/** CR-107 · `process_runs.decision` jsonb `{reason, at}` ⇒ lý do + lúc mở quyết định (hỏng/vắng ⇒ lý do `unknown`). */
export function decisionOf(v: unknown): { reason: string; at: string | null; missing?: string[] } {
  const o = (typeof v === "string" ? JSON.parse(v) : v) as {
    reason?: unknown;
    at?: unknown;
    missing?: unknown;
  } | null;
  const reason = typeof o?.reason === "string" ? o.reason : "unknown";
  // CR-122 · P18 · `missing_fact`: khoá dữ kiện còn trống (gói đổi sang nhãn).
  const missing = Array.isArray(o?.missing)
    ? o.missing.filter((k): k is string => typeof k === "string")
    : [];
  return {
    reason,
    at: typeof o?.at === "string" ? o.at : null,
    ...(missing.length ? { missing } : {}),
  };
}

/** CR-122 · p19 · mã máy của stage đang chờ quyết (tool lỗi vì sao) → thẻ HĐ nói rõ cách xử lý; vắng ⇒ không thêm trường. */
export function stageCode(rows: readonly { stage_status: string; stage_error: string | null }[]): {
  code?: string;
} {
  const code = rows.find((r) => r.stage_status === "needs_decision" && r.stage_error)?.stage_error;
  return code ? { code } : {};
}

/** CR-125 · stage `form` ⇒ trường (snapshot run) + giá trị đã gửi (chỉ khi task đã đóng Đạt; jsonb object, còn lại null). */
export function formOf(
  stage: { executor?: { kind?: string; fields?: FormField[] } | null } | null | undefined,
  r: { form_values: unknown; task_status: string | null; result: string | null },
): { form?: NonNullable<PackStepView["form"]> } {
  if (stage?.executor?.kind !== "form") return {};
  const raw = typeof r.form_values === "string" ? JSON.parse(r.form_values) : r.form_values;
  const done = r.task_status === "closed" && r.result === "pass";
  const values =
    done && raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  return { form: { fields: stage.executor.fields ?? [], values } };
}
