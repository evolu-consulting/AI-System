// HUB-BR-04 · HUB-FR-89 · P11 · bảng câu lỗi Run vi/en nguyên văn theo `plan-errors.md` (plan §6.4).
// Không tham số động, không tên provider/agent/đường dẫn (H1-R26). `hint` = "" khi không có.
import type { ChatRunErrorCode } from "@ai/contracts/chat";

export type RunLocale = "vi" | "en";
type RunErrorText = { message: string; hint: string };

const RETRY_LATER_VI = "Thử lại sau ít phút.";
const RETRY_LATER_EN = "Try again in a few minutes.";
const RETRY_ADMIN_VI = "Thử lại; nếu vẫn lỗi, báo quản trị viên.";
const RETRY_ADMIN_EN = "Try again; if it still fails, contact your administrator.";

const TEXTS: Record<ChatRunErrorCode, Record<RunLocale, RunErrorText>> = {
  ALL_PROVIDERS_EXHAUSTED: {
    vi: { message: "Tất cả dịch vụ AI đang quá tải nên chưa trả lời được.", hint: RETRY_LATER_VI },
    en: {
      message: "All AI services are overloaded, so no answer could be produced.",
      hint: RETRY_LATER_EN,
    },
  },
  TIMEOUT: {
    vi: { message: "Hệ thống phản hồi quá lâu nên yêu cầu đã dừng.", hint: RETRY_LATER_VI },
    en: {
      message: "The system took too long to respond, so the request was stopped.",
      hint: RETRY_LATER_EN,
    },
  },
  UPSTREAM_ERROR: {
    vi: { message: "Dịch vụ AI trả lỗi khi xử lý yêu cầu.", hint: RETRY_ADMIN_VI },
    en: {
      message: "The AI service returned an error while processing the request.",
      hint: RETRY_ADMIN_EN,
    },
  },
  CANCELLED: {
    vi: { message: "Bạn đã dừng yêu cầu này.", hint: "" },
    en: { message: "You stopped this request.", hint: "" },
  },
  BUDGET_EXCEEDED: {
    vi: { message: "Yêu cầu quá lớn để xử lý một lần.", hint: "Hãy chia nhỏ yêu cầu rồi gửi lại." },
    en: {
      message: "The request is too large to process at once.",
      hint: "Split it into smaller requests and send again.",
    },
  },
  NOT_CONFIGURED: {
    vi: { message: "Tính năng này chưa được cấu hình xong.", hint: "Báo quản trị viên." },
    en: {
      message: "This feature isn't fully configured yet.",
      hint: "Contact your administrator.",
    },
  },
  INTERNAL_ERROR: {
    vi: { message: "Có lỗi khi xử lý yêu cầu.", hint: RETRY_ADMIN_VI },
    en: { message: "Something went wrong processing the request.", hint: RETRY_ADMIN_EN },
  },
};

export function runErrorText(code: ChatRunErrorCode, locale: RunLocale): RunErrorText {
  return { ...TEXTS[code][locale] };
}

/** `hint` F4 khi Runtime phân loại `is_error` 0 token là `refused` (`plan-errors` §2, nguyên văn). */
const REFUSED_HINT: Record<RunLocale, string> = {
  vi: "Yêu cầu chưa xử lý được — hãy diễn đạt lại hoặc chia nhỏ.",
  en: "The request could not be handled — rephrase or split it.",
};

/** H2c-R22 · hint khi Dify từ chối file (`/files/upload` 413/415/400 mã file — reason Hub `file_rejected`, `plan-errors` §2). */
const FILE_REJECTED_HINT: Record<RunLocale, string> = {
  vi: "Dify không nhận file này (loại hoặc kích thước).",
  en: "Dify rejected this file (type or size).",
};

const UPSTREAM_HINTS: ReadonlyMap<string, Record<RunLocale, string>> = new Map([
  ["refused", REFUSED_HINT],
  ["file_rejected", FILE_REJECTED_HINT],
]);

/** H3a-R08 (HUB-BR-04, plan §4.3) · `ALL_PROVIDERS_EXHAUSTED` theo reason — câu tĩnh, không giờ/tên provider (Q5). */
const EXHAUSTED_TEXTS: ReadonlyMap<string, Record<RunLocale, RunErrorText>> = new Map([
  [
    "quota",
    {
      vi: {
        message: "Dịch vụ AI đã dùng hết hạn mức của gói hiện tại.",
        hint: "Thử lại sau; hạn mức sẽ tự mở lại.",
      },
      en: {
        message: "The AI service has used up the current plan's limit.",
        hint: "Try again later; the limit will reset automatically.",
      },
    },
  ],
  [
    "provider_unavailable",
    {
      vi: {
        message: "Dịch vụ AI đang tạm ngưng để quản trị viên kiểm tra.",
        hint: "Báo quản trị viên nếu lỗi kéo dài.",
      },
      en: {
        message: "The AI service is paused for an administrator to check.",
        hint: "Contact your administrator if this persists.",
      },
    },
  ],
]);

/**
 * H2b-R27 (F4, P15) · H2c-R22: như `runErrorText`, trừ `UPSTREAM_ERROR` + `reason` ∈ {`refused`, `file_rejected`} → `hint`
 * riêng (`plan-errors` §2); `message` giữ câu H1. H3a-R08: `ALL_PROVIDERS_EXHAUSTED` + `reason` ∈ {`quota`,
 * `provider_unavailable`} → thay cả `message` và `hint`; reason khác/null → câu H1.
 */
export function runErrorTextFor(
  code: ChatRunErrorCode,
  locale: RunLocale,
  reason: string | null,
): RunErrorText {
  const exhausted =
    code === "ALL_PROVIDERS_EXHAUSTED" && reason !== null ? EXHAUSTED_TEXTS.get(reason) : undefined;
  if (exhausted) return { ...exhausted[locale] };
  const t = runErrorText(code, locale);
  const hint =
    code === "UPSTREAM_ERROR" && reason !== null ? UPSTREAM_HINTS.get(reason) : undefined;
  return hint ? { ...t, hint: hint[locale] } : t;
}
