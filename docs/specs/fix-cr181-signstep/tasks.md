---
id: fix-cr181-signstep
lát: fix-cr181-signstep
cr: CR-181
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Tái hiện e2e K07 (bước Ký `ondoc`, người ký công ty = nhóm) bằng int chạy use case Lưu THẬT + engine THẬT.

## Làm
- [x] `apps/hub-api/src/modules/packs/sign-step-group.int.test.ts`: thành viên nhóm Lưu ô «Đại diện nhóm» ⇒ ô đã ký + bước chờ `esign.completed` xong; Lưu khi lượt còn ở stage tool ⇒ bước chờ mở ra là xong ngay.
- [ ] Sửa lỗi: CHƯA tìm ra — int xanh trên evotest (2/2), không tái hiện được ở tầng int.

## Không làm / Chạm
Không đổi code sản phẩm.

## Test tối thiểu
- Int evotest `sign-step-group.int.test.ts` → 2 pass.

## Quyết định trong lúc làm
- Đỏ đầu tiên chỉ do fixture (bước Duyệt còn mở ⇒ `settleStepTx` đặt `current_stage_idx` về bước Duyệt) — không phải lỗi sản phẩm.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ thêm int tái hiện; lỗi e2e K07 chưa tái hiện được ở tầng int).

## Việc còn lại
- Cần dữ liệu thật của lần e2e K07: hàng `contracts.sign_fields` của HĐ (signed_version_id), `contracts.sign_versions` (run_id, voided_at) và audit `document_signed` (`summary.fields`) — xem request Lưu có `field_id` thật không và ô có bị bỏ sau đó không.
