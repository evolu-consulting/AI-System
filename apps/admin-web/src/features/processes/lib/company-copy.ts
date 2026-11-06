// CR-121 c17b · nhận diện bản RIÊNG của công ty (sao từ thư viện). Logic thuần.
type DefLike = { source_template_id?: string | null; slot_body?: unknown };

/** Bản riêng = có nguồn thư viện và không phải editor thư viện (platform); sửa thẳng, không Xuất bản. */
export const isCompanyCopy = (def: DefLike | undefined, lib: unknown): boolean =>
  !!def?.source_template_id && !lib;

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

/** Bản riêng DÙNG ĐƯỢC Form bước dọc chung ⇔ Hub trả `slot_body` (bản sao cũ chưa có body ⇒ chỉ Sơ đồ). */
export const usesStepForm = <D extends DefLike>(def: D | undefined, lib: unknown): D | null =>
  def && isCompanyCopy(def, lib) && def.slot_body != null ? def : null;
