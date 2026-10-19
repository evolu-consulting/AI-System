// HD-FR-37 · review HD3 M1: cài đặt duyệt theo tenant (ngưỡng, Group cấp 1/2) + nhật ký trước/sau/người/lúc trong MỘT câu.
// Tx `PackUow` (role `contracts_rw`, RLS FORCE); không có hàng ⇒ mặc định spec HD3 §5.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { APPROVAL_DEFAULTS, type ApprovalSettings } from "../domain/approval-def.rules";

type SettingsRow = { threshold: string | number; l1: string; l2: string };
const toSettings = (r: SettingsRow | undefined): ApprovalSettings =>
  r
    ? { threshold: Number(r.threshold), level1GroupKey: r.l1, level2GroupKey: r.l2 }
    : { ...APPROVAL_DEFAULTS };

const DEFAULTS_JSON = JSON.stringify({
  threshold: APPROVAL_DEFAULTS.threshold,
  level1_group_key: APPROVAL_DEFAULTS.level1GroupKey,
  level2_group_key: APPROVAL_DEFAULTS.level2GroupKey,
});

export function settingsRepo(tx: Tx, tid: string) {
  return {
    async settings(): Promise<ApprovalSettings> {
      const [r] = await tx.execute<SettingsRow>(sql`select threshold, level1_group_key as l1,
        level2_group_key as l2 from contracts.approval_settings where tenant_id = ${tid}::uuid`);
      return toSettings(r);
    },
    /** Upsert + nhật ký (review M1) trong MỘT câu: `old` đọc ảnh trước khi ghi; vắng hàng ⇒ trước = mặc định. */
    async saveSettings(s: ApprovalSettings, actor: string): Promise<ApprovalSettings> {
      const [r] = await tx.execute<SettingsRow>(sql`with old as (
          select jsonb_build_object('threshold', threshold, 'level1_group_key', level1_group_key,
            'level2_group_key', level2_group_key) as v
          from contracts.approval_settings where tenant_id = ${tid}::uuid),
        up as (insert into contracts.approval_settings
            (tenant_id, threshold, level1_group_key, level2_group_key, updated_by)
          values (${tid}::uuid, ${s.threshold}::bigint, ${s.level1GroupKey}, ${s.level2GroupKey}, ${actor}::uuid)
          on conflict (tenant_id) do update set threshold = excluded.threshold,
            level1_group_key = excluded.level1_group_key, level2_group_key = excluded.level2_group_key,
            updated_by = excluded.updated_by, updated_at = now()
          returning threshold, level1_group_key as l1, level2_group_key as l2),
        au as (insert into contracts.approval_settings_audit (tenant_id, actor_user_id, before, after)
          select ${tid}::uuid, ${actor}::uuid, coalesce((select v from old), ${DEFAULTS_JSON}::jsonb),
            jsonb_build_object('threshold', up.threshold, 'level1_group_key', up.l1, 'level2_group_key', up.l2)
          from up)
        select threshold, l1, l2 from up`);
      return toSettings(r);
    },
  };
}
