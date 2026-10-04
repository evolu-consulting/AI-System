// HUB-BR-04 · C1-R04 · runErrorText — bảng câu lỗi vi/en nguyên văn (test-plan-cases H1 §1 R16; plan-errors.md).
import { describe, expect, it } from "bun:test";
import {
  CHAT_ERROR_TEXT_MAX,
  CHAT_RUN_ERROR_CODES,
  type ChatRunErrorCode,
} from "@ai/contracts/chat";
import { runErrorText } from "../../../../apps/hub-api/src/modules/runs/run-errors";

type Text = { message: string; hint: string };
const RETRY_VI = "Thử lại; nếu vẫn lỗi, báo quản trị viên.";
const RETRY_EN = "Try again; if it still fails, contact your administrator.";

const TABLE: Record<ChatRunErrorCode, { vi: Text; en: Text }> = {
  ALL_PROVIDERS_EXHAUSTED: {
    vi: {
      message: "Tất cả dịch vụ AI đang quá tải nên chưa trả lời được.",
      hint: "Thử lại sau ít phút.",
    },
    en: {
      message: "All AI services are overloaded, so no answer could be produced.",
      hint: "Try again in a few minutes.",
    },
  },
  TIMEOUT: {
    vi: { message: "Hệ thống phản hồi quá lâu nên yêu cầu đã dừng.", hint: "Thử lại sau ít phút." },
    en: {
      message: "The system took too long to respond, so the request was stopped.",
      hint: "Try again in a few minutes.",
    },
  },
  UPSTREAM_ERROR: {
    vi: { message: "Dịch vụ AI trả lỗi khi xử lý yêu cầu.", hint: RETRY_VI },
    en: {
      message: "The AI service returned an error while processing the request.",
      hint: RETRY_EN,
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
    vi: { message: "Có lỗi khi xử lý yêu cầu.", hint: RETRY_VI },
    en: { message: "Something went wrong processing the request.", hint: RETRY_EN },
  },
};

describe("R16 · runErrorText [HUB-BR-04]", () => {
  for (const code of CHAT_RUN_ERROR_CODES) {
    it(`R16 · ${code} vi/en khớp nguyên văn plan-errors [HUB-BR-04 · C1-R04]`, () => {
      expect(runErrorText(code, "vi")).toEqual(TABLE[code].vi);
      expect(runErrorText(code, "en")).toEqual(TABLE[code].en);
    });
  }

  it('R16 · CANCELLED có hint === "" ở cả 2 locale [HUB-BR-04]', () => {
    expect(runErrorText("CANCELLED", "vi").hint).toBe("");
    expect(runErrorText("CANCELLED", "en").hint).toBe("");
  });

  it("R16 · message 1–500 ký tự, hint luôn là string ≤ 500 [HUB-BR-04 · C1-R04]", () => {
    for (const code of CHAT_RUN_ERROR_CODES) {
      for (const locale of ["vi", "en"] as const) {
        const t = runErrorText(code, locale);
        expect(t.message.length).toBeGreaterThanOrEqual(1);
        expect(t.message.length).toBeLessThanOrEqual(CHAT_ERROR_TEXT_MAX);
        expect(typeof t.hint).toBe("string");
        expect(t.hint.length).toBeLessThanOrEqual(CHAT_ERROR_TEXT_MAX);
      }
    }
  });
});
