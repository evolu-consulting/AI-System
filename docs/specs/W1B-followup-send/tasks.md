# W1b — gửi hẹn nhắc chung đúng giờ + bộ nhớ đệm "Mua hàng" an toàn nhiều instance (tiếp W1)

Làn nhanh (Luật 0b), một agent; phần thông báo/quyền job chạm RLS nên test viết cùng lúc với code. Nhánh `slice/w1b-followup-send`.

## Đã làm
| Phần | Nội dung |
|---|---|
| Vòng gửi | `application/followup-send.usecase.ts` + `adapters/followup-send.repo.ts` + `createContractFollowupSender` (`reminders.mount.ts`), chạy cùng `contractsRemindModule` khi `worker` bật (vòng `contracts-followups`, mặc định 60 s). Khuôn HD4: `finder` (role `contracts_job`) tìm tenant → tx `system(tenant)` MỘT câu: claim `FOR UPDATE SKIP LOCKED` ≤ `batchSize` (100) → `status='sent'` → `notify.enqueue('contracts', …)` với `dedup_key = followup:<id>:<giờ hẹn UTC>`; giờ hẹn trong nội dung theo múi tenant (`HH24:MI DD/MM`). Nhắc lại sau (snooze) ⇒ `pending` + giờ mới ⇒ dedup_key mới ⇒ gửi lại. `drain` bỏ qua tenant lỗi / bị khoá, không sleep. |
| Migration | `0014_w1b_followup_send` (số kế tiếp sau `0013_w1_mywork_sourcing`; `when` lớn hơn): index `followups_pending_idx`, `GRANT SELECT (tenant_id, due_at, status)` + policy `followups_job` (chỉ hàng `pending`) cho `contracts_job` — role job không đọc được tiêu đề/người nhận, không ghi được. |
| Nhiều instance | Bộ nhớ đệm dòng giá đã dùng dấu vân tay LẤY TỪ DB MỖI REQUEST (không có bộ đếm cục bộ); thêm test hai app hub-api THẬT trên cùng DB: sửa giá / trạng thái / thêm HĐ / đổi nguồn ở nơi này ⇒ nơi kia thấy ngay. |
| RLS suite | Thêm khai báo `legacy_records` (bảng của I1, 0012, bị báo "không có bảng quên khai") và dọn nó ở `reset`. |
| Test | int: `tests/acceptance/W1B/{send,cache}.int.test.ts` (12 ca); chạy lại W1 int / perf / e2e trên nền mới. |

## Quyết định
- Thông báo `kind = contract.followup`, nguồn `contracts`, liên kết `/contracts/<id>` (có HĐ) hoặc `/my-work`. Email/đẩy do N3 lo từ `hub.notifications`.
- Hẹn nhắc đã `sent` vẫn hiện ở Việc của tôi tới khi người dùng bấm Xong (như mgmt-app: "đến hẹn" ở lại tới khi xong).
- Người nhận ngoài tenant bị `notify.enqueue` bỏ qua (hẹn nhắc vẫn thành `sent`).

## Còn lại
- Ca RLS `partner_event_voids` "thăm dò tồn tại" (22P02 vs 42501) đỏ sẵn trên `platform/gd0` (HD7, giao HD78).
- Gửi hẹn nhắc CKS (`cks_followups`, HD9) vẫn do vòng HD4/HD9 hiện hữu; vòng này chỉ cho `contracts.followups`.
