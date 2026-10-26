// HD7-AC09 · HD8 · D-02: dữ liệu giả CHUNG cho so màn đối tác (/partners + Ghi việc + Chấm điểm), Cách tính điểm (/settings/scoring),
// so giá hàng hoá (/prices?product=) và khối "Ghi việc" của trang HĐ — một bộ dữ liệu, hai bộ chuyển: `partnersAsMgmt()` (hình
// `mgmt-app/web/src/api/{partners,prices}.ts`, khoá `company_id`) và `partnersAsHub()` (hình `@ai/contracts`, khoá `party`).
import { contract } from "./dataset-contract";

const BV = "tax:0312340001";
const PN = "tax:0355555555";
const HH = "tax:0377777777";

export const partners = [
  {
    party: PN,
    name: "Kế toán Phương Nam",
    role: "customer",
    roles: ["customer"],
    score: 92,
    band: "good",
    reason: "Thanh toán đúng hạn 11/12 đợt",
    event_count: 12,
    adjust: 0,
    contracts: 1,
  },
  {
    party: BV,
    name: "Bếp Việt",
    role: "customer",
    roles: ["customer"],
    score: 54,
    band: "watch",
    reason: "Phải nhắc thanh toán 5 lần, dời hẹn 1 lần",
    event_count: 14,
    adjust: 0,
    contracts: 2,
  },
  {
    party: HH,
    name: "VPP Hồng Hà",
    role: "supplier",
    roles: ["supplier"],
    score: null,
    band: null,
    reason: "Chưa đủ dữ liệu để chấm",
    event_count: 1,
    adjust: 0,
    contracts: 1,
  },
] as const;

const instalments = [
  {
    id: "0b000000-0000-4000-8000-000000000001",
    contract_id: contract.id,
    contract_number: "BV-1",
    direction: "receive",
    kind: "payment",
    seq: 1,
    due_date: "2026-10-10",
    amount: 92_500_000,
    status: "open",
    done_at: null,
    postpones: 1,
    reminders: 2,
    estimated: false,
    basis: null,
  },
  {
    id: "0b000000-0000-4000-8000-000000000002",
    contract_id: contract.id,
    contract_number: "BV-1",
    direction: "receive",
    kind: "payment",
    seq: 2,
    due_date: "2026-11-13",
    amount: 92_500_000,
    status: "open",
    done_at: null,
    postpones: 0,
    reminders: 0,
    estimated: true,
    basis: "30 ngày sau giao hàng",
  },
];

const ev = (o: Record<string, unknown>) => ({
  note: null,
  days_late: null,
  amount: null,
  contract_id: contract.id,
  obligation_id: null,
  voided: false,
  source: "action",
  ...o,
});
const events = [
  ev({
    id: "101",
    type: "received",
    at: "2026-09-12",
    days_late: 2,
    amount: 50_000_000,
    obligation_id: "x1",
  }),
  ev({ id: "102", type: "reminded", at: "2026-10-05", obligation_id: instalments[0]?.id }),
  ev({
    id: "103",
    type: "overdue",
    at: "2026-10-11",
    source: "system",
    by: null,
    party_late: true,
    due_date: "2026-10-10",
    kind: "payment",
    seq: 1,
    amount: 92_500_000,
    obligation_id: instalments[0]?.id,
  }),
  ev({
    id: "104",
    type: "postponed",
    at: "2026-10-12",
    to: "2026-10-20",
    was: "2026-10-10",
    note: "hẹn tuần sau",
    obligation_id: "x2",
    voided: true,
  }),
  ev({
    id: "105",
    type: "complaint",
    at: "2026-10-15",
    note: "giao thiếu 2 suất",
    contract_id: null,
  }),
];
const BY = "Lan Nguyễn";

const rules = {
  good_from: 80,
  fair_from: 60,
  min_events: 3,
  window_months: 12,
  recency_boost: true,
  recency_months: 3,
  manual_adjust: true,
};
const criteria = [
  { key: "payment_on_time", kind: "auto", label: "Thanh toán đúng hạn", enabled: true, weight: 25 },
  { key: "cks_renewal", kind: "auto", label: "Gia hạn chữ ký số", enabled: true, weight: 20 },
  { key: "reminders", kind: "auto", label: "Số lần phải nhắc", enabled: true, weight: 15 },
  { key: "appointments", kind: "auto", label: "Giữ lịch hẹn", enabled: true, weight: 10 },
  { key: "complaints", kind: "auto", label: "Khiếu nại, tranh chấp", enabled: false, weight: 10 },
  {
    key: "custom:thai-do-hop-tac",
    kind: "manual",
    label: "Thái độ hợp tác",
    enabled: true,
    weight: 30,
  },
];
const scoring = {
  role: "customer",
  version: 2,
  criteria,
  rules,
  updated_by: BY,
  updated_at: "2026-10-16T03:00:00Z",
  restorable: [{ key: "tenure", label: "Gắn bó", weight: 10 }],
  manual_choices: [
    "Thái độ hợp tác",
    "Tốc độ phản hồi",
    "Chứng từ, hoá đơn đầy đủ",
    "Tiềm năng mua thêm",
    "Mức độ gắn bó",
    "Dễ làm việc",
    "Giới thiệu khách mới",
  ],
};
const history = [
  {
    version: 2,
    at: "2026-10-16T03:00:00Z",
    by: BY,
    summary: "thêm Thái độ hợp tác 30%, tắt Khiếu nại, tranh chấp",
  },
  { version: 1, at: "2026-10-01T03:00:00Z", by: BY, summary: "Số lần phải nhắc 10→15%" },
];
const ratings = {
  criteria: [
    {
      key: "custom:thai-do-hop-tac",
      label: "Thái độ hợp tác",
      weight: 30,
      enabled: true,
      current: {
        id: "201",
        value: 60,
        note: "chậm trả lời",
        by: BY,
        at: "2026-10-14",
        rated_at: "2026-10-14T02:00:00Z",
        counts: true,
      },
    },
  ],
  history: [],
};

