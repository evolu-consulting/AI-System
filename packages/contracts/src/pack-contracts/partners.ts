// HD8-FR-01â€¦08 Â· contract zod cá»§a Ä‘á»‘i tÃ¡c + Ä‘iá»ƒm uy tÃ­n + so giÃ¡ hÃ ng hoÃ¡ (`/pack/contracts/{partners,scoring,prices}`) â€” hÃ¬nh nhÆ°
// mgmt `routes/{scoring,prices}.py`; Ä‘á»‘i tÃ¡c = `party` (khoÃ¡ `tax:`/`name:`, D7-04) thay `company_id`. Tiá»n = sá»‘ nguyÃªn Ä‘á»“ng
// 1â€¦10Â¹âµ (an toÃ n JS). ThÃ¢n strict (khoÃ¡ láº¡ â‡’ 400); cÃ¢u lá»—i luáº­t (422) nhÆ° mgmt.
import { z } from "zod";
import { nfcText } from "./fields";
import { IsoDay, LEDGER_MONEY_MAX, PARTNER_ROLES, type PartnerRole } from "./ledger";

export const SCORE_BANDS = ["good", "fair", "watch"] as const;
export type ScoreBand = (typeof SCORE_BANDS)[number];
const Party = z.string().min(1).max(300);
const Role = z.enum(PARTNER_ROLES);

export const PartnersQuerySchema = z.strictObject({
  role: z.enum(["all", ...PARTNER_ROLES]).default("all"),
});
export const PartnerQuerySchema = z.strictObject({ party: Party, role: Role });
export const ScoringRoleSchema = Role;

export const CriterionInSchema = z.strictObject({
  key: z.string().max(60).nullish(),
  kind: z.enum(["auto", "manual"]).nullish(),
  label: z.string().max(200).nullish(),
  enabled: z.boolean(),
  weight: z.number().int().min(-1000).max(1000),
});
export const RulesSchema = z.strictObject({
  good_from: z.number().int().min(-1000).max(1000),
  fair_from: z.number().int().min(-1000).max(1000),
  min_events: z.number().int().min(-1000).max(1000),
  window_months: z.number().int().min(-1000).max(1000),
  recency_boost: z.boolean(),
  recency_months: z.number().int().min(-1000).max(1000),
  manual_adjust: z.boolean(),
});
export const ScoringDraftSchema = z.strictObject({
  criteria: z.array(CriterionInSchema).max(50),
  rules: RulesSchema,
});
export type ScoringDraft = z.infer<typeof ScoringDraftSchema>;

export const RatingRequestSchema = z.strictObject({
  party: Party,
  role: Role,
  criterion: z.string().min(1).max(60),
  value: z.number().int().min(0).max(100),
  note: nfcText(500).nullish(),
});
export type RatingRequest = z.infer<typeof RatingRequestSchema>;

export const CompareQuerySchema = z.strictObject({ product: z.string().min(1).max(600) });
export const QuoteCreateSchema = z.strictObject({
  product: z.string().min(1).max(600),
  product_name: nfcText(300).nullish(),
  unit: nfcText(40).nullish(),
  supplier_name: nfcText(200).pipe(z.string().trim().min(1)),
  supplier_tax_id: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z-]{0,30}$/)
    .nullish(),
  price: z.number().int().min(1).max(LEDGER_MONEY_MAX),
  quoted_at: IsoDay,
  url: z
    .url({ protocol: /^https?$/ })
    .max(2000)
    .nullish(),
  note: nfcText(500).nullish(),
});
export type QuoteCreate = z.infer<typeof QuoteCreateSchema>;

// ---------- ra ----------
export type Criterion = {
  key: string;
  kind: "auto" | "manual";
  label: string;
  enabled: boolean;
  weight: number;
};
export type ScoreRules = z.infer<typeof RulesSchema>;
export type ScoreConfigOut = {
  role: PartnerRole;
  version: number;
  criteria: Criterion[];
  rules: ScoreRules;
  updated_by: string | null;
  updated_at: string | null;
  restorable: { key: string; label: string; weight: number }[];
  manual_choices: string[];
};
export type PartnerRow = {
  party: string;
  name: string;
  role: PartnerRole;
  roles: PartnerRole[];
  score: number | null;
  band: ScoreBand | null;
  reason: string;
  event_count: number;
  adjust: number;
  contracts: number;
};
export type BreakdownItem = {
  value: number | null;
  detail: string | null;
  label: string;
  by?: string | null;
  at?: string;
};
export type PartnerScore = PartnerRow & { breakdown: Record<string, BreakdownItem> };
export type ScorePreview = {
  changes: {
    party: string;
    name: string;
    old: number | null;
    new: number | null;
    band_old: ScoreBand | null;
    band_new: ScoreBand | null;
  }[];
  changed_band: number;
  total: number;
};
export type ScoreHistoryRow = { version: number; at: string; by: string | null; summary: string };
export type RatingEntry = {
  id: string;
  value: number;
  note: string | null;
  by: string | null;
  at: string;
  rated_at: string | null;
};
export type PartnerRatings = {
  criteria: {
    key: string;
    label: string;
    weight: number;
    enabled: boolean;
    current: (RatingEntry & { counts: boolean }) | null;
  }[];
  history: (RatingEntry & { criterion: string; label: string })[];
};
export type PriceProduct = { key: string; label: string; unit: string | null };
export type GoodsPriceRow = {
  supplier: string;
  party: string;
  price: number;
  unit: string | null;
  score: number | null;
  band: ScoreBand | null;
  is_new: boolean;
  source: {
    type: "contract" | "quote" | "website";
    date: string | null;
    contract_id?: string;
    quote_id?: string;
    url?: string | null;
  };
};
export type GoodsCompare = {
  product: PriceProduct;
  rows: GoodsPriceRow[];
  market: { status: "ok" | "tbd"; min?: number; max?: number; seen?: string | null };
};
