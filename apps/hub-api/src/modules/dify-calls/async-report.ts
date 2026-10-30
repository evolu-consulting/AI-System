// dlc-dify · báo kết quả workflow chạy nền (`hub_async`, vd quy trình DLC) về đúng hội thoại: mở một run `@<agent đã gọi
// tool>` (vd dlc-agent) với báo cáo của flow như tin hệ thống tự động — agent tóm tắt cho người dùng, người dùng thấy trong
// Chat như mọi câu trả lời. Không có agent/hội thoại ⇒ chỉ log.
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import type { Logger } from "../../lib/logger";
import type { ToolCall } from "../mcp/adapters/workflow-invoker";
import { routeMessage } from "../mention/mention-parse.rules";
import type { RunService } from "../runs/runs.service";
import type { PrepareMention } from "./ports";

const REPORT_MAX = 15_000;

type Owner = { conversation_id: string; role: AuthUser["role"]; agent_key: string | null };

export function asyncReporter(d: {
  db: Db;
  runs: RunService;
  prepareMention: PrepareMention;
  log: Logger;
}) {
  return async (call: ToolCall, r: { ok: boolean; text: string }): Promise<void> => {
    const { ctx, wf } = call;
    const [o] = await withHubScope(d.db, { kind: "system" }, (tx) =>
      tx.execute<Owner>(sql`select r.conversation_id, u.role,
          (select key from hub.agents a where a.id = ${ctx.agentId}::uuid) as agent_key
        from hub.runs r join admin.users u on u.id = ${ctx.userId}::uuid where r.id = ${ctx.runId}::uuid`),
    );
    if (!o?.agent_key) {
      d.log.warn("async-flow-no-target", { run_id: ctx.runId, workflow: wf.key });
      return;
    }
    const u: AuthUser = { userId: ctx.userId, tenantId: ctx.tenantId, role: o.role };
    const body =
      r.text.length > REPORT_MAX
        ? `${r.text.slice(0, REPORT_MAX)}\n…(full report saved in the project workspace docs/dlc/result.md)`
        : r.text;
    const content = `@${o.agent_key} [AUTOMATIC: DLC flow ${wf.key} ${r.ok ? "finished" : "stopped"} — summarise this report for the person. In THIS reply only, do not start a DLC process tool; later requests from the person to run a process again are allowed as usual]\n\n${body}`;
    const msg = routeMessage(content);
    if (msg.kind !== "mention") return;
    const plan = await d.prepareMention(u, msg);
    const s = await d.runs.start(u, o.conversation_id, { content }, plan);
    void s.stream.cancel().catch(() => {});
    d.log.info("async-flow-reported", { run_id: s.runId, workflow: wf.key, ok: r.ok });
  };
}
