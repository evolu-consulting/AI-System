// niti-onboard · kiểm đầu vào file khai báo onboarding (zod) — lớp adapter; luật thuần ở `domain/onboard.rules.ts` (ADR-0023).
import {
  DisplayNameSchema,
  EmailSchema,
  TenantKeySchema,
  TenantNameSchema,
  USERNAME_RE,
} from "@ai/contracts/common";
import { PackKeySchema } from "@ai/contracts/packs";
import { JOB_TITLE_MAX } from "@ai/contracts/people";
import { TENANT_TZ_DEFAULT, TenantProfileSchema, TimezoneInputSchema } from "@ai/contracts/tenants";
import { z } from "zod";
import type { OnboardSpec } from "../domain/onboard.rules";

/** Khoá Group (= CHECK `groups_key_check`). */
const GroupKey = z.string().regex(/^[a-z0-9-]{2,32}$/);
const Label = z.string().trim().min(1).max(128);

const DeptSchema = z.strictObject({
  key: GroupKey,
  vi: Label,
  en: Label.optional(),
  /** Khoá phòng cha; vắng ⇒ dưới gốc. */
  parent: GroupKey.optional(),
  head: EmailSchema.optional(),
  members: z.array(EmailSchema).max(1000).default([]),
});

/** CR-159 · tên đăng nhập suy từ email nên phần trước `@` phải hợp lệ làm username. */
const UserSchema = z.strictObject({
  email: EmailSchema.refine(
    (e) => USERNAME_RE.test(e.slice(0, e.indexOf("@"))),
    "USERNAME_FROM_EMAIL",
  ),
  name: DisplayNameSchema,
  title: z.string().trim().min(1).max(JOB_TITLE_MAX),
  role: z.enum(["admin", "member"]).default("member"),
});
const AddonKey = z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/);

export const OnboardSpecSchema = z.strictObject({
  key: TenantKeySchema,
  name: TenantNameSchema,
  timezone: TimezoneInputSchema.default(TENANT_TZ_DEFAULT),
  profile: TenantProfileSchema.default({}),
  packs: z.array(PackKeySchema).max(10).default([]),
  addons: z.array(AddonKey).max(20).default([]),
  users: z.array(UserSchema).max(500).default([]),
  root: DeptSchema.omit({ parent: true }),
  departments: z.array(DeptSchema).max(200).default([]),
  /** Gắn tenant với org mgmt-app cho importer I1 (marker `settings.mgmt_source/mgmt_org_id`); org null ⇒ chưa gắn. */
  import: z
    .strictObject({
      source: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/),
      org_id: z.string().min(1).max(128).nullable().default(null),
    })
    .optional(),
});
export type ParsedSpec = z.infer<typeof OnboardSpecSchema>;
/** Kiểm lúc biên dịch: kết quả zod gán được cho `OnboardSpec` của domain. */
export const asDomainSpec = (s: ParsedSpec): OnboardSpec => s;

/** Đọc file khai báo (YAML; `.json` ⇒ JSON) + kiểm; `mgmtOrg`/`mgmtSource` ghi đè `import.org_id`/`import.source`. */
export function parseSpec(
  text: string,
  o: { json?: boolean; mgmtOrg?: string; mgmtSource?: string } = {},
): { ok: true; spec: ParsedSpec } | { ok: false; issues: { path: PropertyKey[]; code: string }[] } {
  const raw = (o.json ? JSON.parse(text) : Bun.YAML.parse(text)) as Record<string, unknown>;
  if (o.mgmtOrg) raw.import = { ...((raw.import ?? {}) as object), org_id: o.mgmtOrg };
  if (o.mgmtSource) raw.import = { ...((raw.import ?? {}) as object), source: o.mgmtSource };
  const r = OnboardSpecSchema.safeParse(raw);
  const dup = r.success ? dupUserIssues(r.data.users) : [];
  if (dup.length > 0) return { ok: false, issues: dup };
  return r.success
    ? { ok: true, spec: r.data }
    : { ok: false, issues: r.error.issues.map((i) => ({ path: i.path, code: i.code })) };
}

/** Email trùng, hoặc hai email cùng tên đăng nhập (phần trước `@`) ⇒ lỗi. */
function dupUserIssues(users: { email: string }[]): { path: PropertyKey[]; code: string }[] {
  const seenMail = new Set<string>();
  const seenName = new Set<string>();
  const out: { path: PropertyKey[]; code: string }[] = [];
  users.forEach((u, i) => {
    const name = u.email.slice(0, u.email.indexOf("@"));
    if (seenMail.has(u.email)) out.push({ path: ["users", i, "email"], code: "DUP_USER_EMAIL" });
    else if (seenName.has(name)) out.push({ path: ["users", i, "email"], code: "DUP_USERNAME" });
    seenMail.add(u.email);
    seenName.add(name);
  });
  return out;
}
