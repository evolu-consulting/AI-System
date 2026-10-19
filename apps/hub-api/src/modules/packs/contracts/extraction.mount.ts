// HD-FR-21…26 · D2-01 · D2-02 · HD2 plan: nối trích hợp đồng (lớp 4 của gói): `PackUow` (role `contracts_rw`) + agent trích
// (`AgentTransport` tiêm — N2/HD3 nối run Hub; vắng ⇒ không chạy lượt trích: tải lên giữ hành vi HD1 (`extracting`), trích lại
// 503 `AGENT_UNAVAILABLE`) + tra MST (`TaxRegistry` do `packs.mount.ts` tiêm từ `lib/`, gói không gọi HTTP — PK-AC12) + hàng
// đợi trích (thay `ExtractionStarter` no-op HD1) + route trích lại / nhập tay.
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import { logger } from "../../../lib/logger";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import { extractionRepo } from "./adapters/extraction.repo";
import { extractionRoutes } from "./adapters/extraction.routes";
import { type AgentTransport, createExtractionAgent } from "./adapters/extraction-agent";
import { createManual } from "./application/create-manual.usecase";
import type { TaxRegistry } from "./application/extraction.ports";
import { createExtractionQueue } from "./application/extraction-queue";
import { requestExtract } from "./application/request-extract.usecase";
import { createRunExtraction, type ExtractionOutcome } from "./application/run-extraction.usecase";
import type { ExtractionStarter } from "./application/upload-contract.ports";

const KEY = "contracts";

/** Seam `PacksDeps.contractsAi` (test ↔ hub-api; N2 tiêm transport run Hub). */
export type ContractsAiDeps = {
  transport?: AgentTransport;
  /** Vắng ⇒ `packs.mount.ts` dựng theo env `CONTRACTS_TAX_LOOKUP_URL`; null ⇒ không tra. */
  tax?: TaxRegistry | null;
  concurrency?: number;
  onSettled?: (contractId: string, outcome: ExtractionOutcome | "error") => void;
};

export type ContractsAi = { starter: ExtractionStarter; routes: Hono<PackGuardVars> };

/** Chưa có agent: không xếp hàng gì (HĐ ở `extracting` như HD1). */
const idleStarter: ExtractionStarter = { start: async () => {} };

export function contractsAiModule(
  db: Db,
  view: PackAccessView,
  d: Omit<ContractsAiDeps, "tax"> & { tax: TaxRegistry | null },
): ContractsAi {
  const uow = packTenantOnly(
    createPackUow(db, KEY, (tx, tid) => ({ extraction: extractionRepo(tx, tid) })),
  );
  const starter = d.transport
    ? createExtractionQueue({
        run: createRunExtraction({ uow, agent: createExtractionAgent(d.transport), tax: d.tax }),
        concurrency: d.concurrency ?? 2,
        log: logger,
        ...(d.onSettled ? { onSettled: d.onSettled } : {}),
      })
    : idleStarter;
  if (!d.transport) logger.warn("contract-extraction-agent-not-configured", {});
  const routes = extractionRoutes(view, {
    requestExtract: requestExtract({ uow, starter, available: !!d.transport }),
    createManual: createManual({ uow, tax: d.tax, newId: () => Bun.randomUUIDv7() }),
  });
  return { starter, routes };
}
