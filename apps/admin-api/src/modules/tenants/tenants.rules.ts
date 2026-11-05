// ADM-FR-60, ADM-FR-61 · luật tenants dạng hàm thuần (plan M1 §4).
import type { ErrorCode, Role } from "@ai/contracts/common";

export const PLATFORM_TENANT_KEY = "platform";

export type RuleError = { code: ErrorCode; details?: unknown };

/** Chỉ platform_admin quản lý tenant (M1-R12). */
export function canManageTenants(actor: { role: Role }): boolean {
  return actor.role === "platform_admin";
}

/** Tenant `platform` không khoá được (M1-R10). */
export function checkTenantLock(tenant: { key: string }): RuleError | null {
  return tenant.key === PLATFORM_TENANT_KEY ? { code: "PLATFORM_TENANT_LOCKED" } : null;
}

export function tenantStatus(t: { active: boolean }): "active" | "locked" {
  return t.active ? "active" : "locked";
}

export type TenantChanges = {
  name?: string;
  maxConcurrentSub?: number | null;
  timezone?: string;
  processRunsMax?: number;
};

/** CR-121 · cột hồ sơ công ty (camelCase = cột Drizzle `admin.tenants` 0035). */
export type ProfileCols = {
  legalName: string | null;
  taxCode: string | null;
  address: string | null;
  staffSize: number | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  ceoUserId: string | null;
  directorUserId: string | null;
};

/** Tên trường API (snake_case) ⇒ cột. Thứ tự cố định (audit `summary.fields`). */
export const PROFILE_FIELD_COLS = {
  legal_name: "legalName",
  tax_code: "taxCode",
  address: "address",
  staff_size: "staffSize",
  contact_name: "contactName",
  contact_email: "contactEmail",
  contact_phone: "contactPhone",
  ceo_user_id: "ceoUserId",
  director_user_id: "directorUserId",
} as const satisfies Record<string, keyof ProfileCols>;
export type ProfileField = keyof typeof PROFILE_FIELD_COLS;
export const LEADER_FIELDS = ["ceo_user_id", "director_user_id"] as const satisfies ProfileField[];

/** PATCH hồ sơ: chỉ trường gửi lên (≠ undefined) VÀ khác giá trị hiện tại mới tính là đổi. `fields` = tên API đã đổi. */
export function changedProfileFields(
  current: ProfileCols,
  patch: Partial<Record<ProfileField, string | number | null>>,
): { set: Partial<ProfileCols>; fields: ProfileField[] } {
  const set: Record<string, string | number | null> = {};
  const fields: ProfileField[] = [];
  for (const f of Object.keys(PROFILE_FIELD_COLS) as ProfileField[]) {
    const v = patch[f];
    if (v === undefined) continue;
    const col = PROFILE_FIELD_COLS[f];
    if (v === current[col]) continue;
    set[col] = v;
    fields.push(f);
  }
  return { set: set as Partial<ProfileCols>, fields };
}

/** Id CEO/Giám đốc MỚI (khác null, khử trùng) cần kiểm là thành viên của công ty. */
export function leaderIdsToCheck(set: Partial<ProfileCols>): string[] {
  const ids = [set.ceoUserId, set.directorUserId].filter((x): x is string => typeof x === "string");
  return [...new Set(ids)];
}

/** PATCH: chỉ trường gửi lên và khác giá trị hiện tại mới tính là đổi (không đổi → không tăng version). */
export function changedTenantFields(
  current: {
    name: string;
    maxConcurrentSub: number | null;
    timezone: string;
    processRunsMax?: number;
  },
  patch: {
    name?: string;
    max_concurrent_sub?: number | null;
    timezone?: string;
    process_runs_max?: number;
  },
): TenantChanges {
  const out: TenantChanges = {};
  // N2-FR-04 · trần run quy trình (1…1000 đã kiểm ở biên).
  if (patch.process_runs_max !== undefined && patch.process_runs_max !== current.processRunsMax)
    out.processRunsMax = patch.process_runs_max;
  if (patch.name !== undefined && patch.name !== current.name) out.name = patch.name;
  // ADM-FR-72 · TZ-R03: đã qua `TimezoneInputSchema` ở biên (tên IANA chuẩn).
  if (patch.timezone !== undefined && patch.timezone !== current.timezone) {
    out.timezone = patch.timezone;
  }
  if (
    patch.max_concurrent_sub !== undefined &&
    patch.max_concurrent_sub !== current.maxConcurrentSub
  ) {
    out.maxConcurrentSub = patch.max_concurrent_sub;
  }
  return out;
}
