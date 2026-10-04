// HUB-FR-89 · Bảng câu lỗi Run vi/en theo plan-errors.md (plan §6.4). Stub B0.
import type { ChatRunErrorCode } from "@ai/contracts/chat";

export function runErrorText(
  _code: ChatRunErrorCode,
  _locale: "vi" | "en",
): { message: string; hint: string } {
  throw new Error("not implemented");
}
