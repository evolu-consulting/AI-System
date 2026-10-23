// V2-G · BA v2 §3.1 HD-02/HD-08 · §4.2 "Upload và xác nhận" · C3: luật thuần của "Lưu" ở màn xác nhận sau khi AI đọc — gộp sửa trường,
// loại HĐ (+ hướng, hoa hồng), bộ mốc (người đã xem/sửa; trống ở tenant tắt duyệt ⇒ mốc mặc định theo loại), và trạng thái sau lưu
// (tenant tắt duyệt ⇒ `active` ngay, bật duyệt ⇒ còn `needs_review` chờ bước Xác nhận). Không I/O.

import {
  applyEdits,
  type ContractFieldKey,
  type ContractFields,
  type FieldChange,
  type FieldValue,
} from "./fields.rules";
import { asDate } from "./fold.rules";
import {
  checkMilestone,
  type Deal,
  defaultMilestones,
  defaultOwner,
  directionOfDeal,
  MILESTONE_TITLES,
  type MilestoneKind,
  toDb,
} from "./milestones.rules";

export type ReviewMilestoneIn = {
  kind: MilestoneKind;
  title?: string | null | undefined;
  due_date: string;
  amount?: number | null | undefined;
};
export type ReviewIn = {
  deal?: Deal | undefined;
  commission_pct?: number | null | undefined;
  commission_fixed?: number | null | undefined;
  fields?: Partial<Record<ContractFieldKey, FieldValue>> | undefined;
  milestones?: readonly ReviewMilestoneIn[] | undefined;
  /** "Lưu nháp": không xác nhận dù tenant tắt duyệt. */
  draft?: boolean | undefined;
};
export type ReviewCur = {
  status: string;
  deal: Deal | null;
  fields: unknown;
  approvalOn: boolean;
  commissionPct: number | null;
  commissionFixed: number | null;
};

/** Hàng mốc cần ghi (cột `contracts.obligations` ngoài khoá/ngày hệ thống). */
export type PlannedMilestone = {
  kind: "payment" | "delivery" | "commission" | "serial" | "renewal" | "other";
  direction: "pay" | "receive";
  title: string;
  owner: "ours" | "partner";
  due_date: string;
  qty: null;
  amount: number | null;
  source: "ai" | "default";
};
export type ReviewPlan = {
  fields: ContractFields;
  changes: FieldChange[];
  deal: Deal;
  direction: "purchase" | "sale";
  commissionPct: number | null;
  commissionFixed: number | null;
  /** `null` ⇒ không đụng bộ mốc hiện có. */
  milestones: PlannedMilestone[] | null;
  activate: boolean;
};
export type ReviewError = "not_reviewable" | "commission_kind" | "milestone_invalid";

/** Loại HĐ chưa chọn (HĐ tải lên chưa có AI) ⇒ Bán, như `dealOf` của màn hình. */
export const DEFAULT_DEAL: Deal = "sell";

const dateOf = (v: FieldValue): string | null => (typeof v === "string" ? asDate(v) : null);

function plannedMilestones(
  c: { deal: Deal; fields: ContractFields; approvalOn: boolean; today: string },
  input: ReviewIn,
): PlannedMilestone[] | null | "invalid" {
  const { deal, fields, approvalOn, today } = c;
  const given = input.milestones;
  if (given && given.length > 0) {
    const out: PlannedMilestone[] = [];
    for (const m of given) {
      const amount = m.amount ?? null;
      if (checkMilestone({ kind: m.kind, qty: null, amount }) !== "ok") return "invalid";
      out.push({
        ...toDb(m.kind, deal),
        title: m.title?.trim() || MILESTONE_TITLES[m.kind],
        owner: defaultOwner(m.kind, deal),
        due_date: m.due_date,
        qty: null,
        amount,
        source: "ai",
      });
    }
    return out;
  }
  // Tenant bật duyệt + không có mốc ⇒ để HD7 sinh mốc mặc định lúc duyệt; tắt duyệt ⇒ HĐ có hiệu lực ngay nên sinh mốc theo loại.
  if (approvalOn) return given ? [] : null;
  return defaultMilestones({
    deal,
    start: dateOf(fields.start_date.value),
    end: dateOf(fields.end_date.value),
    signed: dateOf(fields.signed_date.value),
    today,
  }).map((m) => ({
    ...toDb(m.kind, deal),
    title: m.title,
    owner: m.owner,
    due_date: m.due_date,
    qty: null,
    amount: null,
    source: "default" as const,
  }));
}

export function planReview(
  cur: ReviewCur,
  input: ReviewIn,
  today: string,
): ReviewPlan | ReviewError {
  if (cur.status !== "needs_review") return "not_reviewable";
  const deal = input.deal ?? cur.deal ?? DEFAULT_DEAL;
  const referral = deal === "referral";
  // Hoa hồng không gửi lên ⇒ giữ giá trị đã lưu (nếu vẫn là HĐ Giới thiệu); gửi tay thì thắng (kể cả null).
  let pct = input.commission_pct !== undefined ? input.commission_pct : cur.commissionPct;
  let fixed = input.commission_fixed !== undefined ? input.commission_fixed : cur.commissionFixed;
  // Chỉ một trong hai (CHECK DB): gửi mới một bên thì bên kia bỏ.
  if (input.commission_fixed != null) pct = null;
  else if (input.commission_pct != null) fixed = null;
  if (!referral && (input.commission_pct != null || input.commission_fixed != null))
    return "commission_kind";
  const { fields, changes } = applyEdits(cur.fields, input.fields ?? {});
  const holdOn = cur.approvalOn || input.draft === true; // nháp ⇒ chưa sinh mốc mặc định (chưa xác nhận)
  const milestones = plannedMilestones({ deal, fields, approvalOn: holdOn, today }, input);
  if (milestones === "invalid") return "milestone_invalid";
  return {
    fields,
    changes,
    deal,
    direction: directionOfDeal(deal),
    commissionPct: referral ? pct : null,
    commissionFixed: referral ? fixed : null,
    milestones,
    activate: !cur.approvalOn && input.draft !== true,
  };
}
