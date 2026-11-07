// CR-121 c17b · nhận diện bản RIÊNG của công ty (sao từ thư viện). Logic thuần.
type DefLike = {
  source_template_id?: string | null;
  slot_body?: unknown;
  tenant_id?: string | null;
  trigger?: unknown;
};

/** Bản riêng = có nguồn thư viện và không phải editor thư viện (platform); sửa thẳng, không Xuất bản. */
export const isCompanyCopy = (def: DefLike | undefined, lib: unknown): boolean =>
  !!def?.source_template_id && !lib;

/** CR-123 · FR-10: quy trình (flow có trigger) thuộc MỘT công ty — kể cả tự tạo, không sao từ thư viện — không bao giờ là mẫu Thư viện. */
export const isCompanyFlow = (def: DefLike | undefined): boolean =>
  !!def?.tenant_id && typeof def.trigger === "object" && def.trigger !== null;

/** Bản của công ty (sao từ thư viện hoặc flow riêng) ⇒ chỉ MỘT nút "Lưu và áp dụng"; "Xuất bản" chỉ có ở mẫu Thư viện. */
export const isCompanyOwned = (def: DefLike | undefined, lib: unknown): boolean =>
  isCompanyCopy(def, lib) || isCompanyFlow(def);

/** CR-123 u9: người dùng công ty sửa bản của công ty ⇒ chỉ thấy phần nghiệp vụ (không Nguồn / Thông tin đầu vào / Nâng cao). Quản trị nền tảng thấy đủ. */
export const isBusinessView = (
  def: DefLike | undefined,
  lib: unknown,
  isPlatform: boolean,
): boolean => !isPlatform && isCompanyOwned(def, lib);

/** Thanh lưu theo loại: bản của công ty ⇒ "Lưu và áp dụng" + một dòng nói phạm vi; mẫu Thư viện ⇒ "Lưu nháp" (còn "Xuất bản" riêng). */
export const saveModeOf = (
  companyOwned: boolean,
  library: boolean,
): { labelKey: string; noteKey: string | null; canPublish: boolean } =>
  companyOwned
    ? {
        labelKey: "process.admin.editor.saveApply",
        noteKey: "process.admin.editor.applyNote",
        canPublish: false,
      }
    : library
      ? { labelKey: "process.admin.library.saveDraft", noteKey: null, canPublish: true }
      : { labelKey: "common.save", noteKey: null, canPublish: false };

/** Công ty của bản riêng = `tenant_id` CỦA CHÍNH def (một nguồn) — không phụ thuộc `?company=` hay công ty đang chọn (tenant_admin: `tenantId` của hook luôn vắng). */
export const copyTenantId = (def: { tenant_id?: string | null } | undefined): string | undefined =>
  def?.tenant_id ?? undefined;

/** Công ty để đọc chỉ-xem thư viện khi def bị ẩn (404): tenant_admin = công ty của phiên; platform = công ty đang chọn (nếu có). */
export const viewerTenantId = (
  isPlatform: boolean,
  picked: string | undefined,
  sessionTenant: string | undefined,
): string | undefined => (isPlatform ? picked : sessionTenant);

/** `?company=` cho link sang trình sửa / trang lượt chạy: platform_admin cần công ty để Hub đọc def/lượt của công ty đó (tenant_admin: Hub suy từ phiên, tham số bị bỏ qua). Một nguồn: link luôn mang công ty đang xem. */
export const companySearch = (tenantId: string | null | undefined): { company?: string } =>
  tenantId ? { company: tenantId } : {};

/** Công ty dùng để đọc: platform_admin theo `?company=` (nếu có), còn lại theo lựa chọn sẵn có. */
export const scopedTenantId = (
  isPlatform: boolean,
  picked: string | undefined,
  company: string | undefined,
): string | undefined => (isPlatform && company ? company : picked);

/** Kiểu thẻ "Thông tin": thư viện / bản riêng chỉ trường nghiệp vụ + "Nâng cao"; còn lại đủ trường. */
export const infoVariant = (def: DefLike | undefined, lib: unknown): "full" | "library" | "copy" =>
  lib ? "library" : isCompanyOwned(def, lib) ? "copy" : "full";

/** Bản riêng DÙNG ĐƯỢC Form bước dọc chung ⇔ Hub trả `slot_body` (bản sao cũ chưa có body ⇒ chỉ Sơ đồ). */
export const usesStepForm = <D extends DefLike>(def: D | undefined, lib: unknown): D | null =>
  def && isCompanyCopy(def, lib) && def.slot_body != null ? def : null;
