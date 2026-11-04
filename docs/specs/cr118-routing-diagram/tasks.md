---
id: cr118-routing-diagram
lát: cr118-routing-diagram
cr: CR-118
làn: nhanh
migration: không
phụ thuộc: cr118-r2-server
---
## Plan (ngắn)
Cài đặt › "Ứng dụng & quy trình": mỗi quy trình đã gán có nút "Xem sơ đồ", nạp khi mở từ `GET /hub-admin/tenants/:tid/process-routing/:slot/processes/:defId`, vẽ bằng canvas chỉ đọc (lười).

## Làm
`api-apps.fetchRoutingDef`, `hooks/use-routing-def`, `lib/routing-def` (slot_body ⇒ bước), `SlotCard` bỏ ghi chú "chỉ quy trình đang dùng". admin-web SlotRouting không có ghi chú/sơ đồ ⇒ không đổi.

## Không làm / Chạm
Không đổi server/contract; không sửa đường gán.

## Test tối thiểu
Unit `routing-def.test.ts`; e2e `tenant-routing.cw.ts`.

## Quyết định trong lúc làm
Dev proxy rsbuild đã phủ `/hub-admin` (test proxy có sẵn).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/cai-dat-va-quyen.md
#### Yêu cầu: Cài đặt › Ứng dụng & quy trình (tenant tự sửa luật chọn quy trình)
Sơ đồ chỉ đọc xem được cho MỌI quy trình đã gán của khe (không chỉ quy trình đang dùng); chỉ nạp khi người dùng mở; quy trình ngoài tập/lỗi (404) hoặc thân không đọc được ⇒ báo "không xem được".
- Kịch bản: mở sơ đồ một quy trình đã gán ⇒ canvas hiện các bước, chưa mở thì không gọi API; 404 ⇒ báo không xem được [test: e2e/contracts-web/tenant-routing.cw.ts » sơ đồ xem được cho MỌI quy trình đã gán, nạp khi mở, 404 ⇒ báo không xem được]
- Kịch bản: 404 ⇒ trạng thái không xem được; slot_body ⇒ bước canvas [test: apps/sohoptac-web/src/features/settings/lib/routing-def.test.ts » 404 (lỗi truy vấn) ⇒ unavailable (không xem được)]

## Việc còn lại
Không.