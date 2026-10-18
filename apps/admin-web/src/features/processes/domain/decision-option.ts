// HUB-FR-143 · P-d1 · FD8: nhãn nút quyết theo lý do. Thuần. Bản sao ở admin-web.
export type DecisionOptionName = "add_attempt" | "use_current" | "cancel";
export type DecisionOptionVariant = "default" | "retry_exhausted" | "timer_invalid";

/** `retry_exhausted` ⇒ add_attempt "Thử lại ngay"; `timer_invalid` ⇒ add_attempt "Tính lại…", use_current "Bỏ chờ…"; còn lại nhãn cũ. */
export function decisionOptionVariant(
  reason: string,
  option: DecisionOptionName,
): DecisionOptionVariant {
  if (reason === "retry_exhausted" && option === "add_attempt") return "retry_exhausted";
  if (reason === "timer_invalid" && (option === "add_attempt" || option === "use_current"))
    return "timer_invalid";
  return "default";
}

/** Khoá i18n nhãn nút (dùng chung admin + chat: `process.common.option.*`). */
export function decisionOptionKey(reason: string, option: DecisionOptionName): string {
  const v = decisionOptionVariant(reason, option);
  return v === "default"
    ? `process.common.option.${option}`
    : `process.common.option.${option}_${v}`;
}
