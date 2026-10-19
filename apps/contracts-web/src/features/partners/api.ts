// HD8-FR-01…06: đối tác + điểm uy tín + cách tính + so giá hàng hoá (`/pack/contracts/{partners,scoring,prices}`) — port
// `mgmt-app/web/src/api/{partners,prices}.ts`. Đối tác = `party` (D7-04). Khoá truy vấn bắt đầu `partners`/`scoring`/`prices`.
import type {
  GoodsCompare,
  PartnerRatings,
  PartnerRole,
  PartnerRow,
  PriceProduct,
  QuoteCreate,
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
