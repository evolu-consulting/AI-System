// X1-AC07 · HUB-FR-44 · chặn sớm tệp đính kèm (plan-frontend §1.6): đuôi, cỡ, tên, số tệp. Thuần, không I/O.
import {
  ATTACH_ALLOWED,
  ATTACH_FILENAME_HEADER_MAX_BYTES,
  ATTACH_FILENAME_MAX,
  ATTACH_MAX_BYTES,
  ATTACH_PER_MESSAGE_MAX,
} from "@ai/contracts/chat";

export type AttachErrorKey =
  | "attach.err.type"
  | "attach.err.empty"
  | "attach.err.tooLarge"
  | "attach.err.name"
  | "attach.err.max";

export type AttachValidation = { ok: true } | { error: AttachErrorKey };

/** MIME theo đuôi (không tin `file.type`); `undefined` khi đuôi ∉ `ATTACH_ALLOWED`. */
export function mimeByName(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return undefined;
  const ext = name.slice(dot + 1).toLowerCase();
  return Object.hasOwn(ATTACH_ALLOWED, ext)
    ? ATTACH_ALLOWED[ext as keyof typeof ATTACH_ALLOWED]
    : undefined;
}

/** `existing` = các tệp đã chọn cho tin này (tệp thứ 11 → `attach.err.max`). */
export function validateAttachment(
  file: Pick<File, "name" | "size">,
  existing: readonly unknown[] = [],
): AttachValidation {
  if (existing.length >= ATTACH_PER_MESSAGE_MAX) return { error: "attach.err.max" };
  if (mimeByName(file.name) === undefined) return { error: "attach.err.type" };
  if (file.size === 0) return { error: "attach.err.empty" };
  if (file.size > ATTACH_MAX_BYTES) return { error: "attach.err.tooLarge" };
  if (
    file.name.length > ATTACH_FILENAME_MAX ||
    encodeURIComponent(file.name).length > ATTACH_FILENAME_HEADER_MAX_BYTES
  )
    return { error: "attach.err.name" };
  return { ok: true };
}
