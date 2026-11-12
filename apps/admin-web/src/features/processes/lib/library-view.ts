// CR-105 · L3: ánh xạ thuần cho màn thư viện quy trình (cột danh sách, xoá được không, kế hoạch gán, kết quả xem trước, trạng thái xuất bản).
import type { LibraryDef, LibraryListItem } from "../library-api";

export type RowLike = Pick<LibraryListItem, "slot" | "is_default" | "tenant_count" | "enabled">;

/** Dòng thuộc thư viện (có khe) — khác quy trình tenant / mẫu. */
export const isLibraryRow = (r: Pick<LibraryListItem, "slot">): boolean => !!r.slot;

/** Lý do không xoá/tắt được: mặc định của khe hoặc đang có tenant gán (Hub trả 409 `PROCESS_IN_USE` — chặn sớm ở UI). */
export function inUseReason(r: RowLike): "default" | "assigned" | null {
  if (r.is_default) return "default";
  return (r.tenant_count ?? 0) > 0 ? "assigned" : null;
}

/** Lý do khoá nút Xoá kèm số tenant (để câu nêu rõ "Đang được N tenant dùng"); không khoá ⇒ null. */
export function deleteLock(r: RowLike): { reason: "default" | "assigned"; n: number } | null {
  const reason = inUseReason(r);
  return reason === null ? null : { reason, n: r.tenant_count ?? 0 };
}

/** Ô "Tenant đang dùng": số tenant gán; mặc định áp cho mọi tenant chưa gán nên ghi kèm "+ mặc định". */
export const tenantUsage = (r: Pick<LibraryListItem, "tenant_count" | "is_default">) => ({
  count: r.tenant_count ?? 0,
  isDefault: r.is_default === true,
});

export type PublishState = "none" | "draft" | "published";
/** `none` = không có khe (không xuất bản); `draft` = chưa có bản xuất bản; `published` = đã có (số bản kèm theo). */
export function publishState(d: Pick<LibraryDef, "slot" | "published_version">): PublishState {
  if (!d.slot) return "none";
  return d.published_version == null ? "draft" : "published";
}

/** Chỉ quy trình đã xuất bản mới đặt mặc định được; mặc định hiện tại thì không đặt lại. */
export const canSetDefault = (d: Pick<LibraryDef, "slot" | "published_version" | "is_default">) =>
  publishState(d) === "published" && d.is_default !== true;

const rec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Ô "Giá trị mẫu" (chữ) ⇒ số nguyên ≥ 0 hoặc null (trống = chưa nhập); không hợp lệ ⇒ "invalid". */
export function parseSampleValue(raw: string): number | null | "invalid" {
  const s = raw.replace(/[\s.,]/g, "");
  if (s === "") return null;
  return /^\d{1,15}$/.test(s) ? Number(s) : "invalid";
}

/** Luật của issue xuất bản: `SYSTEM_TOOL_MISSING:<tool>` | `UNREACHABLE_STEP` | luật khác (giữ nguyên). */
export function splitRule(rule: string): { code: string; arg: string | null } {
  const at = rule.indexOf(":");
  return at < 0 ? { code: rule, arg: null } : { code: rule.slice(0, at), arg: rule.slice(at + 1) };
}

export type RuleFormat = (path: string, code: string, arg: string | null) => string | null;

/**
 * Chi tiết lỗi 422 của xuất bản/gán (`issues[{path,rule}]` | `paths[]` | `keys[]` mã phòng ban thiếu + `tenant`) ⇒ dòng hiển thị.
 * `fmt` (tuỳ chọn) dịch luật đã biết; trả null ⇒ giữ dạng thô `path: rule`.
 */
export function errorLines(details: unknown, fmt?: RuleFormat): string[] {
  if (!rec(details)) return [];
  const head = Array.isArray(details.issues)
    ? issueLines(details.issues, fmt)
    : strings(details.paths);
  const keys = strings(details.keys).join(", ");
  const who = typeof details.tenant === "string" ? `${details.tenant}: ` : "";
  return keys ? [...head, `${who}${keys}`] : head;
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function issueLines(list: readonly unknown[], fmt?: RuleFormat): string[] {
  return list.flatMap((it) => {
    if (!rec(it)) return [];
    const path = typeof it.path === "string" ? it.path : "";
    const rule = typeof it.rule === "string" ? it.rule : "";
    const { code, arg } = splitRule(rule);
    const line = (rule && fmt?.(path, code, arg)) || [path, rule].filter(Boolean).join(": ");
    return line ? [line] : [];
  });
}

/**
 * CR-105 · tab "Mẫu · chạy thử" trộn mẫu toàn nền tảng (`is_template`) với def tenant không khe/không của gói (vd flow-showcase,
 * bản "Chép mẫu"): mẫu mà người xem không sửa được ⇒ chỉ "Xem" (`view`); còn lại ⇒ Chạy/Sửa/Xoá (`full`).
 */
/**
 * Mẫu toàn nền tảng = `is_template` (tenant NULL) VÀ không khe: def thư viện cũng có tenant NULL (`is_template` true) nhưng có `slot`
 * ⇒ là quy trình thật (bật/tắt, sửa, xoá), không phải mẫu.
 */
export const isTemplateRow = (r: Pick<LibraryListItem, "is_template" | "slot">): boolean =>
  r.is_template && !r.slot;

export const rowMode = (
  r: Pick<LibraryListItem, "is_template" | "slot">,
  canEditTemplates: boolean,
): "view" | "full" => (isTemplateRow(r) && !canEditTemplates ? "view" : "full");

/** Hàng của một tab: Hub đã lọc theo `kind` (danh sách chính / `sample`) ⇒ client chỉ áp bộ lọc Bật/Tắt ở tab chính. */
export function rowsForTab<R extends { enabled: boolean }>(
  items: readonly R[],
  samples: boolean,
  filter: "all" | "on" | "off",
): R[] {
  return samples || filter === "all"
    ? [...items]
    : items.filter((r) => r.enabled === (filter === "on"));
}

/** `details` của lỗi Hub (`ApiError.details`) mà không import lớp http vào component. */
export const detailsOf = (err: unknown): unknown => (rec(err) ? err.details : undefined);

const COPY_SUFFIX = " (bản sao)";
/** Tên bản nhân bản: bỏ hậu tố "(bản sao)" đã có (không chồng "(bản sao) (bản sao)") rồi thêm một lần; cắt theo giới hạn tên. */
export function cloneName(name: string, max = 100): string {
  const base = name.replace(/(\s*\(bản sao\))+\s*$/u, "").trim();
  return `${base.slice(0, Math.max(1, max - COPY_SUFFIX.length))}${COPY_SUFFIX}`;
}

/**
 * CR-125 · c5b · mẫu khe thời CR-120 của Community (`community.*`): bước tool khoá của khe, công ty không sao chép/sửa được trên canvas
 * (readiness `copyable=false`). Không công ty nào dùng và không là mặc định của khe ⇒ ẨN khỏi Thư viện; còn dùng/mặc định ⇒ gắn "Mẫu cũ".
 */
export const isLegacySlotTemplate = (r: Pick<LibraryListItem, "slot">): boolean =>
  r.slot?.startsWith("community.") === true;
export const hideLegacySlotTemplate = (r: RowLike): boolean =>
  isLegacySlotTemplate(r) && (r.tenant_count ?? 0) === 0 && r.is_default !== true;
