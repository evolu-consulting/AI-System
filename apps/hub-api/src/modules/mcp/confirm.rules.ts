// HUB-FR-95 · H2a-R21, R22 · xác nhận workflow `side_effect` (plan-db §3, plan-errors §5). Thuần. B0: chỉ chữ ký (B9).
import type { Locale } from "@ai/contracts";

export type ConfirmationPrompt = { question: string; choices: [string, string] };

/** NFC, trim, lower ∈ {"đồng ý", "agree"} — cả hai locale. */
export function isAgreeReply(content: string): boolean {
  throw new Error(`not implemented: isAgreeReply(${content.length})`);
}

/** Nguyên văn plan-errors §5. */
export function confirmationPrompt(locale: Locale): ConfirmationPrompt {
  throw new Error(`not implemented: confirmationPrompt(${locale})`);
}

/** Câu chỉ dẫn `content[1].text`, nguyên văn plan-errors §5. */
export function confirmationInstruction(locale: Locale): string {
  throw new Error(`not implemented: confirmationInstruction(${locale})`);
}
