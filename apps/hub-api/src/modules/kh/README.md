# modules/kh — KnowledgeHub (K1, CR-073)

Kết nối KH nền tảng (khoá chung `X-KH-Key`), "Kiểm tra", client + cache project. Spec: `docs/specs/K1-knowledgehub/`.

| File | Vai trò |
|---|---|
| `kh.rules.ts` | Thuần: `khUrlPolicy`, `khUsableOrigins`, `khUsableNow`, phiên bản, `parseKhProjects`, phân loại lỗi, cursor list, `khSecretReject`, `khResetsCheck`, `khConnectionAudit` |
| `kh.check.rules.ts` | Thuần: `khCheckShouldContinue`, `evaluateKhCheck` (6 bước, 7 lỗi + 5 cảnh báo) |
| `kh.agent.rules.ts` · `kh.query.rules.ts` · `kh.summary.rules.ts` | Thuần cho T5d–T5f |
| `kh.client.ts` | `KhClient` (`hit` thô cho Kiểm tra; `get/post/projects/query/add` ném `KhCallError`) + `KhProjectsCache` |
| `kh.repo.ts` | SQL `kh_connections` (+ đếm `agent_kh`, tên secret), `agentKhConns`, đếm `kh_stage_usage` (`bumpKhUsage`, `setKhWarning`, `usageKeyOf`) |
| `kh.studio.service.ts` | CRUD qua `withConfigWrite` (scope system) |
| `kh.check.service.ts` | `POST …/:id/check`: ngoài tx gọi KH, tx ngắn lưu `check_*` WHERE version + audit `check` |
| `kh.job.ts` | T5e `khPrepareJob` (KH tick ∩ dùng được ⇒ project qua cache/fallback ⇒ `KhJobItem[]`), `KH_QUERY_HINT`; nối vào `JobAgentRunner` (`deps.kh`) |
| `kh.query.service.ts` | T5e tool MCP `kh-query`: `khJobCtx` (ctx.kh), `tools`, `accepts` ⇒ args/project ⇒ dùng được ⇒ đếm D7 ⇒ `/vector/query` ⇒ hạ cấp + audit `degrade` |
| `kh.start.ts` | T5f `khStartPlan`: đích `## Tóm tắt` lúc start ⇒ `snapshot.kh` + `ensureSummary` (gọi từ `processes/runs/start-inputs.createRun`) |
| `kh.writes.repo.ts` | T5f SQL `kh_writes`: `enqueueKhSummary` (savepoint trong `persistStage` done), `claimDue`, `saveResult`, `writeStatesOfRun` (view) |
| `kh.writer.ts` | T5f `KhWriter` nền 10 s (seam `ProcessHandles.khWriteOnce`): kiểm lại dùng được ⇒ `/vector/add` ⇒ done / thử lại ≤ 5 / failed / skipped + audit `write_fail` |
| `kh.routes.ts` · `kh.mount.ts` | Route `/studio/api/kh/connections*`; `khRuntime()` dựng client + cache MỘT lần (mountH4a trả về) |

Dùng lại (T5e/T5f): `const kh = mountH4a(...)` ⇒ `kh.client`, `kh.projects`, `kh.cfg`, `kh.dev`.
Bẫy: khoá chỉ sống trong `KhClient.hit` (`useSecret` quanh `fetch`); không log/audit/response giá trị khoá.
`secrets.repo.ts` `USED_BY_BRANCHES` có nhánh `knowledge_hub` (xoá secret đang được kết nối trỏ ⇒ 409 `SECRET_IN_USE`).
