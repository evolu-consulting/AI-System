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
  company: Omit<CompanyIn, "approval_enabled" | "allow_negative_stock">;
  version: number;
  updated_at: string;
} | null;
export type ApprovalFlag = { enabled: boolean; by_default: boolean; allow_negative?: boolean };

export type CompanyRepo = {
  company(): Promise<StoredCompany>;
  saveCompany(c: CompanyIn): Promise<NonNullable<StoredCompany>>;
  approval(): Promise<ApprovalFlag>;
  saveApproval(enabled: boolean, actor: string): Promise<void>;
  /** Cài đặt "cho phép giao vượt tồn" + nhật ký trước/sau trong MỘT câu. */
  saveAllowNegative(allow: boolean, actor: string): Promise<void>;
};
