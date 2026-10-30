// niti-onboard · kiểm đầu vào file khai báo onboarding (zod) — lớp adapter; luật thuần ở `domain/onboard.rules.ts` (ADR-0023).
import {
  EmailSchema,
  PackKeySchema,
  TENANT_TZ_DEFAULT,
  TenantKeySchema,
  TenantNameSchema,
  TenantProfileSchema,
  TimezoneInputSchema,
} from "@ai/contracts";
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

export const OnboardSpecSchema = z.strictObject({
  key: TenantKeySchema,
  name: TenantNameSchema,
  timezone: TimezoneInputSchema.default(TENANT_TZ_DEFAULT),
  profile: TenantProfileSchema.default({}),
  packs: z.array(PackKeySchema).max(10).default([]),
  root: DeptSchema.omit({ parent: true }),
  departments: z.array(DeptSchema).max(200).default([]),
  /** CR-105 L5: key of a published library process for slot `contracts.approval`; absent => default process. */
  approval_process: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]{0,63}$/)
    .optional(),
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
  return r.success
    ? { ok: true, spec: r.data }
    : { ok: false, issues: r.error.issues.map((i) => ({ path: i.path, code: i.code })) };
}
