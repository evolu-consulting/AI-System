// CR-127 · X2 · spec §4.1 `POST /contracts/deals` + `link`, §6 "Giao dịch gắn HĐ", business §10.2 (BR-48…51). Chọn HĐ ⇒ KHÔNG tạo chứng từ
// giao dịch: ghi THẲNG vào mốc bằng `recordFulfillment` (một đường duy nhất); có quy trình `transaction.saved` khớp ⇒ yêu cầu chờ duyệt
// (`exec_requests`, kho/công nợ chưa đổi) — xong quy trình thì `transaction-events.mount.ts` áp đúng đường trên. "Không theo hợp đồng" ⇒
// chứng từ giao dịch như cũ + lý do. Một giao dịch = một mốc (dòng SP ngoài HĐ ⇒ `LINK_MIXED`). Lớp 2: chỉ cổng.
import type { PackUow, PackWho } from "../../kit/public";
import type { OpenMilestonesRepo } from "../adapters/open-milestones.repo";
import type { TxRequestIn } from "../adapters/transaction-flow.repo";
import { linkQtyItems, linkVerdict, transactionTotal } from "../domain/deal.rules";
import { dealAndDirection, type ManualInput } from "../domain/manual.rules";
import { LedgerFail, type LedgerRepos } from "./ledger.ports";
import { type FulfillIn, precheckFulfill } from "./ledger.usecase";

export type DealLinkIn = { obligation_id: string } | { none: { reason: string } };
export class DealLinkFail extends Error {
  constructor(
    readonly kind:
      | "link_required"
      | "reason_required"
      | "mixed"
      | "evidence_required"
      | "not_found"
      | "claimed",
    /** `claimed`: người đang giữ mốc. */
    readonly by: string | null = null,
  ) {
    super(kind);
  }
}

export type LinkRepos = LedgerRepos & {
  om: OpenMilestonesRepo;
  txf: {
    insertRequest(w: TxRequestIn): Promise<void>;
  };
};
export type LinkDealDeps = {
  uow: PackUow<LinkRepos>;
  /** `ledgerCommands.fulfill` — đường ghi thực hiện duy nhất (X1). */
  fulfill(who: PackWho, id: string, b: FulfillIn): Promise<{ obligation: unknown; child: unknown }>;
  /** "Có quy trình `transaction.saved` khớp?" (engine `FlowAvailability`; chưa có engine ⇒ false ⇒ áp ngay). */
  hasFlow(q: {
    tenantId: string;
    facts: Record<string, string | number | boolean>;
  }): Promise<boolean>;
  newId(): string;
  /** X5: quyền `admin` của gói (quản trị công ty được ghi dù mốc có người nhận). */
  isAdmin?: (who: PackWho) => Promise<boolean>;
  /** X5 (tuỳ chọn, kiểm sớm): người đang giữ mốc ≠ người ghi ⇒ `TASK_CLAIMED`. Luật chính nằm ở `recordFulfillment`/`precheckFulfill` (cùng `claimVerdict`). */
  claimedBy?(who: PackWho, obligationId: string): Promise<string | null>;
};

const productIdsOf = (i: ManualInput) =>
  i.items.map((x) => x.product_id).filter((x): x is string => !!x);

/** Bước 1 của `POST /contracts/deals`: `link` hợp lệ theo luật (LINK_REQUIRED / LINK_REASON_REQUIRED). Gọi cho mọi đường tạo giao dịch. */
export function checkDealLink(d: LinkDealDeps) {
  return async (who: PackWho, input: ManualInput, link: DealLinkIn | undefined) => {
    const { deal, direction } = dealAndDirection(input);
    const ids = productIdsOf(input);
    const hasOpen =
      deal === "referral" || ids.length === 0
        ? false
        : await d.uow.tenant(who, (r) =>
            r.om.partnerHasOpen({
              name: input.partner_name,
              taxId: input.partner_tax_id ?? null,
              direction,
              productIds: ids,
            }),
          );
    const v = linkVerdict(link, hasOpen);
    if (v === "link_required") throw new DealLinkFail("link_required");
    if (v === "reason_required") throw new DealLinkFail("reason_required");
  };
}

export type LinkOut = {
  state: "posted" | "pending";
  obligation_id: string;
  child_obligation_id?: string | null;
  request_id?: string;
};

/** X5 · #59: `LedgerFail` «mốc đang do người khác xử lý» ⇒ `DealLinkFail('claimed')` (câu "Mốc đang do {người} xử lý — … Không theo hợp đồng"). */
const claimedAsLink = (e: unknown): never => {
  if (e instanceof LedgerFail && e.kind === "task_claimed")
    throw new DealLinkFail("claimed", e.detail?.by ?? null);
  throw e;
};

const isUnique = (e: unknown) => {
  const o = e as { code?: string; cause?: { code?: string } };
  return o?.code === "23505" || o?.cause?.code === "23505";
};

/** Chọn mốc: chứng từ giao dịch KHÔNG được tạo. `evidence` bắt buộc (BR-52). */
export function linkToMilestone(d: LinkDealDeps) {
  return async (
    who: PackWho,
    input: ManualInput,
    obligationId: string,
    evidence: FulfillIn["evidence"],
  ): Promise<LinkOut> => {
    if (!evidence) throw new DealLinkFail("evidence_required");
    const prep = await d.uow.tenant(who, async (r) => {
      const ref = await r.om.obligationRef(obligationId, {
        name: input.partner_name,
        taxId: input.partner_tax_id ?? null,
      });
      if (!ref?.partner_match || ref.direction !== dealAndDirection(input).direction)
        throw new DealLinkFail("not_found");
      const lines = input.items.filter((x) => x.name.trim() !== "" || x.product_id);
      const q = linkQtyItems(lines, ref.items);
      if (q.mixed) throw new DealLinkFail("mixed");
      const total = transactionTotal(input.total_value, lines);
      const b: FulfillIn =
        ref.kind === "delivery"
          ? { qty_items: q.qty_items.length > 0 ? q.qty_items : null, evidence }
          : { amount: total, evidence };
      return { b, total, contractId: ref.contract_id };
    });
    const holder = await d.claimedBy?.(who, obligationId);
    if (holder) throw new DealLinkFail("claimed", holder);
    const facts: Record<string, string | number | boolean> = {
      linked: true,
      ...(prep.total === null ? {} : { total_value: prep.total }),
    };
    if (!(await d.hasFlow({ tenantId: who.tenantId, facts }))) {
      const out = await d.fulfill(who, obligationId, prep.b).catch(claimedAsLink);
      return { state: "posted", obligation_id: obligationId, child_obligation_id: idOf(out.child) };
    }
    const id = d.newId();
    await d.uow
      .tenant(who, async (r) => {
        // cùng luật chặn như ghi thật (tạm khoá, yêu cầu đang chờ, vượt tiền, mốc đang do người khác xử lý — X5)
        await precheckFulfill(r, obligationId, prep.b, { d, who });
        await r.txf.insertRequest({
          id,
          contractId: prep.contractId,
          obligationId,
          by: who.userId,
          payload: { ...prep.b, total_value: prep.total },
          evidence,
          totalValue: prep.total,
        });
      })
      .catch((e) => {
        if (isUnique(e)) throw new LedgerFail("change_pending");
        return claimedAsLink(e);
      });
    return { state: "pending", obligation_id: obligationId, request_id: id };
  };
}

const idOf = (o: unknown): string | null =>
  o && typeof o === "object" && "id" in o ? String((o as { id: unknown }).id) : null;
