// CR-127 · X4 · spec §4.1, §6 "Phạt", BR-56: phạt chậm của mốc trễ. Đọc: phạt ước tính theo điều khoản (`penalty.rules`). Ghi: `book` (Ghi vào công
// nợ — mốc `kind='penalty'` đúng chiều) hoặc `waive` (Miễn phạt, bằng chứng bắt buộc); quyết MỘT lần (409). Không tự trừ tiền. Vai = người phụ trách
// HĐ ∪ quản trị công ty (như yêu cầu thay đổi X3). Mỗi lệnh MỘT tx `PackUow`: khoá HĐ → khoá mốc → luật thuần → ghi. Lớp 2: không SQL.
import type { PenaltyDecision, PenaltyOut, PenaltyView } from "@ai/contracts/pack-contracts";
import type { PackUow, PackWho } from "../../kit/public";
import type { PenaltyEvidence, PenaltyOb, PenaltyRepo } from "../adapters/penalty.repo";
import { mayChange } from "../domain/exec-request.rules";
import {
  lateDays,
  noEstimateReason,
  penaltyApplies,
  penaltyEstimate,
} from "../domain/penalty.rules";

export type PenaltyFailKind =
  | "not_found"
  | "forbidden"
  | "decided"
  | "not_applicable"
  | "change_pending"
  | "over_cap"
  | "evidence_required";
export class PenaltyFail extends Error {
  constructor(readonly kind: PenaltyFailKind) {
    super(kind);
  }
}

export type PenaltyRepos = { penalty: PenaltyRepo };
export type PenaltyWho = PackWho & { admin: boolean };
export type PenaltyDeps = {
  uow: PackUow<PenaltyRepos>;
  today(tenantId: string): Promise<string>;
  /** `userId` là trưởng của phòng nào đó có `ownerId` là thành viên? (cùng cách X3 — `exec-head.repo`). */
  headOf(tenantId: string, ownerId: string, userId: string): Promise<boolean>;
};

const viewOf = (
  ob: PenaltyOb,
  terms: Parameters<typeof penaltyEstimate>[0],
  value: number | null,
  today: string,
): PenaltyView => {
  const e = penaltyEstimate(terms, ob, value, today);
  return {
    obligation_id: ob.id,
    days_late: lateDays(ob, today),
    estimate: e
      ? {
          amount: e.amount,
          uncapped: e.uncapped,
          capped: e.capped,
          basis: e.basis,
          term_id: e.term_id,
          cap: e.cap,
        }
      : null,
    reason: e ? null : noEstimateReason(terms, ob, today),
    direction: ob.owner === "partner" ? "receive" : "pay",
    decision: ob.penalty_decision,
    penalty_obligation_id: ob.penalty_obligation_id,
  };
};

/** Số ghi khác phạt ước tính (hoặc không có ước tính) cần lý do; không vượt trần điều khoản. */
function checkBook(
  amount: number,
  est: { amount: number; cap: number | null } | null,
  hasEvidence: boolean,
): void {
  if (est?.cap != null && amount > est.cap) throw new PenaltyFail("over_cap");
  if ((!est || amount !== est.amount) && !hasEvidence) throw new PenaltyFail("evidence_required");
}

export function penaltyCommands(d: PenaltyDeps) {
  /** `GET /contracts/:id/penalties`: phạt ước tính + quyết định của mọi mốc trễ (2 câu SQL + 1 câu HĐ, không phụ thuộc số mốc). */
  const list = async (who: PackWho, contractId: string): Promise<PenaltyView[]> => {
    const today = await d.today(who.tenantId);
    return d.uow.tenant(who, async ({ penalty: r }) => {
      const c = await r.valueOf(contractId);
      if (!c) throw new PenaltyFail("not_found");
      const late = await r.lateOf(contractId, today);
      if (late.length === 0) return [];
      const terms = await r.terms(contractId);
      return late.map((o) => viewOf(o, terms, c.v, today));
    });
  };

  /** Khoá HĐ → khoá mốc; vai; chưa quyết; đã trễ. */
  const guard = async (
    r: PenaltyRepo,
    who: PenaltyWho,
    obligationId: string,
    today: string,
  ): Promise<PenaltyOb> => {
    const c = await r.lockContractOf(obligationId);
    if (!c) throw new PenaltyFail("not_found");
    const actor = {
      userId: who.userId,
      owner: c.owner,
      createdBy: c.created_by,
      head: false,
      admin: who.admin,
    };
    const owner = c.owner ?? c.created_by;
    if (!mayChange(actor) && !(await d.headOf(who.tenantId, owner, who.userId)))
      throw new PenaltyFail("forbidden");
    const ob = await r.lockOb(obligationId);
    if (!ob) throw new PenaltyFail("not_found");
    if (ob.penalty_decision !== null) throw new PenaltyFail("decided");
    if (ob.pending) throw new PenaltyFail("change_pending");
    if (!penaltyApplies(ob) || lateDays(ob, today) === 0) throw new PenaltyFail("not_applicable");
    return ob;
  };

  /** Phạt ước tính của mốc lúc quyết (null ⇒ không có). */
  const estimateOf = async (r: PenaltyRepo, ob: PenaltyOb, today: string) => {
    const c = await r.valueOf(ob.contract_id);
    const est = penaltyEstimate(await r.terms(ob.contract_id), ob, c?.v ?? null, today);
    return est ? { ...est } : null;
  };

  /** Ghi quyết định (đã qua `guard`). `null` từ repo ⇒ có người quyết trước (CAS). */
  const write = async (
    r: PenaltyRepo,
    who: PenaltyWho,
    ob: PenaltyOb,
    b: PenaltyDecision,
    today: string,
  ): Promise<PenaltyOut> => {
    const note = b.evidence?.note.trim();
    const evidence: PenaltyEvidence | null = note ? { ...b.evidence, note } : null;
    if (b.decision === "waive") {
      if (!evidence) throw new PenaltyFail("evidence_required");
      if (!(await r.waive({ id: ob.id, by: who.userId, evidence })))
        throw new PenaltyFail("decided");
      return { state: "waived", penalty_obligation_id: null };
    }
    const amount = b.amount ?? 0;
    const est = await estimateOf(r, ob, today);
    checkBook(amount, est, evidence !== null);
    const out = await r.book({ id: ob.id, amount, today, by: who.userId, evidence, estimate: est });
    if (!out) throw new PenaltyFail("decided");
    return { state: "booked", penalty_obligation_id: String(out.obligation.id) };
  };

  /** `POST /obligations/:id/penalty`: `book` | `waive`. */
  const decide = async (
    who: PenaltyWho,
    obligationId: string,
    b: PenaltyDecision,
  ): Promise<PenaltyOut> => {
    const today = await d.today(who.tenantId);
    return d.uow.tenant(who, async ({ penalty: r }) => {
      const ob = await guard(r, who, obligationId, today);
      return write(r, who, ob, b, today);
    });
  };
  return { list, decide };
}
export type PenaltyCommands = ReturnType<typeof penaltyCommands>;
