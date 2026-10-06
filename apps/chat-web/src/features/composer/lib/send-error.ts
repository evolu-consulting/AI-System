// HUB-FR-10/11 · lỗi E12 trước stream hiện TRONG composer (plan-frontend §0 D5, §1.4): chọn câu + gợi ý từ `ApiError`.
// F2 đã thêm `AGENT_NOT_FOUND`, `TOO_MANY_RUNS`; F3 thêm `ATTACHMENT_NOT_FOUND`.
import { CMD_SUGGESTIONS_MAX } from "@ai/contracts/chat";
import { leadingTag } from "~/features/agents/lib/mention";
import { leadingCommand } from "~/features/commands/lib/slash";
import type { ApiError } from "~/lib/http";

const COMPOSER_CODES: ReadonlySet<string> = new Set([
  "CMD_NOT_FOUND",
  "CMD_MISSING_ARG",
  "AGENT_NOT_FOUND",
  "TOO_MANY_RUNS",
]);

export const isComposerError = (err: ApiError): boolean => COMPOSER_CODES.has(err.code);

export type SendErrorLine = { key: string; params: Record<string, string> };
export type SendErrorView = {
  lines: SendErrorLine[];
  suggestions: string[];
  /** Tiền tố nút gợi ý (mặc định `/`; agent → `@`). */
  suggestionPrefix?: "@";
  /** Tag không tìm thấy (để thay bằng gợi ý). */
  tag?: string;
};

/** Giây chờ mặc định khi 429 không kèm `Retry-After` hợp lệ (đã chuẩn hoá ở `lib/http`). */
export const retrySecondsOf = (err: ApiError): number => err.retryAfter ?? 5;

function strings(v: unknown, max: number): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max) : [];
}

/** `details` đọc rộng tay (Hub có thể kèm trường thừa như `name`); sai dạng → bỏ phần đó. */
function detailsOf(err: ApiError): Record<string, unknown> {
  return err.details && typeof err.details === "object"
    ? (err.details as Record<string, unknown>)
    : {};
}

/** `null` khi mã không thuộc composer. `text` = chữ đã gửi (nguồn của `{name}`/`{tag}`). */
export function sendErrorView(
  err: ApiError,
  text: string,
  /** 429: giây còn lại (mặc định `Retry-After`). */
  retryLeft?: number,
): SendErrorView | null {
  const d = detailsOf(err);
  if (err.code === "CMD_NOT_FOUND") {
    return {
      lines: [{ key: "sendError.cmdNotFound", params: { name: leadingCommand(text) ?? "" } }],
      suggestions: strings(d.suggestions, CMD_SUGGESTIONS_MAX),
    };
  }
  if (err.code === "AGENT_NOT_FOUND") {
    const tag = typeof d.tag === "string" ? d.tag : (leadingTag(text) ?? "");
    return {
      lines: [{ key: "sendError.agentNotFound", params: { tag } }],
      suggestions: strings(d.suggestions, CMD_SUGGESTIONS_MAX),
      suggestionPrefix: "@",
      tag,
    };
  }
  if (err.code === "TOO_MANY_RUNS") {
    const n = String(Math.max(retryLeft ?? retrySecondsOf(err), 0));
    return { lines: [{ key: "sendError.tooManyRuns", params: { n } }], suggestions: [] };
  }
  if (err.code === "CMD_MISSING_ARG") {
    const tag = leadingTag(text);
    if (tag !== null && leadingCommand(text) === null) {
      return { lines: [{ key: "sendError.tagOnly", params: { tag } }], suggestions: [] };
    }
    const lines: SendErrorLine[] = [
      {
        key: "sendError.cmdMissingArg",
        params: { name: leadingCommand(text) ?? "", missing: strings(d.missing, 50).join(", ") },
      },
    ];
    const invalid = strings(d.invalid, 50);
    if (invalid.length > 0) {
      lines.push({ key: "sendError.cmdInvalid", params: { invalid: invalid.join(", ") } });
    }
    return { lines, suggestions: [] };
  }
  return null;
}
