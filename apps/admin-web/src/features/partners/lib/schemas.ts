// ADM-FR-74, ADM-FR-75 · schema form công ty / tài khoản đối tác; hằng số từ @ai/contracts, thông điệp là KEY i18n.
import { DISPLAY_NAME_MAX, EMAIL_MAX, EXTERNAL_ORG_NAME_MAX, USERNAME_RE } from "@ai/contracts";
import { z } from "zod";

export const partnerNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "partners.error.nameRequired")
    .max(EXTERNAL_ORG_NAME_MAX, "partners.error.nameMax"),
});
export type PartnerNameValues = z.infer<typeof partnerNameSchema>;

export const partnerUserSchema = z.object({
  username: z.string().trim().toLowerCase().regex(USERNAME_RE, "users.error.usernameFormat"),
  display_name: z
    .string()
    .trim()
    .min(1, "users.error.displayNameRequired")
    .max(DISPLAY_NAME_MAX, "users.error.displayNameMax"),
  email: z
    .string()
    .trim()
    .max(EMAIL_MAX, "users.error.emailFormat")
    .refine((v) => v === "" || z.email().safeParse(v).success, "users.error.emailFormat"),
  locale: z.enum(["vi", "en"]),
});
export type PartnerUserValues = z.infer<typeof partnerUserSchema>;
