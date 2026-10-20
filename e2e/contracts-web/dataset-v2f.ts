// V2-F · HD-01/03/04/09/10/11 · 5.5a · 5.7e: dữ liệu giả cho form hợp đồng, chi tiết (dòng thời gian mốc) và gợi ý đối tác / sản phẩm.
// Đồng hồ cố định 2026-10-18 (`page.clock`), nên "Giao đợt 2" hạn 10/10 đang quá hạn 8 ngày.
import { contractAsHub } from "./dataset-contract";

export const ACTIVE_ID = "c1000000-0000-4000-8000-0000000000a1";
export const NEW_ID = "c1000000-0000-4000-8000-0000000000b1";
const M = (n: number) => `d1000000-0000-4000-8000-00000000010${n}`;

type Over = Record<string, unknown>;
const ms = (n: number, o: Over) => ({
  id: M(n),
  contract_id: ACTIVE_ID,
  kind: "delivery",
  title: "Giao hàng",
  seq: n,
  due_date: "2026-10-10",
  owner: "partner",
  qty: null,
  amount: null,
  amount_effective: null,
  status: "open",
  confirmed: false,
  done_at: null,
  fault: null,
  postponed_to: null,
  source: "manual",
  ...o,
});

export const MILESTONES = [
  ms(1, {
    kind: "pay",
    title: "Trả trước 50% khi ký",
    due_date: "2026-01-05",
    owner: "ours",
    status: "done",
    confirmed: true,
    done_at: "2026-01-05",
    amount: 122_500_000,
    amount_effective: 122_500_000,
  }),
  ms(2, {
    title: "Giao đợt 1",
    due_date: "2026-03-01",
    status: "done",
    confirmed: true,
    done_at: "2026-03-04",
    fault: "partner",
    qty: 500,
  }),
  ms(3, { title: "Giao đợt 2", due_date: "2026-10-10", qty: 500 }),
  ms(4, {
    kind: "renewal",
    title: "Nhắc gia hạn",
    due_date: "2026-12-01",
    owner: "ours",
  }),
  ms(5, {
    kind: "pay",
    title: "Thanh toán 50% còn lại",
    due_date: "2026-12-20",
    owner: "ours",
    amount_effective: 122_500_000,
  }),
];

/** HĐ đã có hiệu lực (mua), có dòng thời gian: bước hiện tại = "Giao đợt 2" (quá hạn). */
export function activeContract(o: Over = {}) {
  return {
    ...contractAsHub("active"),
    id: ACTIVE_ID,
    deal: "buy",
    stage: "in_progress",
    next_milestone_id: M(3),
    milestones: MILESTONES,
    warnings: [],
    ...o,
  };
}

const comp = (id: string, name: string, mode: string, onHand: string, unit = "cái") => ({
  id,
  ord: 0,
  name,
  unit,
  mode,
  on_hand: onHand,
  avg_cost: 100_000,
  stock_value: Math.round(Number(onHand) * 100_000),
});
const prod = (id: string, name: string, group: string, components: unknown[], unit = "cái") => ({
  id,
  name,
  unit,
  group,
  main_supplier: null,
  created_from_contract_id: null,
  components,
  rules: [],
});
export const P_TOKEN = prod("e1000000-0000-4000-8000-000000000001", "USB Token", "goods", [
  comp("e1000000-0000-4000-8000-0000000000c1", "USB Token", "stock", "10"),
]);
export const P_SIGN = prod(
  "e1000000-0000-4000-8000-000000000002",
  "Chữ ký số 1 năm",
  "service",
  [
    comp("e1000000-0000-4000-8000-0000000000c2", "Gói 100", "quota", "40", "lượt"),
    comp("e1000000-0000-4000-8000-0000000000c3", "Gói 500", "quota", "5", "lượt"),
  ],
  "gói",
);
export const P_REF = prod("e1000000-0000-4000-8000-000000000003", "Bảo hiểm xe", "referral", [
  comp("e1000000-0000-4000-8000-0000000000c4", "Bảo hiểm xe", "none", "0"),
]);
export const PRODUCTS = [P_TOKEN, P_SIGN, P_REF];

/** `POST /products/match`: "token" ⇒ USB Token; "chữ ký" ⇒ Chữ ký số (thành phần Gói 500); còn lại ⇒ đề xuất tạo mới. */
export function matchFor(text: string) {
  const t = text.toLowerCase();
  if (t.includes("token"))
    return {
      suggestions: [{ product: P_TOKEN, component_id: null, by: "words", score: 1 }],
      create: null,
    };
  if (t.includes("chữ ký"))
    return {
      suggestions: [
        { product: P_SIGN, component_id: P_SIGN.components[1]?.id ?? null, by: "rule", score: 2 },
      ],
      create: null,
    };
  return { suggestions: [], create: { name: text } };
}

/** `GET /partners/lookup`: tên "Bao Bì" ⇒ đã có, điểm 88 TỐT; "Mới" ⇒ chưa có; "Chưa vai" ⇒ đã có nhưng chưa có vai. */
export function lookupFor(name: string) {
  const n = name.toLowerCase();
  if (n.includes("bao bì"))
    return {
      status: "existing",
      party: "tax:0312345678",
      name,
      tax_id: "0312345678",
      roles: ["supplier"],
      role: "supplier",
      has_role: true,
      is_new: false,
      score: 88,
      band: "good",
    };
  if (n.includes("chưa vai"))
    return {
      status: "existing",
      party: "name:chua vai",
      name,
      tax_id: null,
      roles: ["customer"],
      role: "supplier",
      has_role: false,
      is_new: false,
      score: null,
      band: null,
    };
  return {
    status: "new",
    party: `name:${n}`,
    role: "supplier",
    label: "Đối tác mới · sẽ tạo khi lưu",
  };
}
