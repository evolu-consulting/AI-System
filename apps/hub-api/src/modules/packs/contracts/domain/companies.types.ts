// HD8-FR-09 · V2-L · ADR-0023: bản sao kiểu DTO danh bạ công ty + cài đặt công ty (`@ai/contracts`) cho lớp 1–2 — chỉ kiểu, khớp
// hai chiều kiểm ở `dto-mirror.test.ts`.
import type { PartnerRole } from "./ledger.rules";

export type Company = {
  party: string;
  tax_id: string | null;
  name: string | null;
  short_name: string | null;
  international_name: string | null;
  address: string | null;
  status: string | null;
  active: boolean | null;
  edited: string[];
  registry_result: string | null;
  created_from: string;
};

export type CompanyRow = Company & { contract_count: number; roles: PartnerRole[] };

export type CompanyIn = {
  name: string | null;
  app_name: string | null;
  logo: string | null;
  accent: "indigo" | "blue" | "teal" | "green" | "orange" | "rose";
  theme: "auto" | "light" | "dark";
  own_names: string[];
  own_tax_ids: string[];
  approval_enabled: boolean;
  allow_negative_stock?: boolean | undefined;
};

export type CompanyOut = {
  company: Omit<CompanyIn, "approval_enabled" | "allow_negative_stock">;
  approval_enabled: boolean;
  allow_negative_stock: boolean;
  defaults: CompanyIn;
  version: number;
  updated_at: string | null;
};
