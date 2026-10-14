// HUB-BR-30 · HUB-FR-129 · PC2-R11 · P-c2 (plan §3.4): `POST /internal/jobs/:job_id/source-credential` — Runtime lấy khoá
// nguồn riêng (`source_credential`) của job đang `running` để clone/fetch/push. Response có `Cache-Control: no-store`;
// Runtime chỉ giữ trong bộ nhớ + env tiến trình git, che khi in.
import { z } from "zod";
import { UuidSchema } from "../common";

export const SOURCE_CREDENTIAL_USERNAME_MAX = 64;
export const SOURCE_CREDENTIAL_TOKEN_MAX = 4096;

export const SourceCredentialRequestSchema = z.strictObject({ source_id: UuidSchema });
export type SourceCredentialRequest = z.infer<typeof SourceCredentialRequestSchema>;

/** `username` = `credentialUsername(provider)` (`github` ⇒ `x-access-token`; host khác ⇒ `oauth2`). */
export const SourceCredentialResponseSchema = z.strictObject({
  username: z.string().min(1).max(SOURCE_CREDENTIAL_USERNAME_MAX),
  token: z.string().min(1).max(SOURCE_CREDENTIAL_TOKEN_MAX),
});
export type SourceCredentialResponse = z.infer<typeof SourceCredentialResponseSchema>;
