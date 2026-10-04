# modules/internal — endpoint nội bộ Hub (HUB-FR-89, H2a-R24, Q5)

Plan H2a §2.3–2.4: `POST /internal/test-run` (Admin, Bearer `HUB_INTERNAL_TOKEN`) và
`POST /internal/jobs/:job_id/dify-credential` (Runtime, Bearer token job — `lib/job-token.ts`).
Không qua middleware JWT/CORS; không log header `Authorization` hay body.

Trạng thái: B0 module rỗng; `internal.routes.ts`, `internal-auth.ts`, `test-run.service.ts` ở B6/B10.
