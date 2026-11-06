// CR-120 · bộ lọc thư viện quy trình (nút phễu): App · Việc (khe) · Trạng thái · Tenant. Thuần, lọc phía client trên danh sách ĐÃ TẢI
// (đổi bộ lọc không gọi thêm API); lưu ở URL `?app=&slot=&status=&usedBy=` (+ `?q=` ô tìm). CR-121 c15: tham số lọc "Dùng bởi" đổi `tenant` ⇒ `usedBy` (`?tenant=<id>` giờ là URL cũ chuyển tới Công ty › Quy trình, c13).
import type { LibraryListItem } from "../library-api";

export type LibStatus = "draft" | "published";
/** `usedBy`: id công ty (đã gán cho) · `none` (chưa gán, không là mặc định) · `default` (là mặc định của khe). */
export type LibFilter = { app?: string; slot?: string; status?: LibStatus; usedBy?: string };
type Row = Pick<
  LibraryListItem,
  "id" | "slot" | "slot_label" | "published_version" | "tenant_count" | "is_default"
>;

const KEY = /^[a-z0-9][a-z0-9.-]{1,63}$/;
const TENANT = /^(none|default|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Tham số URL ⇒ bộ lọc hợp lệ (giá trị lạ bị bỏ). */
export function parseLibFilter(s: Record<string, unknown>): LibFilter {
  const str = (v: unknown, re: RegExp) => (typeof v === "string" && re.test(v) ? v : undefined);
  const status = s.status === "draft" || s.status === "published" ? s.status : undefined;
  const f: LibFilter = {};
  const app = str(s.app, /^[a-z0-9-]{2,32}$/);
  const slot = str(s.slot, KEY);
  const usedBy = str(s.usedBy, TENANT);
  if (app) f.app = app;
  if (slot) f.slot = slot;
  if (status) f.status = status;
  if (usedBy) f.usedBy = usedBy;
  return f;
}

/** Bộ lọc ⇒ tham số URL (khoá không đặt thì vắng). */
export const libFilterSearch = (f: LibFilter): Record<string, string> =>
  Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as Record<
    string,
    string
  >;

export const activeCount = (f: LibFilter): number => Object.keys(libFilterSearch(f)).length;

/** App của khe = phần trước dấu chấm (`contracts.approval` ⇒ `contracts`). */
export const appOfSlot = (slot: string | null | undefined): string =>
  (slot ?? "").split(".")[0] ?? "";

/** Tenant cần tải danh sách gán khi lọc theo id tenant (def có `tenant_count` > 0). */
export const needsAssignments = (f: LibFilter): boolean =>
  f.usedBy !== undefined && f.usedBy !== "none" && f.usedBy !== "default";

export function matchesLibFilter(
  r: Row,
  f: LibFilter,
  assigned?: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (f.app && appOfSlot(r.slot) !== f.app) return false;
  if (f.slot && r.slot !== f.slot) return false;
  if (f.status && (r.published_version == null ? "draft" : "published") !== f.status) return false;
  if (f.usedBy === "default") return r.is_default === true;
  if (f.usedBy === "none") return r.is_default !== true && (r.tenant_count ?? 0) === 0;
  if (f.usedBy) return assigned?.get(r.id)?.has(f.usedBy) === true;
  return true;
}

export const applyLibFilter = <R extends Row>(
  rows: readonly R[],
  f: LibFilter,
  assigned?: ReadonlyMap<string, ReadonlySet<string>>,
): R[] => (activeCount(f) === 0 ? [...rows] : rows.filter((r) => matchesLibFilter(r, f, assigned)));

/** Khe có trong danh sách (nhãn = tên việc của khe, không phải khoá); lọc theo app đang chọn. */
export function slotOptions(rows: readonly Row[], app?: string): { slot: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const r of rows)
    if (r.slot && (!app || appOfSlot(r.slot) === app) && !seen.has(r.slot))
      seen.set(r.slot, r.slot_label ?? r.slot);
  return [...seen].map(([slot, label]) => ({ slot, label }));
}

export const appOptions = (rows: readonly Row[]): string[] => [
  ...new Set(rows.map((r) => appOfSlot(r.slot)).filter(Boolean)),
];

/** Gom theo app (thứ tự app = lần xuất hiện đầu; thứ tự trong app giữ nguyên) để chèn tiêu đề nhóm. */
export function groupByApp<R extends Pick<Row, "slot">>(rows: readonly R[]): R[] {
  const order = [...new Set(rows.map((r) => appOfSlot(r.slot)))];
  return [...rows].sort(
    (a, b) => order.indexOf(appOfSlot(a.slot)) - order.indexOf(appOfSlot(b.slot)),
  );
}

/** CR-121 c15 · ô tìm: khớp (không phân biệt hoa thường/dấu) tên quy trình, TÊN các bước, tên việc của khe; rỗng ⇒ giữ nguyên. */
const fold = (s: string): string =>
  s.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase();

export function searchLibrary<
  R extends Pick<LibraryListItem, "name" | "slot_label"> & {
    steps?: readonly { name: string }[] | undefined;
  },
>(rows: readonly R[], q: string | undefined): R[] {
  const needle = fold((q ?? "").trim());
  if (needle === "") return [...rows];
  return rows.filter((r) =>
    [r.name, r.slot_label ?? "", ...(r.steps ?? []).map((s) => s.name)].some((x) =>
      fold(x).includes(needle),
    ),
  );
}

/** Ô tìm ⇒ tham số URL `q` (cắt 100 ký tự; rỗng ⇒ vắng). */
export const parseSearchQ = (v: unknown): string | undefined => {
  const q = typeof v === "string" ? v.trim().slice(0, 100) : "";
  return q === "" ? undefined : q;
};
