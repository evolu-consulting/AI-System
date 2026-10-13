# modules/kh — KnowledgeHub (K1, CR-073)

Kết nối KH nền tảng (khoá chung `X-KH-Key`), "Kiểm tra", client + cache project. Spec: `docs/specs/K1-knowledgehub/`.

| File | Vai trò |
|---|---|
| `kh.rules.ts` | Thuần: `khUrlPolicy`, `khUsableOrigins`, phiên bản, `parseKhProjects`, phân loại lỗi, cursor list, `khSecretReject`, `khResetsCheck`, `khConnectionAudit` |
| `kh.check.rules.ts` | Thuần: `khCheckShouldContinue`, `evaluateKhCheck` (6 bước, 7 lỗi + 5 cảnh báo) |
| `kh.agent.rules.ts` · `kh.query.rules.ts` · `kh.summary.rules.ts` | Thuần cho T5d–T5f |
| `kh.client.ts` | `KhClient` (`hit` thô cho Kiểm tra; `get/post/projects/query/add` ném `KhCallError`) + `KhProjectsCache` |
| `kh.repo.ts` | SQL `kh_connections` (+ đếm `agent_kh`, tên secret) |
| `kh.studio.service.ts` | CRUD qua `withConfigWrite` (scope system) |
| `kh.check.service.ts` | `POST …/:id/check`: ngoài tx gọi KH, tx ngắn lưu `check_*` WHERE version + audit `check` |
| `kh.routes.ts` · `kh.mount.ts` | Route `/studio/api/kh/connections*`; `khRuntime()` dựng client + cache MỘT lần (mountH4a trả về) |

Dùng lại (T5e/T5f): `const kh = mountH4a(...)` ⇒ `kh.client`, `kh.projects`, `kh.cfg`, `kh.dev`.
Bẫy: khoá chỉ sống trong `KhClient.hit` (`useSecret` quanh `fetch`); không log/audit/response giá trị khoá.
`secrets.repo.ts` `USED_BY_BRANCHES` có nhánh `knowledge_hub` (xoá secret đang được kết nối trỏ ⇒ 409 `SECRET_IN_USE`).
