# transfer

FR: ADM-FR-54 (Import/Export cấu hình yaml), BR-04 (secret chỉ tên), M4-R14, M4-R15, AC-A06.
Spec: `docs/specs/M4-ops/plan-cd.md` §3 (contract `packages/contracts/src/transfer.ts`), §6, §8. Thư viện `yaml` (ADR-0005).

| File | Vai trò |
|---|---|
| `transfer.routes.ts` | `exportRoutes` gắn ở `/admin/export` (`/`, `/meta`); `importRoutes` ở `/admin/import` (`bodyLimit` 2 MiB → 413); `requireAuth` + `requireRole(platform_admin)` |
| `transfer.import.ts` | `previewImport` (dry-run, không ghi): `checkImportSize` (byte UTF-8 ≤ 1 MiB) → `parseConfigText` (yaml `maxAliasCount: 0`, `uniqueKeys`, core) → snapshot RR read-only → `planImport` |
| `transfer.apply.ts` | `applyImport`: một `configWrite({expectBase})` — version ≠ base → 409; plan lại trong tx → `checkSecrets` → khoá §8.4 → secret mới (`createSecretTx`, E4) → `writeImport` → 1 `ch.audit(import/config)`; sau commit `evaluateTenant` cho tenant đổi quota |
| `transfer.ids.ts` | `readIds` (key → id), `lockForImport` (thứ tự khoá plan-cd §8.4), `itemsOf`, `changedQuotas` |
| `transfer.write.ts` | `writeImport`: upsert theo key (`version + 1`, `updated_by`), không xoá; `ch.changed` mỗi hàng |
| `transfer.plan.ts` / `transfer.checks.ts` / `transfer.import-ctx.ts` | `planImport` thuần: file ⊕ snapshot (cùng `sortedEls`), tenant hiệu lực (entitlement hợp, quota upsert), kiểm tham chiếu + luật module, ≤ 100 lỗi |
| `transfer.norm.ts` | `cmpStr`, `sortKeyOf`, `sortedEls`, `canonicalJson`, `diffOp` (dùng chung export/import) |
| `transfer.service.ts` | `exportConfig`, `exportMeta`: một tx `repeatable read, read only` (`SNAPSHOT_TX`), scope platform; `yaml.stringify` (`sortMapEntries`, `lineWidth: 0`) |
| `transfer.repo.ts` | `readSnapshot(tx, v, types)` dạng phần tử file; `countSnapshot` dùng chung `FROM` → meta khớp export; trần 5000 hàng/loại |
| `transfer.rules.ts` | `buildExportFile`, `exportFileName`, `sortKeyOf`, `sortedEls`, `diffOp`, `checkSecretsInput`, re-export `planImport` |
| `transfer.errors.ts` | `mapVersionMoved`: `ConfigVersionMoved` (từ `configWrite({expectBase})`) → 409 `VERSION_CONFLICT {current}` |

Bẫy: test khoá `transfer.lock-order.int.test.ts` (import ∥ command PATCH, import ∥ secret PUT). Sắp ở JS theo code unit (`cmpStr`), không `ORDER BY` (collation DB bỏ qua `-`). Không gắn router ở `/admin` với `use("*")` — middleware platform_admin sẽ chạy cho mọi route `/admin`. Secret: chỉ SELECT `name`. Bỏ tenant `platform`; grant chỉ cho group.
