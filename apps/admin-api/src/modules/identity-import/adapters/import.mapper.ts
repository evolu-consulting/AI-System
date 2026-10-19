// N5-FR-01 · schema file export mgmt-app `mgmt-app-users/v1` (spec N5 §2, §7 R2). Sai cấu trúc ⇒ BAD_FILE (dừng); hàng sai
// kiểu ⇒ BAD_ROW theo chỉ số (ref `users[i]`, KHÔNG chép giá trị — có thể là hash). Trường thừa (vd `has_password`) bỏ qua.
import { z } from "zod";
import type { ImportInput } from "../application/import.usecase";
import { ImportAbort } from "../domain/errors";
import type { Issue, OrgIn, UserIn } from "../domain/import";

/** NUL và surrogate lẻ ⇒ jsonb/Postgres từ chối (22xxx) ⇒ chặn ở biên thành BAD_ROW (M2). */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const badChars = (s: string): boolean =>
  s.includes(String.fromCharCode(0)) || LONE_SURROGATE.test(s);
const str = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((s) => !badChars(s));
const raw = (max: number) =>
  z
    .string()
    .max(max)
    .refine((s) => !badChars(s));

const FileSchema = z.object({
  format: z.literal("mgmt-app-users/v1"),
  /** Định danh instance mgmt-app (vd `mgmt-prod`): marker tenant = (source, org id) — security M1. */
  source: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
  orgs: z.array(z.unknown()).max(10_000),
  users: z.array(z.unknown()).max(200_000),
});
const OrgSchema = z.object({
  id: str(1, 128),
  name: str(1, 512),
  tenant_key: z
    .string()
    .regex(/^[a-z0-9-]{2,32}$/)
    .optional(),
});
const UserSchema = z.object({
  email: raw(320),
  name: raw(512).default(""),
  org_id: str(1, 128).nullable(),
  org_role: raw(32).nullable(),
  password_hash: raw(4096).nullable(),
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
  return {
    source: f.data.source,
    orgs,
    users,
    issues,
    orgRows: f.data.orgs.length,
    userRows: f.data.users.length,
  };
}
