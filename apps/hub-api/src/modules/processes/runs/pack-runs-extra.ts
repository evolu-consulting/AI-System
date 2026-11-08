// Phần đọc nhỏ của `stepsView` (tách khỏi pack-runs-view.ts cho ≤ 400 dòng): lý do quyết định mở của run, mã máy của stage kẹt, và
// dữ liệu bước «Điền thông tin» (form) của thẻ — trường theo snapshot run + giá trị đã gửi. Thuần.
import type { FormField } from "@ai/contracts/hub-admin";
import type { PackStepView } from "../../packs/kit/public";

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
