// ADM-FR-37 · CR-043 · X1-R08 · admin-web gọi Hub THẲNG (cross-origin) bằng JWT admin: địa chỉ = `PUBLIC_HUB_URL` (nhúng lúc build).
// Vắng biến → không gọi Hub, màn hiện "Chưa cấu hình địa chỉ Hub" (plan-frontend §0 D6).

/** Bỏ khoảng trắng và `/` cuối; rỗng = chưa cấu hình. */
export function normalizeHubBase(raw: string | undefined): string {
  return (raw ?? "").trim().replace(/\/+$/, "");
}

export const HUB_BASE = normalizeHubBase(import.meta.env.PUBLIC_HUB_URL);

export const hubConfigured = (base: string = HUB_BASE): boolean => base !== "";

/** URL tuyệt đối tới Hub; `path` bắt đầu bằng `/`. Chưa cấu hình → `null` (nơi gọi không được fetch). */
export function hubUrl(path: string, base: string = HUB_BASE): string | null {
  return base ? `${base}${path}` : null;
}
