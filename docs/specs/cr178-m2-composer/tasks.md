---
id: cr178-m2-composer
lát: cr178-m2-composer
cr: CR-178
làn: nhanh
migration: không
phụ thuộc: cr178-m1-ui
---
# cr178-m2-composer — M2 ô soạn «Tin nhắn»: emoji, dán ảnh, kéo thả

Nguồn: `docs/CHANGE-REQUESTS.md` CR-178. Chỉ đổi `packages/messages-web` (+ i18n, e2e); không đổi API/migration. Không làm: tìm tin, Ảnh & tệp, xem trước (M3), bày tỏ cảm xúc trên tin.

## Plan (ngắn)
Nút emoji (Popover + Frimousse nạp lười, dữ liệu đóng gói sẵn) · `paste` có tệp ⇒ `useStagedFiles.add` · kéo tệp vào khung chat ⇒ lớp phủ + `add` (ô khoá không nhận).

## Làm
- [x] `lib/composer.ts` (+ test): chèn emoji tại con trỏ, tệp từ dán/kéo, «dùng gần đây» (tối đa 24), màu da lưu localStorage (try/catch).
- [x] `EmojiButton` (nạp lười `EmojiPickerPanel`), `data/emoji-vi.json`, `file-drop.tsx`, nối vào `MessageComposer`/`ChatView`; i18n vi+en.
- [x] e2e thêm ca ở `e2e/cr127/j18-tin-nhan.spec.ts` (chưa chạy).

## Không làm / Chạm
Không sửa web-kit. Việc dở: Shift giữ bảng mở (tuỳ chọn) chưa làm; nhãn emoji luôn tiếng Việt (chỉ có dữ liệu `vi`).

## Test tối thiểu
`bun test packages/messages-web` · tsc messages-web/workspace-web/chat-web · `check:ui-kit`.

## Quyết định trong lúc làm
- Thư viện: `frimousse@0.4.0` (MIT, phát hành 2026-09-21, ≥ 2 tuần), cài vào `packages/messages-web`.
- Dữ liệu emoji: không gọi CDN. Chuyển một lần từ `emojibase-data` (locale `vi`) sang dạng `EmojiData` của Frimousse, giữ emoji ≤ Unicode 14 và bỏ cờ quốc gia (Windows không vẽ); lưu `src/data/emoji-vi.json` (249 KB, ~44 KB gzip), nạp lười cùng chunk bảng chọn qua `resolveEmojiData`.
- Dán: có cả chữ lẫn tệp (vd chép ô Excel) ⇒ coi là dán chữ; chỉ ảnh/tệp không chữ mới vào danh sách tệp.
- Kéo thả: khung chat đăng ký hàm nhận (`dropSink`) với ô soạn; ô khoá ⇒ null ⇒ không nhận, không hiện lớp phủ.
- Icon emoji vẽ lại trong `icons.tsx` của gói vì kit chưa xuất `ICONS` qua đường import (báo cáo, không sửa kit).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED pack-contracts/tin-nhan.md

#### Yêu cầu: Ô soạn: emoji, dán ảnh, kéo thả
Ô soạn có nút emoji cạnh «Đính kèm»: mở bảng chọn (tìm, nhóm, «Dùng gần đây», màu da), chọn ⇒ chèn tại con trỏ, đóng bảng, focus về ô soạn; Esc đóng. Dán ảnh/tệp (không kèm chữ) vào ô soạn hoặc thả tệp vào khung chat ⇒ vào danh sách tệp đính kèm như chọn tệp (cùng kiểm loại/dung lượng, cùng câu lỗi); kéo tệp ⇒ lớp phủ «Thả tệp để gửi kèm». Ô bị khoá không nhận tệp.
- Kịch bản: chèn emoji thay vùng chọn/tại con trỏ, quá giới hạn thì không chèn [test: packages/messages-web/src/lib/composer.test.ts » insertAtCursor]
- Kịch bản: dán ảnh không chữ ⇒ lấy tệp; dán chữ thường ⇒ không đổi [test: packages/messages-web/src/lib/composer.test.ts » tệp từ dán / kéo thả]
- Kịch bản: «Dùng gần đây» đưa lên đầu, bỏ trùng, tối đa N; kho lỗi không làm hỏng [test: packages/messages-web/src/lib/composer.test.ts » dùng gần đây]
- Kịch bản: A chèn emoji + dán ảnh rồi gửi; B (người nhận, khác người gửi) thấy tin có emoji [test: e2e/cr127/j18-tin-nhan.spec.ts » A chèn emoji và dán ảnh rồi gửi, B thấy]

## Việc còn lại
Chạy e2e cuối đợt; soát UI bảng emoji trên trình duyệt thật (chưa dựng giao diện trong lát).
