// HD-FR-21 · HD-FR-22 · ADR-0023: bản sao kiểu bản đọc của agent (`@ai/contracts` pack-contracts/extract) cho lớp 1–2 — chỉ kiểu,
// khớp hai chiều kiểm ở `dto-mirror.test.ts`.

export type AiUnsureKey =
  | "number"
  | "type"
  | "title"
  | "deal"
  | "supplier_name"
  | "supplier_tax_id"
  | "supplier_address"
  | "supplier_representative"
  | "buyer_name"
  | "buyer_tax_id"
  | "buyer_representative"
  | "signed_date"
  | "start_date"
  | "end_date"
  | "effective_date"
  | "auto_renew"
  | "notice_days"
  | "total_value"
  | "vat_rate"
  | "vat_included"
  | "payment_terms"
  | "delivery_terms"
  | "warranty"
  | "penalty";

export type AiSummary = {
  main: string;
  deadlines: string[];
  penalties: string[];
  bonuses: string[];
  clauses: string[];
};

export type AiMilestone = {
  kind: "delivery" | "collect" | "pay" | "commission" | "serial" | "renewal" | "other";
  title: string | null;
  due_date: string | null;
  amount: number | null;
  quote: string;
  /** CR-127 K7 · BR-43: điều khoản gốc (tuỳ chọn). */
  clause_ref?: string | null | undefined;
  page?: number | null | undefined;
};

export type AiNoteGroup = "penalty" | "payment" | "delivery" | "warranty" | "renewal" | "dispute";
export type AiNote = {
  group: AiNoteGroup;
  text: string;
  clause_ref?: string | null | undefined;
  page?: number | null | undefined;
  party?: "ours" | "partner" | null | undefined;
};
export type AiRiskKind =
  | "auto_renew"
  | "no_suspension_clause"
  | "one_sided_penalty"
  | "unlimited_liability"
  | "short_notice"
  | "missing_acceptance"
  | "other";
export type AiRisk = { kind: AiRiskKind; text: string; clause_ref?: string | null | undefined };
/** BR-56: điều khoản phạt dạng số do AI trích (`party` = bên bị phạt). */
export type PenaltyTermInput = {
  party: "ours" | "partner";
  trigger: "late_delivery" | "late_payment" | "other";
  rate_pct: number | null;
  basis: "per_day_of_value" | "per_day_of_milestone" | "fixed";
  cap_pct?: number | null | undefined;
  cap_amount?: number | null | undefined;
  clause_ref?: string | null | undefined;
  page?: number | null | undefined;
  quote: string;
};

export type AiRead = {
  deal: "referral" | "buy" | "sell" | null;
  unsure: AiUnsureKey[];
  summary: AiSummary | null;
  milestones: (AiMilestone & { verified: boolean })[];
  /** CR-101 Câu 9: loại chứng từ AI gợi ý (vắng ở bản trích cũ). */
  doc_type_suggest?: "contract" | "framework" | "deal" | null;
  /** CR-127 K7 · BR-55: thẻ "Điều cần lưu ý" / "Cần chú ý" (vắng ở bản trích cũ). */
  notes?: AiNote[];
  risks?: AiRisk[];
};
