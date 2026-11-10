---
id: pl-e2e-roles
lát: pl-e2e-roles
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Bug class G3 (dev-flow §5): CR-126 đối tác chỉ hiện cho người thêm ⇒ e2e xanh vì cùng một user tạo dữ liệu rồi làm bước. Hành trình phải dùng ba người khác nhau.

## Làm
- `e2e/_roles.ts`: `assertDistinctActors(step, {creator, actor, dataOwner})` (thuần, CJS-an toàn) + unit `tests/unit/e2e-roles.test.ts`.
- `e2e/journey-approval/_partner-pick.ts`: `seedPartner(..., addedBy)` ghi `created_by` = user thêm (throw nếu không thêm được); `pickPartnerAndSend` bắt buộc `contractCreator` + `partnerAddedBy` và gọi guard ngay đầu.
- q6 + s7 (hai spec dùng bước «Chọn đối tác & người nhận»): người tạo HĐ = `U.employee`, người thêm đối tác = `U.accounting`, người chọn = `U.director`.

## Không làm / Chạm
Không đổi code sản phẩm. `cr125-purchase-full.spec.ts` KHÔNG có bước chọn đối tác (không import `_partner-pick`) nên không đổi. Không chạy e2e.

## Test tối thiểu
Unit `_roles`; `playwright test --list` trên config journey-purchase và journey; relock.

## Quyết định trong lúc làm
- Unit đặt ở `tests/unit/` vì `bunfig.toml` bỏ qua `e2e/**` khi `bun test`.
- Người thêm đối tác = kế toán (user thứ ba có sẵn ở mọi công ty e2e).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ đổi test)

## Việc còn lại
Bước một tài khoản vừa tạo dữ liệu vừa hành động ở vai khác (chưa sửa, chỉ liệt kê):
- `cr124-q6-partner-journey.spec.ts:140-153` + `:203/:229/:246` — `U.director` của B tự tạo nhóm (chứa chính mình), tự bật nhận HĐ, rồi là người nhận hộp thư và người xác nhận.
- `cr125-ux-s7-partner-enable.spec.ts:94` + `:196/:232/:251` — như trên (bAdmin = `U.director` của B).
- `cr125-purchase-full.spec.ts:389/:417` — `U.employee` tạo phiếu rồi tự làm các bước điền (cố hữu của flow, nhưng chưa kiểm dữ liệu phụ thuộc người thêm).
- `cr125-form-step-card.spec.ts:174/:235` — `U.employee` tạo HĐ rồi đăng nhập lại làm bước cuối.
- `cr125-parallel-approval-ui.spec.ts:142-147` — dữ liệu/nhóm dựng bằng apiLogin platform; người duyệt chỉ là nhóm, chưa kiểm tính thấy dữ liệu do người khác thêm.
Tổng: 5 nhóm nghi vấn.
