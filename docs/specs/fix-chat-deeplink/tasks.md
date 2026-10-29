---
id: fix-chat-deeplink
lát: fix-chat-deeplink
cr:
làn: nhanh
migration: không
phụ thuộc: fix-chat-e2e-login
---
## Plan (ngắn)
Nguyên nhân "mất phiên khi goto sâu": đây là lỗi e2e, không phải sản phẩm. `chatLogin/login` chờ URL `/c/new` — URL đã đúng ngay khi điều hướng, trước khi refresh cookie (xoay vòng một lần mỗi lần tải trang) xong. `goto` kế tiếp huỷ request giữa chừng: server đã xoay, trình duyệt mất cookie mới, refresh sau nhận REFRESH_SUPERSEDED ⇒ về /login. Người dùng mở link từ thông báo chỉ tải một lần nên không dính.

## Làm
- 3 helper đăng nhập (`e2e/chat/_support.ts`, `_x2a-support.ts`, `e2e/combine/_support.ts`): sau khi vào `/c/new` chờ ô "Tin nhắn" hiện (phiên xong) trước khi trả quyền. Khử luôn các ca timeout/flake P-c2, x2a (AC-45, AC-43), x2b2 attach.
- Cài đặt: Giao diện/Ngôn ngữ nay là `PrefsPanel` dùng chung (prefs-sync): nút "EN"/"VI", "Theo máy", khoá `ai.theme`. Cập nhật `i18n.chat.ts`, `x1-attachments.chat.ts` theo đó (qc).
- Mock Hub chat: `PATCH /auth/me` lưu locale/theme theo user (reset ở `/__mock/reset`) + unit; trước đó `/me` luôn trả `light` nên tải lại mất theme tối.

## Không làm / Chạm
Không đổi sản phẩm.

## Quyết định trong lúc làm
Chờ ô "Tin nhắn" (có ở desktop và mobile) thay vì thanh điều hướng (ẩn ở mobile).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa e2e theo prefs-sync/portal-home và mock Hub; sản phẩm không đổi)

## Việc còn lại
Xem báo cáo chạy e2e cuối lát.