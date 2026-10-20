// I1 · orgs + users + memberships mgmt-app ⇒ file export `mgmt-app-users/v1` của N5 (identity-import, gồm hash scrypt cũ).
// mgmt-app: membership `_id` = email, MỘT org mỗi user; user không có membership (nhân viên nội bộ) ⇒ org null ⇒ N5 báo
// NO_ORG (không chuyển). `manager_email` ⇒ N5 (M1b) đặt admin.user_managers. Hash chỉ chuyển nguyên văn vào file trong bộ nhớ, không log. Thuần.
import type { SourceDoc } from "./context";
import { lowerEmail, str } from "./values.rules";

export type UsersExport = {
  format: "mgmt-app-users/v1";
  source: string;
  orgs: { id: string; name: string; tenant_key?: string }[];
  users: {
    email: string;
    name: string;
    org_id: string | null;
    org_role: string | null;
    password_hash: string | null;
    manager_email: string | null;
    locale: "vi";
  }[];
};

export type Membership = { email: string; orgId: string; role: string; manager: string | null };

export function memberships(docs: SourceDoc[]): Map<string, Membership> {
  const out = new Map<string, Membership>();
  for (const d of docs) {
    const email = lowerEmail(d.src.email) ?? lowerEmail(d.id);
    const orgId = str(d.src.org_id, 128);
    if (!email || !orgId) continue;
    out.set(email, {
      email,
      orgId,
      role: str(d.src.role, 32) ?? "viewer",
      manager: lowerEmail(d.src.manager_email),
    });
  }
  return out;
}

export type SourceOrg = { id: string; name: string; members: number };

/** Org nguồn + số membership — báo cáo để người vận hành chọn org gắn với tenant (`--into-tenant`). */
export function sourceOrgs(orgs: SourceDoc[], members: Map<string, Membership>): SourceOrg[] {
  const n = new Map<string, number>();
  for (const m of members.values()) n.set(m.orgId, (n.get(m.orgId) ?? 0) + 1);
  return orgs.map((o) => {
    const id = str(o.src.id, 128) ?? o.id;
    return { id, name: str(o.src.name, 512) ?? o.id, members: n.get(id) ?? 0 };
  });
}

/**
 * niti-onboard · `onlyOrg` (org gắn với tenant đích): giữ org đó + user của nó + user KHÔNG thuộc org nào (N5 vẫn báo NO_ORG
 * như I1 gốc); user của org khác bị loại (không tạo tenant/user cho org không được chọn). `onlyOrg` null ⇒ giữ nguyên.
 */
export function scopeToOrg(
  onlyOrg: string | null | undefined,
  docs: { orgs: SourceDoc[]; users: SourceDoc[] },
  members: Map<string, Membership>,
): { orgs: SourceDoc[]; users: SourceDoc[]; excludedUsers: number } {
  if (onlyOrg == null) return { ...docs, excludedUsers: 0 };
  const orgs = docs.orgs.filter((o) => (str(o.src.id, 128) ?? o.id) === onlyOrg);
  const users = docs.users.filter((u) => {
    const m = members.get(lowerEmail(u.src.email) ?? u.id.toLowerCase());
    return !m || m.orgId === onlyOrg;
  });
  return { orgs, users, excludedUsers: docs.users.length - users.length };
}

export function usersExport(
  source: string,
  orgs: SourceDoc[],
  users: SourceDoc[],
  members: Map<string, Membership>,
): UsersExport {
  return {
    format: "mgmt-app-users/v1",
    source,
    orgs: orgs.map((o) => ({ id: str(o.src.id, 128) ?? o.id, name: str(o.src.name, 512) ?? o.id })),
    users: users.map((u) => {
      const email = lowerEmail(u.src.email) ?? u.id.toLowerCase();
      const m = members.get(email);
      return {
        email,
        name: str(u.src.name, 512) ?? "",
        org_id: m?.orgId ?? null,
        org_role: m?.role ?? null,
        password_hash: typeof u.src.password_hash === "string" ? u.src.password_hash : null,
        manager_email: m?.manager ?? null,
        locale: "vi",
      };
    }),
  };
}
