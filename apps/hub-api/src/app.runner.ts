// HUB-FR-23 · HUB-FR-89 · H2a-R14 · dựng `AgentRunner` cho vòng Orchestrator (plan H2a §5.4): `RoutingRunner` chọn
// `JobAgentRunner` (`agentic-cli`, job `agent.cli` + MCP B8) hoặc `DifyAgentRunner` (`dify-*`). Tách khỏi `app.ts` (≤ 250 dòng).
import { runnerMcp } from "./app.mcp";
import type { Db } from "./lib/db";
import type { Logger } from "./lib/logger";
import type { ConfigCache } from "./modules/config/config.service";
import { CredentialService, loadMasterKey } from "./modules/dify/credential.service";
import { DifyClient } from "./modules/dify/dify.client";
import { DifyAgentRunner } from "./modules/dify/dify-agent-runner";
import { type AgentRunner, JobAgentRunner } from "./modules/runner/job-agent-runner";
import { RoutingRunner } from "./modules/runner/routing-runner";
import type { RunStreamReader } from "./modules/runner/run-stream-reader";

export type AgentRunnerDeps = {
  db: Db;
  /** = `HUB_INSTANCE_ID`. */
  owner: string;
  reader: RunStreamReader;
  /** = `HUB_JOB_MAX_WAIT_S`. */
  maxWaitS: number;
  config: ConfigCache;
  log: Logger;
  /** = `HUB_PUBLIC_INTERNAL_URL` (MCP của job `agent.cli`). */
  publicInternalUrl?: string;
  /** = `SECRET_MASTER_KEY`; vắng → agent `dify-*` `NOT_CONFIGURED`. */
  secretMasterKey?: string;
};

export function agentRunner(d: AgentRunnerDeps): AgentRunner {
  const job = new JobAgentRunner({
    db: d.db,
    owner: d.owner,
    reader: d.reader,
    maxWaitS: d.maxWaitS,
    log: d.log,
    mcp: runnerMcp(d.publicInternalUrl, d.config),
  });
  const credentials = new CredentialService({
    db: d.db,
    masterKey: loadMasterKey(d.secretMasterKey),
    log: d.log,
  });
  const dify = new DifyAgentRunner({
    db: d.db,
    owner: d.owner,
    catalog: () => d.config.catalog(),
    currentTimeoutS: async (id) =>
      (await d.config.snapshot()).agents.find((a) => a.id === id)?.timeoutS,
    credentials,
    dify: new DifyClient(),
    log: d.log,
  });
  return new RoutingRunner({ job, dify });
}
