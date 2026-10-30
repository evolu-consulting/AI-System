// CR-105 · L3: ánh xạ thuần cho màn thư viện quy trình (cột danh sách, xoá được không, kế hoạch gán, kết quả xem trước, trạng thái xuất bản).
import type { LibraryDef, LibraryListItem, PreviewStep } from "../library-api";

export type RowLike = Pick<LibraryListItem, "slot" | "is_default" | "tenant_count" | "enabled">;

/** Dòng thuộc thư viện (có khe) — khác quy trình tenant / mẫu. */
export const isLibraryRow = (r: Pick<LibraryListItem, "slot">): boolean => !!r.slot;

/** Lý do không xoá/tắt được: mặc định của khe hoặc đang có tenant gán (Hub trả 409 `PROCESS_IN_USE` — chặn sớm ở UI). */
export function inUseReason(r: RowLike): "default" | "assigned" | null {
  if (r.is_default) return "default";
  return (r.tenant_count ?? 0) > 0 ? "assigned" : null;
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

/** Chỉ quy trình đã xuất bản mới đặt mặc định / gán được; mặc định hiện tại thì không đặt lại. */
export const canSetDefault = (d: Pick<LibraryDef, "slot" | "published_version" | "is_default">) =>
  publishState(d) === "published" && d.is_default !== true;
export const canAssign = (d: Pick<LibraryDef, "slot" | "published_version">) =>
  publishState(d) === "published";

/** Kế hoạch gán cho một quy trình: tenant mới chọn ⇒ gán (PUT), tenant bỏ chọn ⇒ về mặc định (DELETE). */
export function assignPlan(
  current: readonly string[],
  selected: readonly string[],
): { add: string[]; remove: string[] } {
  const cur = new Set(current);
  const sel = new Set(selected);
  return {
    add: [...sel].filter((id) => !cur.has(id)),
    remove: [...cur].filter((id) => !sel.has(id)),
  };
}

const rec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Xem trước (B3): Hub trả `{steps:[{key,name,run}]}` (hoặc mảng trần; `skipped:true` thay `run:false`); thiếu tên ⇒ khoá. */
export function normalizePreview(raw: unknown): PreviewStep[] {
  const list = Array.isArray(raw) ? raw : rec(raw) && Array.isArray(raw.steps) ? raw.steps : [];
  return list.flatMap((s): PreviewStep[] => {
    if (!rec(s)) return [];
    const key = typeof s.key === "string" ? s.key : "";
    const run = typeof s.run === "boolean" ? s.run : s.skipped !== true;
    const name = typeof s.name === "string" && s.name !== "" ? s.name : key;
    return [{ key, name, run }];
  });
}

/** Ô "Giá trị mẫu" (chữ) ⇒ số nguyên ≥ 0 hoặc null (trống = chưa nhập); không hợp lệ ⇒ "invalid". */
export function parseSampleValue(raw: string): number | null | "invalid" {
  const s = raw.replace(/[\s.,]/g, "");
  if (s === "") return null;
  return /^\d{1,15}$/.test(s) ? Number(s) : "invalid";
}

/** Đếm kết quả `Promise.allSettled` của loạt gán/bỏ gán. */
export function settledCounts(rs: readonly PromiseSettledResult<unknown>[]) {
  const failed = rs.filter((r) => r.status === "rejected").length;
  return { ok: rs.length - failed, failed };
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
 * bản "Chép mẫu"): mẫu mà người xem không sửa được ⇒ chỉ "Chép mẫu" (`copy`); còn lại ⇒ Chạy/Sửa/Xoá (`full`).
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
): "copy" | "full" => (isTemplateRow(r) && !canEditTemplates ? "copy" : "full");

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
