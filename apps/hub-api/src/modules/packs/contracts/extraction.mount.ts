// HD-FR-21…26 · HD-FR-31…37 · M3-decouple: nối trích + flow duyệt hợp đồng (lớp 4 của gói) — KHÔNG phụ thuộc engine quy trình.
// - Lượt AI đọc = job trên hàng đợi bền Redis Streams (vắng Redis ⇒ chạy ngay trong tiến trình) → lời gọi model trực tiếp qua AI
//   client chung (usage + trần theo tenant). Lời nhắc có rào + parse strict + kiểm trích dẫn của HD2 giữ nguyên.
// - Duyệt = máy trạng thái của gói (`contracts.approvals`); vòng quét đóng HĐ `extracting` quá hạn (STALE).
// - Seam `transport` (test HD2) ⇒ đường HD2: tải lên/trích lại chỉ xếp lượt đọc, không mở lượt duyệt (hành vi đã khoá).
// Tra MST (`TaxRegistry`) do `packs.mount.ts` tiêm từ `lib/` (gói không gọi HTTP — PK-AC12).
import { hostname } from "node:os";
import type { Db } from "@ai/db";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import type { Redis } from "ioredis";
import type { AiClient } from "../../../lib/ai-client/ai-client";
import { logger } from "../../../lib/logger";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import type { ActionQuota } from "./adapters/action-quota";
import { aiTransport, EXTRACT_MODEL } from "./adapters/ai-transport";
import { approvalRepo } from "./adapters/approval.repo";
import { approvalRoutes } from "./adapters/approval.routes";
import { sweepRepo } from "./adapters/approval-sweep.repo";
import { createExtractStream } from "./adapters/extract-stream.redis";
import { extractionRepo } from "./adapters/extraction.repo";
import { extractionRoutes } from "./adapters/extraction.routes";
import { type AgentTransport, createExtractionAgent } from "./adapters/extraction-agent";
import { createExtractionVerifier } from "./adapters/extraction-verifier";
import {
  type ApprovalGroups,
  actApproval,
  type ExtractJob,
  type ExtractJobs,
  getApproval,
  patchGuard,
  readApprovalSettings,
  saveApprovalSettings,
  startApproval,
} from "./application/approval.usecase";
import { flowCreateManual, flowRequestExtract, flowStarter } from "./application/approval-flow";
import {
  type SweepDeps,
  startApprovalSweeper,
  sweepApprovalsOnce,
} from "./application/approval-sweep";
import { createManual } from "./application/create-manual.usecase";
import { handleExtractJob } from "./application/extract-job.usecase";
import type { TaxRegistry } from "./application/extraction.ports";
import { createExtractionQueue, type ExtractionQueue } from "./application/extraction-queue";
import type { PatchApprovalGuard } from "./application/patch-fields.usecase";
import { requestExtract } from "./application/request-extract.usecase";
import { createRunExtraction, type ExtractionOutcome } from "./application/run-extraction.usecase";
import { createRefreshParties, type TaxRetryScheduler } from "./application/tax-parties";
import type { ExtractionStarter } from "./application/upload-contract.ports";

const KEY = "contracts";

/** Seam `PacksDeps.contractsAi` (test ↔ hub-api). */
export type ContractsAiDeps = {
  /** HD2 · transport giả ⇒ đường HD2 (không mở lượt duyệt). Vắng ⇒ chế độ flow (AI client chung). */
  transport?: AgentTransport;
  /** Vắng ⇒ `packs.mount.ts` dựng theo env `CONTRACTS_TAX_LOOKUP_URL`; null ⇒ không tra. */
  tax?: TaxRegistry | null;
  concurrency?: number;
  onSettled?: (contractId: string, outcome: ExtractionOutcome | "error") => void;
  /** M3 · test gọi lượt quét / nhận lại job trực tiếp (vòng quét nền tắt khi có hook). */
  onHandles?: (h: {
    sweepOnce: () => ReturnType<typeof sweepApprovalsOnce>;
    reclaimOnce: () => Promise<number>;
  }) => void;
};

export type ContractsAi = {
  starter: ExtractionStarter;
  routes: Hono<PackGuardVars>;
  approval: Hono<PackGuardVars>;
  /** Review S1 · seam cho PATCH trường (HD1): giai đoạn lượt duyệt. */
  guard: PatchApprovalGuard;
};
export type ContractsFlowDeps = {
  ai: AiClient;
  groups: ApprovalGroups;
  redis?: Redis;
  quota: ActionQuota;
  tenants: SweepDeps["tenants"];
  signal?: AbortSignal;
};

/** `CONTRACTS_EXTRACT_TIMEOUT_S` (10–3600, mặc định 300) — trần một lượt AI (review Trung 2). */
function agentTimeoutMs(): number {
  const n = Number(process.env.CONTRACTS_EXTRACT_TIMEOUT_S);
  return (Number.isInteger(n) && n >= 10 && n <= 3600 ? n : 300) * 1000;
}
const envInt = (k: string, def: number): number => {
  const n = Number(process.env[k]);
  return Number.isInteger(n) && n > 0 ? n : def;
};

