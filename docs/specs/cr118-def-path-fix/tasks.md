---
id: cr118-def-path-fix
lát: cr118-def-path-fix
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)

## Làm

## Không làm / Chạm

## Test tối thiểu

## Quyết định trong lúc làm

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED sht/cai-dat-va-quyen.md
#### Yêu cầu: Cài đặt › Ứng dụng & quy trình (tenant tự sửa luật chọn quy trình)
Luật có quy trình đã xoá / chưa xuất bản (server trả `unavailable`) hiện nhãn "Quy trình đã bị xoá / chưa xuất bản"; lưu bị chặn tới khi sửa hoặc xoá luật đó (422 `ROUTING_PROCESS_UNAVAILABLE` ⇒ câu tiếng Việt). Hợp đồng đã đúng đường dẫn `/tenants/:tid/process-routing/...` (không `/hub-admin`) cho GET xem sơ đồ.
- Kịch bản: luật unavailable ⇒ mã 'unavailable' chặn lưu, đổi quy trình thì hết [test: packages/web-kit/src/routing-rules.test.ts » ruleIssues: luật unavailable ⇒ mã 'unavailable' (chặn lưu), đổi quy trình thì hết]
- Kịch bản: 422 ROUTING_PROCESS_UNAVAILABLE ánh xạ về loại lỗi riêng [test: packages/web-kit/src/routing-rules.test.ts » 422 ROUTING_PROCESS_UNAVAILABLE ⇒ kind 'unavailable']
- Kịch bản: hợp đồng ngừng khởi tạo vì không có luật khớp / quy trình bị xoá ⇒ thẻ duyệt hiện câu rõ cho chủ/quản trị [test: apps/workspace-web/src/features/contract-approval/lib/attention.test.ts » stalled: FLOW_ROUTE_NONE / FLOW_ROUTE_UNAVAILABLE có câu riêng]

## Việc còn lại
Không.