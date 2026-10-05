// HUB-FR-23 · HUB-FR-89 · H2a-R14 · dựng `AgentRunner` cho vòng Orchestrator (plan H2a §5.4): `RoutingRunner` chọn
// `JobAgentRunner` (`agentic-cli`, job `agent.cli` + MCP B8) hoặc `DifyAgentRunner` (`dify-*`). Tách khỏi `app.ts` (≤ 250 dòng);
// REVIEW 1 Hub #8: kèm `runDrivers` (driver Orchestrator/`direct`) + `startRunLoops` (lease, sweeper, orphan) từ `app.ts`.
import { DEFAULT_JOB_MAX_WAIT_S } from "./app.async";
import { runnerMcp } from "./app.mcp";
import type { Db } from "./lib/db";
import type { Logger } from "./lib/logger";
import type { Redis } from "./lib/redis";
import type { ConfigCache } from "./modules/config/config.service";
import { DifyAgentRunner } from "./modules/dify/agent/dify-agent-runner";
import { CredentialService, loadMasterKey } from "./modules/dify/credential.service";
import { DifyClient } from "./modules/dify/dify.client";
import { directDriver } from "./modules/mention/direct-driver";
import { orchestratorDriver } from "./modules/orchestrator/orchestrator.service";
import { type AgentRunner, JobAgentRunner } from "./modules/runner/job/job-agent-runner";
import { startOrphanSweep } from "./modules/runner/orphan-sweep";
import { RoutingRunner } from "./modules/runner/routing-runner";
import { RunStreamReader } from "./modules/runner/run-stream-reader";
import { startLeaseLoop } from "./modules/runs/close/lease";
import { startLeaseSweeper } from "./modules/runs/close/sweeper";
import type { RunDriver } from "./modules/runs/runs.service";
import type { RunRegistry } from "./modules/runs/sse/sse-writer";

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

export type RunDriversDeps = {
  db: Db;
  redis: Redis;
  owner: string;
  config: ConfigCache;
  log: Logger;
  /** Test: mọi run đi driver này (không dựng runner). */
  runDriver?: RunDriver;
  jobMaxWaitS?: number;
  publicInternalUrl?: string;
  secretMasterKey?: string;
  signal?: AbortSignal;
};

/**
 * B8 · vòng Orchestrator (plan §6) chạy bước qua `RoutingRunner` (H1 §5.6 + H2a §5.4); dừng theo `signal`. H2b P10 ·
 * run `direct` dùng chung runner (một job agent, không Orchestrator). `runDriver` (test) → mọi run đi driver đó.
 */
export function runDrivers(d: RunDriversDeps): { driver: RunDriver; directDriver?: RunDriver } {
  if (d.runDriver) return { driver: d.runDriver };
  const runner = agentRunner({
    db: d.db,
    owner: d.owner,
    reader: new RunStreamReader(d.redis, d.log, d.signal),
    maxWaitS: d.jobMaxWaitS ?? DEFAULT_JOB_MAX_WAIT_S,
    config: d.config,
    log: d.log,
    publicInternalUrl: d.publicInternalUrl,
    secretMasterKey: d.secretMasterKey,
  });
  return {
    driver: orchestratorDriver({ db: d.db, runner, users: d.config, log: d.log }),
    directDriver: directDriver({ db: d.db, runner, log: d.log }),
  };
}

/** B10 · vòng nền của instance (plan §5.2 lease, §5.8 sweeper lease, plan-db §5.5 orphan); dừng khi `signal` abort. */
export function startRunLoops(d: {
  db: Db;
  redis: Redis;
  owner: string;
  registry: RunRegistry;
  log: Logger;
  signal?: AbortSignal;
}): void {
  startLeaseLoop(d);
  startLeaseSweeper(d);
  startOrphanSweep(d);
}
