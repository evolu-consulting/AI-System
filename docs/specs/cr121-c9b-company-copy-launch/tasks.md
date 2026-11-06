---
id: cr121-c9b-company-copy-launch
lát: cr121-c9b-company-copy-launch
cr: CR-121
làn: đầy đủ nhẹ (đường launch + tenant; Opus low soát diff SQL)
migration: không
phụ thuộc: cr121-c9 (đã gộp gd0 27fd6369)
---
## Plan (ngắn)
Bẫy 1 của c9: bản riêng công ty (`tenant_id=T`, `slot NULL` theo CHECK `process_defs_slot_ck`, không release) bị mọi đường chọn quy trình của khe coi là "chưa xuất bản" ⇒ sau `clone-for-company` khe bị chặn. Sửa để bản riêng LAUNCH được: đọc `slot_body` của chính nó, bản = `source_rel_version`, khe lấy từ def nguồn (`source_template_id`).

## Làm
- `slot-resolve.repo.ts`: fragment dùng chung `LIB_OR_COMPANY_COPY` (def thư viện của khe ĐÃ XUẤT BẢN, hoặc bản riêng của CHÍNH công ty sao từ def thư viện của khe) ⇒ `RESOLVE_SLOT_SQL` (name/rel/slot_body theo loại def).
- `slot-route.repo.ts`: `ROUTE_SLOT_SQL` ứng viên `defs` dùng cùng fragment (luật trỏ bản riêng ⇒ chọn được; bản riêng của công ty khác ⇒ không vào `defs` ⇒ `route_unavailable`).
- `routing.repo.ts` `assignedOf`/`assignedDef`, `slot-assign.repo.ts` `tenantSlotRows`: `rel_version = coalesce(release, source_rel_version)` ⇒ PUT luật không còn `ROUTING_PROCESS_UNAVAILABLE` cho bản riêng; tenant_admin xem được sơ đồ bản riêng.
- Đọc phụ thuộc: `pack-runs-view.ts` `inboxOf` (người duyệt) lấy `stages` từ bản riêng khi không có release; `flow-coverage.check.ts` `broken` không coi bản riêng (`published_version NULL`, có `source_rel_version`) là chưa xuất bản.
- Perf: số câu SQL launch KHÔNG đổi — `resolveSlot`/`routeSlot` vẫn đúng MỘT `execute` mỗi lần; thêm 1 tra PK `left join` def nguồn + 1 PK release chuyển sang left join (cùng index).

## Không làm / Chạm
Máy trạng thái run (settle/kick/retry/launch engine) không đổi — chỉ CHỌN def. Không UI. Không migration. Không sửa editor bản riêng (c17).

## Test tối thiểu
- int hành trình `apps/hub-api/src/modules/processes/library/company-copy-launch.int.test.ts` (sao → launch → snapshot → PUT luật → công ty khác không launch được).
- chạy lại int trực tiếp của file đổi: routing-launch, routing.routes, slot-single-source, slot-assigned, library.routes, approval-inbox-count (CF), ops.flow-coverage, approval-engine-slot, clone-for-company.

## Quyết định trong lúc làm
- `enabled`: KHÔNG bật trong clone. Launch gói (`PackRunsPort.start`) không kiểm `enabled` của def (def vật chất hoá cũng không cần); bật sẽ đưa bản riêng (có nút hệ thống) vào danh mục `!key` của chat. Trạng thái hiển thị "đang dùng" suy từ luật (Mặc định/điều kiện trỏ bản riêng), không từ `enabled` ⇒ không có trạng thái "Chưa bật" để hiện (UI c11/c17 không dùng cờ này).
- Bản riêng công ty khác: điều kiện `d.tenant_id = <công ty đang launch>` trong fragment; test chèn dữ liệu xấu (luật Z trỏ bản riêng X) ⇒ `route_unavailable`/`resolveSlot=null`/lượt `stalled`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED engine/cong-ty-quy-trinh-ban-rieng.md
#### Yêu cầu: Quy trình bản riêng của công ty chạy được
Sau khi sao quy trình thư viện cho công ty, các lượt mở theo việc dùng đúng bản riêng (bước duyệt lấy từ nội dung bản riêng, số bản = bản thư viện lúc sao); lượt ghi bản riêng vào snapshot; công ty khác không bao giờ chạy bản riêng này.
- Kịch bản: sao xong, mở lượt duyệt ⇒ bắt đầu bằng bản riêng, đúng nhóm duyệt, snapshot ghi bản riêng [test: apps/hub-api/src/modules/processes/library/company-copy-launch.int.test.ts » sao → launch dùng bản riêng → PUT luật/danh sách khe nhận bản riêng]
- Kịch bản: đặt luật trỏ bản riêng ⇒ 200, danh sách việc/quy trình của công ty báo đúng số bản [test: apps/hub-api/src/modules/processes/library/company-copy-launch.int.test.ts » sao → launch dùng bản riêng → PUT luật/danh sách khe nhận bản riêng]
- Kịch bản: luật công ty khác trỏ bản riêng của công ty này ⇒ không mở được lượt, lý do "quy trình không dùng được" [test: apps/hub-api/src/modules/processes/library/company-copy-launch.int.test.ts » sao → launch dùng bản riêng → PUT luật/danh sách khe nhận bản riêng]

## Việc còn lại
- c17: lưu sửa bản riêng PHẢI đi đường lưu theo khe (slot_body thắng stages, như `slotDraft`) — launch đọc `slot_body` của bản riêng; sửa chỉ `stages` qua `DefsService.update` sẽ không có hiệu lực khi launch.
- admin-web: 2 mã lỗi `NOT_LIBRARY_DEF`, `SLOT_GONE` (c17).
