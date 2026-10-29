// CR-103 · e2e fnr-showcase · seed flow mẫu vào tenant của stack e2e (chạy trong `_pa-stack.ts` TRƯỚC khi Hub lên, chỉ khi env
// `FNR_SHOWCASE_SEED=1` — do `playwright.fnr.config.ts` đặt, các project e2e khác không thấy). Dùng lại build + kiểm của
// `tools/scripts/src/seed-flow-showcase*` (contracts → luật def → ép trường như API lưu). Idempotent. KHÔNG dùng cho tenant thật.
import type postgres from "postgres";
import { buildShowcaseDef, type GroupIds } from "../../tools/scripts/src/seed-flow-showcase.build";
import { checkShowcase, dryRunRefs } from "../../tools/scripts/src/seed-flow-showcase.check";

type Sql = postgres.Sql;
/** Group riêng của flow mẫu (id cố định dải `f4a0…`); khoá `fnr-*` không đụng Group P-a. */
export const FNR_GROUPS: GroupIds = {
  legal: "f4a00000-0000-4000-8000-000000000001",
  accounting: "f4a00000-0000-4000-8000-000000000002",
  director: "f4a00000-0000-4000-8000-000000000003",
};
const KEYS = {
  legal: "fnr-phap-che",
  accounting: "fnr-ke-toan",
  director: "fnr-giam-doc",
} as const;
const VI = { legal: "Pháp chế", accounting: "Kế toán", director: "Giám đốc" } as const;

/** Thêm 3 Group duyệt + `adminId` làm thành viên + def mẫu cho `tenantId`. */
export async function seedShowcase(sql: Sql, tenantId: string, adminId: string): Promise<void> {
  for (const k of Object.keys(FNR_GROUPS) as (keyof GroupIds)[]) {
    await sql`insert into admin.groups (id, tenant_id, key, name)
      values (${FNR_GROUPS[k]}, ${tenantId}, ${KEYS[k]}, ${sql.json({ vi: `${VI[k]} (flow mẫu)`, en: KEYS[k] })})
      on conflict do nothing`;
    await sql`insert into admin.group_members (tenant_id, group_id, user_id)
      values (${tenantId}, ${FNR_GROUPS[k]}, ${adminId}) on conflict do nothing`;
  }
  const c = checkShowcase(buildShowcaseDef(FNR_GROUPS), dryRunRefs(Object.values(FNR_GROUPS)));
  if (!c.ok) throw new Error(`fnr-showcase seed: def không hợp lệ — ${c.issues.join("; ")}`);
  const d = c.def;
  await sql`insert into hub.process_defs (tenant_id, key, name, description, input_hint, run_group_ids, stages,
      token_budget, enabled, sources, inputs, version)
    select ${tenantId}, ${d.key}, ${d.name}, ${d.description}, ${d.input_hint}, '{}'::uuid[], ${sql.json(d.stages as never)},
      null, true, '[]'::jsonb, ${sql.json(d.inputs as never)}, 1
    where not exists (select 1 from hub.process_defs where tenant_id = ${tenantId} and key = ${d.key} and deleted_at is null)`;
}
