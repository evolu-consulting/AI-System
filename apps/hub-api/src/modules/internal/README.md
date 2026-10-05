# modules/internal — endpoint nội bộ Hub (HUB-FR-89, H2a-R24, Q5)

Plan H2a §2.3–2.4: `POST /internal/test-run` (Admin, Bearer `HUB_INTERNAL_TOKEN`) và
`POST /internal/jobs/:job_id/dify-credential` (Runtime, Bearer token job — `lib/job-token.ts`).
Không qua middleware JWT/CORS; không log header `Authorization` hay body.

| File | Vai trò |
|---|---|
| `test-run.*` | B10 · `POST /internal/test-run` (token dịch vụ `HUB_INTERNAL_TOKEN` ≥ 32 ký tự, đọc từ env qua `config/env-deps.ts`; vắng → 503 `UNAVAILABLE`); sync, không kiểm quyền, không ghi hội thoại/`usage_logs` (Q13), idle timeout request = `min(timeout_s, HUB_DIFY_TIMEOUT_MAX_S) + 30` |
| `credential.routes.ts` | B6 · `POST /internal/jobs/:job_id/dify-credential`: 200 `DifyCredentialResponse` + `Cache-Control: no-store` · 401 `UNAUTHORIZED` (một body cho mọi sai, + `WWW-Authenticate: Bearer`) · 409 `NOT_CONFIGURED` |
| `credential.service.ts` | B6 · `DifyCredentialService.issue(authorization, jobId)`: `bearerJobToken` (43 ký tự base64url) → `hashJobToken` → job `running` có đúng `id` ∧ `type='workflow.async'` ∧ payload hợp `WorkflowAsyncJobSchema` → `base_url`/`app_type` từ catalog (không xét `enabled`, R08) + `CredentialService.apiKey` (secret thiếu/hỏng, master key vắng, workflow ngoài catalog → 409) |
| `credential.repo.ts` | B6 · plan-db §2 "Token → job" (một query, `jobs_token_hash_uq`) |

Mount: router riêng mỗi endpoint trên cùng gốc `/internal` — `app.h2a.ts` `mountTestRun` (B10), `app.async.ts` `mountDifyCredential` (B6).
