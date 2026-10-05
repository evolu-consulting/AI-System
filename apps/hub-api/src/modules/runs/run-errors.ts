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

/** H2b-R27 (F4, P15): như `runErrorText`, trừ `UPSTREAM_ERROR` + `reason = "refused"` → `hint` riêng (`plan-errors` §2). */
export function runErrorTextFor(
  code: ChatRunErrorCode,
  locale: RunLocale,
  reason: string | null,
): RunErrorText {
  const t = runErrorText(code, locale);
  return code === "UPSTREAM_ERROR" && reason === "refused"
    ? { ...t, hint: REFUSED_HINT[locale] }
    : t;
}
