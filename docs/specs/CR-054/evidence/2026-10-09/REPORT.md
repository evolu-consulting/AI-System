# UAT CR-054 — 2026-10-09 (lần chạy 2)

**Lần chạy 1 (BLOCKED):** hub-api khi đó là bản cũ, `/agent-settings` trả 404 → ảnh `00-BLOCKED-agents-load-error.png`. Sau khi điều phối khởi động lại stack trên 230836ba, chạy lại toàn bộ (báo cáo này). Trong lần chạy 2, một lượt script bị lỗi script ở bước 06/07 đã làm đổi tạm trạng thái evolu (mặc định → Consultant, không khớp → Tự trả lời); đã khôi phục bằng `scripts/restore.mjs` rồi chạy lại sạch 9/9.

## Stack & tài khoản
admin-web :3000, chat-web :3100, studio-web :3200/studio, hub-api :4000, Runtime Claude CLI thật. Tài khoản: evolu/julian.bui (tenant_admin), evolu/thomas.tran (member), platform_admin (đọc từ `.env.local` lúc chạy, không ghi lại). Một Chromium, mỗi người một context `vi-VN`.

## Kết quả
| # | Bước | Kết quả | Ảnh |
|---|---|---|---|
| 01 | julian: bảng chỉ có 4 agent của evolu (Evolu Consultant, Chatbot Dify, Invoices, Điều phối), đúng 1 "★ Mặc định" (Điều phối), cột Model: Sonnet/Haiku/"Mặc định CLI" | PASS | 01-A-julian-agents |
| 02 | julian: công tắc "Bật cho công ty" khoá (aria-disabled), bấm không đổi | PASS | 02-A-julian-switch-locked |
| 03 | platform_admin chọn tenant evolu, thấy thêm Trợ lý (đang tắt) | PASS | 03-B-platform-agents-evolu |
| 04 | Tắt/bật lại entitlement invoices (toast đúng) | PASS | 04-B-invoices-off, 04-B-invoices-on |
| 05 | Tắt entitlement agent mặc định: bị chặn (toast `AGENT_IS_DEFAULT`), công tắc vẫn bật (công tắc không bị khoá sẵn, chặn nhờ 409) | PASS | 05-B-default-entitle-blocked |
| 06 | "Đặt mặc định" Consultant rồi trả Orchestrator; luôn đúng 1 mặc định | PASS | 06-B-consultant-default, 06-B-orchestrator-default-back |
| 07 | Ô "Không khớp agent nào →": Evolu Consultant / Chatbot (Dify) / Invoices / Tự trả lời / Hỏi lại người dùng; đổi và khôi phục dự phòng = Evolu Consultant | PASS | 07-B-nomatch-options, -ask, -restored |
| 08 | Ngăn "Cấp quyền" có phạm vi "Cả công ty" (chỉ xem, Huỷ) | PASS | 08-B-grant-sheet |
| 09 | Sau tải lại: Orchestrator mặc định, không khớp → Evolu Consultant, Invoices và Consultant bật | PASS | 09-B-final-restored |
| 10 | Agent Forge: đăng nhập, danh sách agent | PASS | 10-C-studio-agents |
| 11 | Model picker consultant: dữ liệu thật từ CLI (`GET /studio/api/models` 200): Default, Opus, Sonnet, Haiku (alias) + Fable ghim `claude-fable-5-1[1m]`; `resolved_model` thật: haiku→claude-haiku-4-5-20251001, sonnet→claude-sonnet-5-5, opus/default→claude-opus-5-5; đang chọn Sonnet. Không lưu gì | PASS | 11-C-model-picker |
| 12 | Studio: công tắc Orchestrator bị khoá (disabled) — không tắt được; sau reload vẫn bật | PASS | 12-C-orchestrator-still-on |
| 13 | thomas đăng nhập Hỏi AI | PASS | 13-D-chat-new |
| 14 | Tin không tag → Điều phối · Haiku rồi Evolu Consultant · Sonnet trả lời thật; "Quá trình" còn sau khi xong và sau reload | PASS | 14-D-untagged-answer, -steps-open, -after-reload |
| 15 | Tin @invoices → "Invoices · Sonnet — Đang xử lý…", tiêu đề câu trả lời "Invoices" | PASS | 15-D-invoices-answer, -steps-open |

Tổng 15/15 PASS theo assert. Đã gửi 2/3 tin chat.

## Điểm cần lưu ý (không chặn)
1. **Thường — nghi lặp bước:** tin không tag cho "4 bước · 64,1s": cặp "Điều phối · Haiku" + "Evolu Consultant · Sonnet" xuất hiện 2 lần cho một câu hỏi (kết quả là thẻ "Consultant cần thêm thông tin"). Cần xem Hub có chạy Orchestrator + dự phòng hai lần không (ảnh 14-D-untagged-after-reload).
2. **Thấp — tiêu đề trả lời không nhất quán:** tin không tag hiện "Consultant" (chuỗi cố định `answer.who`) dù agent là "Evolu Consultant"; tin @invoices hiện "Invoices". Tên đầy đủ chỉ có ở "Quá trình".
3. **Thấp — Agent Forge picker chỉ hiện alias** (`sonnet`, `haiku`…), không hiện id cụ thể `claude-haiku-4-5-20251001` / `claude-sonnet-5-5` dù API có `resolved_model`; cột Model ở Control cũng chỉ hiện "Sonnet/Haiku".
4. **Thấp — theo thiết kế, ghi lại:** đổi mặc định Consultant → Orchestrator làm mất dự phòng cũ (về "Tự trả lời"); phải chọn lại dự phòng.
5. **Thấp — dữ liệu seed:** mô tả consultant trong DB còn ghi "(agent mặc định)" dù không còn là mặc định (seed cũ, chỉ chữ).
6. Nhãn bước còn dạng đang chạy ("Đang phân tích yêu cầu…") dù đã xong; Studio UI mặc định tiếng Anh (không có công tắc ngôn ngữ). Toast ảnh 05 chụp lẫn toast cũ "Đã bật Invoices".
7. Admin: sau đăng nhập platform_admin giao diện về EN dù đã bấm VI ở trang login; script đặt `ai.locale=vi` rồi tải lại.

## Trạng thái evolu sau UAT (đã kiểm ở bước 09)
Mặc định = Điều phối (Orchestrator, Haiku); không khớp = giao agent dự phòng Evolu Consultant (Sonnet); Invoices và Consultant đang bật cho công ty; Orchestrator trong Studio vẫn bật; không đổi model nào.

## Giới hạn
Không UAT SSE đứt kết nối; 2 tin chat dùng subscription thật. `scripts/`: lib.mjs, admin.mjs, studio.mjs, chat.mjs, restore.mjs, dbg.mjs.
