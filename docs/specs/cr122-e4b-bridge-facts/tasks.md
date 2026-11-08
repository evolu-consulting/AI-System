---
id: cr122-e4b-bridge-facts
lát: cr122-e4b-bridge-facts
cr: CR-122
làn: nhanh
migration: không
phụ thuộc: E4 (20fc56c8b)
---
## Plan (ngắn)
Gợi ý cầu nối AI lấy danh mục dữ kiện của sự kiện mở flow (`def.app` → manifest → `events[trigger.event].facts`) và đưa CHỈ khoá + kiểu vào prompt; kiểm lại nguồn `fact` của đề xuất theo đúng danh mục đó.

## Làm
- [x] `bridge.rules.eventFactsOf` (thuần) + `bridge.service` truyền `facts` vào prompt và `verifyBridge`.
- [x] Unit `bridge.routes.test.ts`: prompt có facts (chỉ key/type) khi flow có app + trigger; nguồn fact lạ ⇒ từ chối.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Gợi ý cầu nối dùng được dữ kiện bản ghi
- Kịch bản: prompt có khoá + kiểu dữ kiện của sự kiện [test: apps/hub-api/src/modules/processes/bridge/bridge.routes.test.ts » CR-122 E4b · flow của app có trigger ⇒ prompt có facts (chỉ khoá + kiểu) của sự kiện, AI dùng được nguồn fact]

## Việc còn lại
- Không.
