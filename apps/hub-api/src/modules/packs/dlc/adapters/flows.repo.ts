// dlc-engine · repo `dlc.flows` trong tx gói (role `dlc_rw`, RLS FORCE theo tenant). Mọi câu lọc `tenant_id` tường minh; ghi
// trạng thái = MỘT câu `state || patch` (gộp nông, khoá bước trong `results` do use case gộp sẵn).
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { DlcFlow, DlcFlowsRepo, DlcOwnRepos, DlcState } from "../application/ports";
import type { DlcMode } from "../domain/dlc-flow.rules";

type Row = {
  id: string;
  mode: DlcMode;
  project: string;
  ticket_id: string | null;
  conversation_id: string | null;
  started_by: string;
  requirement: string;
  state: DlcState | string;
};

export function flowsRepo(tx: Tx, tenantId: string): DlcFlowsRepo {
  return {
    async get(id) {
      const [r] =
        await tx.execute<Row>(sql`select id, mode, project, ticket_id, conversation_id, started_by,
          requirement, state from dlc.flows where id = ${id}::uuid and tenant_id = ${tenantId}::uuid`);
      if (!r) return null;
      const state = typeof r.state === "string" ? (JSON.parse(r.state) as DlcState) : r.state;
      return {
        id: r.id,
        mode: r.mode,
        project: r.project,
        ticketId: r.ticket_id,
        conversationId: r.conversation_id,
        startedBy: r.started_by,
        requirement: r.requirement,
        state,
      } satisfies DlcFlow;
    },
    async insert(f) {
      await tx.execute(sql`insert into dlc.flows (id, tenant_id, mode, project, ticket_id, requirement,
          conversation_id, started_by, state)
        values (${f.id}::uuid, ${tenantId}::uuid, ${f.mode}, ${f.project}, ${f.ticketId}, ${f.requirement},
          ${f.conversationId}::uuid, ${f.startedBy}::uuid, ${JSON.stringify(f.state)}::jsonb)`);
    },
    async byConversation(conversationId, limit) {
      const rows = await tx.execute<
        Pick<Row, "id" | "mode" | "project" | "ticket_id">
      >(sql`select id, mode,
          project, ticket_id from dlc.flows where conversation_id = ${conversationId}::uuid
          and tenant_id = ${tenantId}::uuid order by created_at desc limit ${limit}`);
      return rows.map((r) => ({
        id: r.id,
        mode: r.mode,
        project: r.project,
        ticketId: r.ticket_id,
      }));
    },
    async patch(id, patch) {
      await tx.execute(sql`update dlc.flows set state = state || ${JSON.stringify(patch)}::jsonb, updated_at = now()
        where id = ${id}::uuid and tenant_id = ${tenantId}::uuid`);
    },
  };
}

export const dlcRepos = (tx: Tx, tenantId: string): DlcOwnRepos => ({
  flows: flowsRepo(tx, tenantId),
});
