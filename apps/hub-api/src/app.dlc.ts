// dlc-dify · nối route `/dify/*` (node Dify gọi Agent Hub bằng vé flow): agent-calls (chờ cả lượt hỏi user), answers,
// waiting, agents/spawn. Tách khỏi `app.ts` (giữ file gọn). Ghi cấu hình agent đi qua service Studio sẵn có.
import type { Env, Hono } from "hono";
import type { Db } from "./lib/db";
import { dbHubAudit, type HubAuditWriter } from "./lib/hub-audit";
import type { Logger } from "./lib/logger";
import type { Redis } from "./lib/redis";
import { AgentGrantsService } from "./modules/agent-grants/agent-grants.service";
import { AgentHooksService } from "./modules/agent-hooks/hooks.service";
import { AgentSettingsService } from "./modules/agent-settings/agent-settings.service";
import { agentCallRoutes } from "./modules/dify-calls/agent-call.routes";
import { AgentCallService } from "./modules/dify-calls/agent-call.service";
import { asyncReporter } from "./modules/dify-calls/async-report";
import { SpawnService } from "./modules/dify-calls/spawn.service";
import { flowTickets } from "./modules/dify-calls/tickets";
import { asyncFlowSink } from "./modules/mcp/adapters/workflow-invoker";
import type { PrepareMention } from "./modules/runs/runs.routes";
import type { RunService } from "./modules/runs/runs.service";
import { AgentsService } from "./modules/studio/agents/agents.service";
import { EntitlementsService } from "./modules/studio/entitlements/entitlements.service";

export function mountDlcDify<E extends Env>(
  app: Hono<E>,
  d: {
    db: Db;
    redis: Redis;
    runs: RunService;
    prepareMention: PrepareMention;
    log: Logger;
    hubAudit?: HubAuditWriter;
    packTools?: { has(key: string): boolean };
  },
): void {
  const audit = d.hubAudit ?? dbHubAudit;
  const tickets = flowTickets(d.redis);
  const calls = new AgentCallService({
    db: d.db,
    redis: d.redis,
    runs: d.runs,
    prepareMention: d.prepareMention,
    tickets,
    log: d.log,
  });
  const spawn = new SpawnService({
    db: d.db,
    tickets,
    agents: new AgentsService({ db: d.db, audit, packTools: d.packTools }),
    hooks: new AgentHooksService({ db: d.db, audit }),
    entitlements: new EntitlementsService({
      db: d.db,
      settings: new AgentSettingsService({ db: d.db, audit }),
    }),
    grants: new AgentGrantsService({ db: d.db, audit }),
    log: d.log,
  });
  app.route("/dify", agentCallRoutes(calls, spawn));
  // Workflow chạy nền (`hub_async`) xong ⇒ báo về hội thoại qua agent đã gọi tool.
  asyncFlowSink.done = asyncReporter({
    db: d.db,
    runs: d.runs,
    prepareMention: d.prepareMention,
    log: d.log,
  });
}
