// HD8-FR-09 · V2-L · ADR-0023: cổng repo danh bạ công ty + cài đặt công ty (lớp 2 — chỉ kiểu); `adapters/companies.repo.ts`,
// `adapters/company.repo.ts` cài.
import type { Company, CompanyIn } from "../domain/companies.types";

export type CompanyUse = {
  party: string;
  contract_count: number;
  roles: ("customer" | "supplier")[];
};

export type CompaniesRepo = {
  insert(c: Company): Promise<Company | null>;
  save(c: Company): Promise<Company>;
  list(): Promise<{ companies: Company[]; use: CompanyUse[] }>;
  get(party: string, lock?: boolean): Promise<Company | null>;
};

export type StoredCompany = {
  company: Omit<CompanyIn, "allow_negative_stock" | "legal_warn_threshold" | "cover"> & {
    has_cover: boolean;
  };
  version: number;
  updated_at: string;
} | null;
/** Cài đặt kho/pháp lý của công ty (đọc cùng bảng `approval_settings`). */
export type ApprovalFlag = {
  allow_negative?: boolean;
  legal_warn_threshold?: number;
};

export type CompanyRepo = {
  company(): Promise<StoredCompany>;
  saveCompany(c: CompanyIn): Promise<NonNullable<StoredCompany>>;
  approval(): Promise<ApprovalFlag>;
  /** CR-138 Q9: ảnh bìa (data URL) hoặc null. */
  cover(): Promise<string | null>;
  /** Cài đặt "cho phép giao vượt tồn" + nhật ký trước/sau trong MỘT câu. */
  saveAllowNegative(allow: boolean, actor: string): Promise<void>;
  /** DOC-legal: ngưỡng cảnh báo pháp lý + nhật ký trước/sau trong MỘT câu. */
  saveLegalThreshold(v: number, actor: string): Promise<void>;
};
