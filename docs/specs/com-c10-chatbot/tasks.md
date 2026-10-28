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

## Delta (so với docs/current)
Gộp vào `current/community/nghiep-vu.md` §11 cuối đợt.
