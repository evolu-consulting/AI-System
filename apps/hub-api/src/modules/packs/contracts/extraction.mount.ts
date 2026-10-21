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
import { safeErrorFields } from "../../../lib/errors";
import { logger } from "../../../lib/logger";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import type { PackUow } from "../kit/application/ports";
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
  createInprocLimiter,
  INPROC_DEFAULT_CONCURRENCY,
  type InprocLimiter,
} from "./adapters/inproc-limit";
import { reviewRepo } from "./adapters/review.repo";
import { reviewRoutes } from "./adapters/review.routes";
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
  QUEUED_STALE_MINUTES,
  type SweepDeps,
  staleMinutesFor,
  startApprovalSweeper,
  sweepApprovalsOnce,
} from "./application/approval-sweep";
import { createManual } from "./application/create-manual.usecase";
import { handleExtractJob } from "./application/extract-job.usecase";
import type { SourceFileText, TaxRegistry } from "./application/extraction.ports";
import { createExtractionQueue, type ExtractionQueue } from "./application/extraction-queue";
import type { PatchApprovalGuard } from "./application/patch-fields.usecase";
import { requestExtract } from "./application/request-extract.usecase";
import type { ReviewTxRepos } from "./application/review.ports";
import { attachProduct, reviewSave } from "./application/review.usecase";
import { createRunExtraction, type ExtractionOutcome } from "./application/run-extraction.usecase";
import { createRefreshParties, type TaxRetryScheduler } from "./application/tax-parties";
import type { ExtractionStarter } from "./application/upload-contract.ports";
import { DEFAULT_TENANT_TZ, localDate } from "./domain/local-time.rules";

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
  /** M3 · D3-04 · PDF có lớp chữ ⇒ chữ (FileBox + unpdf); vắng ⇒ tệp đi thẳng agent (`AGENT_UNAVAILABLE`). */
  fileText?: SourceFileText;
  groups: ApprovalGroups;
  redis?: Redis;
  quota: ActionQuota;
  tenants: SweepDeps["tenants"];
  signal?: AbortSignal;
  /** V2-A · múi giờ tenant (ngày lịch cho mốc mặc định); vắng ⇒ múi mặc định. */
  timeZoneOf?: (tenantId: string) => Promise<string>;
};

/** `CONTRACTS_EXTRACT_TIMEOUT_S` (10–3600, mặc định 300) — trần một lượt AI (review Trung 2). */
function agentTimeoutMs(): number {
  const n = Number(process.env.CONTRACTS_EXTRACT_TIMEOUT_S);
  return (Number.isInteger(n) && n >= 10 && n <= 3600 ? n : 300) * 1000;
}
/** Entry treo trong PEL lâu hơn một lượt AI + 1' ⇒ instance khác nhận lại. */
const claimIdleMs = () => agentTimeoutMs() + 60_000;
const envInt = (k: string, def: number): number => {
  const n = Number(process.env[k]);
  return Number.isInteger(n) && n > 0 ? n : def;
};

/** Hàng đợi lượt đọc: Redis Streams (bền) hoặc, vắng Redis, chạy ngay trong tiến trình. AI chưa cấu hình (không khoá, không
 *  seam) ⇒ không xếp, không mở worker: HĐ giữ `extracting` tới vòng quét STALE (như HD1 khi chưa có AI). */
function extractJobs(
  db: Db,
  flow: ContractsFlowDeps,
  handle: (j: ExtractJob) => Promise<void>,
  o: { concurrency: number; ready: boolean },
) {
  if (!o.ready) {
    const jobs: ExtractJobs = { enqueue: async () => undefined };
    return { jobs, reclaimOnce: async () => 0 };
  }
  // TD #242 · job chạy trong tiến trình (vắng Redis / Redis sập) dùng chung một semaphore, cùng trần với worker.
  const inproc = createInprocLimiter(o.concurrency, (err) =>
    logger.warn("contract-extract-inproc-failed", safeErrorFields(err)),
  );
  if (!flow.redis) {
    const jobs: ExtractJobs = {
      enqueue: async (j) => void inproc.run(() => handle(j)),
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
    concurrency: o.concurrency,
    claimIdleMs: claimIdleMs(),
    log: logger,
    ...(flow.signal ? { signal: flow.signal } : {}),
  });
  s.start();
  return { jobs: withFallback(s, handle), reclaimOnce: s.reclaimOnce };
}

/** Review B #11 · XADD lỗi SAU commit (Redis down) ⇒ không trả 500 rồi kẹt 409 tới STALE: log + chạy job trong tiến trình
 *  (như chế độ vắng Redis; mất tính bền nhưng HĐ không kẹt). TD #242: qua semaphore `limit` (quá trần thì xếp hàng). */
export function withFallback(
  q: ExtractJobs,
  handle: (j: ExtractJob) => Promise<void>,
  log: { warn(msg: string, f?: Record<string, unknown>): void } = logger,
  limit: InprocLimiter = createInprocLimiter(INPROC_DEFAULT_CONCURRENCY, (err) =>
    log.warn("contract-extract-inproc-failed", safeErrorFields(err)),
  ),
): ExtractJobs {
  return {
    async enqueue(j) {
      try {
        await q.enqueue(j);
      } catch {
        log.warn("contract-extract-enqueue-failed", { contract_id: j.contractId });
        void limit.run(() => handle(j));
      }
    },
  };
}

