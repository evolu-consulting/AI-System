// W1 · "Mua hàng" · luật thuần của màn (port cm-web `sourcing/{page,Lines}.tsx`).
import type { SaleLine, SourceRef } from "@ai/contracts";
import { ApiError } from "@ai/web-kit/http";

type T = (key: string, o?: Record<string, unknown>) => string;

export const refKey = (c: { contract_id: string; line: number }) => `${c.contract_id}#${c.line}`;

/** Giá trị ô chọn nguồn: chỉ khi người đã chọn; để trống = tự chọn rẻ nhất. */
export const selectValue = (r: SaleLine): string =>
  r.source?.mode === "chosen" ? refKey(r.source) : "";

export const parseRef = (v: string, cands: readonly SourceRef[]): SourceRef | null =>
  cands.find((c) => refKey(c) === v) ?? null;

export const RISK_TONE = {
  source_expiring: "bg-soon-bg text-soon",
  source_ended: "bg-late-bg text-late",
} as const;

const KNOWN = new Set(["SOURCING_INVALID", "NOT_FOUND", "PACK_FORBIDDEN", "VALIDATION_ERROR"]);
export function sourcingErrorText(e: unknown, t: T): string {
  if (e instanceof ApiError) {
    if (KNOWN.has(e.code)) return t(`contracts.sourcing.errors.${e.code}`);
    if (e.code === "NETWORK_ERROR") return t("contracts.errors.network");
  }
  return t("contracts.errors.unknown");
}
