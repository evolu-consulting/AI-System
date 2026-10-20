// V2-G · HD-02/HD-08 · §4.2 "Upload và xác nhận" · C3 · C12: "Lưu" ở màn xác nhận (MỘT tx: khoá HĐ → kiểm `version` → luật thuần
// `planReview` → ghi trường + loại + dòng hàng + mốc → outbox) và gắn lại SP cho dòng HĐ đã lưu (một tx, một CTE). "Hủy" không có
// lệnh: màn hình bỏ bản nháp, không gọi API. Tenant tắt duyệt ⇒ lưu = `active` ngay (V2-A để ngỏ); bật duyệt ⇒ vẫn `needs_review`.
import type { PackUow, PackWho } from "../../kit/application/ports";
import type { ContractFieldKey, FieldValue } from "../domain/fields.rules";
import type { Deal } from "../domain/milestones.rules";
import { planReview, type ReviewMilestoneIn } from "../domain/review.rules";
import type { AttachOutcome, ReviewItemWrite, ReviewTxRepos } from "./review.ports";

export type ReviewInput = {
  version: number;
  deal?: Deal | undefined;
  commission_pct?: number | null | undefined;
  commission_fixed?: number | null | undefined;
  fields?: Partial<Record<ContractFieldKey, FieldValue>> | undefined;
  items?:
    | readonly {
        id?: string | undefined;
        name: string;
        unit?: string | null | undefined;
        qty?: number | null | undefined;
        unit_price?: number | null | undefined;
        product_id?: string | null | undefined;
        component_ids?: readonly string[] | null | undefined;
      }[]
    | undefined;
  milestones?: readonly ReviewMilestoneIn[] | undefined;
};
export type ReviewResult =
  | {
      kind: "ok";
      out: {
        id: string;
        status: "needs_review" | "active";
        version: number;
        items: number;
        milestones: number;
      };
    }
  | { kind: "not_found" }
  | { kind: "stale"; current: { version: number }; updated_at: string }
  | {
      kind:
        | "not_reviewable"
        | "commission_kind"
        | "milestone_invalid"
        | "item_unknown"
        | "component_invalid";
    };

export type ReviewSave = (who: PackWho, id: string, input: ReviewInput) => Promise<ReviewResult>;
export type AttachProduct = (
  who: PackWho,
  id: string,
  itemId: string,
  p: { product_id: string | null; component_ids?: readonly string[] | null | undefined },
) => Promise<AttachOutcome>;

type Deps = {
  uow: PackUow<ReviewTxRepos>;
  /** Ngày lịch của tenant (`YYYY-MM-DD`) — hạn mốc mặc định khi HĐ chưa có ngày. */
  today: (tenantId: string) => Promise<string>;
};

const blank = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};
const itemWrite = (i: NonNullable<ReviewInput["items"]>[number]): ReviewItemWrite => ({
  id: i.id ?? null,
  name: i.name.trim(),
  unit: blank(i.unit),
  qty: i.qty ?? null,
  unit_price: i.unit_price ?? null,
  product_id: i.product_id ?? null,
  component_ids: i.product_id && i.component_ids?.length ? [...i.component_ids] : null,
});

const stale = (cur: { version: number; updated_at: string }): ReviewResult => ({
  kind: "stale",
  current: { version: cur.version },
  updated_at: cur.updated_at,
});

/** Phần trong tx: khoá → kiểm version → luật thuần → ghi (3 câu) → outbox. Lỗi dữ liệu ở câu ghi ⇒ ném để ROLLBACK. */
async function reviewTx(
  r: ReviewTxRepos,
  who: PackWho,
  id: string,
  { input, today }: { input: ReviewInput; today: string },
): Promise<ReviewResult> {
  const cur = await r.review.lock(id);
  if (!cur) return { kind: "not_found" };
  if (cur.version !== input.version) return stale(cur);
  const plan = planReview(cur, input, today);
  if (typeof plan === "string") return { kind: plan };
  const items = input.items ? input.items.map(itemWrite) : null;
  const saved = await r.review.save(id, { plan, items, expected: cur.version, actor: who.userId });
  if (saved === "stale") return stale(cur);
  if (typeof saved === "string") throw new ReviewRollback(saved);
  await r.outbox.enqueue([{ entity: "contract", entity_id: id, op: "upsert" }]);
  return { kind: "ok", out: { id, ...saved } };
}

export function reviewSave(d: Deps): ReviewSave {
  return async (who, id, input) => {
    const today = await d.today(who.tenantId);
    return d.uow
      .tenant(who, (r) => reviewTx(r, who, id, { input, today }))
      .catch((e) => {
        if (e instanceof ReviewRollback) return { kind: e.reason } satisfies ReviewResult;
        throw e;
      });
  };
}
/** Ném để ROLLBACK cả tx (câu ② có thể đã ghi một phần) rồi đổi thành kết quả `{kind}` ở biên. */
class ReviewRollback extends Error {
  constructor(readonly reason: "item_unknown" | "component_invalid") {
    super(reason);
  }
}

export function attachProduct(d: Pick<Deps, "uow">): AttachProduct {
  return (who, id, itemId, p) =>
    d.uow.tenant(who, async (r) => {
      const comps = p.product_id && p.component_ids?.length ? [...p.component_ids] : null;
      const out = await r.review.attachProduct(
        id,
        itemId,
        { product_id: p.product_id, component_ids: comps },
        who.userId,
      );
      if (out.kind === "ok")
        await r.outbox.enqueue([{ entity: "contract", entity_id: id, op: "upsert" }]);
      return out;
    });
}