type AiDeps = Omit<ContractsAiDeps, "tax"> & { tax: TaxRegistry | null };

const packUow = (db: Db) =>
  createPackUow(db, KEY, (tx, tid) => ({
    extraction: extractionRepo(tx, tid),
    approval: approvalRepo(tx, tid),
    sweep: sweepRepo(tx, tid),
    review: reviewRepo(tx, tid),
  }));

/** Lượt trích (agent + kiểm trích dẫn + tra MST hẹn giờ) và handler job của hàng đợi. */
function extractionRunner(d: AiDeps, flow: ContractsFlowDeps, pack: ReturnType<typeof packUow>) {
  const uow = packTenantOnly(pack);
  // Tra lại MST hẹn giờ (cổng Cục Thuế) — hàng trong tiến trình, chỉ cho việc `tax`.
  let taxQueue: ExtractionQueue | null = null;
  const schedule: TaxRetryScheduler = (...a) => taxQueue?.scheduleTaxRetry(...a);
  const transport =
    d.transport ??
    aiTransport(flow.ai, { model: process.env.CONTRACTS_EXTRACT_MODEL || EXTRACT_MODEL });
  const agent = createExtractionAgent(transport, { timeoutMs: agentTimeoutMs() });
  const verifier = createExtractionVerifier();
  const run = createRunExtraction({
    uow,
    agent,
    verifier,
    tax: d.tax,
    scheduleTaxRetry: schedule,
    // Seam HD2 (`transport`) giữ hành vi đã khoá: tệp đi thẳng agent. Chế độ flow: PDF có lớp chữ ⇒ chữ (D3-04).
    ...(flow.fileText && !d.transport ? { fileText: flow.fileText } : {}),
  });
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
  return { handle, schedule };
}

export function contractsAiModule(
  db: Db,
  view: PackAccessView,
  d: AiDeps,
  flow: ContractsFlowDeps,
): ContractsAi {
  const pack = packUow(db);
  const uow = packTenantOnly(pack);
  const { handle, schedule } = extractionRunner(d, flow, pack);
  const ready = d.transport !== undefined || flow.ai.ready;
  const { jobs, reclaimOnce } = extractJobs(db, flow, handle, {
    concurrency: d.concurrency ?? 2,
    ready,
  });
  // Review B #27/#28: quota + kiểm AI sẵn sàng của "Trích lại" chạy SAU `decide`, chỉ khi thật sự trích lại.
  const ad = { uow, groups: flow.groups, jobs, redo: { ready, quota: flow.quota } };
  const start = startApproval(ad);
  const tz = flow.timeZoneOf ?? (async () => DEFAULT_TENANT_TZ);
  const manual = createManual({
    uow,
    tax: d.tax,
    newId: () => Bun.randomUUIDv7(),
    today: async (tid) => localDate(new Date(), await tz(tid)), // V2-A: hạn mốc mặc định
    schedule,
  });
  const legacy = d.transport !== undefined;
  const legacyStarter: ExtractionStarter = {
    start: (who, id) => jobs.enqueue({ ...who, contractId: id, approvalId: null }),
  };
  const starter = legacy ? legacyStarter : flowStarter({ jobs, log: logger });
  startSweep(d, flow, pack, reclaimOnce);
  const routes = extractionRoutes(view, {
    requestExtract: legacy
      ? requestExtract({ uow, starter, available: true })
      : flowRequestExtract({ uow, jobs, ready: flow.ai.ready }),
    createManual: legacy ? manual : flowCreateManual(manual, start),
    quota: flow.quota,
  });
  routes.route("/", reviewModule(view, uow, tz));
  const approval = approvalRoutes(view, {
    get: getApproval(ad),
    act: actApproval(ad),
    readSettings: readApprovalSettings(ad),
    saveSettings: saveApprovalSettings(ad),
  });
  return { starter, routes, approval, guard: patchGuard(ad) };
}

/** V2-G: Lưu màn xác nhận (tenant tắt duyệt ⇒ `active` ngay) + gắn lại SP cho dòng HĐ đã lưu. */
function reviewModule(
  view: PackAccessView,
  uow: PackUow<ReviewTxRepos>,
  tz: (tenantId: string) => Promise<string>,
) {
  return reviewRoutes(view, {
    save: reviewSave({ uow, today: async (tid) => localDate(new Date(), await tz(tid)) }),
    attach: attachProduct({ uow }),
  });
}

/** Vòng quét (D3-09): hook test ⇒ không chạy nền; ngược lại mỗi `CONTRACTS_SWEEP_S` (mặc định 60 s). */
function startSweep(
  d: ContractsAiDeps,
  flow: ContractsFlowDeps,
  pack: SweepDeps["uow"],
  reclaimOnce: () => Promise<number>,
): void {
  const sd: SweepDeps = {
    uow: pack,
    tenants: flow.tenants,
    staleMinutes: staleMinutesFor(claimIdleMs()),
    queuedMinutes: envInt("CONTRACTS_QUEUE_STALE_MIN", QUEUED_STALE_MINUTES),
  };
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
