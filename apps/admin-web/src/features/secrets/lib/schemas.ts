// ADM-FR-50 · M2-R01 · schema form secret; hằng số từ @ai/contracts, thông điệp là KEY i18n (plan-frontend §4).
import { SECRET_NAME_RE, SECRET_NOTE_MAX, SECRET_VALUE_MAX, SECRET_VALUE_MIN } from "@ai/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";
import { z } from "zod";

export type SecretFormMode = "create" | "replace" | "note";
export type SecretFormValues = { name: string; value: string; note: string };

const name = z.string().trim().toUpperCase().regex(SECRET_NAME_RE, "secrets.error.nameFormat");
/** Rỗng → "Nhập giá trị secret"; 8–2048 theo UTF-16, không trim (khớp contract). */
const value = z
  .string()
  .min(1, "secrets.error.valueRequired")
  .superRefine((v, ctx) => {
    if (v.length < SECRET_VALUE_MIN || v.length > SECRET_VALUE_MAX) {
      ctx.addIssue({ code: "custom", message: "secrets.error.valueLength" });
    }
  });
const note = z.string().trim().max(SECRET_NOTE_MAX, "secrets.error.noteMax");

export const secretSchemas = {
  create: z.object({ name, value, note }),
  replace: z.object({ value }),
  note: z.object({ note }),
} as const;

export function secretResolver(mode: SecretFormMode): Resolver<SecretFormValues> {
  return zodResolver(secretSchemas[mode] as never) as unknown as Resolver<SecretFormValues>;
}

/** Ghi chú rỗng → `null` (server lưu không có ghi chú). */
export const noteToValue = (v: string): string | null => (v.trim() === "" ? null : v.trim());

type FieldError = { field: keyof SecretFormValues; key: string };

/** `VALIDATION_ERROR` của /admin/secrets*: ánh xạ theo trường, câu tĩnh (không dùng `message` server, G12). */
export function fieldFromIssues(details: unknown): FieldError | null {
  const issues = (details as { issues?: { path?: unknown[] }[] } | null | undefined)?.issues;
  const first = issues?.[0]?.path?.[0];
  if (first === "name") return { field: "name", key: "secrets.error.nameFormat" };
  if (first === "value") return { field: "value", key: "secrets.error.valueLength" };
  if (first === "note") return { field: "note", key: "secrets.error.noteMax" };
  return null;
}
