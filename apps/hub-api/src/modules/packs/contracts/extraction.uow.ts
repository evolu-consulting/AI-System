// Repo của gói Hợp đồng trong một tx cho lượt trích + duyệt (tách khỏi extraction.mount.ts, trần 400 dòng).
import type { Db } from "@ai/db";
import { createPackUow } from "../kit/public";
import { approvalRepo } from "./adapters/approval.repo";
import { approvalEngineRepo } from "./adapters/approval-engine.repo";
import { approvalFlowRepo } from "./adapters/approval-flow.repo";
import { sweepRepo } from "./adapters/approval-sweep.repo";
import { contractFlowRepo } from "./adapters/contract-flow.repo";
import { extractionRepo } from "./adapters/extraction.repo";
import { flowFactsRepo } from "./adapters/flow-facts.repo";
import { productLinksRepo } from "./adapters/product-links.repo";
import { reviewRepo } from "./adapters/review.repo";
import { CONTRACTS_PACK } from "./domain/contract-flow-events.rules";

export const packUow = (db: Db) =>
  createPackUow(db, CONTRACTS_PACK, (tx, tid) => ({
    extraction: extractionRepo(tx, tid),
    approval: approvalRepo(tx, tid),
    approvalFlow: approvalFlowRepo(tx, tid),
    approvalEngine: approvalEngineRepo(tx, tid),
    sweep: sweepRepo(tx, tid),
    review: reviewRepo(tx, tid),
    links: productLinksRepo(tx, tid),
    flowFacts: flowFactsRepo(tx, tid), // CR-121 D-1
    contractFlow: contractFlowRepo(tx, tid), // CR-122 A1
  }));
