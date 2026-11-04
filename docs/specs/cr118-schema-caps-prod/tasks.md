---
id: cr118-schema-caps-prod
lát: cr118-schema-caps-prod
cr: CR-118
làn: nhanh
migration: không
phụ thuộc: cr118-boot-packs (4ad83da3)
---
## Plan (ngắn)
Review (TB): lặng lẽ đóng an toàn ở prod che mất thiếu GRANT/migration. `APP_ENV=production` thiếu phần schema tuỳ chọn ⇒
server.ts exit 1 (`hub-schema-missing`, liệt kê phần thiếu); khác production giữ đường mềm. ConfigCache dò lại đầu mỗi lần nạp
(Hub/Admin) khi còn thiếu ⇒ migrate sau khi chạy được nhận không khởi động lại; đủ ⇒ không dò (0 SQL thêm).

## Làm
- [x] schema-caps.ts: `schemaCapsVerdict`, `assertHubSchemaCaps`, `refreshHubSchemaCaps`; cảnh báo chỉ khi tập thiếu đổi
- [x] server.ts `assertSchemaCaps`; ConfigSource `refreshSchema`
- [x] unit schema-caps.test.ts + int schema-caps-prod.int.test.ts

## Không làm / Chạm
Không sửa stack e2e đóng băng.

## Test tối thiểu
apps/hub-api/src/modules/config/schema-caps.test.ts, schema-caps-prod.int.test.ts, schema-caps.int.test.ts.

## Quyết định trong lúc làm
- Dò lại chỉ khi còn thiếu (prod đủ schema ⇒ nạp lại không thêm câu SQL nào).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Production không được lặng lẽ thiếu schema gói
`APP_ENV=production` thiếu `packs.pack_agents`/cột default_app/profile_version ⇒ Hub dừng lúc khởi động, liệt kê phần thiếu; môi trường khác chạy mềm và nhận migrate muộn ở lần nạp lại kế.
- Kịch bản: khi production thiếu packs.pack_agents thì boot ném lỗi liệt kê packAgents; test thì không [test: apps/hub-api/src/modules/config/schema-caps-prod.int.test.ts » production thiếu ⇒ ném liệt kê packAgents, test ⇒ không ném]
- Kịch bản: khi migrate sau khi Hub chạy thì lần nạp lại kế dò lại và thấy bảng [test: apps/hub-api/src/modules/config/schema-caps-prod.int.test.ts » migrate sau khi chạy ⇒ lần nạp lại kế dò lại và thấy bảng]
- Kịch bản: quyết định theo APP_ENV [test: apps/hub-api/src/modules/config/schema-caps.test.ts » production thiếu ⇒ fatal, test/development thiếu ⇒ warn, đủ ⇒ ok]

## Việc còn lại
