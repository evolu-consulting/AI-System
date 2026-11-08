---
id: cr118-boot-packs
lát: cr118-boot-packs
cr: CR-118
làn: nhanh
migration: không
phụ thuộc: eeb6781d (pack_agents trong ảnh Hub)
---
## Plan (ngắn)
Hồi quy từ eeb6781d: `loadHubSnapshot` SELECT `packs.pack_agents`; stack e2e đóng băng chỉ chạy `runHubMigrations` ⇒ Hub chết lúc
boot (`relation "packs.pack_agents" does not exist`, server.ts kiểm Orchestrator). Sửa ở Hub: `config/schema-caps.ts` dò MỘT lần mỗi
`Db` (một câu: `to_regclass` + `has_table_privilege` + `information_schema.columns`) các phần tuỳ chọn: `packs.pack_agents`,
`admin.users.default_app`, `admin.tenants.default_app`, `admin.config_meta.profile_version`. Thiếu ⇒ đóng an toàn (không agent gói,
default_app null, profile 0) + một dòng cảnh báo `hub-schema-optional-missing`. Nóng 0 SQL thêm (promise nhớ).

## Làm
- [x] schema-caps.ts + config.repo dùng caps
- [x] int schema-caps.int.test.ts

## Không làm / Chạm
Không sửa stack e2e đóng băng. Migrate sau khi Hub chạy ⇒ khởi động lại mới thấy (giống `assertAdminSchema`).

## Test tối thiểu
apps/hub-api/src/modules/config/schema-caps.int.test.ts; e2e evotest `-Step e2e -All -Filter chat-x2a,K1`.

## Quyết định trong lúc làm
- Dò theo `Db` (WeakMap) thay vì cờ toàn cục: test/instance dùng nhiều kết nối; lỗi dò ⇒ không nhớ, lần sau dò lại.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Hub khởi động khi thiếu schema gói tuỳ chọn
Thiếu `packs.pack_agents` (hoặc cột default_app/profile_version chưa migrate) ⇒ Hub vẫn khởi động và phục vụ; agent gói rỗng, default_app null; cảnh báo một lần; đủ schema ⇒ hành vi không đổi.
- Kịch bản: khi DB không có `packs.pack_agents` thì ảnh Hub nạp với agent gói rỗng, kiểm Orchestrator không ném, /health 200 [test: apps/hub-api/src/modules/config/schema-caps.int.test.ts » thiếu packs.pack_agents ⇒ agent gói rỗng, boot không ném, /health 200, nóng 0 SQL dò thêm]
- Kịch bản: khi đủ schema thì đọc `packs.pack_agents` như cũ [test: apps/hub-api/src/modules/config/schema-caps.int.test.ts » đủ schema ⇒ đọc packs.pack_agents như cũ]

## Việc còn lại
