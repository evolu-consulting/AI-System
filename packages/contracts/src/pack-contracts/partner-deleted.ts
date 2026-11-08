// CR-125 · xoá tenant (tenant-purge) giữ lịch sử của công ty còn lại: bên bị xoá được ẩn danh thay vì xoá dòng hộp thư đối tác.
// MỘT nguồn cho tool xoá (ghi) và màn hình (đọc, đổi sang khoá i18n `contracts.partner.deletedCompany`).

/** Id giả (tombstone) thay `from_tenant`/`to_tenant` của bên đã xoá trong hub.partner_mailbox / partner_links. Không phải tenant thật. */
export const PARTNER_DELETED_TENANT_ID = "00000000-0000-4000-8000-00000000dead";
/** Tên lưu thay tên công ty đã xoá ở bản sao của bên còn lại (contracts.partner_inbox.sender_name / partner_sends.to_name). */
export const PARTNER_DELETED_NAME = "Công ty đã xoá";
/** Khoá liên hệ (partner_sends.to_key) thay MST/email của công ty đã xoá. */
export const PARTNER_DELETED_KEY = "deleted";
/** Khoá i18n màn hình dùng thay tên đã lưu khi bên kia đã bị xoá. */
export const PARTNER_DELETED_I18N_KEY = "contracts.partner.deletedCompany";

/** Tên hiển thị: đã xoá ⇒ khoá i18n (UI dịch), còn lại ⇒ giữ nguyên. */
export const partnerDisplayName = <T extends string | null>(name: T): T | string =>
  name === PARTNER_DELETED_NAME ? PARTNER_DELETED_I18N_KEY : name;
