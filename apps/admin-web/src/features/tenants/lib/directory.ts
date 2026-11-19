// CR-124 q2 · danh bạ công ty: luật dấu «Đã xác minh» ở Công ty › Hồ sơ (logic thuần). CR-187: công tắc «cho tìm thấy» đã chuyển sang Sổ Hợp Tác › Đối tác.
import type { TenantCompanyProfile } from "@ai/contracts/tenants";

type P = Pick<TenantCompanyProfile, "tax_code" | "directory_verified">;

export type DirectoryView = {
  /** Công tắc "Đã xác minh": chỉ quản trị nền tảng; cần có MST để đối chiếu. */
  verified: {
    visible: boolean;
    checked: boolean;
    enabled: boolean;
    at: string | null;
    by: string | null;
  };
};

export function directoryView(p: P, isPlatform: boolean): DirectoryView {
  return {
    verified: {
      visible: isPlatform,
      checked: p.directory_verified !== null,
      enabled: isPlatform && (p.directory_verified !== null || Boolean(p.tax_code)),
      at: p.directory_verified?.at ?? null,
      by: p.directory_verified?.by_name ?? null,
    },
  };
}
