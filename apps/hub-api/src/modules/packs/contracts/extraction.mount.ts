// HD-FR-21…26 · HD-FR-31…37 · D2-01 · D2-02 · D3-01 · HD2/HD3 plan: nối trích + flow duyệt hợp đồng (lớp 4 của gói).
// - Seam `transport` (test HD2) ⇒ đường HD2: hàng đợi trích trong tiến trình (giữ nguyên hành vi đã khoá).
// - Vắng seam (production, HD3) ⇒ chế độ flow: tải lên / nhập tay / trích lại mở run `contracts-approval` qua `PackRuns`; lượt
//   trích chạy trong stage tool `contracts-extract` với agent KHÔNG tool (#219), bền theo engine (#218); vòng quét hoà giải.
// Tra MST (`TaxRegistry`) do `packs.mount.ts` tiêm từ `lib/` (gói không gọi HTTP — PK-AC12).
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import { logger } from "../../../lib/logger";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import type { PackRunsBridge } from "../kit/application/pack-runs.ports";
import type { PackToolDef } from "../kit/application/pack-tools.ports";
import type { ActionQuota } from "./adapters/action-quota";
import { approvalRepo, sweepRepo } from "./adapters/approval.repo";
import { approvalRoutes } from "./adapters/approval.routes";
import { contractsTools } from "./adapters/contracts.tools";
import { extractionRepo } from "./adapters/extraction.repo";
import { extractionRoutes } from "./adapters/extraction.routes";
import { type AgentTransport, createExtractionAgent } from "./adapters/extraction-agent";
import { createExtractionVerifier } from "./adapters/extraction-verifier";
import {
  actApproval,
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
import type { ExtractionAgent, TaxRegistry } from "./application/extraction.ports";
import { createExtractionQueue, type ExtractionQueue } from "./application/extraction-queue";
import type { PatchApprovalGuard } from "./application/patch-fields.usecase";
import { requestExtract } from "./application/request-extract.usecase";
import { createRunExtraction, type ExtractionOutcome } from "./application/run-extraction.usecase";
import { createRefreshParties, type TaxRetryScheduler } from "./application/tax-parties";
import type { ExtractionStarter } from "./application/upload-contract.ports";

const KEY = "contracts";

/** Seam `PacksDeps.contractsAi` (test ↔ hub-api). */
export type ContractsAiDeps = {
  /** HD2 · transport giả ⇒ đường hàng đợi trong tiến trình (vắng ⇒ chế độ flow HD3). */
  transport?: AgentTransport;
  /** Vắng ⇒ `packs.mount.ts` dựng theo env `CONTRACTS_TAX_LOOKUP_URL`; null ⇒ không tra. */
  tax?: TaxRegistry | null;
  concurrency?: number;
  onSettled?: (contractId: string, outcome: ExtractionOutcome | "error") => void;
  /** HD3 · khoá agent trích (vắng ⇒ env `CONTRACTS_EXTRACT_AGENT` ?? `contracts-extractor`). */
  flowAgentKey?: string;
  /** HD3 · test gọi lượt quét trực tiếp (vòng nền tắt khi có hook). */
  onHandles?: (h: { sweepOnce: () => ReturnType<typeof sweepApprovalsOnce> }) => void;
};

export type ContractsAi = {
  starter: ExtractionStarter;
  routes: Hono<PackGuardVars>;
  approval: Hono<PackGuardVars>;
  /** Review S1 · seam cho PATCH trường (HD1): giai đoạn run + mở lại duyệt. */
  guard: PatchApprovalGuard;
};
export type ContractsFlowDeps = {
  bridge: PackRunsBridge;
  tools?: { register(t: PackToolDef): void };
  quota: ActionQuota;
  tenants: SweepDeps["tenants"];
  signal?: AbortSignal;
};

const noAgent: ExtractionAgent = {
  extract: async () => ({ ok: false, code: "AGENT_UNAVAILABLE" }),
};

/** `CONTRACTS_EXTRACT_TIMEOUT_S` (10–3600, mặc định 300) — trần một lượt agent (review Trung 2). */
function agentTimeoutMs(): number {
  const n = Number(process.env.CONTRACTS_EXTRACT_TIMEOUT_S);
  return (Number.isInteger(n) && n >= 10 && n <= 3600 ? n : 300) * 1000;
}
const envInt = (k: string, def: number): number => {
  const n = Number(process.env[k]);
  return Number.isInteger(n) && n > 0 ? n : def;
};

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
  const verifier = createExtractionVerifier();
  // Hàng đợi luôn có (tra lại MST cho cả nhập tay); lượt trích chỉ xếp hàng ở đường HD2 (seam).
  let queue: ExtractionQueue | null = null;
  const schedule: TaxRetryScheduler = (...a) => queue?.scheduleTaxRetry(...a);
  const runWith = (agent: ExtractionAgent) =>
    createRunExtraction({ uow, agent, verifier, tax: d.tax, scheduleTaxRetry: schedule });
  const agent = d.transport
    ? createExtractionAgent(d.transport, { timeoutMs: agentTimeoutMs() })
    : noAgent;
  queue = createExtractionQueue({
    run: runWith(agent),
    refresh: createRefreshParties({ uow, tax: d.tax, schedule }),
    concurrency: d.concurrency ?? 2,
    log: logger,
    ...(d.onSettled ? { onSettled: d.onSettled } : {}),
  });
  const warn = (m: string, meta: Record<string, unknown>) => logger.warn(m, meta);
  const ad = { bridge: flow.bridge, uow, warn };
  const start = startApproval(ad);
  const manual = createManual({ uow, tax: d.tax, newId: () => Bun.randomUUIDv7(), schedule });
  const starter = d.transport ? queue : flowStarter({ start, uow, log: logger });
  if (!d.transport) {
    const agentKey = d.flowAgentKey ?? process.env.CONTRACTS_EXTRACT_AGENT ?? "contracts-extractor";
    const makeAgent = (t: AgentTransport) =>
      createExtractionAgent(t, { timeoutMs: agentTimeoutMs() });
    const tools = contractsTools({
      bridge: flow.bridge,
      uow,
      agentKey,
      runExtraction: runWith,
      makeAgent,
    });
    for (const t of tools) flow.tools?.register(t);
    startSweep(d, flow, pack, patchGuard(ad).restart);
  }
  const routes = extractionRoutes(view, {
    requestExtract: d.transport
      ? requestExtract({ uow, starter, available: true })
      : flowRequestExtract({ start, uow }),
    createManual: d.transport ? manual : flowCreateManual(manual, starter),
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

/** Vòng quét flow (D3-09): hook test ⇒ không chạy nền; ngược lại mỗi `CONTRACTS_SWEEP_S` (mặc định 60 s). */
function startSweep(
  d: ContractsAiDeps,
  flow: ContractsFlowDeps,
  pack: SweepDeps["uow"],
  restart: NonNullable<SweepDeps["restart"]>,
): void {
  const sd: SweepDeps = { uow: pack, bridge: flow.bridge, tenants: flow.tenants, restart };
  if (d.onHandles) {
    d.onHandles({ sweepOnce: () => sweepApprovalsOnce(sd) });
    return;
  }
  startApprovalSweeper({
    ...sd,
    everyMs: envInt("CONTRACTS_SWEEP_S", 60) * 1000,
    ...(flow.signal ? { signal: flow.signal } : {}),
    warn: (m) => logger.warn(m, {}),
  });
}
