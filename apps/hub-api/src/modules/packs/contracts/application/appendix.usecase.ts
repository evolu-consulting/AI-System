// HD-FR-54 · HD-FR-55 · HD5 plan: phụ lục gắn HĐ gốc (chọn tay + gợi ý) và bảng giá có áp phụ lục. Mỗi ca = một tx `PackUow`
// (role `contracts_rw`, RLS FORCE), số câu SQL CỐ ĐỊNH (không theo số hàng): gắn = set_config + khoá/kiểm cha + CTE ghi + outbox;
// gợi ý = set_config + đầu văn bản + ứng viên; giá = set_config + một câu gom họ HĐ.
import type { KitTxRepos } from "../../kit/application/index-outbox";
import type { PackUow, PackWho } from "../../kit/application/ports";
import {
  applyAppendixPricing,
  type PricedLine,
  type PriceSource,
} from "../domain/appendix-pricing.rules";
import {
  type AppendixHints,
  citedNumber,
  type ParentCandidate,
  type Suggestion,
  suggestParents,
} from "../domain/parent-suggest.rules";

/** Hàng đã khoá của HĐ định gắn: `parentKind` = loại của HĐ cha đề xuất (`null` ⇒ không có / tenant khác). */
export type LockedForParent = {
  version: number;
  kind: "contract" | "appendix";
  parentId: string | null;
  updatedAt: string;
  hasAppendices: boolean;
  parentKind: "contract" | "appendix" | null;
};
export type ParentSaved = {
  version: number;
  updatedAt: string;
  kind: "contract" | "appendix";
  parentId: string | null;
};

export type AppendixRepo = {
  /** `SELECT … FOR UPDATE` HĐ theo PK + `tenant_id`, kèm loại của `parentId` (nếu có) và "có phụ lục con?" — MỘT câu. */
  lockForParent(id: string, parentId: string | null): Promise<LockedForParent | null>;
  /** CTE: UPDATE `kind/parent_id/version+1/updated_at` (`version = expected`) + INSERT event `parent_changed {from, to}`. */
  setParent(
    id: string,
    s: { parentId: string | null; from: string | null; expected: number; actor: string },
  ): Promise<ParentSaved>;
  /** Đầu văn bản + hai bên của phụ lục (cho gợi ý); không có ⇒ `null`. */
  hints(
    id: string,
  ): Promise<(AppendixHints & { kind: "contract" | "appendix"; head: string | null }) | null>;
  /** HĐ gốc khác của tenant (mới cập nhật trước), tới `limit`. */
  candidates(id: string, limit: number): Promise<ParentCandidate[]>;
  /** Họ HĐ của `id` (gốc + phụ lục đã chốt), gốc đứng đầu; không có ⇒ `null`. */
  family(id: string): Promise<PriceSource[] | null>;
};

export type AttachInput = { version: number; parent_id: string | null };
export type AttachResult =
  | { kind: "ok"; out: { id: string } & ParentSaved }
  | { kind: "not_found" }
  | { kind: "stale"; current: { version: number }; updated_at: string }
  | { kind: "invalid_parent"; reason: "self" | "not_a_contract" | "has_appendices" };

export type AttachParent = (who: PackWho, id: string, input: AttachInput) => Promise<AttachResult>;

type Uow = PackUow<KitTxRepos & { appendix: AppendixRepo }>;

/** Thuần: HĐ đã khoá + đầu vào ⇒ lỗi (không ghi) hoặc `null` (được ghi/không đổi). */
export function attachVerdict(cur: LockedForParent, input: AttachInput): AttachResult | null {
  if (cur.version !== input.version)
    return { kind: "stale", current: { version: cur.version }, updated_at: cur.updatedAt };
  if (input.parent_id === null) return null;
  if (cur.parentKind !== "contract") return { kind: "invalid_parent", reason: "not_a_contract" };
  if (cur.hasAppendices) return { kind: "invalid_parent", reason: "has_appendices" };
  return null;
}

export function attachParent(d: { uow: Uow }): AttachParent {
  return (who, id, input) =>
    d.uow.tenant(who, async (r): Promise<AttachResult> => {
      if (input.parent_id === id) return { kind: "invalid_parent", reason: "self" };
      const cur = await r.appendix.lockForParent(id, input.parent_id);
      if (!cur) return { kind: "not_found" };
      const bad = attachVerdict(cur, input);
      if (bad) return bad;
      const same = {
        id,
        version: cur.version,
        updatedAt: cur.updatedAt,
        kind: cur.kind,
        parentId: cur.parentId,
      };
      if (cur.parentId === input.parent_id) return { kind: "ok", out: same };
      const saved = await r.appendix.setParent(id, {
        parentId: input.parent_id,
        from: cur.parentId,
        expected: cur.version,
        actor: who.userId,
      });
      await r.outbox.enqueue([{ entity: "contract", entity_id: id, op: "upsert" }]);
      return { kind: "ok", out: { id, ...saved } };
    });
}

/** Ứng viên đọc tối đa (mới cập nhật trước) — gợi ý là tiện ích trong hộp thoại, không phải tìm kiếm toàn tenant. */
export const SUGGEST_POOL = 500;

export type SuggestParents = (who: PackWho, id: string) => Promise<Suggestion[] | null>;

export function suggestParentsFor(d: { uow: PackUow<{ appendix: AppendixRepo }> }): SuggestParents {
  return (who, id) =>
    d.uow.tenant(who, async (r) => {
      const h = await r.appendix.hints(id);
      if (!h) return null;
      const pool = await r.appendix.candidates(id, SUGGEST_POOL);
      return suggestParents({ cited: citedNumber(h.head), seller: h.seller, buyer: h.buyer }, pool);
    });
}

export type ContractPrices = { as_of: string; lines: PricedLine[]; total: number };
export type GetPrices = (who: PackWho, id: string, asOf: string) => Promise<ContractPrices | null>;

export function getPrices(d: { uow: PackUow<{ appendix: AppendixRepo }> }): GetPrices {
  return (who, id, asOf) =>
    d.uow.tenant(who, async (r) => {
      const fam = await r.appendix.family(id);
      const root = fam?.[0];
      if (!fam || !root) return null;
      const lines = applyAppendixPricing(root, fam.slice(1), asOf);
      return { as_of: asOf, lines, total: lines.length };
    });
}
