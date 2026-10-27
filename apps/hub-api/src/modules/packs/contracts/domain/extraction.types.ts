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
};

export type AiRead = {
  deal: "referral" | "buy" | "sell" | null;
  unsure: AiUnsureKey[];
  summary: AiSummary | null;
  milestones: (AiMilestone & { verified: boolean })[];
  /** CR-101 Câu 9: loại chứng từ AI gợi ý (vắng ở bản trích cũ). */
  doc_type_suggest?: "contract" | "framework" | "deal" | null;
};
