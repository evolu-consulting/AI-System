// HUB-FR-66 · validate form Provider (khớp contract `ProviderCreate/Update`; câu lỗi là key i18n). plan-frontend §4.
import { PROVIDER_KINDS, ProviderKeySchema, STUDIO_PROVIDER_VENDORS } from "@ai/contracts/studio";
import { z } from "zod";

export type ProviderMode = "create" | "edit";
type Raw = {
  key: string;
  vendor: string;
  kind: string;
  base_url: string;
  secret_id: string;
  max_concurrency: string;
};
type Issue = [path: string, message: string];

const slotsBad = (raw: string) => {
  const n = Number(raw);
  return raw.trim() === "" || !Number.isInteger(n) || n < 1 || n > 100;
};
function problems(v: Raw, mode: ProviderMode): Issue[] {
  const out: Issue[] = [];
  const vendors: readonly string[] = STUDIO_PROVIDER_VENDORS;
  if (mode === "create" && !ProviderKeySchema.safeParse(v.key.trim()).success)
    out.push(["key", "models.err.key"]);
  if (mode === "create" && !vendors.includes(v.vendor)) out.push(["vendor", "models.err.vendor"]);
  if (v.kind === "api" && v.secret_id === "") out.push(["secret_id", "models.err.secret"]);
  const url = v.base_url.trim();
  if (v.kind === "api" && url !== "" && !/^https?:\/\/\S+$/i.test(url))
    out.push(["base_url", "models.err.baseUrl"]);
  if (slotsBad(v.max_concurrency)) out.push(["max_concurrency", "models.err.slots"]);
  return out;
}

export const providerFormSchema = (mode: ProviderMode) =>
  z
    .object({
      key: z.string(),
      kind: z.enum(PROVIDER_KINDS),
      vendor: z.string(),
      base_url: z.string(),
      secret_id: z.string(),
      max_concurrency: z.string(),
      enabled: z.boolean(),
    })
    .superRefine((v, ctx) => {
      for (const [path, message] of problems(v, mode))
        ctx.addIssue({ code: "custom", path: [path], message });
    });
export type ProviderFormValues = z.infer<ReturnType<typeof providerFormSchema>>;
