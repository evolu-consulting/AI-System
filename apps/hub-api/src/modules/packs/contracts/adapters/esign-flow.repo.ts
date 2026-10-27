// esign-flow · repo bước Ký số trên LƯỢT duyệt hiện tại của HĐ (`contracts.contracts.run_id` ⇒ `contracts.approvals`), tx `PackUow`
// (role `contracts_rw`, RLS tenant) + lọc `tenant_id` tường minh; mỗi hàm MỘT câu. `claim` = khoá idempotent: chỉ một lời gọi đổi
// trạng thái sang `sending` (finalize chạy lại / hai instance không gửi hai phong bì). Danh bạ (trưởng phòng, thành viên có quyền gói)
// đọc `admin.*` qua hub scope như `manage.members`.
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import { type PackAccessView, packAccessInput } from "../../kit/adapters/pack-guard.middleware";
import type { PackWho } from "../../kit/application/ports";
import {
  ESIGN_SENDING_STALE_MIN,
  type EsignFlowCurrent,
  type EsignFlowRepo,
} from "../application/esign-flow.usecase";
import type { FlowEsignStep } from "../domain/approval-flow.types";

const STALE = sql.raw(`a.esign_at < now() - interval '${ESIGN_SENDING_STALE_MIN} minutes'`);
const json = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;

export function esignFlowRepo(tx: Tx, t: string): EsignFlowRepo {
  return {
    claim: async (contractId, resend) => {
      // esign-flow-fix · Gửi lại nhận cả `sending` kẹt quá hạn (tiến trình chết giữa claim và ghi kết quả).
      const from = resend
        ? sql`(a.esign_status = 'needs_decision' or (a.esign_status = 'sending' and ${STALE}))`
        : sql`a.esign_status is null`;
      const [r] = await tx.execute<{ id: string; step: unknown; owner: string | null }>(sql`
        update contracts.approvals a set esign_status = 'sending', esign_reason = null, esign_at = now(), updated_at = now()
        from contracts.contracts c
        where c.tenant_id = ${t}::uuid and c.id = ${contractId}::uuid and a.id = c.run_id and a.tenant_id = c.tenant_id
          and a.status = 'done' and jsonb_typeof(a.flow_steps) = 'array' and a.flow_steps->-1->>'kind' = 'esign'
          and ${from}
        returning a.id, a.flow_steps->-1 as step, c.owner_user_id as owner`);
      return r ? { approvalId: r.id, step: json<FlowEsignStep>(r.step), owner: r.owner } : null;
    },
    set: async (approvalId, s) => {
      await tx.execute(sql`update contracts.approvals set esign_status = ${s.status}, esign_reason = ${s.reason},
          esign_signer = coalesce(${s.signer ?? null}::uuid, esign_signer), esign_at = now(), updated_at = now()
        where tenant_id = ${t}::uuid and id = ${approvalId}::uuid`);
    },
    current: async (contractId) => {
      const [r] = await tx.execute<{
        id: string;
        st: string | null;
        owner: string | null;
        signer: string | null;
        stale: boolean;
      }>(sql`select a.id, a.esign_status as st, c.owner_user_id as owner, a.esign_signer as signer,
          (a.esign_status = 'sending' and ${STALE}) as stale
        from contracts.contracts c join contracts.approvals a on a.id = c.run_id and a.tenant_id = c.tenant_id
        where c.tenant_id = ${t}::uuid and c.id = ${contractId}::uuid`);
      return r
        ? ({
            approvalId: r.id,
            status: r.st,
            owner: r.owner,
            signer: r.signer,
            stale: r.stale === true,
          } satisfies EsignFlowCurrent)
        : null;
    },
    finish: async (contractId, to) => {
      const [r] = await tx.execute<{ id: string; owner: string | null; label: string | null }>(sql`
        update contracts.approvals a set esign_status = ${to.status}, esign_reason = ${to.reason}, esign_at = now(),
          updated_at = now()
        from contracts.contracts c
        where c.tenant_id = ${t}::uuid and c.id = ${contractId}::uuid and a.id = c.run_id and a.tenant_id = c.tenant_id
          and a.esign_status = 'sent'
        returning a.id, c.owner_user_id as owner, coalesce(c.number, c.title) as label`);
      return r ? { approvalId: r.id, owner: r.owner, label: (r.label ?? "").slice(0, 120) } : null;
    },
  };
}

/** Trưởng phòng của Group (cùng tenant); không phòng/không trưởng ⇒ null. */
export const deptHeadOf =
  (db: Db) =>
  async (tenantId: string, groupId: string): Promise<string | null> => {
    const rows = await withHubScope(db, { kind: "system" }, (tx) =>
      tx.execute<{ h: string | null }>(sql`select d.head_user_id as h from admin.departments d
        where d.tenant_id = ${tenantId}::uuid and d.group_id = ${groupId}::uuid limit 1`),
    );
    return rows[0]?.h ?? null;
  };

/** Người trong `ids` là thành viên tenant còn dùng được VÀ thuộc Group được quyền `write` gói (MỘT câu; ngoài tenant ⇒ không có). */
export function packWriters(db: Db, view: PackAccessView, packKey: string) {
  return async (who: PackWho, ids: readonly string[]): Promise<ReadonlySet<string>> => {
    if (ids.length === 0) return new Set();
    const i = await packAccessInput(view, packKey, who);
    const groups = i.entitled && !i.featureOff ? i.grantedByAction.write : [];
    if (groups.length === 0) return new Set();
    const rows = await withHubScope(
      db,
      { kind: "user", tenantId: who.tenantId, userId: who.userId },
      (tx) =>
        tx.execute<{ id: string }>(sql`select u.id from admin.users u
        where u.tenant_id = ${who.tenantId}::uuid and u.active and not u.locked_by_tenant
          and u.id = any(array(select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))::uuid[])
          and exists (select 1 from admin.group_members gm where gm.tenant_id = u.tenant_id and gm.user_id = u.id
            and gm.group_id = any(array(select jsonb_array_elements_text(${JSON.stringify(groups)}::jsonb))::uuid[]))`),
    );
    return new Set(rows.map((r) => r.id));
  };
}

/** esign-flow-fix · user còn dùng được của tenant (active, không bị khoá) — người ký công ty kiểm lại ngay trước khi gửi. */
export const activeUserOf =
  (db: Db) =>
  async (tenantId: string, userId: string): Promise<boolean> => {
    const rows = await withHubScope(db, { kind: "system" }, (tx) =>
      tx.execute<{ id: string }>(sql`select id from admin.users
        where tenant_id = ${tenantId}::uuid and id = ${userId}::uuid and active and not locked_by_tenant`),
    );
    return rows.length === 1;
  };
