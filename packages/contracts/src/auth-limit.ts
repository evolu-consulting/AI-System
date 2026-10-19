// L1 (TECH-DEBT #224) · mã lỗi giới hạn đăng nhập của `/auth/*` — bổ sung (additive), tách khỏi `API_ERRORS` như
// `CHAT_API_ERRORS` để không đổi bảng mã M1–M4 đã khoá. Khoá tài khoản vẫn là 423 `TEMP_LOCKED {until}` (M1).
import { z } from "zod";

export const AUTH_LIMIT_ERRORS = {
  /** Vượt trần theo IP; kèm header `Retry-After` (giây) và `details.retry_after_s`. */
  RATE_LIMITED: 429,
  /** Kho đếm (Redis) không dùng được hoặc hàng đợi băm mật khẩu đầy — đóng an toàn, thử lại sau. */
  AUTH_UNAVAILABLE: 503,
} as const satisfies Record<string, 429 | 503>;

export type AuthLimitErrorCode = keyof typeof AUTH_LIMIT_ERRORS;

export const RateLimitedDetailsSchema = z.strictObject({
  retry_after_s: z.number().int().min(1),
});
export type RateLimitedDetails = z.infer<typeof RateLimitedDetailsSchema>;
