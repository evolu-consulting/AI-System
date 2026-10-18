// HUB-FR-143 · HUB-BR-20 · PD-R05 · D-PD03 · K6 · `SideEffectProbe` gắn tx + `tenantId` của UoW: job của stage đã gửi
// tool `side_effect` từ đầu attempt/round hiện tại? MỘT câu `exists` (không vòng theo hàng). Lời gọi tool của agent ghi
// `run_steps.type = 'tool'` (`mcp.repo.insertToolStep`) ⇒ xét cả `'tool'` lẫn `'workflow'`. `admin.workflows` là
// catalog toàn cục ⇒ join theo `workflow_id`; stage/run/step đều lọc `tenant_id` của UoW.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { SideEffectProbe } from "../../application/ports";

export function sideEffectProbe(tx: Tx, tenantId: string): SideEffectProbe {
  return {
    async sent(stageRunId) {
      // K6 · `retry_since` NULL (stage chạy trước bản này) ⇒ xét mọi lần chạy của stage — nghi ngờ thì coi như đã gửi.
      // Lỗi truy vấn làm hỏng tx ⇒ người gọi không thử lại (rơi vào lưới #134 `agent_failed`).
      const [r] = await tx.execute<{ sent: boolean }>(sql`
        select exists (
          select 1 from hub.stage_runs s
          join hub.runs r on r.stage_run_id = s.id and r.tenant_id = s.tenant_id
          join hub.run_steps rs on rs.run_id = r.id and rs.tenant_id = r.tenant_id
          join admin.workflows w on w.id = rs.workflow_id
          where s.id = ${stageRunId} and s.tenant_id = ${tenantId}
            and rs.type in ('tool', 'workflow') and rs.status <> 'skipped' and w.side_effect
            and (s.retry_since is null or r.started_at >= s.retry_since)
        ) as sent`);
      return r?.sent === true;
    },
  };
}
