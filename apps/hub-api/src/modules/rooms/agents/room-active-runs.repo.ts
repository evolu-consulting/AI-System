// HUB-FR-101 · X2b-R10 · `GET /rooms/:id` `active_runs` (plan §2.2 `RoomActiveRunSchema`, §4.2 `room_run_states`). Scope
// user + thành viên: definer trả run `running` + lượt chờ của phòng (≤ 50, chỉ người tag còn là thành viên) — không nội
// dung, nên thành viên thấy cả run người khác. Tên agent/người gọi join ở đây (Orchestrator: `agent_id` null ⇒ `agent` null).
import type { RoomAgentRef } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { Me } from "../manage/rooms.repo";
import type { ActiveRunRow } from "../rooms.map";

type Ts = Date | string;

type ActiveRunSqlRow = {
  run_id: string;
  flow_id: string;
  trigger_message_id: string;
  caller_id: string;
  status: ActiveRunRow["status"];
  wait_kind: ActiveRunRow["waitKind"] | null;
  started_at: Ts;
  agent_key: string | null;
  agent_name: RoomAgentRef["name"] | null;
  display_name: string | null;
  username: string | null;
};

/** Sắp `started_at` rồi `run_id` (definer đã `LIMIT 50` cùng thứ tự). */
export async function activeRuns(tx: Tx, me: Me, roomId: string): Promise<ActiveRunRow[]> {
  const rows = await tx.execute<ActiveRunSqlRow>(sql`
    select s.run_id, s.flow_id, s.trigger_message_id, s.caller_id, s.status, s.wait_kind, s.started_at,
      ag.key as agent_key, ag.name as agent_name, u.display_name, u.username
    from hub.room_run_states(${roomId}::uuid) s
    left join hub.agents ag on ag.id = s.agent_id
    left join admin.users u on u.id = s.caller_id and u.tenant_id = ${me.tenantId}
    order by s.started_at, s.run_id`);
  return rows.map((r) => ({
    runId: r.run_id,
    flowId: r.flow_id,
    triggerMessageId: r.trigger_message_id,
    agent: r.agent_key && r.agent_name ? { key: r.agent_key, name: r.agent_name } : null,
    caller: { id: r.caller_id, displayName: r.display_name, username: r.username },
    status: r.status,
    ...(r.status === "waiting" && r.wait_kind && { waitKind: r.wait_kind }),
    startedAt: r.started_at instanceof Date ? r.started_at : new Date(r.started_at),
  }));
}
