# modules/internal — endpoint nội bộ Hub (HUB-FR-89, H2a-R24, Q5; H2c HUB-FR-44, WRK-FR-18)

Plan H2a §2.3–2.4: `POST /internal/test-run` (Admin, Bearer `HUB_INTERNAL_TOKEN`) và
`POST /internal/jobs/:job_id/dify-credential` (Runtime, Bearer token job — `lib/job-token.ts`); H2c: `GET …/attachments/:attachment_id` (Runtime tải file) + `POST …/outputs` (Runtime đẩy `out/`).
Không qua middleware JWT/CORS; không log header `Authorization` hay body.

| File | Vai trò |
|---|---|
| `test-run.*` | B10 · `POST /internal/test-run` (token dịch vụ `HUB_INTERNAL_TOKEN` ≥ 32 ký tự, đọc từ env qua `config/env-deps.ts`; vắng → 503 `UNAVAILABLE`); sync, không kiểm quyền, không ghi hội thoại/`usage_logs` (Q13), idle timeout request = `min(timeout_s, HUB_DIFY_TIMEOUT_MAX_S) + 30` |
| `credential.routes.ts` | B6 · `POST /internal/jobs/:job_id/dify-credential`: 200 `DifyCredentialResponse` + `Cache-Control: no-store` · 401 `UNAUTHORIZED` (một body cho mọi sai, + `WWW-Authenticate: Bearer`) · 409 `NOT_CONFIGURED` |
| `credential.service.ts` | B6 · `DifyCredentialService.issue(authorization, jobId)`: `bearerJobToken` (43 ký tự base64url) → `hashJobToken` → job `running` có đúng `id` ∧ `type='workflow.async'` ∧ payload hợp `WorkflowAsyncJobSchema` → `base_url`/`app_type` từ catalog (không xét `enabled`, R08) + `CredentialService.apiKey` (secret thiếu/hỏng, master key vắng, workflow ngoài catalog → 409) |
| `credential.repo.ts` | B6 · plan-db §2 "Token → job" (một query, `jobs_token_hash_uq`); H2c B5: + `tenantId/userId/runId`, `jobAttachment` (plan-db H2c §2.5) |
| `attachments.routes.ts` | H2c B5 · `GET /internal/jobs/:job_id/attachments/:attachment_id` (R17): 200 byte `application/octet-stream` + `Content-Length` + `X-Content-SHA256` + `no-store` (`lib/blob-body`) · 401 `UNAUTHORIZED` một thân · 404 `NOT_FOUND` (đã xoá/mất) · H2c B9 `POST /internal/jobs/:job_id/outputs` (R25): byte + `X-Filename` → 201 `JobOutputResponse` · 401 một thân · 400/409/413/415 thân `toErrorBody`, mọi phản hồi `no-store` |
| `attachments.service.ts` | H2c B5 · `InternalAttachmentService.download`: token → job `running` `agent.cli` đúng `id` → id ∈ `payload.attachments` → hàng cùng tenant → `storage.blob` · H2c B9 · `output`: token → job `running` `agent.cli` role `agent` → `AttachmentService.ingestOutput` (≤ 5/lần claim, P21) |
| `autofix.routes.ts` | P-c1 B4 · `POST /internal/jobs/:job_id/autofix-result` (HUB-FR-130, plan §3.3): `bodyLimit` 3 MiB → 201 `{id}` · 400 `VALIDATION_ERROR` · 401 `UNAUTHORIZED` một thân · 409 `AUTOFIX_NOT_EXPECTED`/`AUTOFIX_RESULT_EXISTS` · 413 `PAYLOAD_TOO_LARGE` (chỉ `error.code`, G10); mọi phản hồi `no-store` |
| `autofix.service.ts` | P-c1 B4 · `InternalAutofixService.report`: token job (mọi trạng thái) → job `running` ∧ `payload.autofix` ∧ run stage (khác ⇒ 409) → `parseReport` (diff > 2 MiB byte ⇒ 413 trước zod; `ok` ⇒ diff khác rỗng) → `reportMatchesJob` → stage blob diff/log NGOÀI tx → tx `system` (kiểm lại `running`+token; attachments output `text/plain` `<stage>-r<n>.diff.txt`/`-test.log.txt` + `autofix_results`) → commit blob. PC-R16: không kiểm hạn mức |
| `autofix.repo.ts` | P-c1 B4 · `jobByTokenAnyStatus` (jobs ⟕ runs cùng tenant), `stillRunning`, `insertOutputFile`, `insertResult`, `isResultExists` (23505 `autofix_results_job_uq`) |

Mount: router riêng mỗi endpoint trên cùng gốc `/internal` — `app.h2a.ts` `mountTestRun` (B10), `app.async.ts` `mountDifyCredential` (B6), `app.h2c.ts` `mountH2c` (H2c + P-c1 autofix-result, chỉ khi có `AppDeps.attachments`).
