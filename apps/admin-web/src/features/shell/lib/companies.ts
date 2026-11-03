// CR-112 · ADM-FR-76/77 · mục "Công ty" của sidebar: platform_admin thấy mọi công ty (lọc theo ô tìm); tenant_admin chỉ công ty mình, không có ô tìm.
import type { Role } from "@ai/contracts";

export type CompanyEntry = { id: string; key: string; name: string; locked: boolean };
type ListItem = { id: string; key: string; name: string; status: string };
type OwnTenant = { id: string; key: string; name: string };

/** Ô tìm chỉ cho platform_admin (tenant_admin chỉ có một công ty). */
export const canSearchCompanies = (role: Role | undefined): boolean => role === "platform_admin";

/** Có thể tạo công ty từ sidebar (chỉ platform_admin). */
export const canCreateCompany = canSearchCompanies;

export function companyEntries(
  role: Role | undefined,
  own: OwnTenant | undefined,
  list: readonly ListItem[] | undefined,
  q: string,
): CompanyEntry[] {
  if (role === "tenant_admin") {
    return own ? [{ id: own.id, key: own.key, name: own.name, locked: false }] : [];
  }
  if (role !== "platform_admin") return [];
  const needle = q.trim().toLowerCase();
  return (list ?? [])
    .filter((t) => !needle || t.name.toLowerCase().includes(needle) || t.key.includes(needle))
    .map((t) => ({ id: t.id, key: t.key, name: t.name, locked: t.status === "locked" }));
}
