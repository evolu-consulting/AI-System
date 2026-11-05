// V2-G · BA §4.2 "Upload và xác nhận" · HD-02/HD-08: luật thuần của màn xác nhận sau khi AI đọc — form điền sẵn từ HĐ đã đọc, trường AI chưa
// chắc (tô vàng), đổi Mua↔Bán dựng lại đối tác/người ký, mốc AI tìm thấy (giữ/bỏ, hạn mặc định), thân `POST /contracts/:id/review`.
import type {
  ContractDeal,
  ContractDetail,
  ContractItem,
  ReviewMilestone,
  ReviewSaveRequest,
} from "@ai/contracts";
import { dealOf } from "./deal";
import { fieldKeyOf, formOfDetail, patchOfForm } from "./detail-form";
import { type FormState, type LineState, type Numbers, named, type TextKey } from "./form-model";

type Detail = Pick<
  ContractDetail,
  "deal" | "direction" | "fields" | "commission_pct" | "commission_fixed" | "ai" | "items"
>;

const asText = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const orNull = (s: string): string | null => (s.trim() === "" ? null : s.trim());

/** Dòng đã lưu → dòng form (giữ `id`; SP + thành phần đã gắn). */
export function lineOfItem(it: ContractItem): LineState {
  return {
    id: it.id,
    name: it.name,
    unit: asText(it.unit),
    qty: asText(it.qty),
    unit_price: asText(it.unit_price),
    product_id: it.product_id ?? "",
    component_id: it.component_ids?.[0] ?? "",
    new_name: "",
    new_group: "goods",
    suggested: false,
  };
}

/** Form xác nhận: thông tin điền sẵn từ `fields` + dòng hàng AI đọc + hoa hồng đã lưu. */
export function formOfConfirm(c: Detail): FormState {
  return { ...formOfDetail(c), items: c.items.map(lineOfItem) };
}

/** Đổi loại HĐ: đối tác + người ký dựng lại từ `fields` đã đọc theo phía mới (Mua ⇒ bên bán, Bán ⇒ bên mua) để PATCH không thấy "đổi"
 *  ảo; lựa chọn SP bỏ để chọn lại theo loại mới (như form nhập tay). */
export function switchDeal(c: Detail, f: FormState, deal: ContractDeal): FormState {
  const re = formOfDetail({ ...c, deal });
  return {
    ...f,
    deal,
    partner_name: re.partner_name,
    partner_tax_id: re.partner_tax_id,
    partner_signer: re.partner_signer,
    our_signer: re.our_signer,
    items: f.items.map((l) => ({ ...l, product_id: "", component_id: "", suggested: false })),
  };
}

const FORM_KEYS: readonly TextKey[] = [
  "title",
  "number",
  "partner_name",
  "partner_tax_id",
  "partner_signer",
  "our_signer",
  "start_date",
  "end_date",
  "notice_days",
  "total_value",
  "payment_terms",
];

/** Ô cần tô vàng: AI nói chưa chắc, hoặc có giá trị mà trích dẫn không có trong văn bản — và người CHƯA sửa (ô còn y giá trị đã đọc). */
export function unsureKeys(c: Pick<Detail, "fields" | "ai">, f: FormState): Set<TextKey> {
  const out = new Set<TextKey>();
  const ai = new Set<string>(c.ai?.unsure ?? []);
  for (const k of FORM_KEYS) {
    const fk = fieldKeyOf(f.deal, k);
    const fv = fk ? c.fields[fk] : undefined;
    if (!fk || !fv || fv.edited) continue;
    if (!(ai.has(fk) || (!fv.verified && fv.value !== null))) continue;
    if (f[k].trim() === asText(fv.value).trim()) out.add(k);
  }
  return out;
}

/** Loại HĐ còn tô vàng khi AI chưa chắc và người chưa đổi. */
export const dealUnsure = (c: Pick<Detail, "ai" | "deal" | "direction">, f: FormState): boolean =>
  (c.ai?.unsure ?? []).includes("deal") && f.deal === dealOf(c);

// ---------- mốc AI tìm thấy ----------
export type MsRow = {
  kind: ReviewMilestone["kind"];
  title: string | null;
  due_date: string | null;
  amount: number | null;
  quote: string;
  verified: boolean;
  keep: boolean;
};
const MONEY: ReadonlySet<string> = new Set(["collect", "pay", "commission"]);

export const msRowsOf = (c: Pick<Detail, "ai">): MsRow[] =>
  (c.ai?.milestones ?? []).map((m) => ({ ...m, keep: true }));

/** Hạn mặc định khi AI không thấy ngày: kết thúc ?? bắt đầu (theo form) ?? hôm nay. */
export const fallbackDue = (f: Pick<FormState, "end_date" | "start_date">, today: string): string =>
  f.end_date || f.start_date || today;

/** Mốc giữ lại ⇒ thân gửi (số tiền chỉ cho mốc tiền — luật V2-A). */
export function reviewMilestones(
  rows: readonly MsRow[],
  f: Pick<FormState, "end_date" | "start_date">,
  today: string,
): ReviewMilestone[] {
  return rows
    .filter((r) => r.keep)
    .map((r) => ({
      kind: r.kind,
      ...(r.title ? { title: r.title } : {}),
      due_date: r.due_date ?? fallbackDue(f, today),
      ...(r.amount !== null && MONEY.has(r.kind) ? { amount: r.amount } : {}),
    }));
}

/** Thân `POST /contracts/:id/review` (chỉ gọi khi số hợp lệ + mọi dòng đã gắn SP). `productIds` theo dòng có tên (đã tạo SP mới nếu cần). */
export function reviewRequest(i: {
  c: Detail & Pick<ContractDetail, "version">;
  f: FormState;
  n: Numbers;
  productIds: readonly (string | null)[];
  rows: readonly MsRow[];
  today: string;
}): ReviewSaveRequest {
  const { c, f, n, productIds, rows, today } = i;
  const patch = patchOfForm(c, f);
  const referral = f.deal === "referral";
  return {
    version: c.version,
    deal: f.deal,
    ...(referral ? { commission_pct: n.commission_pct, commission_fixed: n.commission_fixed } : {}),
    ...(Object.keys(patch).length ? { fields: patch } : {}),
    items: named(f.items).map((l, j) => {
      const pid = productIds[j] ?? null;
      return {
        ...(l.id ? { id: l.id } : {}),
        name: l.name.trim(),
        unit: orNull(l.unit),
        ...n.lines[j],
        product_id: pid,
        ...(pid && l.component_id ? { component_ids: [l.component_id] } : {}),
      };
    }),
    milestones: reviewMilestones(rows, f, today),
  };
}
