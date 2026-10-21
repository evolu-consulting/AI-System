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
};

const isAdmin = (r: Viewer["role"]): boolean => r === "tenant_admin" || r === "platform_admin";

/** App người xem được mở: bật + có URL + đúng đối tượng + đủ feature (platform_admin bỏ qua feature). */
export function canOpen(row: CatalogRow, v: Viewer): boolean {
  if (!row.enabled || row.url === "") return false;
  if (row.audience === "admin" && !isAdmin(v.role)) return false;
  if (row.audience === "platform" && v.role !== "platform_admin") return false;
  if (row.requiredFeature && v.role !== "platform_admin" && !v.features.has(row.requiredFeature))
    return false;
  return true;
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
