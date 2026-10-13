// HUB-FR-131 · HUB-BR-37 · validate form kết nối (khớp contract `@ai/contracts/hub-admin` kh.*; câu lỗi = key i18n).
// D10: chỉ kiểm cú pháp URL; allowlist/SSRF do server quyết (422 KH_URL_NOT_ALLOWED).
import { KH_BASE_URL_MAX, KH_CONNECTION_NAME_MAX, KH_PROJECT_ID_RE } from "@ai/contracts/hub-admin";
import { z } from "zod";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Mã lỗi (key i18n) của địa chỉ, hoặc `null` nếu cú pháp hợp lệ. */
export function urlProblem(raw: string): string | null {
  const v = raw.trim();
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return "knowledgehub.err.urlInvalid";
  }
  if (v.length > KH_BASE_URL_MAX) return "knowledgehub.err.urlInvalid";
  const secure = u.protocol === "https:";
  if (!secure && !(u.protocol === "http:" && LOOPBACK.has(u.hostname)))
    return "knowledgehub.err.urlScheme";
  if (u.username || u.password || u.search || u.hash) return "knowledgehub.err.urlParts";
  return null;
}

export const khFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "knowledgehub.err.name")
    .max(KH_CONNECTION_NAME_MAX, "knowledgehub.err.name")
    .regex(/^[^/]*$/, "knowledgehub.err.name"),
  base_url: z.string().superRefine((v, ctx) => {
    const p = urlProblem(v);
    if (p) ctx.addIssue({ code: "custom", message: p });
  }),
  secret_id: z.string().min(1, "knowledgehub.err.key"),
  summary_project: z
    .string()
    .trim()
    .refine((v) => v === "" || KH_PROJECT_ID_RE.test(v), "knowledgehub.err.project"),
});
export type KhFormValues = z.infer<typeof khFormSchema>;

export const toBody = (v: KhFormValues) => ({
  name: v.name.trim(),
  base_url: v.base_url.trim(),
  secret_id: v.secret_id,
  summary_project: v.summary_project.trim() === "" ? null : v.summary_project.trim(),
});
