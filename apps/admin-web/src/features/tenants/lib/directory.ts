// CR-124 q2 · danh bạ công ty: luật hiển thị công tắc ở Công ty › Hồ sơ (logic thuần, test không cần DOM).
import type { TenantCompanyProfile } from "@ai/contracts/tenants";

type P = Pick<
  TenantCompanyProfile,
  "legal_name" | "tax_code" | "directory_listed" | "directory_verified"
>;

export type DirectoryView = {
  /** Công tắc "Cho phép công ty khác tìm thấy": quản trị công ty mới bật được, và chỉ khi đã có tên pháp lý + MST (tắt thì luôn được). */
  listed: { checked: boolean; enabled: boolean; needProfile: boolean };
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
  const hasProfile = Boolean(p.legal_name && p.tax_code);
  return {
    listed: {
      checked: p.directory_listed,
      enabled: !isPlatform && (p.directory_listed || hasProfile),
      needProfile: !isPlatform && !p.directory_listed && !hasProfile,
    },
    verified: {
      visible: isPlatform,
      checked: p.directory_verified !== null,
      enabled: isPlatform && (p.directory_verified !== null || Boolean(p.tax_code)),
      at: p.directory_verified?.at ?? null,
      by: p.directory_verified?.by_name ?? null,
    },
  };
}
