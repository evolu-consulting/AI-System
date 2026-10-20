// V2-G · HD-02/HD-08 · BA §4.2: dữ liệu giả cho màn xác nhận sau AI đọc (HĐ `needs_review` có `ai`) và tóm tắt AI ở chi tiết.
// Đồng hồ cố định 2026-10-18 (giờ VN), như `dataset-v2f.ts`.
import { contractAsHub } from "./dataset-contract";
import { comp, prod } from "./dataset-v2f";

export const REVIEW_ID = "c1000000-0000-4000-8000-0000000000c1";
export const ITEM1 = "e1000000-0000-4000-8000-0000000000d1";
export const ITEM2 = "e1000000-0000-4000-8000-0000000000d2";
export const NEW_PRODUCT_ID = "e1000000-0000-4000-8000-000000000099";

/** Luật nhận diện "USB" ⇒ Chữ ký số DN – USB Token (thành phần USB Token), kho giữ hàng. */
export const P_USB = prod(
  "e1000000-0000-4000-8000-000000000010",
  "Chữ ký số DN – USB Token",
  "goods",
  [comp("e1000000-0000-4000-8000-0000000000e1", "USB Token", "stock", "40")],
);

/** `POST /products/match` của màn xác nhận: "usb" ⇒ quy tắc nhận diện (P_USB); còn lại ⇒ đề xuất tạo mới. */
export function matchV2g(text: string) {
  if (text.toLowerCase().includes("usb"))
    return {
      suggestions: [
        { product: P_USB, component_id: P_USB.components[0]?.id ?? null, by: "rule", score: 3 },
      ],
      create: null,
    };
  return { suggestions: [], create: { name: text } };
}

export const AI_SUMMARY = {
  main: "Hợp đồng bán bao bì cho Công ty An Khang, giao hàng 2 đợt trong năm 2026.",
  deadlines: ["Giao đợt 1 trước 01/03/2026", "Thanh toán đủ trước 31/12/2026"],
  penalties: ["Phạt 0,05%/ngày trên giá trị chậm giao"],
  bonuses: [],
  clauses: ["Điều 5: bảo hành 12 tháng", "Điều 9: giải quyết tranh chấp tại toà"],
};

export const AI_MILESTONES = [
  {
    kind: "delivery",
    title: "Giao hàng đợt 1",
    due_date: "2026-03-01",
    amount: null,
    quote: "giao hàng đợt 1 trước ngày 01/03/2026",
    verified: true,
  },
  {
    kind: "collect",
    title: "Thanh toán 50%",
    due_date: null,
    amount: 122_500_000,
    quote: "thanh toán 50% giá trị hợp đồng",
    verified: false,
  },
];

type Over = Record<string, unknown>;

/** HĐ bán vừa được AI đọc: loại Bán (AI chưa chắc), 2 dòng hàng, 2 mốc tìm thấy, tóm tắt 5 mục. */
export function reviewContract(o: Over = {}) {
  const base = contractAsHub("needs_review");
  const f = base.fields as Record<string, { value: unknown }>;
  return {
    ...base,
    id: REVIEW_ID,
    deal: "sell",
    direction: "sale",
    fields: f,
    items: [
      row(ITEM1, 0, "USB", "cái", 100, 250_000),
      row(ITEM2, 1, "Phí dịch vụ lạ", "gói", 1, 5_000_000),
    ],
    ai: {
      deal: "sell",
      unsure: ["deal", "payment_terms", "buyer_name"],
      summary: AI_SUMMARY,
      milestones: AI_MILESTONES,
    },
    ...o,
  };
}

const row = (id: string, ord: number, name: string, unit: string, qty: number, price: number) => ({
  id,
  ord,
  code: null,
  name,
  spec: null,
  unit,
  qty,
  unit_price: price,
  vat_rate: null,
  moq: null,
  lead_time_days: null,
  valid_from: null,
  valid_to: null,
  category_id: null,
  quote: null,
  verified: true,
  edited: false,
  product_id: null,
  component_ids: null,
});
