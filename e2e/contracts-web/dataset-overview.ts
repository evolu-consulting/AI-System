// nav-v2 · Tổng quan: dữ liệu giả cho `/overview` (không chứa test). Việc cần xử lý (`GET /my-work`, 8 việc để thử "6 việc + Xem thêm 2"),
// danh sách HĐ sắp hết hiệu lực (`GET /contracts?status=expiring…`) và đối tác (`GET /partners`, có mức CHÚ Ý) — hình = contract hub.
import { listAsHub } from "./dataset-list";
import { partnersAsHub } from "./dataset-partners";

export const TODAY = "2026-10-18";
const CID = "c1000000-0000-4000-8000-000000000011";
const base = {
  at: null,
  title: null,
  party: null,
  amount: null,
  direction: null,
  contract_direction: null,
  contract_id: null,
  customer_id: null,
  note: null,
  milestone: null,
  subject: null,
};
const item = (o: Record<string, unknown>) => ({ ...base, ...o });

/** 8 việc, gấp nhất trước (máy chủ đã sắp): 2 trễ, 2 hôm nay, 4 sắp tới. */
export const WORK = [
  item({
    id: "obligation:o1",
    kind: "obligation",
    tone: "late",
    days: 3,
    due: "2026-10-15",
    title: "S-1",
    party: "Khách An",
    amount: 5_000_000,
    direction: "receive",
    contract_direction: "sale",
    contract_id: CID,
  }),
  item({
    id: "obligation:o2",
    kind: "obligation",
    tone: "late",
    days: 1,
    due: "2026-10-17",
    title: "M-1",
    party: "NCC Bình",
    amount: 1_000_000,
    direction: "pay",
    contract_direction: "purchase",
    contract_id: CID,
  }),
  item({
    id: "followup:f1",
    kind: "followup",
    tone: "soon",
    days: 0,
    due: TODAY,
    at: "2026-10-18T08:30",
    title: "Bếp Việt",
    note: "Gọi lại",
    customer_id: "k1",
    subject: "customer",
  }),
  item({
    id: `deadline:${CID}`,
    kind: "deadline",
    tone: "soon",
    days: 0,
    due: TODAY,
    title: "Hợp đồng mua bán bao bì 2026",
    party: "Bao Bì Phương Nam",
    contract_direction: "purchase",
    contract_id: CID,
  }),
  ...[2, 3, 4, 5].map((n) =>
    item({
      id: `obligation:u${n}`,
      kind: "obligation",
      tone: "dim",
      days: -n,
      due: `2026-10-${18 + n}`,
      title: `S-${n}`,
      party: `Khách ${n}`,
      amount: n * 1_000_000,
      direction: "receive",
      contract_direction: "sale",
      contract_id: CID,
    }),
  ),
];

export const myWorkAsHub = (items: unknown[] = WORK) => ({
  today: TODAY,
  items,
  counts: { late: 2, today: 2, upcoming: 4 },
  truncated: false,
});

/** `GET /contracts?…`: truy vấn `status=expiring` ⇒ chỉ HĐ sắp hết hiệu lực; còn lại ⇒ cả danh sách. */
export function contractsListAsHub(search: URLSearchParams) {
  const all = listAsHub();
  if (!search.getAll("status").includes("expiring")) return all;
  const items = all.items.filter((r) => r.status === "expiring");
  return { ...all, items, total: items.length };
}

/** `GET /partners?role=all` của bộ chung (Bếp Việt ở mức CHÚ Ý). */
export const partnersForOverview = (search: URLSearchParams) => partnersAsHub("/partners", search);
