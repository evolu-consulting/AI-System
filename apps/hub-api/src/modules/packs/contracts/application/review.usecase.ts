// V2-G · HD-02/HD-08 · §4.2 "Upload và xác nhận" · C3 · C12: "Lưu" ở màn xác nhận (MỘT tx: khoá HĐ → kiểm `version` → luật thuần
// `planReview` → ghi trường + loại + dòng hàng + mốc → outbox) và gắn lại SP cho dòng HĐ đã lưu (một tx, một CTE). "Hủy" không có
// lệnh: màn hình bỏ bản nháp, không gọi API. Tenant tắt duyệt ⇒ lưu = `active` ngay (V2-A để ngỏ); bật duyệt ⇒ vẫn `needs_review`.
import type { ProductLink } from "@ai/contracts/pack-contracts";
import type { PackUow, PackWho } from "../../kit/public";
import type { ContractFieldKey, FieldValue } from "../domain/fields.rules";
import type { Deal } from "../domain/milestones.rules";
import { planReview, type ReviewMilestoneIn } from "../domain/review.rules";
import type { AttachOutcome, ReviewItemWrite, ReviewTxRepos } from "./review.ports";
import { type SubmitDeps, SubmitRollback, type SubmitTxRepos, submitInTx } from "./submit.usecase";

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
  draft?: boolean | undefined;
  /** atomic-confirm: gắn/tạo SP trong cùng tx khi lệnh này xác nhận HĐ (tenant tắt duyệt). */
  products?: readonly ProductLink[] | undefined;
};
export type ReviewResult =
  | {
      kind: "ok";
      out: {
        id: string;
        status: "draft" | "processing" | "done";
        version: number;
        items: number;
        milestones: number;
      };
    }
  | { kind: "not_found" }
  | { kind: "submit"; code: string }
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
  uow: PackUow<ReviewTxRepos & Partial<SubmitTxRepos>>;
  /** CR-127 K3 · "Xác nhận & lưu" = Gửi (`submit.usecase`); vắng (test cũ) ⇒ đường K1b (không quy trình ⇒ DONE). */
  submit?: SubmitDeps;
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
  r: ReviewTxRepos & Partial<SubmitTxRepos>,
  who: PackWho,
  id: string,
  { input, today, submit }: { input: ReviewInput; today: string; submit?: SubmitDeps | undefined },
): Promise<ReviewResult> {
  const cur = await r.review.lock(id);
  if (!cur) return { kind: "not_found" };
  if (cur.version !== input.version) return stale(cur);
  const planned = planReview(cur, input, today);
  if (typeof planned === "string") return { kind: planned };
  const viaSubmit = submit !== undefined && r.sub && r.st && r.contractFlow && input.draft !== true;
  // CR-127 K3 · cổng đổi trạng thái do `submitInTx` làm (có quy trình ⇒ PROCESSING, không ⇒ DONE) — câu lưu không tự kích hoạt.
  const plan = viaSubmit ? { ...planned, activate: false } : planned;
  const items = input.items ? input.items.map(itemWrite) : null;
  const saved = await r.review.save(id, { plan, items, expected: cur.version, actor: who.userId });
  if (saved === "stale") return stale(cur);
  if (saved === "not_draft") return { kind: "not_reviewable" };
  if (typeof saved === "string") throw new ReviewRollback(saved);
  let out: Extract<ReviewResult, { kind: "ok" }>["out"] = { id, ...saved };
  if (viaSubmit && submit) {
    // CR-127 BR-02 · SP gắn khi HĐ còn DRAFT (sửa được), cùng tx, TRƯỚC khi chuyển — sau khi processing/done K4 khoá gắn SP.
    // Lỗi dòng lạ / kho ⇒ ném ⇒ ROLLBACK (HĐ giữ Nháp). Đã gắn xong ⇒ không giữ `pending_links` ở lượt (không gắn lần hai khi duyệt).
    await linkProducts(r, who, id, input.products, true);
    const s = await submitInTx(
      r as SubmitTxRepos,
      who,
      id,
      { links: null, checkRole: false },
      submit,
    );
    if ("error" in s) throw new SubmitRollback(s.error);
    out = { ...out, status: s.status, version: saved.version + 1 };
  } else if (out.status === "done") await linkProducts(r, who, id, input.products, false);
  await r.outbox.enqueue([{ entity: "contract", entity_id: id, op: "upsert" }]);
  return { kind: "ok", out };
}

/** atomic-confirm: gắn/tạo SP theo hộp "Gắn sản phẩm" TRONG tx của lệnh xác nhận (không lock-strict vì cùng tx với lệnh chuyển trạng thái).
 *  `inDraft` ⇒ HĐ còn DRAFT (đường Gửi); không ⇒ HĐ đã `done` (đường K1b). Dòng không thuộc HĐ / HĐ có kho ⇒ ném ⇒ ROLLBACK. */
async function linkProducts(
  r: ReviewTxRepos,
  who: PackWho,
  id: string,
  products: readonly ProductLink[] | undefined,
  inDraft: boolean,
): Promise<void> {
  if (!products?.length) return;
  if (!r.links) throw new Error("review: products without links repo");
  const out = await r.links.link(id, products, who.userId, false, inDraft);
  if (out.kind !== "ok" || out.matched !== products.length)
    throw new ReviewRollback("item_unknown");
}

export function reviewSave(d: Deps): ReviewSave {
  return async (who, id, input) => {
    const today = await d.today(who.tenantId);
    return d.uow
      .tenant(who, (r) => reviewTx(r, who, id, { input, today, submit: d.submit }))
      .catch((e) => {
        if (e instanceof ReviewRollback) return { kind: e.reason } satisfies ReviewResult;
        if (e instanceof SubmitRollback)
          return { kind: "submit", code: e.code } satisfies ReviewResult;
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
