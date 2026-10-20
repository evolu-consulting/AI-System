// HD-FR-21 · HD-FR-24 · HD-FR-25 · HD-FR-26 · D2-01 · HD2 plan: cổng của trích hợp đồng. Lớp 2 — chỉ kiểu.
import type { AiRead } from "@ai/contracts";
import type { KitTxRepos } from "../../kit/application/index-outbox";
import type { PackUow, PackWho } from "../../kit/application/ports";
import type { ParentFacts } from "../domain/extract-prompt.rules";
import type {
  Clause,
  ExtractedItemRow,
  RawExtraction,
  VerifiedExtraction,
} from "../domain/extraction.rules";
import type { ContractFields } from "../domain/fields.rules";
import type { ManualItem } from "../domain/manual.rules";
import type { Deal } from "../domain/milestones.rules";
import type { TaxLookup } from "../domain/party.rules";
import type { ItemNumbers, Warning } from "../domain/warnings.rules";
import type { MilestoneWrite } from "./milestones.ports";

/** Tệp gốc (PDF/ảnh) khi không có văn bản — adapter đưa cho agent đọc trực tiếp. */
export type SourceFile = { org: string; fileId: string; mime: string };

export type AgentFailCode =
  | "AGENT_UNAVAILABLE"
  | "AGENT_FAILED"
  | "INVALID_OUTPUT"
  | "TIMEOUT"
  /** M3 · trần token AI/ngày của tenant đã hết (AI client chung). */
  | "AI_CAP_EXCEEDED";
export type AgentReply = { ok: true; raw: RawExtraction } | { ok: false; code: AgentFailCode };

/** M3 · D3-04 · tệp gốc ⇒ chữ (PDF có lớp chữ, ADR-0028). `null` ⇒ loại tệp không đọc được ở đây (ảnh) ⇒ đường cũ. PDF scan ⇒
 *  `PDF_NEEDS_OCR`. Không ném. */
export type SourceFileText = (
  who: PackWho,
  f: SourceFile,
) => Promise<{ ok: true; text: string } | { ok: false; code: string } | null>;

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

/** Kiểm trích dẫn (phần nặng) NGOÀI tx; văn bản lớn chạy ở Worker (review Trung 1). Có thể ném (use case ⇒ `SAVE_FAILED`). */
export type ExtractionVerifier = {
  verify(i: {
    raw: RawExtraction;
    source: string | null;
    kind: "contract" | "appendix";
  }): Promise<VerifiedExtraction>;
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
  version: number;
  /** Số liệu dòng hàng hiện có (cảnh báo tổng lệch khi giữ dòng cũ — D2-08). */
  items: ItemNumbers[];
};
export type ExtractionResult = {
  fields: ContractFields;
  items: ExtractedItemRow[] | null;
  clauses: Clause[];
  warnings: Warning[];
  /** V2-G: phần AI đọc (null ⇒ bản trích cũ: giữ nguyên `ai_read` hiện có). */
  ai: AiRead | null;
};
export type RequestExtractOutcome =
  | { kind: "ok"; version: number }
  | { kind: "not_found" | "busy" | "no_source" | "unavailable" | "not_allowed" };

export type NewManualContract = {
  id: string;
  title: string;
  direction: "sale" | "purchase";
  /** V2-A: loại HĐ + hoa hồng (Giới thiệu). */
  deal: Deal;
  commissionPct: number | null;
  commissionFixed: number | null;
  /** V2-A · HD-01: mốc mặc định — chỉ ghi khi tenant TẮT duyệt (`contracts.approval_on()` trong cùng câu ⇒ HĐ `active`). */
  milestones: MilestoneWrite[];
  fields: ContractFields;
  items: ManualItem[];
  warnings: Warning[];
  userId: string;
};

/** Repo trong tx `PackUow` (RLS tenant): mỗi hàm MỘT câu SQL. */
export type ExtractionRepo = {
  /** Văn bản + tệp + tóm tắt HĐ gốc (phụ lục) của HĐ; không có / tenant khác ⇒ null. */
  source(id: string): Promise<ExtractionSource | null>;
  /** Một CTE có điều kiện `version = expected` ∧ `extracting` (không khoá trước): UPDATE HĐ + INSERT dòng hàng (lô JSON) +
   * event `extracted`. `false` ⇒ hàng đã đổi (sửa tay mới hơn / trạng thái khác) ⇒ người gọi đọc lại rồi gộp lại. */
  saveResult(id: string, r: ExtractionResult & { expected: number }): Promise<boolean>;
  /** Tra MST lại (`needs_review`, `version = expected`): chỉ thay `warnings`, không tăng version. */
  saveWarnings(id: string, warnings: Warning[], expected: number): Promise<boolean>;
  /** Còn `extracting` ⇒ UPDATE `extract_failed` + `error` (mã) + event; trả có ghi hay không. */
  saveFailure(id: string, code: string): Promise<boolean>;
  /** Trích lại: khoá + kiểm trạng thái/nguồn + đặt `extracting` + event, một câu. */
  requestExtract(id: string, actor: string): Promise<RequestExtractOutcome>;
  /** Nhập tay: một CTE (HĐ + dòng hàng + event `created_manual`). */
  insertManual(
    c: NewManualContract,
  ): Promise<{ id: string; version: number; status: "needs_review" | "active" }>;
};
export type ExtractionTxRepos = { extraction: ExtractionRepo } & KitTxRepos;
export type ExtractionUow = PackUow<ExtractionTxRepos>;
