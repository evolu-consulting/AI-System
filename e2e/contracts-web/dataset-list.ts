// HD-FR-51 · S03 · HD5: dữ liệu giả CHUNG cho màn danh sách HĐ — một bộ chuẩn + hai bộ chuyển: `boardAsMgmt()` (hình
// `mgmt-app/web/src/api/board.ts` `BoardRow`) và `listAsHub()` / `facetsAsHub()` (hình `ContractListResponse` / `ContractFacets`).
import { dataset } from "./dataset";

const OWNER = dataset.user.id;
export const CAT = {
  packaging: "ca7e0000-0000-4000-8000-000000000001",
  spice: "ca7e0000-0000-4000-8000-000000000002",
} as const;
export const CATEGORIES = [
  { id: CAT.packaging, name: "Bao bì" },
  { id: CAT.spice, name: "Gia vị" },
];

type Row = {
  id: string;
  title: string;
  number: string | null;
  seller: string | null;
  buyer: string | null;
  seller_signer: string | null;
  buyer_signer: string | null;
  value: number | null;
  status: "active" | "needs_review" | "expiring";
  end: string | null;
  categories: string[];
  direction: "sale" | "purchase" | null;
};
export const ROWS: Row[] = [
  {
    id: "c1000000-0000-4000-8000-000000000011",
    title: "Hợp đồng mua bán bao bì 2026",
    number: "01/2026/HĐMB-PN",
    seller: "CÔNG TY TNHH BAO BÌ PHƯƠNG NAM",
    buyer: "Công ty CP Thực phẩm An Khang",
    seller_signer: "Nguyễn Văn Phúc – Giám đốc",
    buyer_signer: "Trần Thị Mai – Phó Giám đốc",
    value: 245000000,
    status: "active",
    end: "2026-12-31",
    categories: [CAT.packaging],
    direction: "purchase",
  },
  {
    id: "c1000000-0000-4000-8000-000000000012",
    title: "Hợp đồng cung cấp gia vị",
    number: "GV-07/2026",
    seller: "Công ty TNHH Gia Vị Việt",
    buyer: "Công ty CP Thực phẩm An Khang",
    seller_signer: null,
    buyer_signer: "Trần Thị Mai – Phó Giám đốc",
    value: 80000000,
    status: "needs_review",
    end: "2027-03-31",
    categories: [CAT.spice],
    direction: "purchase",
  },
  {
    id: "c1000000-0000-4000-8000-000000000013",
    title: "Hợp đồng vận chuyển quý 4",
    number: null,
    seller: "Vận Tải Bắc Nam",
    buyer: "Công ty CP Thực phẩm An Khang",
    seller_signer: null,
    buyer_signer: null,
    value: null,
    status: "expiring",
    end: "2026-11-20",
    categories: [],
    direction: null,
  },
];

const MGMT_STATUS = {
  active: { label: "Đang hiệu lực", tone: "dim" },
  needs_review: { label: "Chờ xác nhận", tone: "act", code: "review" },
  expiring: { label: "Sắp đáo hạn", tone: "soon", code: "soon" },
} as const;

/** mgmt-app: `GET /api/board/contracts` (mảng `BoardRow`) + `GET /api/categories`. */
export function boardAsMgmt() {
  return ROWS.map((r) => ({
    id: r.id,
    title: r.title,
    party: r.seller,
    sub: null,
    tags: r.categories.map((id) => ({ label: CATEGORIES.find((c) => c.id === id)?.name ?? "" })),
    cks: null,
    status: MGMT_STATUS[r.status],
    category_ids: r.categories,
    number: r.number,
    seller: r.seller,
    buyer: r.buyer,
    value: r.value,
    direction: r.direction,
    end: r.end,
    seller_signer: r.seller_signer,
    buyer_signer: r.buyer_signer,
    owner: dataset.user.name,
  }));
}
export const categoriesAsMgmt = () => CATEGORIES.map((c) => ({ ...c, product_count: 0 }));

const at = "2026-10-18T02:00:00.000Z";

/** V2-F · HD-03: `progress` (V2-A) cạnh `items` — loại HĐ, ngày bắt đầu, giai đoạn, bước hiện tại (đỏ khi quá hạn). */
export const PROGRESS: Record<string, unknown> = {
  [ROWS[0]?.id as string]: {
    deal: "buy",
    start_date: "2026-01-01",
    stage: "in_progress",
    next: {
      id: "d1000000-0000-4000-8000-000000000001",
      kind: "delivery",
      title: "Giao đợt 2",
      due_date: "2026-10-10",
      overdue: true,
    },
  },
  [ROWS[1]?.id as string]: { deal: "buy", start_date: null, stage: "not_started", next: null },
  [ROWS[2]?.id as string]: { deal: null, start_date: null, stage: "done", next: null },
};
/** Hub: `GET /pack/contracts/contracts`. `extra` thêm hàng (vd phụ lục) cho test hành vi. */
export function listAsHub(extra: Partial<ReturnType<typeof hubRow>>[] = [], total?: number) {
  const items = [...ROWS.map(hubRow), ...extra.map((e) => ({ ...hubRow(ROWS[0] as Row), ...e }))];
  const progress = items.map((r) => ({
    id: r.id,
    deal: null,
    start_date: null,
    stage: "in_progress",
    next: null,
    ...(PROGRESS[r.id] as object | undefined),
  }));
  return { items, total: total ?? items.length, parents: [], progress, page: 1, page_size: 20 };
}
function hubRow(r: Row) {
  return {
    id: r.id,
    kind: "contract",
    parent_id: null as string | null,
    title: r.title,
    number: r.number,
    type: null,
    direction: r.direction,
    status: r.status,
    seller: r.seller,
    buyer: r.buyer,
    seller_signer: r.seller_signer,
    buyer_signer: r.buyer_signer,
    value: r.value,
    end_date: r.end,
    action_deadline: null,
    owner_user_id: OWNER,
    category_ids: r.categories,
    updated_at: at,
    version: 1,
    locked: ["active", "expiring"].includes(r.status), // CR-097 K1: đã xác nhận ⇒ khoá
    version_no: 1, // CR-097 K2
    versions_count: 1,
  };
}

export function facetsAsHub() {
  const count = <T>(xs: T[]) => {
    const m = new Map<T, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return [...m].map(([v, n]) => ({ v, n }));
  };
  return {
    status: count(ROWS.map((r) => r.status)),
    direction: count(ROWS.map((r) => r.direction ?? "unknown")),
    kind: [{ v: "contract", n: ROWS.length }],
    owner: [{ v: OWNER, n: ROWS.length }],
    seller: count(ROWS.map((r) => r.seller).filter((s): s is string => !!s)),
    buyer: count(ROWS.map((r) => r.buyer).filter((s): s is string => !!s)),
    signer: [],
    category: CATEGORIES.map((c) => ({ v: c.id, label: c.name, n: 1 })),
    value: { min: 80000000, max: 245000000 },
    truncated: [],
  };
}
export const membersAsHub = () => ({ items: [{ id: OWNER, name: dataset.user.name }] });
export const categoriesAsHub = () => ({ items: CATEGORIES });

/** mgmt-app: GET của màn danh sách theo đường dẫn (sau `/api`); không phải của màn này ⇒ `undefined`. */
export function mgmtListGet(path: string, notices: unknown): unknown {
  if (path === "/notifications") return notices;
  if (path === "/board/contracts") return boardAsMgmt();
  if (path === "/categories") return categoriesAsMgmt();
  return undefined;
}
