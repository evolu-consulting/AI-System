// HUB-BR-04 · H3a-R08 · câu lỗi Run theo reason — bảng nguyên văn `plan` §4.3 (một chỗ, dùng ở R/A/S và T1).
// Tách khỏi `_h3a.ts` để unit `rules/` không nạp fixture DB (H1 `_fixtures.ts` đòi biến DB lúc import).
export type R08Text = { message: string; hint: string };
export type R08Reason = "quota" | "provider_unavailable";

export const R08: Record<R08Reason, { vi: R08Text; en: R08Text }> = {
  quota: {
    vi: {
      message: "Dịch vụ AI đã dùng hết hạn mức của gói hiện tại.",
      hint: "Thử lại sau; hạn mức sẽ tự mở lại.",
    },
    en: {
      message: "The AI service has used up the current plan's limit.",
      hint: "Try again later; the limit will reset automatically.",
    },
  },
  provider_unavailable: {
    vi: {
      message: "Dịch vụ AI đang tạm ngưng để quản trị viên kiểm tra.",
      hint: "Báo quản trị viên nếu lỗi kéo dài.",
    },
    en: {
      message: "The AI service is paused for an administrator to check.",
      hint: "Contact your administrator if this persists.",
    },
  },
};

/** Câu H1 `ALL_PROVIDERS_EXHAUSTED` (H1 `rules/run-errors.test.ts`) — reason khác/null giữ nguyên (R14). */
export const H1_EXHAUSTED: { vi: R08Text; en: R08Text } = {
  vi: {
    message: "Tất cả dịch vụ AI đang quá tải nên chưa trả lời được.",
    hint: "Thử lại sau ít phút.",
  },
  en: {
    message: "All AI services are overloaded, so no answer could be produced.",
    hint: "Try again in a few minutes.",
  },
};
