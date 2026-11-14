# cr159-tenant-flows — CR-159 (script dựng quy trình cho evolu / nitigroup / preschool)

## Plan
`bun run tenant:flows` đi đúng đường admin nền tảng soạn quy trình (CR-127): tạo sơ đồ trống → `PUT /process-defs/:id` → `apply` → xếp thứ tự (API hub-api; công ty/nhóm/người tra qua admin-api). Dữ liệu thuần ở `tenant-flows.data.ts`, lõi HTTP ở `tenant-flows.core.ts`. Chạy lại an toàn: quy trình cùng TÊN đã Bật + áp dụng và bước/trigger đúng ⇒ bỏ qua (không PUT, không tăng version). Có `--dry-run`, `--tenant <key>`; DB ngoài localhost/test hoặc `APP_ENV=production` ⇒ bắt buộc `--i-know-prod`.

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | Dữ liệu quy trình 3 công ty (không ngưỡng tiền; Duyệt / Trả lại / Từ chối) | `tools/scripts/src/tenant-flows.data.ts` | [x] |
| 2 | Lõi tạo / cập nhật / bỏ qua + thứ tự + tự kiểm | `tools/scripts/src/tenant-flows.core.ts` | [x] |
| 3 | CLI + lệnh `tenant:flows` | `tools/scripts/src/tenant-flows.ts`, `package.json` | [x] |
| 4 | int (DB thật, Hono thật): đủ quy trình, đúng người, dry-run, chạy lần 2 | `tools/scripts/src/tenant-flows.int.test.ts` | [x] |

## Quyết định trong lúc làm
- «Trưởng phòng của người tạo»: dùng `approver_mode: starter_head` (engine leo lên phòng cha nếu phòng không có trưởng). nitigroup «Duyệt hợp đồng gửi đi» thêm nhánh `if creator_department = pb-kinh-doanh` ⇒ Ngân duyệt (người cụ thể) thay trưởng phòng, hai nhánh gộp vào «Tiên duyệt». Phiếu nitigroup KHÔNG có dữ kiện phòng (không phải sự kiện HĐ) nên chỉ dùng `starter_head`: người tạo ở Phòng Kinh doanh ⇒ engine leo lên Phòng Giám đốc (trưởng = Tiên), không phải Ngân. Gọn nhất: đặt `head: thuyngan.le` cho `pb-kinh-doanh` ở `deploy/tenants/nitigroup.yaml` (lát onboarding) — khi đó cả hai đường ra Ngân.
- Người duyệt cụ thể = `after.approver_user_id` (người dùng thật), không tạo nhóm. Người trùng người tạo (STARTER_CANNOT_REVIEW): bước giữ `exclude_starter` ⇒ người tạo không nhận được; engine (R#15) giao thêm cho «Quá hạn chuyển cho» ⇒ mỗi bước đặt `escalate.user_id` = người thay (evolu Thomas→Julian; nitigroup Tiên↔Ngân, Phương→Ngân). Không có người thay thì rơi về quản trị công ty ≠ người tạo.
- Bước Ký: «Ký qua» = `upload`, «Người ký phía công ty» = `user:<id>` (Thomas / Tiên / Dung). «Nhận HĐ»: người phụ trách ở `trigger.params.owner_user_id` (Julian / Vy / Dung); KHÔNG đặt ngưỡng Quan trọng (dùng mặc định hệ thống, chỉ để xếp mức, không chặn duyệt). Kết thúc Nhận HĐ: Đồng ý / Từ chối / Trả lại.
- «Chọn đối tác & người nhận»: server buộc `assignee_group` cho node Gửi đối tác ⇒ dùng phòng gốc của yaml (evolu/preschool `pb-ban-giam-doc`, nitigroup `pb-giam-doc`) và khoá người làm bằng `approver_user_id` = người ký.
- preschool: engine buộc bước hành động thật (Ký, Gửi đối tác) đứng ngay sau MỘT bước kiểu duyệt (`REAL_ACTION`) ⇒ chèn bước làm việc «Chuẩn bị ký» (Dung tự làm, không Duyệt/Từ chối) trước Ký; Nhận HĐ tương tự «Xem hợp đồng nhận».
- Phiếu «Đề nghị mua hàng / thanh toán»: bắt đầu bằng phiếu (nội dung, số tiền, nhà cung cấp, tệp), luật mở không bao giờ đúng (không tranh quyền duyệt HĐ) và đứng TRƯỚC «Duyệt hợp đồng gửi đi» (tránh cảnh báo «bị che»). «Đã chi» = bước làm việc (số tiền, ngày, ghi chú), KHÔNG dùng `contracts.record-payment` vì node đó cần HĐ gắn lượt, phiếu không có HĐ.
- Idempotent so sánh «bước mong muốn ⊆ bước đang lưu» (server được thêm mặc định) thay vì băm.

## Việc còn lại
- Tính năng `contracts-partner-confirm` chưa nằm trong `addons:` của yaml ⇒ công ty cần được cấp trước khi dùng Gửi đối tác (hub chỉ cảnh báo lúc áp dụng, không chặn).
- Chạy thật trên bản test/prod: người dùng phải có trước (tenant-onboard), rồi `bun run tenant:flows -- --dry-run`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ thêm script vận hành `tenant:flows` gọi API quy trình có sẵn của admin nền tảng; không đổi engine, contract API hay màn hình).
