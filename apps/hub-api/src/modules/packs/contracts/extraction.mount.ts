// HD-FR-21…26 · HD-FR-31…37 · M3-decouple: nối trích + flow duyệt hợp đồng (lớp 4 của gói) — KHÔNG phụ thuộc engine quy trình.
// - Lượt AI đọc = job trên hàng đợi bền Redis Streams (vắng Redis ⇒ chạy ngay trong tiến trình) → lời gọi model trực tiếp qua AI
//   client chung (usage + trần theo tenant). Lời nhắc có rào + parse strict + kiểm trích dẫn của HD2 giữ nguyên.
// - Duyệt = máy trạng thái của gói (`contracts.approvals`); vòng quét đóng HĐ `extracting` quá hạn (STALE).
// - Seam `transport` (test HD2) ⇒ đường HD2: tải lên/trích lại chỉ xếp lượt đọc, không mở lượt duyệt (hành vi đã khoá).
// Tra MST (`TaxRegistry`) do `packs.mount.ts` tiêm từ `lib/` (gói không gọi HTTP — PK-AC12).
import { hostname } from "node:os";
import type { Db } from "@ai/db";
import { sql } from "drizzle-orm";
import { safeErrorFields } from "../../../lib/errors";
import { logger } from "../../../lib/logger";
import type { PackAccessView, PackUow } from "../kit/public";
import { flowEngine, packTenantOnly } from "../kit/public";
import { aiMilestonesDoneHook } from "./adapters/ai-milestones.repo";
import { aiTransport, EXTRACT_MODEL } from "./adapters/ai-transport";
import { approvalRoutes } from "./adapters/approval.routes";
import { registerContractDoneHook } from "./adapters/contract-state.repo";
import { createExtractStream } from "./adapters/extract-stream.redis";
import { extractionRoutes } from "./adapters/extraction.routes";
import { createExtractionAgent } from "./adapters/extraction-agent";
import { createExtractionVerifier } from "./adapters/extraction-verifier";
import { withCreatorDepartments } from "./adapters/flow-facts.repo";
import {
  createInprocLimiter,
  INPROC_DEFAULT_CONCURRENCY,
  type InprocLimiter,
} from "./adapters/inproc-limit";
import { reviewRoutes } from "./adapters/review.routes";
import { submitRoutes } from "./adapters/submit.routes";
import {
  actApproval,
  type ExtractJob,
  type ExtractJobs,
  getApproval,
  readApprovalSettings,
  saveApprovalSettings,
} from "./application/approval.usecase";
import { recordEngineDecision, recordTaskEvents } from "./application/approval-decided.usecase";
import { flowRequestExtract, flowStarter } from "./application/approval-flow";
import type { ApprovalFlowTxRepos } from "./application/approval-flow.usecase";
import {
  QUEUED_STALE_MINUTES,
  type SweepDeps,
  staleMinutesFor,
  startApprovalSweeper,
  sweepApprovalsOnce,
} from "./application/approval-sweep";
import type { ContractFlowGate } from "./application/contract-flow.ports";
import { createManual } from "./application/create-manual.usecase";
import { handleExtractJob } from "./application/extract-job.usecase";
import type { TaxRegistry } from "./application/extraction.ports";
import { createExtractionQueue, type ExtractionQueue } from "./application/extraction-queue";
import {
  linkContractProducts,
  type ProductLinksTxRepos,
} from "./application/product-links.usecase";
import { requestExtract } from "./application/request-extract.usecase";
import type { ReviewTxRepos } from "./application/review.ports";
import { attachProduct, reviewSave } from "./application/review.usecase";
import { createRunExtraction } from "./application/run-extraction.usecase";
import {
  recreateContract,
  type SubmitTxRepos,
  submitContract,
  submitFlowOpen,
  submitPreview,
  withdrawContract,
} from "./application/submit.usecase";
import { createRefreshParties, type TaxRetryScheduler } from "./application/tax-parties";
import type { ExtractionStarter } from "./application/upload-contract.ports";
import { approvalEngine, flowTemplateRoutes } from "./approval.mount";
import { mountContractAccess } from "./contract-access.mount";
import { DEFAULT_TENANT_TZ, localDate } from "./domain/local-time.rules";
import type { ContractsAi, ContractsAiDeps, ContractsFlowDeps } from "./extraction.types";
import { packUow } from "./extraction.uow";
import { contractsFlowRoutes } from "./flow.mount";
import { mountContractFlow } from "./flow-events.mount";
import { bindUnsourcedContractEvents } from "./flow-unsourced-events.mount";
import { safeTimeZone } from "./reminders.mount";

