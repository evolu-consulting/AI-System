# niti-import2 — phần còn lại của tài khoản chị Tiên (`--include-extras`)

Làn: **đầy đủ** (dữ liệu khách thật, migration, RLS). Một agent làm trọn; int chạy một lần trên evotest.

## Plan
- Export (`owner-export`): gộp chat, chat_files, signed_docs, cks_certificates, notifications, quotes, market_scans (+ kết quả
  `market_observations` theo `scan_id`), score_config_history + công ty được trỏ; `not_imported` chỉ còn index không có đường nhập.
- Nhập `--include-extras --source <nhãn riêng> --link-source <nhãn lô chính>`: lọc org (`--extras-org`) + bỏ "[E2E]"; ánh xạ:
  chat → `hub.conversations/flows/messages` lưu trữ (`import_source`, `archived_at`) + `hub.attachments` (FileBox `FILEBOX_ORG`);
  CKS → `contracts.cks_*`; thông báo → `notify.import_read` (đã đọc, `fanout_at` sẵn); báo giá → `price_quotes`; quét giá →
  `cks_market_prices` + `legacy_records`; lịch sử chấm điểm → `legacy_records`. Hoàn tác theo nhãn (sổ `contracts.import_rows`).
- Migration: hub `0054_mgmt_import_history` (when 1796300000000), contracts `0045_niti_import_extras` (when 1797400000000).

## Quyết định trong lúc làm
- Góp ý KHÔNG nhập; chỉ org `d963bf8c…`; bỏ "[E2E]" (người dùng chốt 2026-10-21).
- Hội thoại lưu trữ: guard `archived_at is null` ở `runs.repo.touchConversation` (không tạo run ⇒ không agent). UI composer chưa ẩn
  (gửi tin ⇒ API từ chối như hội thoại không thấy) — việc còn lại.
- Notification giữ `created_at` cũ ⇒ hàm DEFINER riêng (`notify.enqueue` không đặt được read_at/created_at/fanout_at).
- `signed_docs`: app cũ không giữ bytes (chỉ sha256) ⇒ không có file FileBox; `quotes`: không file (chỉ URL).
- Lô mua CKS / chuỗi thay thế chứng thư ngoài phạm vi ⇒ để trống, đếm ở `notes`.
- score_config_history → `contracts.legacy_records` (JSON nguyên văn, chỉ thêm) thay vì `score_config_history` mới (tránh lẫn với
  cấu hình chấm điểm hiện tại của tenant).
- my-chat-history chỉ thấy tin trong `chat_history_months` (mặc định 12) ⇒ báo cáo `retention.messages_older`.

## Xong
- [x] unit `domain/extras.rules.test.ts` · int `tests/acceptance/NITI/extras-import.int.test.ts` (evotest: 6 pass) · README (f).
