// HUB-NFR-04 · tách từ app.ts (CR-127 R1 #3): dây nối phụ thuộc của app hub (github endpoint, seams, labeler, driver lệnh, hook quy trình).

import { hostname } from "node:os";
import type { Hono } from "hono";
import type { AppVars } from "./app";
import { workflowJobs } from "./app.async";
import type { AppDeps } from "./app.deps";
import { commandDriverFor } from "./app.h2a";
import { sharedWorkflowInvoker } from "./app.mcp";
import { processAgentRunner } from "./app.runner";
import type { X2aMounted } from "./app.x2a";
import type { AuthUser } from "./lib/auth.middleware";
import type { Db } from "./lib/db";
import { logger } from "./lib/logger";
import type { ConfigCache } from "./modules/config/public";
import type { KhRuntime } from "./modules/kh/kh.mount";
import type { ContextLabeler } from "./modules/packs/kit/public";
import { checkPackAccess, packAccessInput, registerFlowEngine } from "./modules/packs/kit/public";
import { bridgeAgentOf } from "./modules/processes/bridge/bridge.mount";
import type { ProcessStartPort } from "./modules/processes/core/ports";
import {
  mountProcesses,
  type ProcessMountDeps,
  type ProcessSeams,
} from "./modules/processes/processes.mount";
import { resolveProcessRoutes } from "./modules/processes/routes-mode";
import { HubSecretReader } from "./modules/secrets/secrets.use";
import type { ResolveBridge } from "./modules/sources/resolve.bridge";

/** P-c2 · C13 · endpoint GitHub: seam `deps.github` ưu tiên; ngược lại env `HUB_GITHUB_*` (vắng ⇒ undefined ⇒ không mở PR). */
export function githubEndpointOf(deps: AppDeps): { apiUrl: string; webHost: string } | undefined {
  if (deps.github) return deps.github;
  const apiUrl = process.env.HUB_GITHUB_API_URL;
  const webHost = process.env.HUB_GITHUB_WEB_HOST;
  return apiUrl && webHost ? { apiUrl, webHost } : undefined;
}

/** Seam N3 (plan-contract §7.1) chuyển nguyên cho module quy trình. */
export const seamsOf = (d: AppDeps): ProcessSeams => ({
  processRunsPerTenant: d.processRunsPerTenant,
  stageLauncher: d.stageLauncher,
  now: d.now,
  processLoops: d.processLoops,
  processTimerBatch: d.processTimerBatch, // CR-115
  onProcessHandles: d.onProcessHandles,
  ...{ packRuns: d.packRuns, packTools: d.packTools }, // N2-FR-01/03
});

/** one-agent · cổng nhãn ngữ cảnh từ registry tool gói (vắng ⇒ không nhắc bản ghi). */
export const contextLabelerOf = (t: AppDeps["packTools"]): ContextLabeler | undefined => {
  const f = t?.contextLabel;
  return f && t ? { contextLabel: f.bind(t) } : undefined;
};

/** chat-api-gate · dock trợ lý mở cho user có quyền `read` gói của dock (`contracts` = Sổ Hợp Tác, `community` = com-c10b;
 *  cùng luật cổng gói, đọc cache). */
export const contractsReader =
  (config: ConfigCache) =>
  async (u: AuthUser, surface: "contracts" | "community"): Promise<boolean> => {
    const i = await packAccessInput(config, surface, u);
    return checkPackAccess({ ...i, grantedGroupIds: i.grantedByAction.read }) === "ok";
  };

/** `runs.owner` của instance (= `HUB_INSTANCE_ID`; test khung vắng → host:pid). */
export const instanceOwner = (deps: AppDeps): string =>
  deps.instanceId ?? `${hostname()}:${process.pid}`;

/** H2a · driver lệnh `/` (B5 sync Dify, B6 async qua job `workflow.async`). */
export function commandDrivers(deps: AppDeps, db: Db) {
  return commandDriverFor({
    db,
    log: logger,
    secretMasterKey: deps.secretMasterKey,
    storage: deps.attachments?.storage,
    jobs: workflowJobs({ ...deps, db, owner: instanceOwner(deps), log: logger }),
  });
}

/** P-a D15 · cờ bật: module quy trình + runner stage (N4) + nối `!` vào phòng (T1/T7); trả cổng `!` Hỏi AI (D14). */
export function processHooks(
  app: Hono<AppVars>,
  deps: AppDeps,
  m: Omit<ProcessMountDeps, keyof ProcessSeams | "runner"> & {
    config: ConfigCache;
    messages: X2aMounted["messages"];
    resolveBridge?: ResolveBridge;
    kh?: KhRuntime;
  },
): ProcessStartPort | undefined {
  // CR-127 NF1b · không có engine ⇒ xoá cổng engine của gói (sổ kit là biến module): app dựng TRƯỚC trong cùng tiến trình (test) có thể đã
  // đăng ký engine với DB đã đóng ⇒ Gửi / `submit_block` gọi vào đó ⇒ 500 CONNECTION_ENDED.
  if (!deps.processEngine) {
    registerFlowEngine(null);
    return undefined;
  }
  const runner = processAgentRunner({ ...deps, ...m, kh: m.kh, owner: instanceOwner(deps) });
  const proc = mountProcesses(app, {
    ...m,
    runner,
    signal: deps.signal,
    ...seamsOf(deps),
    resolveBridge: m.resolveBridge,
    workflowInvoker: sharedWorkflowInvoker({ ...deps, ...m }), // P-d2 · D2-02 · chung với `/mcp`
    // P-c2 · C13 · endpoint GitHub (seam ưu tiên env) + reader khoá nguồn cho driver stage Áp (mở PR).
    github: githubEndpointOf(deps),
    internalToken: deps.internalToken, // CR-105 · L5
    partnerMailbox: deps.partnerMailbox === true, // CR-124 · q1 · bộ chuyển hộp thư liên công ty
    bridgeAgent: bridgeAgentOf(m), // CR-122 · N2 · "Gợi ý cầu nối" qua agent Hub `flow-bridge`
    publicRoutes: resolveProcessRoutes(deps), // F1 · CR-103 · off | admin (chỉ admin-web) | all
    secrets: new HubSecretReader({ db: m.db, key: deps.hubSecretsKey ?? null, log: logger }),
  });
  m.messages.useProcesses(proc.roomSender);
  return proc.conversationStart;
}
