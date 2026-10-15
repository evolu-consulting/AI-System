# Plan · FB1-filebox-attachments

backend-lead/frontend-lead điền ở PLAN. Không chép contract/spec — trỏ link mục. Nền: `apps/hub-api/src/modules/attachments/` (`storage.ts` interface `AttachmentStorage`).

## Backend (backend-lead) — các bước BUILD theo thứ tự

**Scope CORE-ONLY (2026-10-15):** bỏ secret-store, dispatcher, sweeper DELETE, UI Secrets (Hardening). Trỏ: contract/DDL/ánh xạ ở `spec.md` §3; luật ở §4. Mọi bước giữ `storage_key = "<tenant>/<id>"`, chỉ thêm cột `filebox_*`.

| Bước | Task (tasks.md) | Nội dung | File chính | Rủi ro | Phụ thuộc |
|---|---|---|---|---|---|
| **B0** | Scaffold | `driver:"local"\|"filebox"`; `Staged` thêm `fileId?/versionId?`; hàm thuần `fileboxLocator`/`storageLocatorOf`/`parseFileboxLocator`/`isFileboxRow`/`fileboxRetryable`; `FileboxUnavailable` | `storage.ts` (+`storage.rules.ts` nếu tách thuần) | thường | — |
| **B1** | Migration 0033 | CHỈ thêm `filebox_file_id`/`filebox_version_id` (§3.2), idempotent `DO $$`/`IF NOT EXISTS`. **Không** sửa definer, **không** nới secret. Drizzle schema `hub.ts` thêm cột | `packages/db/migrations-hub/0033_fb1_filebox_ref.sql`, `packages/db/src/schema/*` | **cao** (migration) | B0 |
| **B2** | Key từ env | `parseAttachEnv` đọc `FILEBOX_TOKEN`; `FileboxTokenSource` (`get`=env, `refresh`=cùng giá trị); vắng ⇒ `null` ⇒ fail-closed (§3.3). Không `hub.secrets`, không `findSecretIdByName` | `attach-env.rules.ts`, driver | **cao** (secret/auth) | B1 |
| **B3** | FileBox client | HTTP client (`fetch`): `postFile`, `getContent`, `getLink`, `deleteFile`, `getVersions`, `health`; Bearer từ B2 (`token.get/refresh`); hàm thuần `fileboxUrlOk` (bề mặt egress §3.8); CA pin (`caPath`/`NODE_EXTRA_CA_CERTS`, cấm `rejectUnauthorized:false`); timeout; retry 1/2/4s **chỉ** GET/DELETE; ánh xạ lỗi §4.6 | `apps/hub-api/src/modules/attachments/filebox.client.ts` | **cao** (egress/TLS/secret) | B2 |
| **B4** | Driver filebox | `createFileboxStorage(cfg)` (chữ ký §3.1) cài `AttachmentStorage`: `stage` spill temp+inspect+sha256→`POST /files`→`discard=DELETE`; `blob/open`→`/content`; `remove` (key `fb/`) → `DELETE` idempotent, key khác ⇒ no-op; `promote` no-op; `list`→`[]`. **Không** dispatcher | `storage.filebox.ts` | **cao** (vòng đời file) | B3 |
| **B5** | Wire env + mount | `parseAttachEnv` → union `local\|filebox` (§3.8); `env-deps` nhận `FILEBOX_*`; `server.ts` khi `driver=filebox` mount **thẳng** `createFileboxStorage`; `AttachmentDeps` giữ nguyên | `attach-env.rules.ts`, `config/env-deps.ts`, `server.ts` | thường | B4 |
| **B6** | INSERT ghi cột | `insertAttachment` + 3 nơi insert (autofix.repo, apply.service, output-attachment) ghi `filebox_file_id/version_id` từ `staged` | `attachments.repo.ts`, `internal/autofix.repo.ts`, `internal/apply.service.ts`, `processes/runs/output-attachment.ts` | **cao** (nhiều nơi ghi, transaction) | B4 |
| **B7** | Read hybrid | `AttachmentService.content()` → union `{blob}\|{redirect}` (`contentInline`/`contentLink`); route `/content` phân nhánh `Sec-Fetch-Mode/Dest` (C5, §3.4): navigate→302, cors/vắng→inline; không log URL; 404/purged | `attachments.service.ts`, `attachments.routes.ts` | **cao** (authz/redirect/CORS) | B4 |
| **B8** | Byte-consumer | `uploadToDify` dùng `storageLocatorOf` (RunFile thêm `fileboxFileId/versionId`; `runFileRows`/`sendableFiles` SELECT cột); CLI `internal/attachments download` (`credential.repo findJobFile` SELECT cột) | `attachment-dify.ts`, `run-files.rules.ts`, `attachments.repo.ts`, `internal/attachments.service.ts`, `internal/credential.repo.ts` | **cao** (đọc chéo tenant nếu sai locator) | B6 |

**Ngoài phạm vi BUILD:** mock FileBox `tests/acceptance/FB1/_fbfake.ts` (qc, `spec-appendix.md` §A1); UAT smoke thật (HS1). **Hoãn:** FE Secrets, sweeper DELETE (B9 cũ), dispatcher.

### Ghi chú kỹ thuật
- `stage` buffer bộ nhớ (≤ 20 MB cap, không spill file — quyết định BUILD §9): đếm `maxBytes`/`FileInspector`/sha256 trên buffer rồi `POST /files`.
- `name` khi `POST /files` = `<attachmentId>` (uuid, ổn định; tra lại bằng `file_id` không bằng name).
- Mock (`http://`) ⇒ client bỏ CA/pin, không áp allowlist IP; prod (`https://`) ⇒ pin + allowlist.
- Hồi quy: `driver=local` phải xanh toàn bộ H2c/X2b-2 (FB1-AC-03). `Staged.fileId` optional ⇒ local không đổi.

## Frontend
v1 **không đổi FE** (spec §5); nạp key bằng env. Tab Studio Secrets `filebox_token` (F1–F6 cũ) → Hoãn Hardening. Không đổi `fetchAttachmentContent`: nhánh `cors` ⇒ inline (AC-13).
