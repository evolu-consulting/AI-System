# qc-batch-146-152 — QC cuối đợt (CR-146..152): relock + sửa e2e/int đã biết gãy

## Plan
Relock `tests/.lock` sau các lát CR-146..152; sửa e2e/int lệch theo hành vi mới. Chỉ chạm `e2e/**`, `tests/.lock`, một int, docs.

## Làm
| # | Việc | Trạng thái |
|---|---|---|
| 1 | Đối chiếu từng tệp CHANGED/UNLOCKED rồi `test:lock:write` | xong (verify xanh, 1546 tệp) |
| 2 | file-preview (iframe Word), cr150 vào testMatch cr127 + selector, _cr127-stack thêm bước Ký | xong (chưa chạy e2e) |
| 3 | `defs-flow.int.test.ts` theo luật CR-127 (ghi bằng platform_admin, ca tenant_admin 403) | 6/7 xanh; 1 đỏ khác nguyên nhân (xem Việc còn lại) |
| 4 | Danh sách e2e cuối đợt | xong (dưới) |

## Quyết định lúc relock (một dòng mỗi tệp)
- cr130-journey.cs.ts · CR-137b bấm dòng ⇒ hộp chi tiết, hộp tự đóng sau duyệt: đúng hành vi mới, chấp nhận.
- flows.cs.ts · CR-137b như trên (report-hide trong hộp chi tiết): chấp nhận.
- org-visibility.cw.ts · CR-151 chọn quản lý qua hộp tìm ở máy chủ (mock `/admin/org/members?q`): chấp nhận.
- v2j1-products.cw.ts · CR-151 danh sách sản phẩm là trang máy chủ (mock lọc nhóm + tìm, vẫn có `total`/`counts`): chấp nhận.
- V2-J1/business.int.test.ts · chỉ THÊM ca CR-151 phân trang; ca cũ nguyên: chấp nhận.
- _cr127-stack.ts · CR-146b bỏ nhóm Người ký cấp công ty; người ký bên nhận = bước Ký của quy trình Nhận HĐ ⇒ đã thêm bước Ký (nhóm Người ký làm «Người ký phía công ty», provider selfsign): chấp nhận.
- j01-soan-ap-dung-duyet.spec.ts · đổi nhãn «Ký số»→«Ký hợp đồng» (CR-141) + thêm assert hồ sơ duyệt CR-144, không xoá assert: chấp nhận.
- j03-uy-quyen.spec.ts · CR-151 hộp chọn người gõ tên rồi bấm kết quả thay select; vẫn chọn đúng người: chấp nhận.
- cr123-u6-run-card.spec.ts · chỉ thêm `provider: selfsign` bắt buộc (CR-146b): chấp nhận.
- cr125-s2-settings-flow.spec.ts · commit 5ca23843b bỏ `flow-current-title` nhưng thay bằng `flow-list-items` trong cùng `.or(flow-none)` (tương đương cho UI danh sách) và THÊM assert `flow-item-0`/`flow-when-0`/`flow-sign-block`: không làm yếu, chấp nhận (không cần khôi phục).
- UNLOCKED mới (cr145/cr147/cr147b community, j20, cr139b/d, cr141, cr152 kinds-ui, CR-135 docx-esign-number): test mới bám CR tương ứng, không skip/only: khoá. cr149/file-preview + cr150 đã sửa ở mục 2 rồi khoá.

## Quyết định trong lúc làm
- cr150 A thấy kết quả B ở thẻ `partner-round` (khối «Gửi đối tác»); `partner-status` chỉ có ở admin-web nên bỏ. `[data-approval=return|reject|approve|pass]` có thật (HeadActions → pop-menu).
- playwright.cr127.config.ts: `testDir` đổi `..`, testMatch `**/cr127/j*.spec.ts` + `**/journey-approval/cr150-two-companies.spec.ts` (spec nằm ngoài e2e/cr127).
- Cảnh báo: cặp d5a→d5b nay có bước Ký ở Nhận HĐ (do j08). cr150 duyệt xong B còn chờ Ký ⇒ ca «A thấy đối tác đã xác nhận» có thể chưa tới nếu HĐ không phải PDF/chưa ký; điều phối xem kết quả chạy rồi tách cặp riêng (không ký) nếu đỏ.
- Cộng đồng: e2e cũ dùng ô «Nhắc tên»/«Người đăng» đã chuyển sang hộp mới ở cr145/cr147 (đã nằm trong UNLOCKED); không còn spec nào gọi `mention-people` cũ.
- defs-flow.int: thêm `provider` vào tham số tool giả (CR-146b gửi `provider` ⇒ TOOL_INVALID).

## Việc còn lại
- `defs-flow.int.test.ts` ca «sai kiểu (field date là chuỗi, Hẹn giờ cần date)»: PUT 200 nhưng KHÔNG có `warnings` (kiểm cạnh `core.wait-until` không báo lệch kiểu). Không do luật CR-127; nghi hồi quy edge-check/palette node core (CR-125). Chưa sửa test, cần backend xem. 
- Chạy e2e cuối đợt (điều phối):
  `powershell -File deploy/evotest/run-tests.ps1 -Step e2e -Filter "e2e/community-web/cr130-journey.cs.ts e2e/community-web/flows.cs.ts e2e/community-web/cr145-post-mention.cs.ts e2e/community-web/cr147-feed.cm.ts e2e/community-web/cr147b-people.cs.ts e2e/contracts-web/org-visibility.cw.ts e2e/contracts-web/v2j1-products.cw.ts e2e/cr127/j01-soan-ap-dung-duyet.spec.ts e2e/cr127/j03-uy-quyen.spec.ts e2e/cr127/j08-ky-cung-luc.spec.ts e2e/cr127/j20-tin-nhan-danh-ba.spec.ts e2e/cr149/file-preview.spec.ts e2e/cr152/kinds-ui.spec.ts e2e/journey-approval/cr123-u6-run-card.spec.ts e2e/journey-approval/cr125-s2-settings-flow.spec.ts e2e/journey-approval/cr139b-starter-head.spec.ts e2e/journey-approval/cr139d-org-tree.spec.ts e2e/journey-approval/cr141-sign-or-upload.spec.ts e2e/journey-approval/cr150-two-companies.spec.ts"`

## Delta (so với docs/current)
Không thay đổi hành vi (lý do: QC relock + sửa e2e)

Trạng thái gộp: chưa gộp
