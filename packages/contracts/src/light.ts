// CR-118 bundle · hằng số KHÔNG phụ thuộc zod: web gộp import đường này để zod (~370 KB nguồn) không vào JS tải ban đầu.
// Định nghĩa duy nhất ở đây; `app-catalog`, `chat/errors`, `pack-contracts/list` import lại và re-export (đường cũ vẫn dùng được).

/** `GET /me/apps` (bản gốc) và `GET /auth/me/apps` (cùng handler; web gọi đường này vì mọi web đã proxy `/auth`). */
export const MY_APPS_PATH = "/auth/me/apps";

export const RETRY_AFTER_HEADER = "Retry-After";
export const TOO_MANY_RUNS_RETRY_AFTER_S = 5;

/** Gap #10: cột ngày lọc được; cửa sổ tương đối: quá hạn (< hôm nay), 30/60/90 ngày tới (hôm nay … +N). */
export const CONTRACT_DATE_FIELDS = ["end_date", "action_deadline"] as const;
export const CONTRACT_DUE_PRESETS = ["overdue", "30", "60", "90"] as const;
