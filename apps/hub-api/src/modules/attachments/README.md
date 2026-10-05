# modules/attachments — file đính kèm (HUB-FR-44, HUB-FR-75, WRK-FR-11)

Spec H2c-attachments (R01–R29); plan §1 P4–P23, §4, §5; chữ ký hàm thuần `plan-rules.md`; SQL `plan-db.md`; câu lỗi `plan-errors.md`.

| File | Vai trò |
|---|---|
| `attachment.rules.ts` | thuần: `parseFilenameHeader`, `displayName`, `splitExt`, `extOf`, `mimeOf`, `safeName`, `contentDisposition`, `difyFileType`, `overQuota` (plan-rules §1, §4) |
| `sniff.rules.ts` | thuần: `SNIFF_HEAD`, `isExecutableHead`, `headOk`, `FileInspector` (kiểm từng chunk, plan-rules §2) |
| `run-files.rules.ts` | thuần: `pickRunFiles`, `jobFileNames`, `jobAttachments`, `fileSizeKb`, `orchestratorFilesBlock`, `agentFilesBlock`, `OUT_HINT`/`withOutHint` (plan-rules §3) |
| `attach-env.rules.ts` | thuần: `parseAttachEnv` (`HUB_ATTACH_*`, plan §7) |
| `storage.ts` | interface `AttachmentStorage` (`stage/open/blob/remove/list`, PL1), lỗi `StorageTooLarge`/`StorageRejected`/`StorageKeyError`, khoá `storageKey`/`isStorageKey`/`keyUnder` |
| `storage.local.ts` | driver `local`: `createLocalStorage({dir, platform?})` (L8, P23) |
| `sweeper.rules.ts` · `sweeper.ts` | `orphanCandidate` + hằng; `sweepOnce` (một transaction mỗi lượt, PL11), `startAttachmentSweeper` |

Trạng thái: **B1** xong storage `local` + `parseAttachEnv` + khởi động (`server.ts`, `config/env-deps.ts` `attachEnvOf`;
`lib/unread-body.ts` đóng/đọc bỏ thân khi lỗi sớm — spec-decisions B1-1…B1-7); hàm còn lại vẫn stub `not implemented`. B2/B3: `POST/GET /attachments*`
(`attachments.{repo,service,routes}.ts`, `app.h2c.ts`); B4: E12 gắn file + tập file run; B6/B7/B8: job agent, Dify, MCP;
B9: output; B10: sweeper.
