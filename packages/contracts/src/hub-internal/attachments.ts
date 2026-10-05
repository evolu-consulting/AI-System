// HUB-FR-44, WRK-FR-11, WRK-FR-18 · endpoint nội bộ file của job (plan H2c §2.3–2.4):
// `GET /internal/jobs/:job_id/attachments/:attachment_id` (byte + `X-Content-SHA256`) và
// `POST /internal/jobs/:job_id/outputs` (byte + `X-Filename`) → 201 `JobOutputResponse`.
// Biểu diễn được bằng JSON Schema (xuất sang pydantic qua HUB_JSON_SCHEMAS).
import { z } from "zod";
import { HubUuidSchema } from "../hub/common";

/** Header sha256 (hex thường) của nội dung trả về ở endpoint tải file. */
export const CONTENT_SHA256_HEADER = "X-Content-SHA256";

export const JobOutputResponseSchema = z.strictObject({ id: HubUuidSchema });
export type JobOutputResponse = z.infer<typeof JobOutputResponseSchema>;
