// CR-122 · A1 · FLOW2-FR-12/15/18/19 · nối gói Hợp đồng vào flow theo sự kiện lúc mount: cờ công ty (`ContractFlowGate`), `FactsReader`
// (dữ kiện HIỆN TẠI, tự lọc tenant) và `OutcomeHandler` (Đã duyệt / Từ chối / Trả lại, idempotent theo `(runId, outcome)`) đăng ký vào
// sổ của kit — engine tra theo `(contracts, sự kiện)`. Đăng ký lại ⇒ thay (mount chạy lại vô hại).
import type { Db, Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { withPackScope } from "@ai/db/pack-scope";
import { sql } from "drizzle-orm";
import { logger } from "../../../lib/logger";
import {
  type FactsReader,
  type FlowFacts,
  moduleRegistry,
  type OutcomeHandler,
} from "../kit/public";
import {
  applyContractOutcome,
  attachFlowRun,
  contractFlowRepo,
  markFlowNotLaunched,
} from "./adapters/contract-flow.repo";
import { creatorDepartmentsOf } from "./adapters/flow-facts.repo";
import { applyReceivedOutcome } from "./adapters/partner-inbox.repo";
import { type ContractFlowGate, FLOW_OFF, type FlowPrep } from "./application/contract-flow.ports";
import {
  CONTRACT_EVENTS,
  CONTRACTS_PACK,
  EV_APPROVED,
  EV_RECEIVED,
  EV_SUBMITTED,
  EV_UPLOADED,
  isContractOutcome,
  pickFacts,
} from "./domain/contract-flow-events.rules";

/** Cờ `hub.tenant_flow_settings.flow_triggers` (scope system hub; role gói không đọc bảng này) + phòng ban người gây sự kiện khi bật. */
export function contractFlowGate(db: Db): ContractFlowGate {
  const depts = creatorDepartmentsOf(db);
  return {
    async prepare(tenantId, userId): Promise<FlowPrep> {
      try {
        const [r] = await withHubScope(db, { kind: "system" }, (tx) =>
          tx.execute<{ on: boolean }>(
            sql`select exists (select 1 from hub.tenant_flow_settings
              where tenant_id = ${tenantId}::uuid and flow_triggers) as on`,
          ),
        );
        // Cờ tắt vẫn đọc phòng ban: app phát sự kiện để bộ điều phối ghi bóng (so với đường khe cũ), cờ chỉ quyết có mở lượt hay không.
        return { on: r?.on === true, departments: await depts(tenantId, userId) };
      } catch (e) {
        logger.warn("contract-flow-gate-failed", {
          error: e instanceof Error ? e.name : "unknown",
        });
        return FLOW_OFF;
      }
    },
  };
}

export function contractsFactsReader(db: Db): FactsReader {
  const depts = creatorDepartmentsOf(db);
  return {
    packKey: CONTRACTS_PACK,
    events: CONTRACT_EVENTS,
    async read(tenantId, ref, keys) {
      const r = await withPackScope(db, { packKey: CONTRACTS_PACK, tenantId, userId: null }, (tx) =>
        contractFlowRepo(tx, tenantId).readFacts(ref),
      );
      if (!r) return null;
      const all: Record<string, unknown> = { ...r.facts };
      if (keys.includes("creator_department") && r.startedBy) {
        const d = await depts(tenantId, r.startedBy);
        if (d.length > 0) all.creator_department = d;
      }
      return pickFacts(all, keys) as FlowFacts;
    },
  };
}

/** `contract.approved` / `contract.uploaded` không đổi HĐ (kết cục `done` / `accepted`); kết cục khác chưa hỗ trợ ⇒ ném (Cần xử lý). */
const NO_OP: Readonly<Record<string, string>> = {
  [EV_APPROVED]: "done",
  [EV_UPLOADED]: "accepted",
};

export function contractsOutcomeHandler(): OutcomeHandler<Tx> {
  return {
    packKey: CONTRACTS_PACK,
    events: CONTRACT_EVENTS,
    async apply(tx, input) {
      if (input.event === EV_SUBMITTED && isContractOutcome(input.outcome))
        return applyContractOutcome(tx, input, input.outcome);
      // CR-124 · q3 · Kết thúc flow NHẬN tự thành câu trả lời gửi về bên gửi (không node «Trả lời đối tác» riêng).
      if (input.event === EV_RECEIVED) return applyReceivedOutcome(tx, input);
      if (NO_OP[input.event] === input.outcome) return "applied";
      throw new Error(`contracts outcome chưa hỗ trợ: ${input.event} · ${input.outcome}`);
    },
    // CR-122 · P11 · lượt flow mở cho `contract.submitted` ⇒ gắn vào thẻ duyệt CÙNG tx tạo run (CAS).
    launched: (tx, input) =>
      input.event === EV_SUBMITTED ? attachFlowRun(tx, input) : Promise.resolve(true), // P11c · false = superseded
    // CR-122 · P11b · không mở được lượt ⇒ thẻ ghi lý do (không kẹt mãi "đang mở quy trình").
    notLaunched: (tx, input) =>
      input.event === EV_SUBMITTED ? markFlowNotLaunched(tx, input) : Promise.resolve(false),
  };
}

/** Gọi MỘT lần lúc mount gói Hợp đồng; trả cổng cờ cho các use case bắn sự kiện. */
export function mountContractFlow(db: Db): ContractFlowGate {
  moduleRegistry.bindEvent({
    facts: contractsFactsReader(db),
    outcome: contractsOutcomeHandler(),
  }); // CR-125 · m2 · đăng ký hộ `flowPortRegistry` (hành vi không đổi)
  return contractFlowGate(db);
}
