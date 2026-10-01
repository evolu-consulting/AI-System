// ADM-FR-04, ADM-FR-63 · schema form user; hằng số từ @ai/contracts, thông điệp là KEY i18n.
import { DISPLAY_NAME_MAX, EMAIL_MAX, USERNAME_RE } from "@ai/contracts";
import { z } from "zod";

const roleField = z.enum(["member", "tenant_admin", "platform_admin"]);
const localeField = z.enum(["vi", "en"]);
const displayName = z
  .string()
  .trim()
  .min(1, "users.error.displayNameRequired")
  .max(DISPLAY_NAME_MAX, "users.error.displayNameMax");
const email = z.string().trim().max(EMAIL_MAX, "users.error.emailFormat");

type WithEmailRole = { email: string; role: string };

/** tenant_admin bắt buộc có email; có nhập thì phải đúng định dạng. */
function checkEmail(v: WithEmailRole, ctx: z.RefinementCtx): void {
  if (v.email === "") {
    if (v.role === "tenant_admin") {
      ctx.addIssue({ code: "custom", path: ["email"], message: "users.error.emailRequired" });
    }
    return;
  }
  if (!z.email().safeParse(v.email).success) {
    ctx.addIssue({ code: "custom", path: ["email"], message: "users.error.emailFormat" });
  }
}

export const userEditSchema = z
  .object({ display_name: displayName, email, role: roleField, locale: localeField })
  .superRefine(checkEmail);
export type UserEditValues = z.infer<typeof userEditSchema>;

export const userCreateSchema = z
  .object({
    username: z.string().trim().toLowerCase().regex(USERNAME_RE, "users.error.usernameFormat"),
    display_name: displayName,
    email,
    role: roleField,
    locale: localeField,
  })
  .superRefine(checkEmail);
export type UserCreateValues = z.infer<typeof userCreateSchema>;

/** Ô email trống → `null` (server lưu không có email). */
export const emailToValue = (v: string): string | null => (v.trim() === "" ? null : v.trim());
