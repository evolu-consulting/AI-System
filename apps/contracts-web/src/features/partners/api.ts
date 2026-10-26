// HD8-FR-01…06: đối tác + điểm uy tín + cách tính + so giá hàng hoá (`/pack/contracts/{partners,scoring,prices}`) — port
// `mgmt-app/web/src/api/{partners,prices}.ts`. Đối tác = `party` (D7-04). Khoá truy vấn bắt đầu `partners`/`scoring`/`prices`.
import type {
  Company,
  GoodsCompare,
  PartnerContactPerson,
  PartnerContractCount,
  PartnerContractRow,
  PartnerNote,
  PartnerProfile,
  PartnerRole,
  PartnerRoleRow,
  PartnerRow,
  PartnerScore,
  PartnerWebSearch,
  PriceProduct,
  QuoteCreate,
  RepMine,
  ScoreConfigOut,
  ScoreHistoryRow,
  ScorePreview,
  ScoringDraft,
} from "@ai/contracts";
import { api } from "@ai/web-kit/http";
import { wireOf } from "./lib/contacts";

const BASE = "/pack/contracts";
const enc = encodeURIComponent;

/** Một người liên hệ khi lưu (chưa có `id`; thứ tự mảng = thứ tự hiển thị). */
export type PartnerContactDraft = Omit<PartnerContactPerson, "id">;

export const partnerKeys = {
  list: (role: PartnerRole | "all") => ["partners", "list", role] as const,
  scoring: (role: PartnerRole) => ["scoring", role] as const,
  history: (role: PartnerRole) => ["scoring", role, "history"] as const,
  // V2-I (khoá bắt đầu `partners` ⇒ mọi thao tác ghi đối tác làm mới cả danh sách lẫn chi tiết)
  counts: ["partners", "counts"] as const,
  score: (party: string, role: PartnerRole) => ["partners", "score", party, role] as const,
  profile: (party: string) => ["partners", "profile", party] as const,
  contacts: (party: string) => ["partners", "contacts", party] as const,
  mine: (days: number) => ["partners", "rep", "mine", days] as const,
  roles: (party: string) => ["partners", "roles", party] as const,
  contracts: (party: string) => ["partners", "contracts", party] as const,
  notes: (party: string) => ["partners", "notes", party] as const,
  products: ["prices", "products"] as const,
  compare: (product: string) => ["prices", "compare", product] as const,
};

export const fetchPartners = (role: PartnerRole | "all", signal?: AbortSignal) =>
  api<PartnerRow[]>(`${BASE}/partners?role=${role}`, { signal });
export const fetchPartnerScore = (party: string, role: PartnerRole, signal?: AbortSignal) =>
  api<PartnerScore>(`${BASE}/partners/score?party=${enc(party)}&role=${role}`, { signal });

export const fetchScoring = (role: PartnerRole, signal?: AbortSignal) =>
  api<ScoreConfigOut>(`${BASE}/scoring/${role}`, { signal });
export const fetchScoringHistory = (role: PartnerRole, signal?: AbortSignal) =>
  api<ScoreHistoryRow[]>(`${BASE}/scoring/${role}/history`, { signal });
export const previewScoring = (role: PartnerRole, d: ScoringDraft) =>
  api<ScorePreview>(`${BASE}/scoring/${role}/preview`, { method: "POST", body: d });
export const saveScoring = (role: PartnerRole, d: ScoringDraft) =>
  api<ScoreConfigOut>(`${BASE}/scoring/${role}`, { method: "PUT", body: d });

export const fetchProducts = (signal?: AbortSignal) =>
  api<PriceProduct[]>(`${BASE}/prices/products`, { signal });
export const fetchCompare = (product: string, signal?: AbortSignal) =>
  api<GoodsCompare>(`${BASE}/prices/compare?product=${enc(product)}`, { signal });
export const addQuote = (q: QuoteCreate) =>
  api<{ id: string }>(`${BASE}/prices/quotes`, { method: "POST", body: q });

// ---------- V2-I · hồ sơ đối tác: `/partners/{profile,contracts,contract-counts,notes,internet-search}`; `/reputation/mine` chỉ đọc (V2-E đóng băng, CR-097a) ----------
const REP = `${BASE}/reputation`;

export const fetchProfile = (party: string, signal?: AbortSignal) =>
  api<PartnerProfile>(`${BASE}/partners/profile?party=${enc(party)}`, { signal });
export const fetchRoles = (party: string, signal?: AbortSignal) =>
  api<PartnerRoleRow[]>(`${BASE}/partners/roles?party=${enc(party)}`, { signal });
export const fetchPartnerContracts = (party: string, signal?: AbortSignal) =>
  api<PartnerContractRow[]>(`${BASE}/partners/contracts?party=${enc(party)}`, { signal });
export const fetchContractCounts = (signal?: AbortSignal) =>
  api<PartnerContractCount[]>(`${BASE}/partners/contract-counts`, { signal });
export const fetchNotes = (party: string, signal?: AbortSignal) =>
  api<PartnerNote[]>(`${BASE}/partners/notes?party=${enc(party)}`, { signal });
export const addNote = (b: { party: string; body: string; source?: "manual" | "internet" }) =>
  api<PartnerNote>(`${BASE}/partners/notes`, { method: "POST", body: b });
export const deleteNote = (id: string) =>
  api<{ deleted: true }>(`${BASE}/partners/notes/${id}`, { method: "DELETE" });
/** Q8: chỉ chạy khi người dùng bấm; máy chủ chỉ gửi tên + MST. */
export const searchInternet = (party: string) =>
  api<PartnerWebSearch>(`${BASE}/partners/internet-search`, { method: "POST", body: { party } });

// ---------- V2-GAPS: điện thoại / liên hệ đối tác (DT-01) + "Uy tín của mình" (C10) ----------
export const saveProfile = (b: { party: string; phone: string; contact: string }) =>
  api<PartnerProfile>(`${BASE}/partners/profile`, { method: "PUT", body: b });

// ---------- GAP-D2: nhiều người liên hệ (#24) + "Thêm công ty" tra Cục Thuế (#23) ----------
export const fetchContacts = (party: string, signal?: AbortSignal) =>
  api<PartnerContactPerson[]>(`${BASE}/partners/contacts?party=${enc(party)}`, { signal });
export const saveContacts = (party: string, contacts: PartnerContactDraft[]) =>
  api<PartnerContactPerson[]>(`${BASE}/partners/contacts`, {
    method: "PUT",
    body: { party, contacts: wireOf(contacts) },
  });
/** Chỉ MST (tuỳ chọn tên/địa chỉ khi Cục Thuế chưa tra được) — máy chủ tra Cục Thuế chỉ bằng MST. */
export const createCompany = (b: { tax_id?: string; name?: string; address?: string }) =>
  api<Company>(`${BASE}/companies`, { method: "POST", body: b });
export const refreshCompany = (party: string) =>
  api<Company>(`${BASE}/companies/refresh?party=${enc(party)}`, { method: "POST", body: {} });
export const fetchRepMine = (days: number, signal?: AbortSignal) =>
  api<RepMine>(`${REP}/mine?days=${days}`, { signal });
