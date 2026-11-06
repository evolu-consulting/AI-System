---
id: cr121-c18-feature-app-col
lát: cr121-c18-feature-app-col
cr: CR-121
làn: đầy đủ (dữ liệu khách; Sonnet high viết, Opus low soát)
migration: admin 0037 (journal idx 37, when 1803400000000 > 0036 = 1803300000000)
phụ thuộc: docs/specs/cr121-c/spec.md D1 + D5, tasks.md c18
---
## Plan (ngắn)
Một migration admin 0037: (1) cột `admin.features.app` NOT NULL + CHECK (`core|chat|community|contracts|knowledge|other`), backfill set-based bằng hàm
`admin.feature_app_of(key)` (quy ước cũ + `han-muc-duyet → contracts`); (2) trigger BEFORE INSERT điền `app` khi INSERT SQL thẳng không nêu
(cài gói `packs.install`, seed — tránh sửa migration gói đã chạy); (3) gỡ feature `contracts-approval-engine`: xoá entitlement mồ côi rồi hàng feature
(set-based, ghi `audit_log`). Mọi chỗ ĐỌC chuyển sang cột: `tenants.repo.ts` (Q-1 lọc/`apps`), API features + ma trận quyền trả `app`, admin-web
`feature-meta` (`metaOf({key, app})`, `groupByApp`) và các hook/lib dùng nó. Check ops `flow_coverage` thêm danh mục feature lệch.

## Làm
- `packages/db/migrations/0037_feature_app_col.sql` + journal; Drizzle `features.app`.
- contracts: `FEATURE_APP_IDS`, `FeatureAppSchema`; `FeatureListItem/Detail.app`, `FeatureCreateRequest.app?`, `MatrixFeature.feature.app`.
- admin-api: `tenants.repo.ts` (`f.app`, bỏ `split_part` + lọc engine), `features.repo/service`, `grants.matrix.ts`.
- admin-web: `feature-meta.ts` (bỏ `FEATURE_META`/`HIDDEN_FEATURES`/`isHiddenFeature`, app theo cột), `feature-assign.ts` (`TenantFeature.app`), `tenants/api.ts`,
  `use-app-companies.ts`, `FeaturesTab.tsx`, `app-config.ts`, `FeatureGroupSection/Drawer`.
- i18n vi/en: bỏ `featmeta.f.contracts-approval-engine` (không thêm chuỗi mới).
- Ops: `flow-coverage.check.ts` (+ `featureCatalogQuery`): crit khi engine còn sót hoặc feature có cột `app = other` mà quy ước xếp vào một app.
- Test mô tả đổi: `capabilities.rules.test.ts` (đổi key ví dụ), `pack-guard.middleware.ts` (chú thích), M1 `db-rls.int.test.ts` (features chỉ còn `core`).

## Không làm / Chạm
- Không sửa migrations-packs (trigger đảm nhiệm `app` cho feature gói cài mới). Không đổi `restore`/`import` feature để mang `app` (trigger điền).
- `registry.ts` không cần sửa (mở rộng check `flow_coverage` có sẵn). e2e (`app-config.spec.ts`, `journey-approval/*`) chỉ còn chú thích nhắc engine — qc sửa chữ.
- `CLAUDE.md` D7 còn ví dụ engine (tài liệu luật, ngoài phạm vi).

## Test tối thiểu
- int: `packages/db/src/feature-app-col.int.test.ts` (backfill + gỡ engine + audit + NOT NULL/CHECK/trigger + journal); `apps/admin-api/src/modules/tenants/tenants.list-app.int.test.ts` (lọc `app` đọc cột).
- 1 test phát hiện lệch: `flow-coverage.check.test.ts` (unit) + `ops.flow-coverage.int.test.ts` (int).
- unit: `feature-meta.test.ts`, `feature-assign.test.ts`, `apps-plan.test.ts`, `overview.test.ts`, `revoke-message.test.ts`, contracts `features/grants`.

