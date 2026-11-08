---
id: cr122-q1-e2e
lát: cr122-q1-e2e
cr: CR-122
làn: nhanh
migration: không
phụ thuộc: cr122-u2e-node-panel
---
## Plan (ngắn)
Qc một mình: sửa các ca e2e vỡ vì màn Việc/Luật định tuyến/khe đã gỡ; viết hành trình G1/G2 (journey-approval), G3 (community-web), ca UI trình sửa (menu Thêm bước, cầu nối, chèn giữa flow, Chạy lại từ Nếu).

## Làm
- Kit: `_kit/ui.ts` (`openCompanyFlows`, `assignFlowUi`, `loginTenantAdminUi`), `_kit/flows.ts` (dựng flow riêng + cờ FLOW_TRIGGERS), `_kit/api.ts`.
- `cr122-flows.spec.ts` (G1, G2, 3 lỗi 409, H2 Chạy lại từ Nếu, kéo thả), `cr122-editor.spec.ts` (menu, cầu nối mock route, chèn giữa + Lưu), `community-web/flows.cs.ts` (G3, cờ bật).
- Gỡ ca của UI đã gỡ: `cr121-c-flows`, `tenant-routing.pa|cw`; ca cũ gán theo khe (d-journey, d6b, approval.ja) gán bằng API đường khe cũ.

## Không làm / Chạm
- Ca chỉnh cấu hình Ký số (chờ U2f). Không sửa code sản phẩm.

## Quyết định trong lúc làm
- Flow Thư viện dựng bằng SQL (Lỗi sản phẩm #1). Phòng ban dùng của stack hành trình; bước Ký số giả lập bỏ (stack không có nhà cung cấp).

## Lỗi sản phẩm
1. Không có đường xuất bản flow Thư viện mới: `library.service.ts:77-89` (`#b2` → `specOrThrow(def.slot)` + `systemTools` `contracts-route/finalize` ở `approval.mount.ts:107`) và `library.repo.ts:19` (`IS_LIB` đòi `slot is not null`). Flow có trigger nhưng không khe ⇒ 404; có khe ⇒ PROCESS_PUBLISH_INVALID vì thiếu nút hệ thống. Tái hiện: POST /process-defs {trigger, app} rồi POST /process-defs/:id/publish.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

Không thay đổi hành vi (lý do: chỉ thêm/sửa test e2e và kit test).

## Việc còn lại
Chạy job journey-approval, community-web, P-a, fnr-showcase, P-b2; ca Ký số chờ U2f.

## Lỗi sản phẩm (bổ sung)
- #1 ĐÃ SỬA ở E6 (kit dùng API thật). 
- #2 `LibraryReadOnlyView.tsx:71` chỉ vẽ `slot_body`: dòng "Được gán" mở ra "Chưa xem được các bước" (G1.1b fixme). Tái hiện: gán flow mới cho công ty, platform_admin bấm Mở.
- #3 Flow có node Ký số bảng chưa cấu hình: thẻ node báo "Chọn nguồn cho tham số này", bấm Lưu không gửi PUT và không báo lỗi (cr122-editor 2b fixme). A (dữ liệu tự nối) dự kiến sửa.
- #4 (nghi) HĐ đầu tiên của công ty sau khi gán flow không mở lượt trong 135 s; HĐ sau đó chạy đúng (G1.2 fixme, G1 được G2 phủ).
- #5 (nghi) Community: flow duyệt bài đã gán + FLOW_TRIGGERS bật, bài của đối tác không hiện "Chờ duyệt" (flows.cs ca 2 fixme).
- P-a Form theo khe: mọi def thư viện đã backfill có trigger ⇒ chỉ còn canvas; đã gỡ phần Form/slot-stage-form trong process-library.pa và ca Form của editor-steps.pa.
