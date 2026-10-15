# Tasks · FB1-filebox-attachments

**Scope CORE-ONLY 2026-10-15** (bỏ B9 sweeper DELETE, F1–F6 FE, dispatcher, secret-store). Cột `Đọc`/`Rủi ro` theo `docs/WORKFLOW.md`.

> Mã FR: HUB-FR-138..142 (spec §3.0). Rủi ro theo `WORKFLOW` "Chính sách model": RLS/tenant · secret/auth · khoá/transaction/NOTIFY · mất dữ liệu ⇒ `cao` (Opus).

| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| **B0** | Scaffold interface (`driver` union, `Staged.fileId?`, hàm thuần locator, `FileboxUnavailable`) | backend-lead | thường | spec §3.1, §4.7; `storage.ts` | `storage.ts` | — | `bun run typecheck` | [ ] |
| **B1** | Migration 0033 CHỈ 2 cột `filebox_*` + Drizzle (bỏ sửa definer) | backend-lead | cao | spec §3.2 | `migrations-hub/0033_*.sql`, `db/src/schema/*` | B0 | `bun run db:migrate` | [ ] |
| **B2** | Key từ env `FILEBOX_TOKEN` + `FileboxTokenSource` + fail-closed (bỏ secret-store) | backend-lead | cao | spec §3.3, §4.5 | `attach-env.rules.ts` | B1 | `bun test` | [ ] |
| **B3** | FileBox HTTP client (calls + retry + CA pin + lỗi map) | backend-lead | cao | spec §3.1, §4.6 (+`spec-appendix.md` §A4); ADR-0015 | `attachments/filebox.client.ts` | B2 | `bun test` | [ ] |
| **B4** | `createFileboxStorage` (§3.1 chữ ký), mount thẳng (không dispatcher) | backend-lead | cao | spec §3.1, §4.2; `storage.local.ts` | `attachments/storage.filebox.ts` | B3 | `bun test` | [ ] |
| **B5** | `parseAttachEnv` union + mount thẳng filebox ở `server.ts` | backend-lead | thường | spec §3.6, §3.8; `attach-env.rules.ts`, `server.ts` | `attach-env.rules.ts`, `config/env-deps.ts`, `server.ts` | B4 | `bun run typecheck` | [ ] |
| **B6** | INSERT ghi `filebox_*` ở 4 nơi | backend-lead | cao | spec §3.5 (+appendix §A6); repo+3 insert sites | `attachments.repo.ts`, `internal/autofix.repo.ts`, `internal/apply.service.ts`, `processes/runs/output-attachment.ts` | B4 | `bun test`, `bun run test:int` | [ ] |
| **B7** | Route `/content` hybrid redirect/inline (`Sec-Fetch-*`, C5) | backend-lead | cao | spec §3.4 (+appendix §A7) | `attachments.service.ts`, `attachments.routes.ts` | B4 | `bun test`, `bun run test:int` | [ ] |
| **B8** | Byte-consumer dùng locator (dify + CLI) | backend-lead | cao | spec §3.5 (+appendix §A6); `attachment-dify.ts`, `credential.repo.ts` | `attachment-dify.ts`, `run-files.rules.ts`, `attachments.repo.ts`, `internal/attachments.service.ts`, `internal/credential.repo.ts` | B6 | `bun test`, `bun run test:int` | [ ] |
| ~~Frontend~~ | Hoãn (Hardening): Studio Secrets `filebox_token` | — | | | | | | [~] hoãn |
| **QC** | Test trước code (mock FileBox) | qc | | | | | | [ ] |
| **Review** | reviewer + security review (tenant NHẸ, egress/secret đầy đủ) | reviewer | | | | | | [ ] |
| **UAT-mock** | qc-uat qua mock; smoke FileBox thật = hard stop người dùng | qc-uat | | | | | | [ ] |
