---
id: cr125-g3-toast
lát: cr125-g3-toast
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Một toast duy nhất `packages/web-kit/src/ui/toast.tsx` (+ `toaster.tsx`) thay `sonner` trực tiếp (chat, studio), `admin-web/.../toast.tsx`, `workspace-web/.../toast.ts` và 4 bản `ui/sonner.tsx`. sonner tải lười trong web-kit.

## Làm
- web-kit: `toast` (gọi gọn + `.success/.info/.warning/.error/.message/.dismiss`) và `notifySuccess/Info/Error/Brief`; sonner chuyển thành dependency của web-kit, gỡ khỏi 4 app.
- 4 app đổi import (~130 file), xoá wrapper. `check:toast` (check-toast*.ts + test) vào `check` và `slice-rebase.ts`.

## Không làm / Chạm
- globals.css/token (G4), locale, hub, DLC, e2e (không chạy).

## Test tối thiểu
- `packages/web-kit/src/ui/toast.test.ts`, `tools/scripts/src/check-toast.rules.test.ts`, `slice-rebase.test.ts`.

## Quyết định trong lúc làm
- Quy ước lỗi = của admin: ở lại tới khi bấm đóng (role alert, nút đóng). Chat/studio/workspace trước đây tự tắt ⇒ đổi hành vi; `toast(node, {action})` trung tính giữ nguyên.
- `check:bundle` admin-web đỏ sẵn trên HEAD (js 187.4 KB > 174, chunk q 50.7 KB > 50), số liệu y hệt sau lát này.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED platform/toast-chung.md
#### Yêu cầu: Một toast cho mọi app
Mọi app web hiển thị thông báo qua `@ai/web-kit/ui/toast`; thành công/thông tin tự ẩn, lỗi ở lại cho tới khi người dùng bấm đóng.
- Kịch bản: khi gọi `toast("Lỗi", "late")` hoặc `toast.error(...)` thì toast không tự tắt và có nút đóng [test: packages/web-kit/src/ui/toast.test.ts » ok → success 4s, late/error → ở lại + nút đóng]
#### Yêu cầu: Không import sonner ngoài web-kit
- Kịch bản: khi một app import `sonner` trực tiếp thì `check:toast` báo vi phạm [test: tools/scripts/src/check-toast.rules.test.ts » import sonner trong app ⇒ vi phạm (tĩnh và lười)]

## Việc còn lại
- Soát e2e có selector toast lỗi chat/studio/workspace (nay không tự tắt).