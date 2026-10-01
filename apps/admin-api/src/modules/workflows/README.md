# workflows

FR: ADM-FR-10 (catalog workflow), ADM-FR-11 (input schema nhập tay), ADM-FR-13 (chặn xoá/tắt khi đang dùng), ADM-FR-14 ("Chưa gắn"), ADM-FR-15 ("Đang được dùng bởi"), BR-13.
Spec: `docs/specs/M2-catalog-command/spec.md` §3 (`/admin/workflows*`), M2-R07…R12, R18; plan §3.3, §5, §5.1.

| File | Vai trò |
|---|---|
| `workflows.routes.ts` | `requireAuth` + `requireRole(platform_admin)`; không có route grant / test-connection / dify-schema |
| `workflows.service.ts` | CRUD, usages; khoá workflow `FOR NO KEY UPDATE` → secret `FOR SHARE`; xuất `lockWorkflowRef` (`FOR SHARE`) cho commands |
| `workflows.repo.ts` | list/detail với `command_count`/`agent_count` bằng subquery; counts trừ chip `status`/`attached` |
| `workflows.hub.ts` | `hubAgentsReadable` (`has_table_privilege(to_regclass(…))`, không cache) + đọc `hub.agent_workflows` |
| `workflows.rules.ts` | chặn xoá/tắt, `inputMapGaps`, `checkSchemaChange`, `changedWorkflowFields` |

Phụ thuộc: `secrets.service.lockSecretRef`. Bẫy: bảng hub không đọc được → không nhắc tới nó trong SQL (cờ `readable`).
Agent thêm cùng lúc xoá workflow có thể mồ côi (Admin không khoá được hàng `hub.*`) → Hub tự kiểm.
