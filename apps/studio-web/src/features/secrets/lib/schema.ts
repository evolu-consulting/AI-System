// HUB-FR-68 · validate form Secret (khớp contract `@ai/contracts/hub-admin`; câu lỗi là key i18n). Giá trị không trim.
import { HUB_SECRET_NAME_RE, HubSecretValueSchema } from "@ai/contracts/hub-admin";
import { z } from "zod";

/** Giá trị `Select` "Toàn nền tảng" (Select không nhận chuỗi rỗng). */
export const PLATFORM = "platform";

export const secretFormSchema = (needName: boolean) =>
  z.object({
    name: needName
      ? z
          .string()
          .trim()
          .min(1, "secrets.err.nameEmpty")
          .regex(HUB_SECRET_NAME_RE, "secrets.err.nameFormat")
      : z.string(),
    scope: z.string(),
    value: z
      .string()
      .min(1, "secrets.err.valueEmpty")
      .refine((v) => HubSecretValueSchema.safeParse(v).success, "secrets.err.valueLen"),
  });
export type SecretFormValues = z.infer<ReturnType<typeof secretFormSchema>>;
