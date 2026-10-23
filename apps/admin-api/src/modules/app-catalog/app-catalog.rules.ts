// app-catalog · luật thuần: app nào người gọi được mở (vai + feature hiệu lực) và đích SSO hợp lệ. Không I/O.
import type { AppAudience } from "@ai/contracts";

export type CatalogRow = {
  key: string;
  name: { vi: string; en?: string };
  icon: string;
  url: string;
  audience: AppAudience;
  requiredFeature: string | null;
  sso: boolean;
  sortOrder: number;
  enabled: boolean;
};

export type Viewer = {
  role: "member" | "tenant_admin" | "platform_admin";
  /** Key feature hiệu lực của user (rỗng với platform_admin: không cần — họ thấy mọi app bật). */
  features: ReadonlySet<string>;
  /** app-perm · key feature TENANT được cấp (entitlement còn hiệu lực, feature không `off`). */
  tenantFeatures?: ReadonlySet<string>;
  /** app-perm · mọi key feature đang tồn tại (feature theo công ty chưa tạo ⇒ coi như mở). */
  knownFeatures?: ReadonlySet<string>;
};

/** app-perm · feature của Chat AI: gắn theo CÔNG TY (đủ entitlement, không cần grant nhóm/user). */
export const CHAT_APP_FEATURE = "chat-app";
/** Feature mở app theo entitlement của tenant (không theo group/user) — mọi user của công ty cùng thấy/không thấy. */
export const TENANT_APP_FEATURES: ReadonlySet<string> = new Set([CHAT_APP_FEATURE]);

const isAdmin = (r: Viewer["role"]): boolean => r === "tenant_admin" || r === "platform_admin";

/** Feature của app: theo công ty ⇒ tenant được cấp (feature chưa tồn tại ⇒ mở); còn lại ⇒ feature hiệu lực của user. */
function hasFeature(f: string, v: Viewer): boolean {
  if (v.role === "platform_admin") return true;
  if (TENANT_APP_FEATURES.has(f))
    return !(v.knownFeatures?.has(f) ?? false) || (v.tenantFeatures?.has(f) ?? false);
  return v.features.has(f);
}

/** Đúng đối tượng + đủ feature (bỏ qua bật/URL): người xem có QUYỀN dùng app. */
export function mayUse(row: Pick<CatalogRow, "audience" | "requiredFeature">, v: Viewer): boolean {
  if (row.audience === "admin" && !isAdmin(v.role)) return false;
  if (row.audience === "platform" && v.role !== "platform_admin") return false;
  return !row.requiredFeature || hasFeature(row.requiredFeature, v);
}

/** App người xem được mở: bật + có URL + đúng đối tượng + đủ feature (platform_admin bỏ qua feature). */
export function canOpen(row: CatalogRow, v: Viewer): boolean {
  if (!row.enabled || row.url === "") return false;
  return mayUse(row, v);
}

/**
 * app-perm · Chat AI dùng được (cho chat-web chuyển hướng người không có quyền): theo quyền, KHÔNG theo URL/bật (dev/test để
 * URL rỗng vẫn chat được như cũ). Catalog không có hàng `chat` ⇒ dùng được (hành vi cũ).
 */
export function chatAllowed(rows: readonly CatalogRow[], v: Viewer): boolean {
  const chat = rows.find((r) => r.key === "chat");
  return !chat || mayUse(chat, v);
}

/** Theo `sort_order` rồi `key` (ổn định, không phụ thuộc thứ tự DB). */
export function visibleApps(rows: readonly CatalogRow[], v: Viewer): CatalogRow[] {
  return rows
    .filter((r) => canOpen(r, v))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
}

/** Có hàng nào đòi feature mà người xem cần tra (tránh tải quyền khi không cần). */
export const needsFeatures = (rows: readonly CatalogRow[], role: Viewer["role"]): boolean =>
  role !== "platform_admin" && rows.some((r) => r.enabled && r.requiredFeature !== null);

/** Origin của URL catalog (`null` nếu hỏng). */
export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Đổi mã SSO ở web đích: app phải còn bật + có URL + hỗ trợ SSO trong catalog; nếu request có `Origin` thì phải đúng origin
 * của URL catalog (web lạ không lấy được phiên bằng mã đánh cắp dù đặt `X-App` giả). Không `Origin` (client không phải
 * trình duyệt/test) ⇒ chỉ kiểm catalog.
 */
export function redeemTargetOk(
  row: Pick<CatalogRow, "enabled" | "url" | "sso"> | undefined,
  origin: string | undefined,
): boolean {
  if (!row || !row.enabled || row.url === "" || !row.sso) return false;
  if (origin === undefined) return true;
  const want = originOf(row.url);
  return want !== null && origin === want;
}
