// HD-FR-21 · HD-FR-24 · HD-FR-25 · HD-FR-26 · D2-01 · HD2 plan: cổng của trích hợp đồng. Lớp 2 — chỉ kiểu.
import type { KitTxRepos } from "../../kit/application/index-outbox";
import type { PackUow, PackWho } from "../../kit/application/ports";
import type { ParentFacts } from "../domain/extract-prompt.rules";
import type { Clause, ExtractedItemRow, RawExtraction } from "../domain/extraction.rules";
import type { ContractFields } from "../domain/fields.rules";
import type { ManualItem } from "../domain/manual.rules";
import type { TaxLookup } from "../domain/party.rules";
import type { ItemNumbers, Warning } from "../domain/warnings.rules";

/** Tệp gốc (PDF/ảnh) khi không có văn bản — adapter đưa cho agent đọc trực tiếp. */
export type SourceFile = { org: string; fileId: string; mime: string };

export type AgentFailCode = "AGENT_UNAVAILABLE" | "AGENT_FAILED" | "INVALID_OUTPUT" | "TIMEOUT";
export type AgentReply = { ok: true; raw: RawExtraction } | { ok: false; code: AgentFailCode };

/** Agent trích chạy trong Agent Hub (D2-01). Adapter dựng lời nhắc có rào (domain) + parse strict; không bao giờ ném. */
export type ExtractionAgent = {
  extract(req: {
    who: PackWho;
    contractId: string;
    text: string | null;
    file: SourceFile | null;
    parent: ParentFacts | null;
  }): Promise<AgentReply>;
};

/** Tra MST Cục Thuế (Q10). `fast` = người dùng đang chờ (nhập tay); không bao giờ ném. */
export type TaxRegistry = { lookup(taxId: string, o: { fast: boolean }): Promise<TaxLookup> };

export type ExtractionSource = {
  status: string;
  kind: "contract" | "appendix";
  text: string | null;
  file: SourceFile | null;
  parent: ParentFacts | null;
  fields: unknown;
};
export type LockedForResult = {
  status: string;
  kind: "contract" | "appendix";
  direction: "sale" | "purchase" | null;
  fields: unknown;
  items: ItemNumbers[];
};
export type ExtractionResult = {
  fields: ContractFields;
  items: ExtractedItemRow[] | null;
  clauses: Clause[];
  warnings: Warning[];
};
export type RequestExtractOutcome =
  | { kind: "ok"; version: number }
  | { kind: "not_found" | "busy" | "no_source" | "unavailable" };

export type NewManualContract = {
  id: string;
  title: string;
  direction: "sale" | "purchase";
  fields: ContractFields;
  items: ManualItem[];
  warnings: Warning[];
  userId: string;
};

/** Repo trong tx `PackUow` (RLS tenant): mỗi hàm MỘT câu SQL. */
export type ExtractionRepo = {
  /** Văn bản + tệp + tóm tắt HĐ gốc (phụ lục) của HĐ; không có / tenant khác ⇒ null. */
  source(id: string): Promise<ExtractionSource | null>;
  /** `FOR UPDATE` hàng HĐ + số liệu dòng hàng hiện có. */
  lock(id: string): Promise<LockedForResult | null>;
  /** Một CTE: UPDATE HĐ (needs_review) + INSERT dòng hàng (lô JSON) + event `extracted`. */
  saveResult(id: string, r: ExtractionResult): Promise<void>;
  /** Còn `extracting` ⇒ UPDATE `extract_failed` + `error` (mã) + event; trả có ghi hay không. */
  saveFailure(id: string, code: string): Promise<boolean>;
  /** Trích lại: khoá + kiểm trạng thái/nguồn + đặt `extracting` + event, một câu. */
  requestExtract(id: string, actor: string): Promise<RequestExtractOutcome>;
  /** Nhập tay: một CTE (HĐ + dòng hàng + event `created_manual`). */
  insertManual(c: NewManualContract): Promise<{ id: string; version: number }>;
};
export type ExtractionTxRepos = { extraction: ExtractionRepo } & KitTxRepos;
export type ExtractionUow = PackUow<ExtractionTxRepos>;