## Quyết định trong lúc làm
- `other` = chưa phân vào ứng dụng nào (nhóm "Khác"); tập `app` gồm cả `core` (luôn bật) và `other` — `TENANT_APP_IDS` (lọc được) là tập con.
- Cột không có DEFAULT; trigger điền theo cùng hàm `feature_app_of` dùng cho backfill (một định nghĩa). Đây là mặc định lúc TẠO, mọi chỗ ĐỌC dùng cột.
- Mức (Xem/Sửa/Quản trị) và "tính năng thêm" vẫn suy từ hậu tố khoá ở admin-web — không phải ứng dụng.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED admin/feature-ung-dung.md
#### Yêu cầu: Ứng dụng của feature là một cột duy nhất
Mỗi feature có cột `app` (core, chat, community, contracts, knowledge hoặc other); mọi nơi cần biết feature thuộc ứng dụng nào (lọc công ty theo Ứng dụng, nhóm Tính năng, thẻ app của công ty) đọc cột này, không suy từ tiền tố khoá. Migration backfill theo quy ước khoá (`han-muc-duyet` thuộc contracts) và feature tạo bằng SQL thẳng được điền theo cùng quy ước.
- Kịch bản: khi chạy migration trên dữ liệu chưa có `app` thì mọi feature có `app` hợp lệ, `han-muc-duyet` thuộc contracts [test: packages/db/src/feature-app-col.int.test.ts » backfill theo quy ước (han-muc-duyet → contracts), gỡ engine + entitlement mồ côi kèm audit, NOT NULL/CHECK/trigger]
- Kịch bản: khi lọc công ty theo Ứng dụng thì tính theo cột `app`, không theo tiền tố khoá [test: apps/admin-api/src/modules/tenants/tenants.list-app.int.test.ts » lọc app=contracts đọc cột `app`: có zz-sales (app=contracts), bỏ revoked và contracts-odd (app=other)]
- Kịch bản: khi nhóm danh mục feature thì nhóm theo cột `app` [test: apps/admin-web/src/features/features/lib/feature-meta.test.ts » nhóm theo cột app, không theo tiền tố]
#### Yêu cầu: Không còn feature bật duyệt bằng quy trình
Duyệt hợp đồng bằng quy trình bật khi công ty được gán quy trình cho khe duyệt; feature `contracts-approval-engine` và các cấp phép của nó bị gỡ, không hiện ở danh mục.
- Kịch bản: khi chạy migration thì feature engine và entitlement của nó biến mất, có dòng audit [test: packages/db/src/feature-app-col.int.test.ts » backfill theo quy ước (han-muc-duyet → contracts), gỡ engine + entitlement mồ côi kèm audit, NOT NULL/CHECK/trigger]
#### Yêu cầu: Ops phát hiện feature thiếu ứng dụng hoặc engine còn sót
Check `flow_coverage` báo đỏ khi feature theo quy ước thuộc một ứng dụng mà cột `app` là other, hoặc feature engine còn trong danh mục, kèm cách sửa.
- Kịch bản: khi có feature `contracts-*` với app=other thì check báo đỏ nêu key, sửa xong thì xanh [test: apps/hub-api/src/modules/ops/ops.flow-coverage.int.test.ts » CR-121 c18 · feature thiếu app (khoá thuộc ứng dụng mà cột app = other) và engine còn sót ⇒ crit nêu key, sửa xong ⇒ ok]
- Kịch bản: khi đánh giá kết quả có feature thiếu app thì crit và nối với lệch hiển thị [test: apps/hub-api/src/modules/ops/adapters/checks/flow-coverage.check.test.ts » feature thiếu app (cột app = other dù khoá thuộc một ứng dụng) ⇒ crit nêu key, kèm lệch hiển thị khi có]

## Việc còn lại
- Chạy int evotest (db + admin-api + hub-api ops) và `bun run test:lock:write` nếu cần; Opus low soát diff migration/trigger.
- qc sửa chữ nhắc engine trong `e2e/app-config.spec.ts:147`, `e2e/journey-approval/{_ja-stack.ts,approval.ja.ts}`; CLAUDE.md D7 ví dụ engine.
