// CR-105 · UX: ánh xạ thuần cho danh sách thư viện — trạng thái, "đang dùng" bằng chữ, sắp xếp (mặc định ghim đầu), khoá sinh từ tên,
// xoá được bản nháp, mô tả điều kiện bước bằng lời. Không React / không API.
import type { FlowWhen } from "@ai/contracts";
import type { LibraryListItem } from "../library-api";

/** Mục danh sách (có `has_unpublished_changes` từ Hub: nháp khác bản xuất bản). */
export type ListRow = LibraryListItem;

export type RowStatus =
  | { kind: "draft" }
  | { kind: "published"; version: number }
  | { kind: "changed"; version: number };

/** Nháp (chưa từng xuất bản) · Đã xuất bản vN · Có thay đổi chưa xuất bản (nháp mới hơn bản xuất bản). */
export function statusOf(
  r: Pick<ListRow, "published_version" | "has_unpublished_changes">,
): RowStatus {
  if (r.published_version == null) return { kind: "draft" };
  return r.has_unpublished_changes === true
    ? { kind: "changed", version: r.published_version }
    : { kind: "published", version: r.published_version };
}

export type TenantsSummary =
  | { kind: "default"; names: string[]; extra: number }
  | { kind: "assigned"; names: string[]; extra: number }
  | { kind: "none" };

const NAMES_SHOWN = 3;
/** "Đang dùng": mặc định ⇒ mọi tenant chưa gán; có gán ⇒ n tenant + tên (rút gọn); không ⇒ Chưa gán. `names` = tên tenant đã tải. */
export function tenantsSummary(r: ListRow, names: readonly string[] = []): TenantsSummary {
  const n = r.tenant_count ?? 0;
  const shown = names.slice(0, NAMES_SHOWN);
  const extra = Math.max(0, n - shown.length);
  if (r.is_default === true) return { kind: "default", names: shown, extra };
  return n > 0 ? { kind: "assigned", names: shown, extra } : { kind: "none" };
}

/** Mặc định ghim đầu; còn lại theo `updated_at` mới nhất trước (ổn định). */
export function sortLibraryRows<R extends ListRow>(rows: readonly R[]): R[] {
  return [...rows].sort((a, b) => {
    if ((a.is_default === true) !== (b.is_default === true)) return a.is_default === true ? -1 : 1;
    return a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0;
  });
}

/** Xoá được khi KHÔNG phải mặc định của khe và không có tenant gán (nháp lẫn đã xuất bản — Hub chỉ chặn PROCESS_IN_USE). */
export const canDeleteLibrary = (r: ListRow): boolean =>
  r.is_default !== true && (r.tenant_count ?? 0) === 0;

const KEY_MAX = 32;
/** Khoá đọc được từ tên: bỏ dấu, chữ thường, `-`; ≤ 32 ký tự (chừa chỗ hậu tố `-n` khi trùng); rỗng ⇒ `quy-trinh`. */
export function slugKey(name: string, attempt = 1): string {
  const suffix = attempt > 1 ? `-${attempt}` : "";
  const base = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, KEY_MAX - suffix.length)
    .replace(/-+$/g, "");
  const key = `${base.length >= 2 ? base : "quy-trinh"}${suffix}`;
  return key.slice(0, KEY_MAX);
}

/** Tên gợi ý khi nhân bản: "<tên> – bản mới" (bỏ hậu tố cũ, không chồng). */
export function cloneSuggestion(name: string): string {
  const base = name.replace(/(\s*[–-]\s*bản mới|\s*\(bản sao\))+\s*$/u, "").trim();
  return `${base} – bản mới`;
}

const DEAL_WORD: Record<string, string> = { buy: "Mua", sell: "Bán", referral: "Giới thiệu" };
const OP_WORD: Record<string, string> = { ge: "≥", gt: ">", le: "≤", lt: "<" };

/** 500_000_000 ⇒ "500 tr"; 2_000_000_000 ⇒ "2 tỷ"; nhỏ hơn ⇒ số có dấu chấm. */
export function moneyWords(v: number): string {
  const trim = (x: number) => String(Math.round(x * 100) / 100).replace(".", ",");
  if (v >= 1_000_000_000) return `${trim(v / 1_000_000_000)} tỷ`;
  if (v >= 1_000_000) return `${trim(v / 1_000_000)} tr`;
  return v.toLocaleString("vi-VN");
}

/** Điều kiện của bước bằng lời: "Chỉ khi giá trị > 500 tr", "Chỉ khi loại Mua hoặc Bán và giá trị ≥ 50 tr"; không điều kiện ⇒ null. */
export function describeWhen(when: FlowWhen | null | undefined): string | null {
  if (!when || when.conds.length === 0) return null;
  const parts = when.conds.map((c) =>
    c.field === "deal"
      ? `loại ${c.in.map((d) => DEAL_WORD[d] ?? d).join(" hoặc ")}`
      : `giá trị ${OP_WORD[c.op] ?? c.op} ${moneyWords(c.value)}`,
  );
  return `Chỉ khi ${parts.join(when.op === "or" ? " hoặc " : " và ")}`;
}
