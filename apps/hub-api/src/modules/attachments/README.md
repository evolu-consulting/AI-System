# modules/attachments — file đính kèm (HUB-FR-44, HUB-FR-75, WRK-FR-11)

Spec H2c-attachments (R01–R29); plan §1 P4–P23, §4, §5; chữ ký hàm thuần `plan-rules.md`; SQL `plan-db.md`; câu lỗi `plan-errors.md`.

| File | Vai trò |
|---|---|
| `attachment.rules.ts` | thuần: `parseFilenameHeader`, `displayName`, `splitExt`, `extOf`, `mimeOf`, `safeName`, `contentDisposition`, `difyFileType`, `overQuota` (plan-rules §1, §4) |
| `sniff.rules.ts` | thuần: `SNIFF_HEAD`, `isExecutableHead`, `headOk`, `FileInspector` (kiểm từng chunk, plan-rules §2) |
| `run-files.rules.ts` | thuần: `pickRunFiles`, `jobFileNames`, `jobAttachments`, `fileSizeKb`, `orchestratorFilesBlock`, `agentFilesBlock`, `OUT_HINT`/`withOutHint` (plan-rules §3) |
| `run-files.ts` | **B4** · E12: `checkSendable(db, u, ids)` (R09, scope `user`, ngoài transaction — R10; mọi sai ⇒ 404 `ATTACHMENT_NOT_FOUND{ids}`) · `bindRunFiles(tx, o, p)` trong `createRunTx` sau INSERT messages (R11 gắn, số hàng ≠ ⇒ 404 rollback; R14 `runFileRows` → `pickRunFiles`). Chỉ cần DB (PL14) |
| `run-files.ts` (B9) · `counted-body.ts` | `bindRunOutputs(tx, p)` (R26, PL6, PL10 — plan-db §2.4) gọi từ `SseWriter.finish` khi run `finished`; `countedBody` (đếm byte thân, dùng chung upload/output) |
| `attachment-dify.ts` | **B7** · `uploadToDify(deps, {tenantId, file}, target, signal)` (kho → `dify/dify-upload` `uploadDifyFile`, tên `safe_name`) + trace `detail.upload`; `difyFileInput`; `AttachmentContentMissing` (kho vắng/mất ⇒ `INTERNAL_ERROR`). Dùng ở `commands/driver/command-files.ts`, MCP (B8) |
| `attach-env.rules.ts` | thuần: `parseAttachEnv` (`HUB_ATTACH_*`, plan §7) |
| `storage.ts` | interface `AttachmentStorage` (`stage/open/blob/remove/promote/list`, PL1; `promote` = hoàn tất `.part` cho sweeper, PL13), lỗi `StorageTooLarge`/`StorageRejected`/`StorageKeyError`, khoá `storageKey`/`isStorageKey`/`keyUnder` |
| `storage.local.ts` | driver `local`: `createLocalStorage({dir, platform?})` (L8, P23) |
| `attachments.repo.ts` · `attachments.service.ts` · `attachments.routes.ts` | **B2** `POST /attachments` (kiểm header/đuôi/`Content-Length`/hạn mức sớm → `stage` → transaction `system` khoá tenant → INSERT → `commit`, plan §5.1); **B3** `GET /attachments/:id(/content)` (scope `user`, hội thoại đã xoá ⇒ 404, header R13, `blobResponse`) — mount ở `app.h2c.ts` |
| `sweeper.rules.ts` · `sweeper.ts` | **B10** · `orphanCandidate` + hằng; `sweepOnce({db, storage, now, log?})` một transaction `system` mỗi lượt (khoá thử `hub.attach.sweep` ⇒ `skipped`; R27 claim + `purged_at` → xoá nội dung → DELETE; R28 hội thoại xoá; mồ côi lô `list` xoay vòng, `.part` có hàng sống ⇒ `promote`), `startAttachmentSweeper` (`lib/loop`, mount ở `app.h2c.ts` khi `sweep !== false`) |

Trạng thái: **H2c xong** (B1–B10). Hằng/luật thuần ở `*.rules.ts`; I/O ở `attachments.{repo,service}.ts`, `storage.local.ts`; mount `app.h2c.ts` (`mountH2c`, chỉ khi có `AppDeps.attachments`).
Env `HUB_ATTACH_{DRIVER,DIR,TENANT_MAX_BYTES,SWEEP_S}` (`attach-env.rules.ts`, `config/env-deps.ts` `attachEnvOf`). Quyết định: spec-decisions "BUILD — B1…B10", "REVIEW 1/2 — Hub", "Kết luận H2c".
Bẫy: thứ tự khoá `attachments` → `jobs` (P8, sau khoá tenant); upload không đọc thân trước khi kiểm header; id luôn chữ thường; kho `local` từ chối symlink; đổi migration `0007` không FK `job_id`; TECH-DEBT #59–#68.
