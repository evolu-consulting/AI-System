// CR-118 bundle · hằng số KHÔNG phụ thuộc zod: web gộp import đường này để zod (~370 KB nguồn) không vào JS tải ban đầu.
// Định nghĩa duy nhất ở đây; `app-catalog`, `chat/errors`, `pack-contracts/list` import lại và re-export (đường cũ vẫn dùng được).

/** `GET /me/apps` (bản gốc) và `GET /auth/me/apps` (cùng handler; web gọi đường này vì mọi web đã proxy `/auth`). */
export const MY_APPS_PATH = "/auth/me/apps";

export const RETRY_AFTER_HEADER = "Retry-After";
export const TOO_MANY_RUNS_RETRY_AFTER_S = 5;

/** Gap #10: cột ngày lọc được; cửa sổ tương đối: quá hạn (< hôm nay), 30/60/90 ngày tới (hôm nay … +N). */
export const CONTRACT_DATE_FIELDS = ["end_date", "action_deadline"] as const;
export const CONTRACT_DUE_PRESETS = ["overdue", "30", "60", "90"] as const;

/** CR-121 Q-1 · ứng dụng lọc được (đọc cột `admin.features.app`; `core` luôn bật nên không có). */
export const TENANT_APP_IDS = ["chat", "community", "contracts", "knowledge"] as const;
/** CR-121 c18 · giá trị cột `admin.features.app` (nguồn duy nhất feature → ứng dụng): + `core` (luôn bật) và `other` (chưa phân app, nhóm "Khác"). */
export const FEATURE_APP_IDS = ["core", ...TENANT_APP_IDS, "other"] as const;
/** CR-125 c7 · khoá tính năng "Gửi hợp đồng cho đối tác xác nhận": MỘT chuỗi cho manifest, node, menu hub và màn tính năng admin. */
export const CONTRACTS_PARTNER_CONFIRM_FEATURE = "contracts-partner-confirm";

/** Thực thể / hành động của Nhật ký (định nghĩa duy nhất; `audit.ts` dựng schema zod từ đây và re-export). */
export const AUDIT_ENTITIES = [
  "tenant",
  "user",
  "user_totp",
  "group",
  "grant",
  "entitlement",
  "feature",
  "workflow",
  "command",
  "secret",
  "quota",
  "config",
] as const;
export const AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  "lock",
  "unlock",
  "grant",
  "revoke",
  "restore",
  "import",
] as const;
