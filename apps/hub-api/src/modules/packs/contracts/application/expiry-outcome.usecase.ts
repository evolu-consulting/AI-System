// CR-127 · SG1 · BR-67/68 · spec §4.1 `POST /contracts/:id/expiry-outcome`: người phụ trách ∪ trưởng phòng của họ ∪ quản trị công ty quyết kết cục của HĐ ĐÃ DUYỆT
// sắp hết hạn (Gia hạn / Chấm dứt / Để hết hạn). Dùng lại logic kết cục của quy trình `contract.expiring` (K6, `applyExpiringOutcome`) — không chép luật.
// Công ty có quy trình `contract.expiring` khớp HĐ ⇒ 409 (quyết trong việc của quy trình). Lớp 2: không SQL; MỘT tx `PackUow`.
import type {
  ExpiryOutcome,
  ExpiryOutcomeOut,
  ExpiryOutcomeRequest,
} from "@ai/contracts/pack-contracts";
import type { PackUow, PackWho } from "../../kit/public";
import type { ExecRepo } from "../adapters/exec-requests.repo";
import type { ExpiringEvidence, ExpiringResult } from "../adapters/expiring-outcome.repo";
import { ExecFail, type ExecWho } from "./exec-request.usecase";

export type ExpiryFailKind = "not_found" | "forbidden" | "not_allowed" | "in_flow" | "decided";
export class ExpiryFail extends Error {
  constructor(readonly kind: ExpiryFailKind) {
    super(kind);
  }
}

export type ExpiryRepos = {
  exec: Pick<ExecRepo, "lockContract">;
  expiry: {
    apply(i: {
      ref: string;
      actorId: string;
      outcome: ExpiryOutcome;
      evidence: ExpiringEvidence;
    }): Promise<{ result: ExpiringResult; renewalId: string | null }>;
    facts(ref: string, today: string): Promise<Record<string, unknown>>;
  };
};
export type ExpiryDeps = {
  uow: PackUow<ExpiryRepos>;
  /** Có quy trình `contract.expiring` khớp dữ kiện HĐ? (engine `FlowAvailability`; chưa có engine ⇒ false). */
  hasFlow(q: {
    tenantId: string;
    facts: Record<string, string | number | boolean>;
  }): Promise<boolean>;
  /** Người gọi là người phụ trách ∪ trưởng phòng của họ ∪ quản trị công ty? (cùng luật `can.hold` — `holdRoleOk`). */
  roleOk(who: PackWho, c: { owner: string | null; created_by: string }): Promise<boolean>;
  today(tenantId: string): Promise<string>;
};

const asFacts = (f: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(f).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v)),
  ) as Record<string, string | number | boolean>;

/** HĐ cho phép chốt kết cục: đã duyệt, bản hiện hành, hiệu lực "sắp hết hạn" (chưa Gia hạn / Chấm dứt). */
export const expiryStateOk = (c: { status: string; superseded: boolean; effect: string | null }) =>
  c.status === "done" && !c.superseded && c.effect === "expiring";

/** Đã có kết cục ⇒ `decided`; chưa "sắp hết hạn" / không phải bản hiện hành đã duyệt ⇒ `not_allowed`. */
function assertOpen(c: { status: string; superseded: boolean; effect: string | null }): void {
  if (c.effect === "renewed" || c.effect === "terminated") throw new ExpiryFail("decided");
  if (!expiryStateOk(c)) throw new ExpiryFail("not_allowed");
}

/** "Có quy trình khớp?" cho MỘT HĐ (một lần đọc dữ kiện + engine) — dùng chung cho lệnh và `can.expiry` của chi tiết. */
export const expiryFlowOpen =
  (d: Pick<ExpiryDeps, "uow" | "hasFlow" | "today">) =>
  async (who: PackWho, id: string): Promise<boolean> => {
    const today = await d.today(who.tenantId);
    const facts = await d.uow.tenant(who, (r) => r.expiry.facts(id, today));
    return d.hasFlow({ tenantId: who.tenantId, facts: asFacts(facts) });
  };

export function expiryCommands(d: ExpiryDeps) {
  const flowOpen = expiryFlowOpen(d);
  return async (who: ExecWho, id: string, b: ExpiryOutcomeRequest): Promise<ExpiryOutcomeOut> => {
    // Đọc + kiểm vai/trạng thái; quy trình khớp kiểm NGOÀI tx (engine tự mở kết nối).
    const head = await d.uow.tenant(who, async (r) => {
      const c = await r.exec.lockContract(id);
      if (!c) throw new ExpiryFail("not_found");
      if (!who.admin && !(await d.roleOk(who, { owner: c.owner, created_by: c.created_by })))
        throw new ExpiryFail("forbidden");
      assertOpen(c);
      return c;
    });
    if (!b.evidence?.note.trim()) throw new ExecFail("evidence_required");
    if (await flowOpen(who, head.id)) throw new ExpiryFail("in_flow");
    const evidence = b.evidence;
    return d.uow.tenant(who, async (r) => {
      const c = await r.exec.lockContract(id); // khoá lại: trạng thái có thể đổi giữa hai tx
      if (!c) throw new ExpiryFail("not_found");
      assertOpen(c);
      const out = await r.expiry.apply({
        ref: id,
        actorId: who.userId,
        outcome: b.outcome,
        evidence,
      });
      if (out.result === "not_found") throw new ExpiryFail("not_allowed");
      if (out.result === "already_applied") throw new ExpiryFail("decided");
      return { state: "applied", renewal_id: out.renewalId };
    });
  };
}
export type ExpiryCommand = ReturnType<typeof expiryCommands>;
