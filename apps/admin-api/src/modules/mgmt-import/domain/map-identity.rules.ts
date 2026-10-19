// I1 · orgs + users + memberships mgmt-app ⇒ file export `mgmt-app-users/v1` của N5 (identity-import, gồm hash scrypt cũ).
// mgmt-app: membership `_id` = email, MỘT org mỗi user; user không có membership (nhân viên nội bộ) ⇒ org null ⇒ N5 báo
// NO_ORG (không chuyển). Hash chỉ chuyển nguyên văn vào file trong bộ nhớ, không log. Thuần.
import type { SourceDoc } from "./context";
import { lowerEmail, str } from "./values.rules";

export type UsersExport = {
  format: "mgmt-app-users/v1";
  source: string;
  orgs: { id: string; name: string }[];
  users: {
    email: string;
    name: string;
    org_id: string | null;
    org_role: string | null;
    password_hash: string | null;
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
        locale: "vi",
      };
    }),
  };
}

/** Cặp (user, quản lý) cùng org; quản lý ngoài org / chính mình ⇒ bỏ. */
export function managerPairs(
  members: Map<string, Membership>,
): { email: string; manager: string; orgId: string }[] {
  const out: { email: string; manager: string; orgId: string }[] = [];
  for (const m of members.values()) {
    if (!m.manager || m.manager === m.email) continue;
    if (members.get(m.manager)?.orgId !== m.orgId) continue;
    out.push({ email: m.email, manager: m.manager, orgId: m.orgId });
  }
  return out;
}
