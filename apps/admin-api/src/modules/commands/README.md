# commands

FR: ADM-FR-20 (CRUD command, alias, tham số, output, mode/timeout), ADM-FR-21 (input map 8 nguồn), ADM-FR-22 (validate khi lưu, cảnh báo sai kiểu), ADM-FR-24 (Ai dùng được — chỉ tenant, CR-013), BR-01, BR-02, BR-06, BR-10.
Spec: `docs/specs/M2-catalog-command/spec.md` §3 (`/admin/commands*`), M2-R13…R19, R23, R27; plan §4, §5, §5.1.

| File | Vai trò |
|---|---|
| `commands.routes.ts` | `requireAuth` + `requireRole(platform_admin)`; không có `…/test` (M5), "Lịch sử" (M4) |
| `commands.service.ts` | khoá workflow `FOR SHARE` → command `FOR NO KEY UPDATE` → features (qua `features.service`); luật trên trạng thái ghép theo thứ tự spec §3 |
| `commands.repo.ts` | list/detail, `command_names` (không gian tên chung), `takenNames` |
| `commands.access.ts` | tab "Ai dùng được": một câu `json_agg` + `count(*) over()` |
| `commands.rules.ts` | `checkInputMap`, `inputMapWarnings`, `checkCommandEnable`, `changedCommandFields` |
| `commands.perf.int.test.ts` | ngân sách p95 spec §6 |

Phụ thuộc: `workflows.service` (`lockWorkflowRef`, `readWorkflowSchema`), `features.service` (`setCommandFeatures`, `coreFeatureId`, `featureRefsByCommands`, `bumpFeaturesOfCommand`, `missingFeatureIds`).
Bẫy: `warnings` tính lại mỗi lần đọc/ghi, không lưu. 23505 tên/alias đua → tra lại trong savepoint → `COMMAND_NAME_TAKEN`. Test khoá: `lib/lock-order.int.test.ts`.
