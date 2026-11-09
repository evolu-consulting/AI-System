---
id: cr126-partner-pick-fix4
lát: cr126-partner-pick-fix4
cr: CR-126
làn: nhanh
migration: không
phụ thuộc: cr126-partner-pick-fix3
---
## Plan (ngắn)
e2e q6/s7: sau «Gửi» bước chọn người nhận, tool gửi dừng `PARTNER_NOT_IN_COMPANY` dù đối tác thuộc công ty: `isPartner` chạy theo người bắt đầu
lượt, RLS `partner_roles_visible` ẩn đối tác người đó không thấy (chế độ xem 'org', đối tác thêm tay bởi người khác). Sửa: kiểm ở phạm vi hệ
thống của CHÍNH tenant (`uow.system(tenantId, …)`, SQL lọc `tenant_id` tường minh), trước mọi ghi. Không đổi RLS.

## Không làm / Chạm
Perf: vẫn một câu `exists` theo index (tenant_id, party_key).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/gui-doi-tac-xac-nhan.md
#### Yêu cầu: Kiểm đối tác chọn theo sổ đối tác của công ty
Đối tác chọn ở bước chọn người nhận được kiểm theo sổ đối tác của cả công ty, không theo quyền xem của người gửi.
- Kịch bản: khi chế độ xem theo tổ chức và người gửi không phải người thêm đối tác thì vẫn gửi được cho đối tác của công ty [test: apps/hub-api/src/modules/packs/contracts/partner-pick.int.test.ts » (a) chế độ 'org']
- Kịch bản: khi chọn MST đối tác của công ty khác thì bước gửi lỗi và không ghi lần gửi [test: apps/hub-api/src/modules/packs/contracts/partner-pick.int.test.ts » (b) MST đối tác của công ty khác]
