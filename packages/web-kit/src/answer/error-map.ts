// CHAT-AC-24..27, 30 · mã lỗi → tiêu đề/nút (ui-chat-extension §8); mã lạ coi như INTERNAL_ERROR.
const TITLED = new Set([
  "ALL_PROVIDERS_EXHAUSTED",
  "TIMEOUT",
  "UPSTREAM_ERROR",
  "BUDGET_EXCEEDED",
  "NOT_CONFIGURED",
]);
const WITH_BODY = new Set(["ALL_PROVIDERS_EXHAUSTED"]);

export type ErrorActions = { retry: boolean; report: boolean };

export function errorActions(code: string): ErrorActions {
  switch (code) {
    case "TIMEOUT":
    case "UPSTREAM_ERROR":
      return { retry: true, report: false };
    case "NOT_CONFIGURED":
      return { retry: false, report: true };
    case "BUDGET_EXCEEDED":
    case "CANCELLED":
      return { retry: false, report: false };
    default:
      return { retry: true, report: true };
  }
}

/** Khoá i18n tiêu đề; mã lạ → `errors.unknown.title`. */
export function errorTitleKey(code: string): string {
  return `errors.${TITLED.has(code) ? code : "unknown"}.title`;
}

export function errorBodyKey(code: string): string | null {
  return WITH_BODY.has(code) ? `errors.${code}.body` : null;
}

/** Chuỗi Báo admin chép: `{CODE} · run {id}` (id thiếu → "—"). */
export function reportText(code: string, runId: string | null): string {
  return `${code} · run ${runId ?? "—"}`;
}