// HD-FR-21…26 · HD-FR-31…37 · M3-decouple: nối trích + flow duyệt hợp đồng (lớp 4 của gói) — KHÔNG phụ thuộc engine quy trình.
// - Lượt AI đọc = job trên hàng đợi bền Redis Streams (vắng Redis ⇒ chạy ngay trong tiến trình) → lời gọi model trực tiếp qua AI
//   client chung (usage + trần theo tenant). Lời nhắc có rào + parse strict + kiểm trích dẫn của HD2 giữ nguyên.
// - Duyệt = máy trạng thái của gói (`contracts.approvals`); vòng quét đóng HĐ `extracting` quá hạn (STALE).
// - Seam `transport` (test HD2) ⇒ đường HD2: tải lên/trích lại chỉ xếp lượt đọc, không mở lượt duyệt (hành vi đã khoá).
// Tra MST (`TaxRegistry`) do `packs.mount.ts` tiêm từ `lib/` (gói không gọi HTTP — PK-AC12).

const _KEY = "contracts";

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

/** Lượt trích (agent + kiểm trích dẫn + tra MST hẹn giờ) và handler job của hàng đợi. */
function extractionRunner(d: AiDeps, flow: ContractsFlowDeps, pack: ReturnType<typeof packUow>) {
  const uow = packTenantOnly(pack);
  // Tra lại MST hẹn giờ (cổng Cục Thuế) — hàng trong tiến trình, chỉ cho việc `tax`.
  let taxQueue: ExtractionQueue | null = null;
  const schedule: TaxRetryScheduler = (...a) => taxQueue?.scheduleTaxRetry(...a);
  const transport =
    d.transport ??
    aiTransport(flow.ai, {
      model: process.env.CONTRACTS_EXTRACT_MODEL || EXTRACT_MODEL,
      ...(flow.fileBytes ? { files: flow.fileBytes } : {}), // CR-122 p9: scan/ảnh ⇒ tệp đính kèm lời gọi
    });
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
  // cr121-a2 · lượt mới luôn engine (không env, không cổng "đã gán"); seam test `approvalEngine: false` giữ máy cũ.
  const engOpts = { hd2: d.transport !== undefined, legacyMachine: d.approvalEngine === false };
  const gate = mountContractFlow(db, flow.timeZoneOf ? safeTimeZone(flow.timeZoneOf) : undefined); // CR-122 A1: cổng cờ + đăng ký FactsReader/OutcomeHandler
  registerContractDoneHook(aiMilestonesDoneHook, "mốc-AI"); // CR-127 K7 · HĐ vào DONE ⇒ lập mốc từ AI (BR-43)
  bindUnsourcedContractEvents(); // CR-127 B0: sự kiện manifest chưa có nguồn phát (tạm tới X2/X3/K6/E10)
  mountContractAccess(db); // CR-127 E3b: cổng kit `ContractAccess` (uỷ quyền / giao việc)
  const engFlow = { ...flow, groups: withCreatorDepartments(flow.groups, db), flowGate: gate }; // CR-121 D-1
  const eng = approvalEngine(engOpts, engFlow, uow, view);
  // [AUDIT] · quyết bước duyệt HĐ qua đường chung (Việc của tôi / chuông) ⇒ vẫn có dòng «Hồ sơ duyệt».
  if (eng && flow.engine)
    flow.engine.onDecided = { ...flow.engine.onDecided, contracts: recordEngineDecision(pack) };
  if (eng && flow.engine)
    flow.engine.onTaskEvents = { ...flow.engine.onTaskEvents, contracts: recordTaskEvents(pack) };
  const { handle, schedule } = extractionRunner(d, flow, pack);
  const ready = d.transport !== undefined || flow.ai.ready;
  const { jobs, reclaimOnce } = extractJobs(db, flow, handle, {
    concurrency: d.concurrency ?? 2,
    ready,
  });
  // Review B #27/#28: quota + kiểm AI sẵn sàng của "Trích lại" chạy SAU `decide`, chỉ khi thật sự trích lại.
  const redo = { ready, quota: flow.quota };
  const ad = {
    uow,
    groups: flow.groups,
    ...(eng
      ? {
          card: eng.card({
            port: () => flow.engine?.port,
            uow,
            jobs,
            redo,
            evidenceBytes: d.evidenceBytes, // CR-127 · E4b
            evidenceNames: d.evidenceNames, // CR-127 · U4b-3
          }),
        }
      : {}),
  };
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
  startSweep(d, flow, pack, reclaimOnce, eng);
  const routes = extractionRoutes(view, {
    requestExtract: legacy
      ? requestExtract({ uow, starter, available: true })
      : flowRequestExtract({ uow, jobs, ready: flow.ai.ready }),
    createManual: manual,
    quota: flow.quota,
  });
  routes.route("/", reviewModule(view, uow, tz, gate));
  const approval = approvalModule(view, { ad, uow, flow, db });
  return {
    submitFlowOpen: submitFlowOpen({ uow, gate, engine: flowEngine }), // CR-127 NF1
    starter,
    routes,
    approval,
    // CR-101 DOC-deals-fix: nâng giao dịch khi bật duyệt ⇒ mở lượt cấp 1 như nhập tay (engine nếu có entitlement, máy cũ nếu không).
    ...(eng ? { myApprovals: eng.myApprovals } : {}),
  };
}

