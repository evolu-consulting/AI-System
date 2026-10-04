// WRK-FR-07, HUB-FR-89 · `POST /internal/jobs/:job_id/dify-credential` (Q5, plan H2a §2.3; plan-runtime §3.3).
// Biểu diễn được bằng JSON Schema (xuất sang pydantic qua HUB_JSON_SCHEMAS). Response có `Cache-Control: no-store`.
import { z } from "zod";
import { DifyAppTypeSchema, HTTP_URL_RE } from "../hub/workflow";

export const DIFY_BASE_URL_MAX = 2048;
export const DIFY_API_KEY_MAX = 2048;

/** Giá trị hiện hành của workflow; Runtime giữ trong bộ nhớ tới hết lần claim, che `api_key` khi in. */
export const DifyCredentialResponseSchema = z.strictObject({
  base_url: z.string().min(1).max(DIFY_BASE_URL_MAX).regex(HTTP_URL_RE),
  api_key: z.string().min(1).max(DIFY_API_KEY_MAX),
  app_type: DifyAppTypeSchema,
});
export type DifyCredentialResponse = z.infer<typeof DifyCredentialResponseSchema>;
