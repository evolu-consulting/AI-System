# fix-review-r3 — sửa theo soát Opus vòng 3 (CR-127 / CR-148 / CR-150 / CR-151 / CR-152)

## Plan
5 điểm soát: gửi duyệt qua «Lưu» phải theo vai (CR-127 §148), ràng buộc `direction` của HĐ Nhượng quyền/Hợp tác, kiểm người phụ trách nhận HĐ ở mọi đường lưu, test tin nhắn theo CR-148, ghi quyết định CR-150/151.

## Làm
| # | Việc | Trạng thái |
|---|---|---|
| 1 | `POST /contracts/:id/review` không `draft` ⇒ `checkRole: true` (403 `FORBIDDEN`, HĐ giữ Nháp); web `confirmSave` thêm `can.submit` (`review.usecase.ts`, `review.routes.ts`, `head-rule.ts`) | xong (int + unit) |
| 2 | `ManualContractRequestSchema`: bỏ ràng buộc deal↔direction cho franchise/cooperation (`extract.ts`) | xong (unit) |
| 3 | `checkOnSave` (flow-check.ts): đường khe / bản sao thư viện vẫn gọi `receiveOwnerCheck` | xong (int) |
| 4 | `messages.test.ts` mong 30 theo CR-148 (`MSG_PAGE_DEFAULT`); test không nằm trong `tests/.lock` | xong (unit) |
| 5 | Ghi quyết định CR-150 / CR-151 vào `tasks.md` của hai lát đó | xong |

## Không làm / Chạm
Không đổi tên `nextOffset`; không sửa e2e. Chạm: contracts/review, contract-review/head-rule, pack-contracts/extract, processes/defs/flow-check.

## Test tối thiểu
- unit: `head-rule.test.ts`, `pack-contracts.test.ts`, `messages.test.ts`.
- int (evotest): `review-role.int.test.ts`, `flow-check.int.test.ts`.

## Quyết định trong lúc làm
- (1) Lỗi vai phát sinh SAU `planReview` + ghi trong tx ⇒ `SubmitRollback` ⇒ rollback cả lệnh (trường không đổi, version giữ). Người không có quyền mà gửi version cũ nhận 409 trước 403 (không lộ gì thêm). Lưu nháp (`draft:true`) giữ theo vai `write` (spec không cấm).
- (1) Web: `resubmit` đã có `can.submit` từ trước; chỉ `confirmSave` thiếu. Test cũ NF1 truyền `can.submit:false` cho ca «không chặn» ⇒ đổi thành `true` (hành vi mới).
- (3) Không dựng def bản sao thư viện (cần khe + `slot_body`) trong int; gom điều kiện vào `checkOnSave` (một cổng) và test cổng bằng `flowRules=false/true` — `defs.service.ts` đã sát trần 400 dòng nên không thêm dòng.
- e2e khoá: chưa soát được e2e hành trình nào bấm «Lưu» để gửi duyệt bằng người không phải người tạo/phụ trách — QC rà `e2e/**` (mục 1 đổi hành vi: người đó giờ chỉ còn «Lưu nháp»).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md

#### Yêu cầu: Gửi duyệt qua «Xác nhận và lưu» chỉ người tạo hoặc người phụ trách
Người có quyền ghi nhưng không phải người tạo hợp đồng hay người phụ trách chỉ «Lưu nháp» được; nút «Xác nhận và lưu» / «Gửi lại» không hiện với họ, và gửi qua API bị từ chối 403, hợp đồng giữ Nháp.
- Kịch bản: khi người có quyền ghi nhưng không phải người tạo hay phụ trách gửi duyệt thì bị từ chối và hợp đồng giữ Nháp [test: apps/hub-api/src/modules/packs/contracts/adapters/review-role.int.test.ts » người KHÔNG phải người tạo/phụ trách ⇒ forbidden, HĐ giữ Nháp, version không đổi]
- Kịch bản: khi người tạo hoặc người phụ trách gửi duyệt thì hợp đồng sang Đang duyệt [test: apps/hub-api/src/modules/packs/contracts/adapters/review-role.int.test.ts » người phụ trách (không phải người tạo) ⇒ gửi được]
- Kịch bản: khi người có quyền ghi nhưng không phải người tạo/phụ trách mở hợp đồng nháp thì chỉ thấy «Lưu nháp» [test: apps/workspace-web/src/features/contract-review/lib/head-rule.test.ts » vai write nhưng không phải người tạo/phụ trách ⇒ có Lưu nháp, KHÔNG có Xác nhận và lưu]

### ADDED pack-contracts/loai-hop-dong.md

#### Yêu cầu: Hợp đồng Nhượng quyền / Hợp tác bỏ qua `direction` khi nhập tay
Khi nhập tay hợp đồng Nhượng quyền hoặc Hợp tác, hướng mua/bán gửi lên bị bỏ qua (hướng lấy theo vai trong trường riêng); không bị từ chối vì lệch loại.
- Kịch bản: khi nhập tay Nhượng quyền hoặc Hợp tác kèm hướng bất kỳ thì được nhận [test: packages/contracts/src/pack-contracts/pack-contracts.test.ts » franchise/cooperation + direction bất kỳ ⇒ hợp lệ (direction lấy theo vai trong kind_terms)]

## Việc còn lại
- QC rà e2e có bước «Lưu» gửi duyệt bằng người khác người tạo (xem Quyết định).
