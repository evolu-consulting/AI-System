// HUB-FR-10/11 · lỗi E12 trước stream hiện TRONG composer (plan-frontend §0 D5, §1.4): chọn câu + gợi ý từ `ApiError`.
// F2 đã thêm `AGENT_NOT_FOUND`, `TOO_MANY_RUNS`; F3 thêm `ATTACHMENT_NOT_FOUND`; CR-054 thêm `DEFAULT_AGENT_FORBIDDEN`.
import { CMD_SUGGESTIONS_MAX, PROCESS_RUNS_PER_TENANT } from "@ai/contracts/chat";
import { leadingTag } from "~/features/agents/lib/mention";
import { leadingCommand } from "~/features/commands/lib/slash";
import type { ApiError } from "~/lib/http";

const COMPOSER_CODES: ReadonlySet<string> = new Set([
  "CMD_NOT_FOUND",
  "CMD_MISSING_ARG",
  "AGENT_NOT_FOUND",
  "TOO_MANY_RUNS",
  "ATTACHMENT_NOT_FOUND",
  "DEFAULT_AGENT_FORBIDDEN",
  // P-a (CR-056): `!key` ở composer + `@agent` trong thread quy trình + tệp đính kèm ở Hỏi AI (client-side).
  "PROCESS_NOT_FOUND",
  "TOO_MANY_PROCESS_RUNS",
  "PROCESS_THREAD_NO_AGENT",
  "PROCESS_ATTACH_UNSUPPORTED",
]);

/**
 * Mã 429 có đếm ngược `Retry-After`. D7 (UAT 2026-10-11): `TOO_MANY_PROCESS_RUNS` KHÔNG đếm ngược —
 * lượt `needs_decision` giữ chỗ tới khi quyết/huỷ (không theo thời gian), nên không khoá Gửi theo giây.
 */
export const isCooldownCode = (code: string): boolean => code === "TOO_MANY_RUNS";

/** X2b-2 D8: `!key` kèm tệp ở phòng ⇒ 400 `VALIDATION_ERROR` path `attachment_ids`. */
const isBangAttachError = (err: ApiError, text: string): boolean => {
  if (err.code !== "VALIDATION_ERROR" || leadingBangKey(text) === null) return false;
  const issues = detailsOf(err).issues;
  return (
    Array.isArray(issues) &&
    issues.some((i) => Array.isArray(i?.path) && (i.path as unknown[])[0] === "attachment_ids")
  );
};

/** `text` (chữ đã gửi) chỉ cần cho ca `!key` + tệp ở phòng. */
export const isComposerError = (err: ApiError, text?: string): boolean =>
  COMPOSER_CODES.has(err.code) || (text !== undefined && isBangAttachError(err, text));

export type SendErrorLine = { key: string; params: Record<string, string> };
export type SendErrorView = {
  lines: SendErrorLine[];
  suggestions: string[];
  /** Tiền tố nút gợi ý (mặc định `/`; agent → `@`). */
  suggestionPrefix?: "@" | "!";
  /** Tag không tìm thấy (để thay bằng gợi ý). */
  tag?: string;
};

/** `!key` đầu tin (không phải `!!`): để dựng câu "Không tìm thấy quy trình". */
const leadingBangKey = (text: string): string | null =>
  /^!([a-z0-9-]+)/.exec(text.trimStart())?.[1] ?? null;

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

function missingArgView(d: Record<string, unknown>, text: string): SendErrorView {
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

/** Lỗi của quy trình (P-a): `!key` không có, 429 quy trình, `@agent` trong thread quy trình. */
function processErrorView(
  err: ApiError,
  text: string,
  d: Record<string, unknown>,
): SendErrorView | null {
  if (err.code === "PROCESS_NOT_FOUND") {
    const key = typeof d.key === "string" ? d.key : (leadingBangKey(text) ?? "");
    return {
      lines: [{ key: "process.composer.error.notFound", params: { key } }],
      suggestions: strings(d.suggestions, CMD_SUGGESTIONS_MAX),
      suggestionPrefix: "!",
      tag: key,
    };
  }
  if (err.code === "TOO_MANY_PROCESS_RUNS") {
    // D7: không hứa đếm ngược — mời người dùng quyết/huỷ một lượt đang chờ.
    return {
      lines: [
        { key: "process.composer.error.tooMany", params: { max: String(PROCESS_RUNS_PER_TENANT) } },
      ],
      suggestions: [],
    };
  }
  if (err.code === "PROCESS_THREAD_NO_AGENT") {
    return { lines: [{ key: "process.thread.err.noAgent", params: {} }], suggestions: [] };
  }
  // Mã client-side (không thuộc `ApiErrorCode` của Hub) ⇒ so sánh dạng chuỗi.
  if ((err.code as string) === "PROCESS_ATTACH_UNSUPPORTED") {
    return { lines: [{ key: "process.composer.error.noAttach", params: {} }], suggestions: [] };
  }
  return null;
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
  if (isBangAttachError(err, text)) {
    return { lines: [{ key: "process.composer.error.noAttach", params: {} }], suggestions: [] };
  }
  const proc = processErrorView(err, text, d);
  if (proc) return proc;
  if (err.code === "ATTACHMENT_NOT_FOUND") {
    return { lines: [{ key: "sendError.attachmentNotFound", params: {} }], suggestions: [] };
  }
  if (err.code === "DEFAULT_AGENT_FORBIDDEN") {
    return { lines: [{ key: "sendError.defaultAgentForbidden", params: {} }], suggestions: [] };
  }
  if (err.code === "CMD_MISSING_ARG") return missingArgView(d, text);
  return null;
}
