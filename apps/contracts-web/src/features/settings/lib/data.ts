// V2-L · bản nháp ↔ API (thuần): dựng trạng thái từ 2 nguồn, so với mặc định (chấm cam) và với bản đã lưu (nút Lưu/Bỏ thay đổi), kiểm sơ bộ
// trước khi gửi.
import { type BizConfigOut, type CompanyOut, MST_RE } from "@ai/contracts";
import type { SettingsState } from "./types";

/** Hai nguồn API ⇒ trạng thái đã lưu + mặc định (cùng hình) của hộp thoại. */
export function buildState(co: CompanyOut, biz: BizConfigOut): SettingsState {
  return {
    saved: {
      company: {
        ...co.company,
        approval_enabled: co.approval_enabled,
        allow_negative_stock: co.allow_negative_stock,
      },
      biz: structuredClone(biz.config),
    },
    defaults: { company: co.defaults, biz: structuredClone(biz.defaults) },
  };
}

export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return (
    ka.length === kb.length &&
    ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

export type Changed = { company: boolean; biz: boolean };
/** Khác nhau ở phần nào (draft so với `base` = đã lưu hoặc mặc định). */
export const changedParts = (
  d: { company: unknown; biz: unknown },
  base: { company: unknown; biz: unknown },
): Changed => ({ company: !same(d.company, base.company), biz: !same(d.biz, base.biz) });
export const anyChanged = (c: Changed): boolean => c.company || c.biz;

/** Lỗi đầu tiên của mọi phần đã đổi (key i18n sau `contracts.settings.`), null = lưu được. */
export function firstIssue(d: { company: { own_tax_ids: string[] } }, ch: Changed): string | null {
  if (ch.company && d.company.own_tax_ids.some((x) => !MST_RE.test(x))) return "co.taxInvalid";
  return null;
}
