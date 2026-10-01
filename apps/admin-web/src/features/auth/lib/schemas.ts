// ADM-FR-01, ADM-FR-06 · schema form auth; hằng số lấy từ @ai/contracts, thông điệp là KEY i18n (resolve khi render).
import { PASSWORD_MAX_LEN, PASSWORD_MIN_LEN } from "@ai/contracts";
import { z } from "zod";

export const loginSchema = z.object({
  tenant_key: z.string().trim().min(1, "auth.error.required.tenant"),
  username: z.string().trim().min(1, "auth.error.required.username"),
  // Không trim, không kiểm độ dài tối thiểu: sai vẫn ra 401 chung (M1-R01).
  password: z.string().min(1, "auth.error.required.password"),
});
export type LoginValues = z.infer<typeof loginSchema>;

const newPassword = z
  .string()
  .min(PASSWORD_MIN_LEN, "password.error.min")
  .max(PASSWORD_MAX_LEN, "password.error.max");

export const forcedPasswordSchema = z
  .object({ new_password: newPassword, confirm: z.string() })
  .refine((v) => v.new_password === v.confirm, {
    path: ["confirm"],
    message: "password.error.mismatch",
  });
export type ForcedPasswordValues = z.infer<typeof forcedPasswordSchema>;

export const selfPasswordSchema = z
  .object({
    current_password: z.string().min(1, "password.error.required.current"),
    new_password: newPassword,
    confirm: z.string(),
  })
  .refine((v) => v.new_password === v.confirm, {
    path: ["confirm"],
    message: "password.error.mismatch",
  })
  .refine((v) => v.new_password !== v.current_password, {
    path: ["new_password"],
    message: "password.error.same",
  });
export type SelfPasswordValues = z.infer<typeof selfPasswordSchema>;