/** Thẻ duyệt + cài đặt + mẫu luồng (S2; đồng bộ def engine khi cờ bật — S3a). */
function approvalModule(
  view: PackAccessView,
  o: {
    ad: Parameters<typeof getApproval>[0];
    uow: PackUow<ApprovalFlowTxRepos>;
    flow: ContractsFlowDeps;
    db: Db;
  },
) {
  const { ad, flow } = o;
  const [get, act] = [getApproval(ad), actApproval(ad)];
  const approval = approvalRoutes(view, {
    get,
    act,
    readSettings: readApprovalSettings(ad),
    saveSettings: saveApprovalSettings(ad),
    record: async (w, i) => (await ad.card?.record(w, i)) ?? null, // CR-127 · E4
    evidenceFile: async (w, i, e, f) => (await ad.card?.evidenceFile(w, i, e, f)) ?? null, // CR-127 · E4b
    recordPdf: async (w, i) => (await ad.card?.recordPdf(w, i)) ?? null, // CR-127 · U4b-3
  });
  approval.route("/", flowTemplateRoutes(view, o.uow, flow));
  const fr = contractsFlowRoutes(o.db, view, { get, act }); // CR-120 · mặc định bật; HUB_FLOW_RUNTIME=off = tắt route (404, không còn rollback web)
  if (fr) approval.route("/", fr);
  return approval;
}

/** V2-G: Lưu màn xác nhận (tenant tắt duyệt ⇒ `active` ngay) + gắn lại SP cho dòng HĐ đã lưu. */
function reviewModule(
  view: PackAccessView,
  uow: PackUow<ReviewTxRepos & ProductLinksTxRepos & SubmitTxRepos>,
  tz: (tenantId: string) => Promise<string>,
  gate: ContractFlowGate,
) {
  // CR-127 K3 · Gửi / Rút về / Tạo lại + "Xác nhận & lưu" = Gửi (cổng engine qua kit `flowEngine()`).
  const sub = { uow, gate, engine: flowEngine };
  const r = reviewRoutes(view, {
    save: reviewSave({
      uow,
      today: async (tid) => localDate(new Date(), await tz(tid)),
      submit: sub,
    }),
    attach: attachProduct({ uow }),
    link: linkContractProducts({ uow }),
  });
  r.route(
    "/",
    submitRoutes(view, {
      submit: submitContract(sub),
      withdraw: withdrawContract(sub),
      recreate: recreateContract(sub),
      preview: submitPreview(sub), // CR-127 · M4
    }),
  );
  return r;
}

/** Vòng quét (D3-09): hook test ⇒ không chạy nền; ngược lại mỗi `CONTRACTS_SWEEP_S` (mặc định 60 s). */
function startSweep(
  d: ContractsAiDeps,
  flow: ContractsFlowDeps,
  pack: SweepDeps["uow"],
  reclaimOnce: () => Promise<number>,
  eng: object | null,
): void {
  const sd: SweepDeps = {
    uow: pack,
    tenants: flow.tenants,
    staleMinutes: staleMinutesFor(claimIdleMs()),
    queuedMinutes: envInt("CONTRACTS_QUEUE_STALE_MIN", QUEUED_STALE_MINUTES),
    ...(eng ? { engine: { port: () => flow.engine?.port } } : {}),
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

export type { ContractsAi, ContractsAiDeps, ContractsFlowDeps } from "./extraction.types";
