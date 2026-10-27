// tenant-quotas · bản nháp ô hạn mức ngày (thuần): chuỗi trống = mặc định env (null); số nguyên 1..max; còn lại = lỗi.
import {
  DAILY_LIMIT_KINDS,
  DAILY_LIMIT_MAX,
  type DailyLimitKind,
  type DailyLimitsPut,
  type DailyLimitsResponse,
} from "@ai/contracts";

export type DailyDraft = Record<DailyLimitKind, string>;

export function draftOf(res: DailyLimitsResponse | undefined): DailyDraft {
  const d: DailyDraft = { uploads: "", actions: "", ai_tokens: "" };
  for (const i of res?.items ?? []) d[i.kind] = i.override === null ? "" : String(i.override);
  return d;
}

/** "" ⇒ null; số nguyên trong [1, max] ⇒ số; khác ⇒ "invalid". Bỏ dấu chấm/phẩy/khoảng trắng ngăn cách nghìn. */
export function parseLimit(kind: DailyLimitKind, raw: string): number | null | "invalid" {
  const s = raw.replace(/[\s.,]/g, "");
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return "invalid";
  const n = Number(s);
  return n >= 1 && n <= DAILY_LIMIT_MAX[kind] ? n : "invalid";
}

/** Body PUT, hoặc null khi còn ô lỗi. */
export function toPut(d: DailyDraft): DailyLimitsPut | null {
  const out: Partial<Record<DailyLimitKind, number | null>> = {};
  for (const k of DAILY_LIMIT_KINDS) {
    const v = parseLimit(k, d[k]);
    if (v === "invalid") return null;
    out[k] = v;
  }
  return out as DailyLimitsPut;
}

export const sameDraft = (a: DailyDraft, b: DailyDraft): boolean =>
  DAILY_LIMIT_KINDS.every((k) => a[k].trim() === b[k].trim());
