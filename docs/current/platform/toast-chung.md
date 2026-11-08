# toast chung

Cập nhật: 2026-11-08 · Nguồn: CR-125.

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Một toast cho mọi app (nguồn: cr125-g3-toast)
Mọi app web hiển thị thông báo qua `@ai/web-kit/ui/toast`; thành công/thông tin tự ẩn, lỗi ở lại cho tới khi người dùng bấm đóng.
- Kịch bản: khi gọi `toast("Lỗi", "late")` hoặc `toast.error(...)` thì toast không tự tắt và có nút đóng [test: packages/web-kit/src/ui/toast.test.ts » ok → success 4s, late/error → ở lại + nút đóng]
#### Yêu cầu: Không import sonner ngoài web-kit (nguồn: cr125-g3-toast)
- Kịch bản: khi một app import `sonner` trực tiếp thì `check:toast` báo vi phạm [test: tools/scripts/src/check-toast.rules.test.ts » import sonner trong app ⇒ vi phạm (tĩnh và lười)]

