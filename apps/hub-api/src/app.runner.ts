// HUB-FR-23 · HUB-FR-89 · H2a-R14 · dựng `AgentRunner` cho vòng Orchestrator (plan H2a §5.4): `RoutingRunner` chọn
// `JobAgentRunner` (`agentic-cli`, job `agent.cli` + MCP B8) hoặc `DifyAgentRunner` (`dify-*`). Tách khỏi `app.ts` (≤ 250 dòng);
// REVIEW 1 Hub #8: kèm `runDrivers` (driver Orchestrator/`direct`) + `startRunLoops` (lease, sweeper, orphan) từ `app.ts`.
import { DEFAULT_JOB_MAX_WAIT_S } from "./app.async";
import { chatToolTokens, runnerMcp } from "./app.mcp";
import { envDailyTokens } from "./lib/ai-client/ai-client.env";
import { pgUsageStore } from "./lib/ai-client/usage.pg";
import type { Db } from "./lib/db";
import type { Logger } from "./lib/logger";
import type { Redis } from "./lib/redis";
import { HookRunner } from "./modules/agent-hooks/hook-runner";
import { HookedRunner } from "./modules/agent-hooks/hooked-runner";
import { userTokens } from "./modules/agent-hooks/user-token";
import { DEFAULT_TENANT_TZ } from "./modules/config/config.rules";
import type { ConfigCache } from "./modules/config/config.service";
import { DifyAgentRunner } from "./modules/dify/agent/dify-agent-runner";
import { CredentialService, loadMasterKey } from "./modules/dify/credential.service";
import { DifyClient } from "./modules/dify/dify.client";
import { khPrepareJob } from "./modules/kh/kh.job";
import type { KhRuntime } from "./modules/kh/kh.mount";
import type { ChatToolTokens } from "./modules/mcp/chat-token";
import { directDriver } from "./modules/mention/direct-driver";
import { orchestratorDriver } from "./modules/orchestrator/orchestrator.service";
import type { PackToolCatalog } from "./modules/packs/kit/application/pack-tools.ports";
import { type AgentRunner, JobAgentRunner } from "./modules/runner/job/job-agent-runner";
import { startOrphanSweep } from "./modules/runner/orphan-sweep";
import { RoutingRunner } from "./modules/runner/routing-runner";
import { RunStreamReader } from "./modules/runner/run-stream-reader";
import { startLeaseLoop } from "./modules/runs/close/lease";
import { startLeaseSweeper } from "./modules/runs/close/sweeper";
import type { RunDriver } from "./modules/runs/runs.service";
import type { RunRegistry } from "./modules/runs/sse/sse-writer";
import { chatTokenGate } from "./modules/usage/chat-token-gate";

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
  /** K1 · client + cache project KH (`mountH4a`); vắng ⇒ job stage không có `kh-query`. */
  kh?: KhRuntime;
  /** M2-chat · cấp token tool chat ngắn hạn cho agent Dify (vắng ⇒ Dify không tool). */
  toolTokens?: Pick<ChatToolTokens, "grant" | "refreshHandle" | "newHandle">;
  /** dlc-dify · admin-api + token dịch vụ để hook agent xin access token thay user; vắng ⇒ `user_token` rỗng. */
  adminApiUrl?: string;
  internalToken?: string;
};

/** P-a N4 · `AgentRunner` cho job stage quy trình (dùng `RunStreamReader` riêng, cùng cấu hình runner chính). */
export function processAgentRunner(
  d: Omit<AgentRunnerDeps, "reader" | "maxWaitS"> & {
    redis: Redis;
    signal?: AbortSignal;
    jobMaxWaitS?: number;
  },
): AgentRunner {
  const reader = new RunStreamReader(d.redis, d.log, d.signal);
  return agentRunner({ ...d, reader, maxWaitS: d.jobMaxWaitS ?? DEFAULT_JOB_MAX_WAIT_S });
}

export function agentRunner(d: AgentRunnerDeps): AgentRunner {
  const job = new JobAgentRunner({
    db: d.db,
    owner: d.owner,
    reader: d.reader,
    maxWaitS: d.maxWaitS,
    log: d.log,
    mcp: runnerMcp(d.publicInternalUrl, d.config),
    kh: d.kh && khPrepareJob({ db: d.db, rt: d.kh, log: d.log }),
    // TD #252 · trần token tenant/ngày cho lượt chat (cùng trần + giữ chỗ với ai-client)
    tokenGate: chatTokenGate({ usage: pgUsageStore(d.db), cap: () => envDailyTokens() }),
    // "hôm nay" của agent chat theo lịch tenant (không theo đồng hồ UTC của máy chạy CLI)
    timeZoneOf: async (tid) => (await d.config.tenant(tid))?.timezone ?? DEFAULT_TENANT_TZ,
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
    ...(d.toolTokens ? { toolTokens: d.toolTokens } : {}),
  });
  const routed = new RoutingRunner({ job, dify });
  // dlc-dify · hook agent (SessionStart/UserPromptSubmit trước job, Stop sau) — agent không có hook ⇒ chuyển thẳng.
  const hooks = new HookRunner({
    db: d.db,
    catalog: () => d.config.catalog(),
    credentials,
    dify: new DifyClient(),
    log: d.log,
  });
  const tokens = userTokens({
    adminUrl: d.adminApiUrl,
    internalToken: d.internalToken,
    log: d.log,
  });
  return new HookedRunner(routed, { hooks, tokens, log: d.log });
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
  /** M2-chat · registry tool gói (token chat Dify). */
  packTools?: PackToolCatalog;
  adminApiUrl?: string;
  internalToken?: string;
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
    adminApiUrl: d.adminApiUrl,
    internalToken: d.internalToken,
    ...(d.packTools ? { toolTokens: chatToolTokens(d.redis, d.packTools) } : {}),
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
