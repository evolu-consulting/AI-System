// HD-FR-51 · S03 · port `ContractsPage.tsx:20-58` (nhãn trạng thái, tên rút gọn, người ký) + dựng truy vấn phía server từ bộ lọc
// của `useTable`. Thuần: không React, không fetch. Tuỳ chọn lọc lấy từ facets (cả tenant), không từ trang hiện tại.
import type { ContractFacets, ContractStatus } from "@ai/contracts";
import type { Cond } from "~/features/table";
import { type DateFilter, dateParams } from "./date-filter";
import { type DocFilter, docTypeParams } from "./doc-list";

export type Tone = "late" | "soon" | "ok" | "dim" | "act";

/** Nhóm trạng thái hiển thị (một nhãn có thể gồm nhiều mã); thứ tự = thứ tự gợi ý trong bộ lọc. */
export const STATUS_VIEW: Record<ContractStatus, { tone: Tone }> = {
  needs_review: { tone: "act" },
  extracting: { tone: "dim" },
  extract_failed: { tone: "late" },
  active: { tone: "dim" },
  expiring: { tone: "soon" },
  expired: { tone: "late" },
  renewed: { tone: "dim" },
  terminated: { tone: "dim" },
  rejected: { tone: "late" },
};

/** Hàm dịch tối thiểu (GAP-E #34: nhãn qua i18n `contracts.gape.*`, không còn chuỗi cứng). */
export type Tr = (key: string) => string;
export const statusLabel = (t: Tr, s: ContractStatus): string => t(`contracts.gape.status.${s}`);

/** "Nguyễn Văn A – Giám đốc" → "Nguyễn Văn A": lọc theo tên người, không theo chức danh. */
export const personOf = (s: string): string => (s.split(/\s[–-]\s|,/)[0] ?? "").trim();

const LEGAL =
  /\b(công ty|cong ty|cty|tnhh|cổ phần|co phan|cp|một thành viên|mtv|hộ kinh doanh|hkd)\b\.?/giu;

/** "CÔNG TY TNHH BAO BÌ PHƯƠNG NAM" → "Bao Bì Phương Nam" (loại hình chiếm chỗ cột hẹp; tên đầy đủ ở tooltip). */
export function shortName(name: string | null): string {
  if (!name) return "—";
  let s = name.replace(LEGAL, " ").replace(/\s+/g, " ").trim() || name;
  if (s === s.toUpperCase()) s = s.toLowerCase().replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase());
  return s;
}

/** Một bộ lọc dạng "chọn giá trị": nhãn hiển thị → các giá trị gửi API. */
export type Choice = { label: string; values: string[] };
export type FilterMaps = {
  category: Choice[];
  direction: Choice[];
  seller: Choice[];
  buyer: Choice[];
  owner: Choice[];
  signer: Choice[];
  status: Choice[];
};
export type MemberNames = ReadonlyMap<string, string>;

const byLabel = (a: Choice, b: Choice) => a.label.localeCompare(b.label, "vi");

/** Gộp theo nhãn (nhiều giá trị thô cùng nhãn rút gọn ⇒ một lựa chọn). */
function group(pairs: [label: string, value: string][], sort = true): Choice[] {
  const m = new Map<string, string[]>();
  for (const [label, value] of pairs) m.set(label, [...(m.get(label) ?? []), value]);
  const out = [...m].map(([label, values]) => ({ label, values }));
  return sort ? out.sort(byLabel) : out;
}

export function filterMaps(f: ContractFacets | undefined, members: MemberNames, t: Tr): FilterMaps {
  const none: FilterMaps = {
    category: [],
    direction: [],
    seller: [],
    buyer: [],
    owner: [],
    signer: [],
    status: [],
  };
  if (!f) return none;
  const order = Object.keys(STATUS_VIEW);
  const status = f.status
    .map((s) => s.v)
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((v): [string, string] => [statusLabel(t, v), v]);
  return {
    category: group(f.category.map((c) => [c.label, c.v])),
    direction: group(
      f.direction.map((d) => [t(`contracts.gape.direction.${d.v}`), d.v]),
      false,
    ),
    seller: group(f.seller.map((s) => [shortName(s.v), s.v])),
    buyer: group(f.buyer.map((s) => [shortName(s.v), s.v])),
    owner: group(f.owner.map((o) => [members.get(o.v) ?? t("contracts.gape.ownerUnknown"), o.v])),
    signer: group(f.signer.map((s) => [personOf(s.label), s.label])),
    status: group(status, false),
  };
}

export const optionLabels = (c: Choice[]): string[] => c.map((x) => x.label);

const valuesOf = (c: Choice[], picked: string[] | undefined): string[] => {
  const want = new Set(picked ?? []);
  return [...new Set(c.filter((x) => want.has(x.label)).flatMap((x) => x.values))];
};

export type ListParams = {
  q: string;
  conds: Record<string, Cond>;
  maps: FilterMaps;
  page: number;
  pageSize: number;
  /** Gap #10: lọc ngày (từ URL). */
  date?: DateFilter;
  /** DOC-ui-list: bộ lọc loại chứng từ; vắng ⇒ không gửi tham số loại (phản hồi HD1 cũ). */
  docType?: DocFilter;
};

/** Phần lọc dùng chung cho danh sách và xuất tệp (không phân trang): `q`, các lựa chọn, giá trị, ngày. `q` < 2 ký tự bị bỏ (API từ chối). */
function filterParams(p: ListParams): URLSearchParams {
  const u = new URLSearchParams();
  const q = p.q.trim();
  if (q.length >= 2) u.set("q", q);
  const add = (key: string, choices: Choice[], condKey = key) => {
    for (const v of valuesOf(choices, p.conds[condKey]?.in)) u.append(key, v);
  };
  add("category", p.maps.category);
  add("direction", p.maps.direction);
  add("seller", p.maps.seller);
  add("buyer", p.maps.buyer);
  add("owner", p.maps.owner);
  add("signer", p.maps.signer);
  add("status", p.maps.status);
  const v = p.conds.value;
  if (v?.min != null) u.set("value_min", String(v.min));
  if (v?.max != null) u.set("value_max", String(v.max));
  for (const [k, val] of p.date ? dateParams(p.date) : []) u.set(k, val);
  return u;
}

/** `?status=a&status=b…` (tham số lặp). Lọc đã chọn nhưng chưa có giá trị khớp ⇒ không lọc thêm. */
export function listQueryString(p: ListParams): string {
  const u = filterParams(p);
  if (p.docType) for (const [k, v] of docTypeParams(p.docType)) u.set(k, v);
  u.set("include", "progress"); // V2-F: giai đoạn + bước hiện tại + loại HĐ của từng HĐ trong trang
  u.set("page", String(p.page));
  u.set("page_size", String(p.pageSize));
  return u.toString();
}

/** Gap #8: cùng bộ lọc với danh sách đang hiện, không phân trang, kèm định dạng tệp. */
export function exportQueryString(p: ListParams, format: "xlsx" | "csv"): string {
  const u = filterParams(p);
  // Xuất tệp không có `nest`: chỉ giữ lọc loại (`doc_type`).
  if (p.docType) for (const [k, v] of docTypeParams(p.docType)) if (k === "doc_type") u.set(k, v);
  u.set("format", format);
  return u.toString();
}
