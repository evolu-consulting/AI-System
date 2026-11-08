---
id: cr123-u6c-esign-perm
lát: cr123-u6c-esign-perm
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Run từ flow Thư viện được gán cho công ty không chạy được stage `tool` thật vì `loadCall` nối `hub.process_defs` kèm `d.tenant_id = r.tenant_id`: def Thư viện thuộc nền tảng nên không khớp, `can_run` NULL, run dừng `permission_lost`. Sửa: nối theo `d.id` (run đã trỏ đúng def; truy vấn scope hệ thống).

## Làm
`tool-stage-load.repo.ts` bỏ điều kiện tenant ở join def; e2e hành trình thẻ Ký số (`cr123-u6-run-card.spec.ts`) bỏ fixme, ảnh ở `docs/specs/CR-123/shots/u6`.

## Không làm / Chạm
Không đổi mô hình quyền, không migration.

## Test tối thiểu
Hành trình `journey-approval` (spec u6 xanh: Đang chờ ký + người ký, rồi Đã ký).

## Quyết định trong lúc làm
Ký số chỉ nhận PDF (đúng sản phẩm): e2e đổi mime tệp mẫu của HĐ.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Bước tool của flow được gán chạy được không cần cấp quyền thủ công
Flow Thư viện được gán cho công ty có bước Ký số: sau khi duyệt xong, bước gửi ký chạy như flow bản công ty; thẻ duyệt hiện MỘT dòng Ký số: Đang chờ ký rồi Đã ký, kèm người ký.
- Kịch bản: duyệt xong thì Ký số Đang chờ ký kèm người ký, người ký bấm Ký ngay thì Đã ký [test: thủ công — e2e/journey-approval/cr123-u6-run-card.spec.ts (job journey-approval)]

## Việc còn lại
Int riêng cho `loadCall` với def Thư viện (hiện phủ bằng e2e hành trình).
