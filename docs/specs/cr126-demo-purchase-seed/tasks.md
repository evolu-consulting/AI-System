---
id: cr126-demo-purchase-seed
lát: cr126-demo-purchase-seed
cr: CR-126
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Công ty `demo` chạy trọn 11 bước «Quy trình mua hàng» ngay sau seed, không set tay (như e2e cr125-purchase-full).

## Làm
- `seed.cr125-config.ts`: hằng `PURCHASE_ROLE_GROUPS` (vai → nhóm duyệt; nguồn duy nhất cho seed + e2e); `purchaseMembers` theo vai thay cho xoay vòng: demo-owner = giám đốc, demo-viewer = kế toán, demo-editor = nhân viên (evolu: julian.bui / vio.ngo / thomas.tran).
- Cha «Quy trình mua hàng» đã được gán + Bật cho công ty có `contracts-read` (`assignManualFlows`); không đổi. Ghi thành viên nhóm đã bump cache (`bumpIfChanged`).

## Không làm / Chạm
Không sửa e2e (agent khác); không DLC.

## Test tối thiểu
`apps/hub-api/src/modules/seed/seed.cr126-demo-purchase.int.test.ts`.

## Quyết định trong lúc làm
Thành viên cũ do xoay vòng (nếu có trên DB đã seed) giữ nguyên; chỉ thêm. Mọi dòng cùng duyệt có giám đốc + kế toán nên ≥ 2 người khác nhau.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/seed-cau-hinh-cong-ty.md
#### Yêu cầu: Công ty mẫu demo chạy trọn «Quy trình mua hàng» ngay sau seed (nguồn: cr126-demo-purchase-seed)
Tài khoản demo-owner (giám đốc), demo-viewer (kế toán), demo-editor (nhân viên) được xếp sẵn vào các nhóm duyệt theo vai; mỗi dòng «cùng duyệt» có ít nhất hai người khác nhau; flow cha đã gán và Bật; không cần thao tác tay.
- Kịch bản: khi seed công ty demo thì flow cha đã Bật, mỗi nhóm duyệt có thành viên, mỗi dòng cùng duyệt có ≥ 2 người khác nhau và chạy lại 0 đổi [test: apps/hub-api/src/modules/seed/seed.cr126-demo-purchase.int.test.ts » cha gán + Bật, mọi nhóm có người, dòng cùng duyệt ≥ 2 người khác nhau, chạy lại 0 đổi]

## Việc còn lại
e2e cr125-purchase-full nên import `PURCHASE_ROLE_GROUPS` thay map MEMBERS riêng.
