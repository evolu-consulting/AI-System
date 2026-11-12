// V2-L · bản nháp ↔ API (thuần): dựng trạng thái từ 2 nguồn, so với mặc định (chấm cam) và với bản đã lưu (nút Lưu/Bỏ thay đổi), kiểm sơ bộ
// trước khi gửi.
import { type BizConfigOut, type CompanyOut, MST_RE } from "@ai/contracts/pack-contracts";
import { accentIssue } from "./accent-input";
import type { CompanyDraft, SettingsState } from "./types";

/** Hai nguồn API ⇒ trạng thái đã lưu + mặc định (cùng hình) của hộp thoại. */
export function buildState(co: CompanyOut, biz: BizConfigOut): SettingsState {
  return {
    saved: {
      company: {
        ...co.company,
        allow_negative_stock: co.allow_negative_stock,
        legal_warn_threshold: co.legal_warn_threshold,
      },
      biz: structuredClone(biz.config),
    },
    defaults: { company: co.defaults, biz: structuredClone(biz.defaults) },
  };
}

/** CR-138 Q9 · sau khi Lưu thành công: ảnh bìa đã ở server ⇒ bỏ `cover` khỏi nháp và cập nhật `has_cover` (nháp lại bằng bản đã lưu). */
export function settledCompany(c: CompanyDraft): CompanyDraft {
  const { cover, ...rest } = c;
  return { ...rest, has_cover: cover === undefined ? c.has_cover : cover !== null };
}

/** Ảnh bìa đang thấy trong ô chọn: nháp (ảnh mới / null = đã xoá) thắng ảnh đã lưu (`saved`). */
export function coverShown(c: CompanyDraft, saved: string | null | undefined): string | null {
  if (c.cover !== undefined) return c.cover;
  return c.has_cover ? (saved ?? null) : null;
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
export function firstIssue(
  d: { company: { own_tax_ids: string[]; accent: string } },
  ch: Changed,
): string | null {
  if (ch.company && accentIssue(d.company.accent)) return "co.accentBad"; // CR-138 Q8: màu tự chọn sai/nhạt ⇒ không cho lưu
  if (ch.company && d.company.own_tax_ids.some((x) => !MST_RE.test(x))) return "co.taxInvalid";
  return null;
}
