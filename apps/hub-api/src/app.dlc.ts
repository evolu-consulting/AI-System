// dlc-engine · gắn cổng Agent Hub vào cầu `dlcAgents` của gói `dlc` (khuôn `packRuns`): bước DLC của engine quy trình chạy agent
// trong hội thoại của lượt (`AgentCallService`) và sinh agent domain/QC (`SpawnService`, ghi qua service Studio ⇒ audit). Thay
// `mountDlcDify` (route `/dify/*` + vé flow cho flow quy trình DLC trên Dify — quy trình đã chuyển vào engine).
import type { Db } from "./lib/db";
import { dbHubAudit, type HubAuditWriter } from "./lib/hub-audit";
import type { Logger } from "./lib/logger";
import { AgentGrantsService } from "./modules/agent-grants/agent-grants.service";
import { AgentHooksService } from "./modules/agent-hooks/hooks.service";
import { AgentSettingsService } from "./modules/agent-settings/agent-settings.service";
import { AgentCallService } from "./modules/dlc-calls/agent-call.service";
import { agentHubPort } from "./modules/dlc-calls/agent-hub.port";
import type { PrepareMention } from "./modules/dlc-calls/ports";
import { SpawnService } from "./modules/dlc-calls/spawn.service";
import type { PacksMountDeps } from "./modules/packs/packs.mount";
import type { RunService } from "./modules/runs/runs.service";
import { AgentsService } from "./modules/studio/agents/agents.service";
import { EntitlementsService } from "./modules/studio/entitlements/entitlements.service";

export type DlcAgentsBridge = NonNullable<PacksMountDeps["dlcAgents"]>;

export function bindDlcAgents(
  bridge: DlcAgentsBridge | undefined,
  d: {
    db: Db;
    runs: RunService;
    prepareMention: PrepareMention;
    log: Logger;
    hubAudit?: HubAuditWriter;
    packTools?: { has(key: string): boolean };
  },
): void {
  if (!bridge) return;
  const audit = d.hubAudit ?? dbHubAudit;
  const calls = new AgentCallService({
    db: d.db,
    runs: d.runs,
    prepareMention: d.prepareMention,
    log: d.log,
  });
  const spawn = new SpawnService({
    db: d.db,
    agents: new AgentsService({ db: d.db, audit, packTools: d.packTools }),
    hooks: new AgentHooksService({ db: d.db, audit }),
    entitlements: new EntitlementsService({
      db: d.db,
      settings: new AgentSettingsService({ db: d.db, audit }),
    }),
    grants: new AgentGrantsService({ db: d.db, audit }),
    log: d.log,
  });
  bridge.port = agentHubPort({ db: d.db, calls, spawn });
}
