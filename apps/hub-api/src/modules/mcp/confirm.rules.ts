// HUB-FR-95 · H2a-R21, R22 · xác nhận workflow `side_effect` (plan-db §3, plan-errors §5, plan §2.3). Thuần.
import type { Locale } from "@ai/contracts";
import type { ToolConfirmationRequired } from "@ai/contracts/hub-internal";
import type { ToolResult } from "./mcp.rules";

export type ConfirmationPrompt = { question: string; choices: [string, string] };

const AGREE = new Set(["đồng ý", "agree"]);

const PROMPT: Record<Locale, ConfirmationPrompt> = {
  vi: {
    question: "Thao tác này sẽ thay đổi dữ liệu ở hệ thống bên ngoài. Bạn có muốn tiếp tục?",
    choices: ["Đồng ý", "Huỷ"],
  },
  en: {
    question: "This action will change data in an external system. Do you want to continue?",
    choices: ["Agree", "Cancel"],
  },
};

const INSTRUCTION: Record<Locale, string> = {
  vi: "CONFIRMATION_REQUIRED: Công cụ này cần người dùng xác nhận trước. Dừng lại và trả need_input với đúng question và choices trong structuredContent; không gọi lại công cụ trong lượt này.",
  en: "CONFIRMATION_REQUIRED: This tool needs user confirmation first. Stop and return need_input with exactly the question and choices in structuredContent; do not call the tool again this turn.",
};

/** NFC, trim, lower ∈ {"đồng ý", "agree"} — cả hai locale. */
export function isAgreeReply(content: string): boolean {
  return AGREE.has(content.normalize("NFC").trim().toLowerCase());
}

/** Nguyên văn plan-errors §5. */
export function confirmationPrompt(locale: Locale): ConfirmationPrompt {
  const p = PROMPT[locale];
  return { question: p.question, choices: [...p.choices] };
}

/** Câu chỉ dẫn `content[1].text`, nguyên văn plan-errors §5. */
export function confirmationInstruction(locale: Locale): string {
  return INSTRUCTION[locale];
}

/**
 * Kết quả `tools/call` khi cần xác nhận (plan §2.3): `content[0].text` = JSON `ToolConfirmationRequired` (model không thấy
 * `structuredContent` — spike S2), `content[1].text` = câu chỉ dẫn, `structuredContent` = cùng object.
 */
export function confirmationRequiredResult(locale: Locale): ToolResult {
  const body: ToolConfirmationRequired = {
    code: "CONFIRMATION_REQUIRED",
    ...confirmationPrompt(locale),
  };
  return {
    content: [
      { type: "text", text: JSON.stringify(body) },
      { type: "text", text: confirmationInstruction(locale) },
    ],
    isError: true,
    structuredContent: { ...body },
  };
}
