# com-c10-chatbot — Chatbot chủ quản trên `assistant`

Đọc: `docs/current/community/nghiep-vu.md` §11; trợ lý chung (`hub/0051_one_assistant.sql`, README platform "Trợ lý chat"); dock `surface` (`hub/0062`); chat-gate.
| Lát | Làn | Model | Migration | Phụ thuộc |
|---|---|---|---|---|
| C10 | Nhanh | Sonnet | hub **0063** (`surface='community'`) | C7, C8 |

## Phạm vi
Tool MCP community đăng ký qua `PackToolRegistry` trên cùng `assistant`, bộ tool theo surface + `kind`: tra giá, so sánh (cùng đơn vị, ghi VAT), tóm tắt ("hôm nay có gì mới"), tìm đối tác (nhóm hàng/khu vực/uy tín), dán **văn bản** Zalo ⇒ bóc tách ⇒ mở form Lưu báo giá điền sẵn (trường không chắc được đánh dấu). Mọi số có nguồn + ngày; không dữ liệu ⇒ "chưa có giá"; bỏ giá hết hạn/gỡ; chỉ soạn, người bấm xác nhận. Surface `community` + dock nút nổi trong community-web, biết ngữ cảnh trang. **User ngoài không có chatbot** (chat-gate, C2). Ảnh/PDF, chatbot đối tác = GĐ2.

## Xong khi
Unit bóc tách văn bản (bảng mẫu); một int đường chính; một int chặn `kind=external`. Không e2e chạy.

## Quyết định trong lúc làm
<!-- agent điền -->
- C10a (tra giá/so sánh/tìm NCC): 3 tool `contracts-price-lookup|price-compare|find-suppliers` (action read) trên `HostBookReader` (reader kiểm nội bộ + quyền đọc gói; ngoài/không quyền ⇒ forbidden). Tìm NCC theo SP (tên/tiền tố), chưa theo nhóm hàng/khu vực (chưa có dữ liệu khu vực). So sánh: mỗi NCC giá mới nhất, khác đơn vị không quy đổi, VAT không đồng nhất ⇒ cảnh báo. Rỗng ⇒ "chưa có giá". Chưa có `kind` trên `PackToolCtx` (đọc nếu có).
- C10b (dock): hub **0063** nới CHECK `conversations.surface` thêm `community`; `X-Ai-Surface: community` là dock thứ 2 (`DOCK_SURFACES`): chat-gate mở khi user nội bộ có quyền đọc gói `community` (kể cả công ty không có Chat AI), hội thoại mang `surface=community` và chỉ gửi vào đúng dock đó. Đối tác: C2 chặn 403 (int). `PackToolCtx.userKind` thêm (price tools từ chối `external` ngay ở tool; MCP provider chuyển tiếp nếu token mang, token chat chưa mang ⇒ reader vẫn kiểm). community-web: dock thật (SSE `/conversations`+`/runs` qua proxy, mock có câu mẫu), ngữ cảnh = surface+route+từ khoá tìm (chưa có loại entity bài/SP ⇒ chưa gắn nhãn RLS), CSS `.fab/.chat` bổ sung (trước đó thiếu). CHƯA làm (COULD): tool dán Zalo ⇒ prefill form Lưu báo giá; **Deploy:** nginx/edge phải route `/conversations` và `/runs` tới hub-api cho community-web (như contracts-web).


## Delta (so với docs/current)
Gộp vào `current/community/nghiep-vu.md` §11 cuối đợt.
