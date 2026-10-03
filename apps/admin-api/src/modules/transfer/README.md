# transfer

FR: ADM-FR-54 (Import/Export cấu hình yaml), BR-04 (secret chỉ tên), M4-R14, M4-R15, AC-A06.
Spec: `docs/specs/M4-ops/plan-cd.md` §3 (contract `packages/contracts/src/transfer.ts`), §6, §8. Thư viện `yaml` (ADR-0005).

| File | Vai trò |
|---|---|
| `transfer.routes.ts` | `exportRoutes` gắn ở `/admin/export` (`/`, `/meta`); `requireAuth` + `requireRole(platform_admin)` |
| `transfer.service.ts` | `exportConfig`, `exportMeta`: một tx `repeatable read, read only` (`SNAPSHOT_TX`), scope platform; `yaml.stringify` (`sortMapEntries`, `lineWidth: 0`) |
| `transfer.repo.ts` | `readSnapshot(tx, v, types)` dạng phần tử file; `countSnapshot` dùng chung `FROM` → meta khớp export; trần 5000 hàng/loại |
| `transfer.rules.ts` | `buildExportFile`, `exportFileName`, `sortKeyOf`, `sortedEls`, `diffOp`, `checkSecretsInput` (T8 thêm `planImport`) |
| `transfer.errors.ts` | `mapVersionMoved`: `ConfigVersionMoved` (từ `configWrite({expectBase})`) → 409 `VERSION_CONFLICT {current}` |

Bẫy: sắp ở JS theo code unit (`cmpStr`), không `ORDER BY` (collation DB bỏ qua `-`). Không gắn router ở `/admin` với `use("*")` — middleware platform_admin sẽ chạy cho mọi route `/admin`. Secret: chỉ SELECT `name`. Bỏ tenant `platform`; grant chỉ cho group.
