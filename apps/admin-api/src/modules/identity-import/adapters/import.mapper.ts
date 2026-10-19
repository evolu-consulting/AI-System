// N5-FR-01 · schema file export mgmt-app `mgmt-app-users/v1` (spec N5 §2, §7 R2). Sai cấu trúc ⇒ BAD_FILE (dừng); hàng sai
// kiểu ⇒ BAD_ROW theo chỉ số (ref `users[i]`, KHÔNG chép giá trị — có thể là hash). Trường thừa (vd `has_password`) bỏ qua.
import { z } from "zod";
import type { ImportInput } from "../application/import.usecase";
import { ImportAbort } from "../domain/errors";
import type { Issue, OrgIn, UserIn } from "../domain/import";

const FileSchema = z.object({
  format: z.literal("mgmt-app-users/v1"),
  orgs: z.array(z.unknown()).max(10_000),
  users: z.array(z.unknown()).max(200_000),
});
const OrgSchema = z.object({
  id: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(512),
  tenant_key: z
    .string()
    .regex(/^[a-z0-9-]{2,32}$/)
    .optional(),
});
const UserSchema = z.object({
  email: z.string().max(320),
  name: z.string().max(512).default(""),
  org_id: z.string().trim().min(1).max(128).nullable(),
  org_role: z.string().max(32).nullable(),
  password_hash: z.string().max(4096).nullable(),
  locale: z.enum(["vi", "en"]).default("vi"),
});

export function parseExport(raw: unknown): ImportInput {
  const f = FileSchema.safeParse(raw);
  if (!f.success) throw new ImportAbort("BAD_FILE");
  const issues: Issue[] = [];
  const orgs: OrgIn[] = [];
  for (const [i, x] of f.data.orgs.entries()) {
    const o = OrgSchema.safeParse(x);
    if (!o.success) issues.push({ kind: "org", ref: `orgs[${i}]`, code: "BAD_ROW" });
    else orgs.push({ id: o.data.id, name: o.data.name, tenantKey: o.data.tenant_key ?? null });
  }
  const users: UserIn[] = [];
  for (const [i, x] of f.data.users.entries()) {
    const u = UserSchema.safeParse(x);
    if (!u.success) {
      issues.push({ kind: "user", ref: `users[${i}]`, code: "BAD_ROW" });
      continue;
    }
    const d = u.data;
    users.push({
      email: d.email,
      name: d.name,
      orgId: d.org_id,
      orgRole: d.org_role,
      passwordHash: d.password_hash,
      locale: d.locale,
    });
  }
  return { orgs, users, issues, orgRows: f.data.orgs.length, userRows: f.data.users.length };
}