export const PORK = "name:thit heo|";
const products = [
  { key: PORK, label: "Thịt heo (đ/kg)", unit: "kg" },
  { key: "name:gao st25|", label: "Gạo ST25 (đ/kg)", unit: "kg" },
];
const compareRows = [
  {
    supplier: "Thực phẩm Sạch Bình An",
    party: "tax:0322223333",
    price: 98_000,
    unit: "kg",
    score: 88,
    band: "good",
    is_new: false,
    source: { type: "contract", date: "2026-01-01", contract_id: contract.id },
  },
  {
    supplier: "Heo Rẻ",
    party: "tax:0322224444",
    price: 96_500,
    unit: "kg",
    score: 64,
    band: "fair",
    is_new: false,
    source: { type: "contract", date: "2026-03-01", contract_id: contract.id },
  },
  {
    supplier: "Thực phẩm Hưng Phát",
    party: "name:thuc pham hung phat",
    price: 94_500,
    unit: "kg",
    score: null,
    band: null,
    is_new: true,
    source: {
      type: "quote",
      date: "2026-10-10",
      quote_id: "0c000000-0000-4000-8000-000000000001",
      url: null,
    },
  },
];
const compare = {
  product: { key: PORK, label: "Thịt heo", unit: "kg" },
  rows: compareRows,
  market: { status: "tbd" },
};

export const partnerData = {
  BV,
  PN,
  HH,
  instalments,
  events,
  BY,
  scoring,
  history,
  ratings,
  compare,
};

/** Hình hub: `/pack/contracts/{partners,scoring,obligations,partner-events,prices,contracts/:id/partner}`. */
export function partnersAsHub(path: string, s: URLSearchParams): unknown {
  const p = path.replace(/^.*\/pack\/contracts/, "");
  if (p === "/partners")
    return partners.filter(
      (x) => s.get("role") === "all" || !s.get("role") || x.role === s.get("role"),
    );
  if (p === "/partners/contract-counts")
    return partners.map((x) => ({ party: x.party, n: x.contracts }));
  if (p === "/partners/ratings") return ratings;
  if (p === "/scoring/customer" || p === "/scoring/supplier")
    return { ...scoring, role: p.split("/")[2] };
  if (p.endsWith("/history")) return history;
  if (p === "/obligations")
    return instalments
      .filter((o) => !s.get("contract_id") || o.contract_id === s.get("contract_id"))
      .map(({ ...o }) => ({ ...o, party: BV, source: "default" }));
  if (p === "/partner-events")
    return events.map((e) => ({
      ...e,
      party: BV,
      role: "customer",
      by: e.source === "system" ? null : "u1",
      by_name: e.source === "system" ? null : BY,
      voided_by: null,
      voided_at: null,
    }));
  if (p === `/contracts/${contract.id}/partner`)
    return { party: BV, role: "customer", name: "Bếp Việt" };
  if (p === "/prices/products") return products;
  if (p === "/prices/compare") return compare;
  return undefined;
}

/** Hình mgmt-app: `/api/{partners,scoring,obligations,partner-events,prices}`. */
export function partnersAsMgmt(path: string, s: URLSearchParams): unknown {
  const asMgmtPartner = ({ party, ...x }: (typeof partners)[number]) => ({
    company_id: party,
    ...x,
  });
  if (path === "/partners")
    return partners
      .filter((x) => s.get("role") === "all" || x.role === s.get("role"))
      .map(asMgmtPartner);
  if (/^\/partners\/[^/]+\/ratings$/.test(path)) return ratings;
  if (path === "/scoring/customer" || path === "/scoring/supplier")
    return { ...scoring, role: path.split("/")[2] };
  if (path.endsWith("/history")) return history;
  if (path === "/obligations")
    return instalments.filter(
      (o) => !s.get("contract_id") || o.contract_id === s.get("contract_id"),
    );
  if (path === "/partner-events")
    return events.map((e) => ({
      ...e,
      company_id: BV,
      role: "customer",
      by: e.source === "system" ? "hệ thống" : BY,
    }));
  if (path === `/partner-events/contract/${contract.id}`)
    return { company_id: BV, role: "customer", name: "Bếp Việt" };
  if (path === "/prices/products") return products;
  if (path === "/prices/compare")
    return {
      ...compare,
      rows: compareRows.map(({ party, ...r }) => ({ ...r, supplier_company_id: party })),
    };
  return undefined;
}
