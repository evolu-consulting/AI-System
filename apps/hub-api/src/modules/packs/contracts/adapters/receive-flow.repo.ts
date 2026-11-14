// CR-146b · cấu hình bên NHẬN hợp đồng đối tác đọc từ MỘT nguồn: quy trình «Nhận HĐ từ đối tác» (`contract.received`) đang bật ĐẦU TIÊN của
// công ty (cùng luật chọn `eventFlowOf`: `company_flows.position, id`; def công ty hoặc Thư viện đã xuất bản) — G1, không còn `partner_settings`.
//   · ngưỡng «Quan trọng»/«Rất quan trọng» + người phụ trách ở `trigger.params` (triệu đồng);
//   · người ký bên nhận = «Người ký phía công ty» của bước Ký (`contracts-esign-send`) trong CHÍNH quy trình đó.
// Mỗi hàm MỘT câu SQL văn bản hằng, tenant tường minh (Luật 4c).

import {
  FLOW_RECEIVE_DEFAULT_CRITICAL_M,
  FLOW_RECEIVE_DEFAULT_IMPORTANT_M,
} from "@ai/contracts/hub-admin";
import { decodeEsignNodeArgs, type EsignNodeSigner } from "@ai/contracts/pack-contracts";
import type { Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";

const MILLION = 1_000_000;
export const RECEIVE_DEFAULT_IMPORTANT = FLOW_RECEIVE_DEFAULT_IMPORTANT_M * MILLION;
export const RECEIVE_DEFAULT_CRITICAL = FLOW_RECEIVE_DEFAULT_CRITICAL_M * MILLION;
export const SIGN_TOOL = "contracts-esign-send";

export type ReceiveFlowConfig = {
  importantMin: number;
  criticalMin: number;
  ownerId: string | null;
  /** null ⇒ quy trình chưa có bước Ký (hoặc chưa có quy trình); [] không xảy ra (luật lưu bắt buộc ≥ 1 người ký). */
  signers: EsignNodeSigner[] | null;
};

type Params = { important_min_m?: unknown; critical_min_m?: unknown; owner_user_id?: unknown };

/** Luật THUẦN: `trigger.params` (triệu đồng) ⇒ ngưỡng VND + người phụ trách; thiếu ⇒ mặc định 500 triệu / 2 tỷ. */
export function receiveParamsOf(p: Params | null | undefined): Omit<ReceiveFlowConfig, "signers"> {
  const num = (v: unknown, d: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v * MILLION : d;
  const owner = typeof p?.owner_user_id === "string" ? p.owner_user_id : null;
  return {
    importantMin: num(p?.important_min_m, RECEIVE_DEFAULT_IMPORTANT),
    criticalMin: num(p?.critical_min_m, RECEIVE_DEFAULT_CRITICAL),
    ownerId: owner,
  };
}

/**
 * Luật THUẦN: người phụ trách ghi vào `owner_user_id` của HĐ nhận. `configured` = người đặt ở quy trình, `actor` = kết quả `flowReceiveState`
 * (người đã đặt nếu còn dùng được, không thì quản trị công ty). Đã đặt mà không còn dùng được ⇒ null (HĐ vẫn vào; quản trị thấy «chưa có người
 * phụ trách» và gán lại) — KHÔNG lặng lẽ đổi sang người khác. Chưa đặt ⇒ quản trị công ty (spec §3 #9b).
 */
export const receiveOwnerOf = (configured: string | null, actor: string | null): string | null =>
  configured !== null && actor !== configured ? null : actor;

/** Luật THUẦN: «Người ký phía công ty» của bước Ký ĐẦU TIÊN trong stage của quy trình; không có bước Ký / chưa chọn người ký ⇒ null. */
export function signersOfStages(stages: readonly unknown[]): EsignNodeSigner[] | null {
  for (const s of stages) {
    const ex = (
      s as { executor?: { tool_key?: string; args?: Record<string, { value?: unknown }> } }
    ).executor;
    if (ex?.tool_key !== SIGN_TOOL) continue;
    const raw = ex.args?.company_signers?.value;
    const dec = decodeEsignNodeArgs({ company_signers: typeof raw === "string" ? raw : "" });
    return dec.ok && (dec.config.company_signers?.length ?? 0) > 0
      ? (dec.config.company_signers ?? null)
      : null;
  }
  return null;
}

type Row = { params: Params | null; stages: unknown[] | null };

export async function receiveFlowOf(db: Db, tenantId: string): Promise<ReceiveFlowConfig> {
  const [r] = await withHubScope(db, { kind: "system" }, (tx) =>
    tx.execute<Row>(sql`
      select d.trigger -> 'params' as params,
        case when d.tenant_id is null then coalesce(r.stages, d.stages) else d.stages end as stages
      from hub.company_flows cf
      join hub.process_defs d on d.id = cf.flow_id and d.deleted_at is null
        and (d.tenant_id = cf.tenant_id or d.tenant_id is null)
      left join hub.process_def_releases r on r.def_id = d.id and r.rel_version = d.published_version
      where cf.tenant_id = ${tenantId}::uuid and cf.enabled and d.trigger_event = 'contract.received'
        and (d.tenant_id is not null or d.published_version is not null)
      order by cf.position, cf.id limit 1`),
  );
  return {
    ...receiveParamsOf(r?.params),
    signers: r && Array.isArray(r.stages) ? signersOfStages(r.stages) : null,
  };
}

/** Người ký bên nhận (người + thành viên các phòng) còn dùng được của công ty — MỘT câu, theo mảng id. */
export async function signerMembersOf(
  db: Db,
  tenantId: string,
  signers: readonly EsignNodeSigner[],
): Promise<{ id: string; name: string }[]> {
  const users = `{${signers
    .filter((s) => s.kind === "user")
    .map((s) => s.id)
    .join(",")}}`;
  const groups = `{${signers
    .filter((s) => s.kind === "group")
    .map((s) => s.id)
    .join(",")}}`;
  return withHubScope(db, { kind: "system" }, (tx) =>
    tx.execute<{
      id: string;
      name: string;
    }>(sql`select u.id::text as id, u.display_name as name from admin.users u
      where u.tenant_id = ${tenantId}::uuid and u.active and not u.locked_by_tenant and u.kind = 'internal'
        and (u.id = any(${users}::uuid[]) or exists (select 1 from admin.group_members m
          where m.tenant_id = u.tenant_id and m.user_id = u.id and m.group_id = any(${groups}::uuid[])))
      order by u.display_name, u.id limit 200`),
  );
}
