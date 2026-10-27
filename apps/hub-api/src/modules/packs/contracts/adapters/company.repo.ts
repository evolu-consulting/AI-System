// V2-L · CD-01 · V2-A (cờ duyệt): cài đặt công ty — nhận diện (tên, tên ứng dụng, logo, màu, giao diện), tên/MST của chính công ty và
// cờ duyệt hợp đồng. Mỗi hàm MỘT câu, văn bản cố định (dữ liệu qua tham số). Tx `PackUow` (role `contracts_rw`, RLS FORCE).
import type { CompanyIn } from "@ai/contracts";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { ApprovalFlag, StoredCompany } from "../application/companies.ports";
import { one } from "./ledger-sql";

export type { ApprovalFlag, StoredCompany };

export function companyRepo(tx: Tx, tid: string) {
  const company = (): Promise<StoredCompany> =>
    one<StoredCompany>(
      tx,
      sql`select jsonb_build_object('company', jsonb_build_object('name', s.company_name, 'app_name', s.app_name,
          'logo', s.logo, 'accent', s.accent, 'theme', s.theme, 'own_names', to_jsonb(s.own_names),
          'own_tax_ids', to_jsonb(s.own_tax_ids)), 'version', s.version, 'updated_at', s.updated_at) as j
        from contracts.company_settings s where s.tenant_id = ${tid}::uuid`,
    );

  const saveCompany = (c: CompanyIn): Promise<NonNullable<StoredCompany>> =>
    one<NonNullable<StoredCompany>>(
      tx,
      sql`insert into contracts.company_settings as s (tenant_id, company_name, app_name, logo, accent, theme, own_names, own_tax_ids)
        values (${tid}::uuid, ${c.name}, ${c.app_name}, ${c.logo}, ${c.accent}, ${c.theme},
          array(select jsonb_array_elements_text(${JSON.stringify(c.own_names)}::jsonb)),
          array(select jsonb_array_elements_text(${JSON.stringify(c.own_tax_ids)}::jsonb)))
        on conflict (tenant_id) do update set company_name = excluded.company_name, app_name = excluded.app_name,
          logo = excluded.logo, accent = excluded.accent, theme = excluded.theme, own_names = excluded.own_names,
          own_tax_ids = excluded.own_tax_ids, version = s.version + 1, updated_by = excluded.updated_by, updated_at = now()
        returning jsonb_build_object('company', jsonb_build_object('name', s.company_name, 'app_name', s.app_name,
          'logo', s.logo, 'accent', s.accent, 'theme', s.theme, 'own_names', to_jsonb(s.own_names),
          'own_tax_ids', to_jsonb(s.own_tax_ids)), 'version', s.version, 'updated_at', s.updated_at) as j`,
    );

  /** Cờ hiệu lực (hàng cài đặt > mặc định theo tenant) và mặc định. */
  const approval = () => approvalFlag(tx, tid);

  /** Ghi cờ + nhật ký trước/sau (cùng bảng nhật ký với ngưỡng duyệt) trong MỘT câu. */
  const saveApproval = async (enabled: boolean, actor: string): Promise<void> => {
    await tx.execute(sql`with old as (select contracts.approval_on() as v),
        up as (insert into contracts.approval_settings (tenant_id, approval_enabled, updated_by)
          values (${tid}::uuid, ${enabled}, ${actor}::uuid)
          on conflict (tenant_id) do update set approval_enabled = excluded.approval_enabled,
            updated_by = excluded.updated_by, updated_at = now()
          returning approval_enabled)
      insert into contracts.approval_settings_audit (tenant_id, actor_user_id, before, after)
        select ${tid}::uuid, ${actor}::uuid, jsonb_build_object('approval_enabled', (select v from old)),
          jsonb_build_object('approval_enabled', up.approval_enabled) from up`);
  };

  return {
    company,
    saveCompany,
    approval,
    saveApproval,
    saveAllowNegative: (allow: boolean, actor: string) =>
      saveAllowNegativeStock(tx, tid, allow, actor),
    saveLegalThreshold: (v: number, actor: string) => saveLegalThreshold(tx, tid, v, actor),
  };
}
export type CompanyRepo = ReturnType<typeof companyRepo>;

const approvalFlag = (tx: Tx, tid: string): Promise<ApprovalFlag> =>
  one<ApprovalFlag>(
    tx,
    sql`select jsonb_build_object('enabled', contracts.approval_on(), 'by_default', contracts.approval_default(),
      'allow_negative', coalesce((select s.allow_negative_stock from contracts.approval_settings s
        where s.tenant_id = ${tid}::uuid), false),
      'legal_warn_threshold', coalesce((select s.legal_warn_threshold from contracts.approval_settings s
        where s.tenant_id = ${tid}::uuid), 5000000)) as j`,
  );

/** Cài đặt "cho phép giao vượt tồn" + nhật ký trước/sau trong MỘT câu. */
async function saveAllowNegativeStock(
  tx: Tx,
  tid: string,
  allow: boolean,
  actor: string,
): Promise<void> {
  await tx.execute(sql`with old as (select coalesce((select s.allow_negative_stock from contracts.approval_settings s
        where s.tenant_id = ${tid}::uuid), false) as v),
      up as (insert into contracts.approval_settings (tenant_id, allow_negative_stock, updated_by)
        values (${tid}::uuid, ${allow}, ${actor}::uuid)
        on conflict (tenant_id) do update set allow_negative_stock = excluded.allow_negative_stock,
          updated_by = excluded.updated_by, updated_at = now()
        returning allow_negative_stock)
    insert into contracts.approval_settings_audit (tenant_id, actor_user_id, before, after)
      select ${tid}::uuid, ${actor}::uuid, jsonb_build_object('allow_negative_stock', (select v from old)),
        jsonb_build_object('allow_negative_stock', up.allow_negative_stock) from up`);
}

/** DOC-legal: ngưỡng cảnh báo pháp lý (đồng) + nhật ký trước/sau trong MỘT câu. */
async function saveLegalThreshold(tx: Tx, tid: string, v: number, actor: string): Promise<void> {
  await tx.execute(sql`with old as (select coalesce((select s.legal_warn_threshold from contracts.approval_settings s
        where s.tenant_id = ${tid}::uuid), 5000000) as v),
      up as (insert into contracts.approval_settings (tenant_id, legal_warn_threshold, updated_by)
        values (${tid}::uuid, ${v}::bigint, ${actor}::uuid)
        on conflict (tenant_id) do update set legal_warn_threshold = excluded.legal_warn_threshold,
          updated_by = excluded.updated_by, updated_at = now()
        returning legal_warn_threshold)
    insert into contracts.approval_settings_audit (tenant_id, actor_user_id, before, after)
      select ${tid}::uuid, ${actor}::uuid, jsonb_build_object('legal_warn_threshold', (select v from old)),
        jsonb_build_object('legal_warn_threshold', up.legal_warn_threshold) from up`);
}
