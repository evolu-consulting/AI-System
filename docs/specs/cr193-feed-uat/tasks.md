---
id: cr193-feed-uat
lát: cr193-feed-uat
cr: CR-193
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa 3 lỗi UAT (REPORT mục 1, 2, 7): nhãn phạm vi bài, «@» là danh sách thả tại chỗ, bộ lọc nguồn thiếu «Đối tác».

## Làm
- [x] 1 `domain/scope-label.ts` + `PostCardParts.tsx`: nhãn = «Ai thấy bài» của bài (nguyên nhân: nhãn suy từ bên đăng — bài chủ quản luôn «Bạn bè»). Người xem không nhận `audience` ⇒ không hiện nhãn.
- [x] 2 `useMentionSuggest` + `MentionSuggest.tsx` thay hộp `MentionPicker` ở Thread (bình luận) và Composer (thân bài). Nguyên nhân: lát trước mới ẩn NÚT ở bình luận, `@` vẫn mở hộp có ô tích; thân bài chưa đổi. Xoá `MentionPicker.tsx`, chip tách sang `MentionChips.tsx`.
- [x] 7 `adapters/http.ts listConnected` đọc `/pack/community/audience-connected` (cùng nguồn «Ai thấy bài»). Nguyên nhân: gọi `/pack/contracts/connect/links` (cần quyền gói Hợp đồng; lỗi bị nuốt thành `[]`) ⇒ danh sách rỗng ⇒ UI ẩn «Đối tác» + từng công ty. UI: `sourceChoices` luôn có «Đối tác».

## Không làm / Chạm
Không đổi API/DB/contract. Chạm `modules/community/**`, `packages/i18n/locales/community` (khoá `mentionSuggest`), e2e community-web.

## Test tối thiểu
`domain/cr193-uat.test.ts` (scopeLabel, sourceChoices, applyMention, suggestKey). e2e viết, chưa chạy.

## Quyết định trong lúc làm
- Bỏ lọc nhóm (Nội bộ/Đối tác/Khách hàng) của hộp cũ: danh sách thả chỉ lọc theo chữ gõ, như bình luận (BR-191-8). Server vẫn có tham số `group`, không dùng.
- Textarea thân bài không đổi role (giữ `textbox` cho e2e/trợ năng); danh sách có `role=listbox`.
- Khoá i18n «Nhắc tên» cũ (`draft.mentionLabel`…) còn trong locale vì chip/thông báo còn dùng một số khoá; dọn ở lát sau.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa lỗi UAT cho đúng BR-191-7/8 đã chốt; e2e community-web cr191-composer-audience, cr191-feed-ui).

## Việc còn lại
Điều phối chạy e2e community-web; chụp lại ảnh baseline.
