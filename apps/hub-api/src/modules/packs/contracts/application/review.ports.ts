// V2-G · HD-02/HD-08 · §4.2: cổng của "Lưu" màn xác nhận (một tx) và gắn lại SP cho dòng HĐ đã lưu. Lớp 2 — chỉ kiểu.
import type { KitTxRepos } from "../../kit/application/index-outbox";
import type { Deal } from "../domain/milestones.rules";
import type { ReviewPlan } from "../domain/review.rules";

/** Hàng đã khoá của HĐ chờ xác nhận. */
export type ReviewLocked = {
  version: number;
  updated_at: string;
  status: string;
  deal: Deal | null;
  fields: unknown;
  /** Cờ duyệt của tenant, đọc cùng câu khoá (`contracts.approval_on()`). */
  approvalOn: boolean;
  commissionPct: number | null;
  commissionFixed: number | null;
};

export type ReviewItemWrite = {
  /** Có ⇒ sửa dòng AI đã đọc; vắng ⇒ dòng thêm mới. */
  id: string | null;
  name: string;
  unit: string | null;
  qty: number | null;
  unit_price: number | null;
  product_id: string | null;
  component_ids: string[] | null;
};

export type ReviewWrite = {
  plan: ReviewPlan;
  /** `null` ⇒ không đụng dòng hàng. */
  items: ReviewItemWrite[] | null;
  expected: number;
  actor: string;
};
export type ReviewSaved = {
  version: number;
  status: "needs_review" | "active";
  items: number;
  milestones: number;
};
/** `item_unknown`: có `id` dòng không thuộc HĐ; `component_invalid`: thành phần không thuộc SP đã chọn. */
export type ReviewSaveOutcome = ReviewSaved | "item_unknown" | "component_invalid" | "stale";

export type AttachOutcome =
  | { kind: "ok"; item: { id: string; product_id: string | null; component_ids: string[] | null } }
  | { kind: "not_found" | "locked" | "component_invalid" | "contract_locked" };

export type ReviewRepo = {
  /** `SELECT … FOR UPDATE` theo PK + `tenant_id` (+ cờ duyệt); không có / tenant khác ⇒ null. */
  lock(id: string): Promise<ReviewLocked | null>;
  /** Ghi trong tx: (1) HĐ (trường, loại, hướng, hoa hồng, version+1) (2) dòng hàng + mốc (một CTE, lô JSON) (3) xác nhận + event;
   *  số câu cố định. */
  save(id: string, w: ReviewWrite): Promise<ReviewSaveOutcome>;
  /** Gắn / gắn lại SP cho một dòng — MỘT CTE (kiểm dòng, kho, thành phần; ghi + event). */
  attachProduct(
    id: string,
    itemId: string,
    p: { product_id: string | null; component_ids: string[] | null },
    actor: string,
  ): Promise<AttachOutcome>;
};
export type ReviewTxRepos = { review: ReviewRepo } & KitTxRepos;