/** Hàng đợi lượt đọc: Redis Streams (bền) hoặc, vắng Redis, chạy ngay trong tiến trình. */
function extractJobs(
  db: Db,
  flow: ContractsFlowDeps,
  handle: (j: ExtractJob) => Promise<void>,
  concurrency: number,
) {
  if (!flow.redis) {
    const jobs: ExtractJobs = {
      enqueue: async (j) => void handle(j),
    };
    return { jobs, reclaimOnce: async () => 0 };
  }
  const s = createExtractStream({
    redis: flow.redis,
    key: async () => {
      const [r] = await db.db.execute<{ d: string }>(sql`select current_database() as d`);
      return `contracts:extract:${r?.d ?? "db"}`;
    },
    consumer: `${hostname()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`,
    handle,
    concurrency,
    claimIdleMs: agentTimeoutMs() + 60_000,
    log: logger,
    ...(flow.signal ? { signal: flow.signal } : {}),
  });
  s.start();
  return { jobs: s as ExtractJobs, reclaimOnce: s.reclaimOnce };
}

export function contractsAiModule(
  db: Db,
  view: PackAccessView,
  d: Omit<ContractsAiDeps, "tax"> & { tax: TaxRegistry | null },
  flow: ContractsFlowDeps,
): ContractsAi {
  const pack = createPackUow(db, KEY, (tx, tid) => ({
    extraction: extractionRepo(tx, tid),
    approval: approvalRepo(tx, tid),
    sweep: sweepRepo(tx, tid),
  }));
  const uow = packTenantOnly(pack);
  // Tra lại MST hẹn giờ (cổng Cục Thuế) — hàng trong tiến trình, chỉ cho việc `tax`.
  let taxQueue: ExtractionQueue | null = null;
  const schedule: TaxRetryScheduler = (...a) => taxQueue?.scheduleTaxRetry(...a);
  const transport =
    d.transport ??
    aiTransport(flow.ai, { model: process.env.CONTRACTS_EXTRACT_MODEL || EXTRACT_MODEL });
  const agent = createExtractionAgent(transport, { timeoutMs: agentTimeoutMs() });
  const verifier = createExtractionVerifier();
  const run = createRunExtraction({ uow, agent, verifier, tax: d.tax, scheduleTaxRetry: schedule });
  taxQueue = createExtractionQueue({
    run,
    refresh: createRefreshParties({ uow, tax: d.tax, schedule }),
    log: logger,
  });
  const handle = handleExtractJob({
    run,
    uow,
    log: logger,
    ...(d.onSettled ? { onSettled: d.onSettled } : {}),
  });
  const { jobs, reclaimOnce } = extractJobs(db, flow, handle, d.concurrency ?? 2);
  const ad = { uow, groups: flow.groups, jobs };
  const start = startApproval(ad);
  const manual = createManual({ uow, tax: d.tax, newId: () => Bun.randomUUIDv7(), schedule });
  const legacy = d.transport !== undefined;
  const legacyStarter: ExtractionStarter = {
    start: (who, id) => jobs.enqueue({ ...who, contractId: id, approvalId: null }),
  };
  const starter = legacy ? legacyStarter : flowStarter({ start, jobs, log: logger });
  startSweep(d, flow, pack, reclaimOnce);
  const routes = extractionRoutes(view, {
    requestExtract: legacy
      ? requestExtract({ uow, starter, available: true })
      : flowRequestExtract({ uow, jobs }),
    createManual: legacy ? manual : flowCreateManual(manual, start),
    quota: flow.quota,
  });
  const approval = approvalRoutes(view, {
    get: getApproval(ad),
    act: actApproval(ad),
    readSettings: readApprovalSettings(ad),
    saveSettings: saveApprovalSettings(ad),
    quota: flow.quota,
  });
  return { starter, routes, approval, guard: patchGuard(ad) };
}

/** Vòng quét (D3-09): hook test ⇒ không chạy nền; ngược lại mỗi `CONTRACTS_SWEEP_S` (mặc định 60 s). */
function startSweep(
  d: ContractsAiDeps,
  flow: ContractsFlowDeps,
  pack: SweepDeps["uow"],
  reclaimOnce: () => Promise<number>,
): void {
  const sd: SweepDeps = { uow: pack, tenants: flow.tenants };
  if (d.onHandles) {
    d.onHandles({ sweepOnce: () => sweepApprovalsOnce(sd), reclaimOnce });
    return;
  }
  startApprovalSweeper({
    ...sd,
    everyMs: envInt("CONTRACTS_SWEEP_S", 60) * 1000,
    ...(flow.signal ? { signal: flow.signal } : {}),
    warn: (m) => logger.warn(m, {}),
  });
}
