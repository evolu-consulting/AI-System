// HD8-FR-01…06: đối tác + điểm uy tín + cách tính + so giá hàng hoá (`/pack/contracts/{partners,scoring,prices}`) — port
// `mgmt-app/web/src/api/{partners,prices}.ts`. Đối tác = `party` (D7-04). Khoá truy vấn bắt đầu `partners`/`scoring`/`prices`.
import type {
  GoodsCompare,
  PartnerContractCount,
  PartnerContractRow,
  PartnerNote,
  PartnerProfile,
  PartnerRatings,
  PartnerRole,
  PartnerRoleRow,
  PartnerRow,
  PartnerWebSearch,
  PriceProduct,
  QuoteCreate,
  RepConfigOut,
  RepDetail,
  RepHistory,
  RepPartnerRow,
  RepRatingIn,
  RepRatingRow,
  RepRatings,
  RepRole,
  ScoreConfigOut,
  ScoreHistoryRow,
  ScorePreview,
  ScoringDraft,
} from "@ai/contracts";
import { api } from "@ai/web-kit/http";

const BASE = "/pack/contracts";
const enc = encodeURIComponent;

export const partnerKeys = {
  list: (role: PartnerRole | "all") => ["partners", "list", role] as const,
  ratings: (party: string, role: PartnerRole) => ["partners", party, "ratings", role] as const,
  scoring: (role: PartnerRole) => ["scoring", role] as const,
  history: (role: PartnerRole) => ["scoring", role, "history"] as const,
  // V2-I (khoá bắt đầu `partners` ⇒ mọi thao tác ghi đối tác làm mới cả danh sách v2 lẫn chi tiết)
  repList: ["partners", "rep", "list"] as const,
  counts: ["partners", "counts"] as const,
  repConfig: ["partners", "rep", "config"] as const,
  detail: (party: string, role: RepRole) => ["partners", "rep", "detail", party, role] as const,
  repHistory: (party: string, role: RepRole, months: number) =>
    ["partners", "rep", "history", party, role, months] as const,
  repRatings: (party: string, role: RepRole) =>
    ["partners", "rep", "ratings", party, role] as const,
  profile: (party: string) => ["partners", "profile", party] as const,
  roles: (party: string) => ["partners", "roles", party] as const,
  contracts: (party: string) => ["partners", "contracts", party] as const,
  notes: (party: string) => ["partners", "notes", party] as const,
  products: ["prices", "products"] as const,
  compare: (product: string) => ["prices", "compare", product] as const,
};

export const fetchPartners = (role: PartnerRole | "all", signal?: AbortSignal) =>
  api<PartnerRow[]>(`${BASE}/partners?role=${role}`, { signal });
export const fetchRatings = (party: string, role: PartnerRole, signal?: AbortSignal) =>
  api<PartnerRatings>(`${BASE}/partners/ratings?party=${enc(party)}&role=${role}`, { signal });
export const ratePartner = (b: {
  party: string;
  role: PartnerRole;
  criterion: string;
  value: number;
  note?: string;
}) => api(`${BASE}/partners/ratings`, { method: "PUT", body: b });

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

// ---------- V2-I · Đối tác UI v2: `/reputation/**` (V2-E) + `/partners/{profile,contracts,contract-counts,notes,internet-search}` ----------
const REP = `${BASE}/reputation`;
export const fetchRepPartners = (signal?: AbortSignal) =>
  api<RepPartnerRow[]>(`${REP}/partners?role=all`, { signal });
export const fetchRepDetail = (party: string, role: RepRole, signal?: AbortSignal) =>
  api<RepDetail>(`${REP}/partner?party=${enc(party)}&role=${role}`, { signal });
export const fetchRepHistory = (
  party: string,
  role: RepRole,
  months: number,
  signal?: AbortSignal,
) =>
  api<RepHistory>(`${REP}/history?party=${enc(party)}&role=${role}&months=${months}`, { signal });
export const fetchRepRatings = (party: string, role: RepRole, signal?: AbortSignal) =>
  api<RepRatings>(`${REP}/ratings?party=${enc(party)}&role=${role}`, { signal });
export const rateRep = (b: RepRatingIn) =>
  api<RepRatingRow>(`${REP}/ratings`, { method: "POST", body: b });
export const fetchRepConfig = (signal?: AbortSignal) =>
  api<RepConfigOut>(`${REP}/config`, { signal });

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
