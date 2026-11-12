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
  /** CR-138: khoá một trong 12 màu đặt sẵn hoặc `#rrggbb` tự chọn (đã kiểm ở contract). */
  accent: string;
  /** CR-138 Q9: ảnh bìa công ty (data URL); vắng ⇒ giữ nguyên khi lưu, null ⇒ xoá. */
  cover?: string | null | undefined;
  theme: "auto" | "light" | "dark";
  own_names: string[];
  own_tax_ids: string[];
  allow_negative_stock?: boolean | undefined;
  legal_warn_threshold?: number | undefined;
};

export type CompanyOut = {
  /** CR-138: `has_cover` = đã có ảnh bìa (ảnh lấy ở `GET /company/cover`, không kèm ở đây để khỏi kéo ảnh to vào mỗi lần tải app). */
  company: Omit<CompanyIn, "allow_negative_stock" | "legal_warn_threshold" | "cover"> & {
    has_cover: boolean;
  };
  allow_negative_stock: boolean;
  legal_warn_threshold: number;
  defaults: CompanyIn & { has_cover: boolean };
  version: number;
  updated_at: string | null;
};
