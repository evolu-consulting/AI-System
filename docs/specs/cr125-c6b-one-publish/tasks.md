---
id: cr125-c6b-one-publish
lát: cr125-c6b-one-publish
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: cr125-c6-community-editor
---
## Plan (ngắn)
Menu "+" community có hai lối đăng bài: node "Hiện bài" (`community.show-post`) và "Kết thúc · Hiện bài". Hôm nay cả hai cho CÙNG một stage `set` mang `outcome: shown`; app hiện bài qua OutcomeHandler theo kết quả, KHÔNG phụ thuộc khoá node (`bindNode` chỉ đăng ký). Khác biệt duy nhất của node: gắn khoá node + cổng tính năng `community-write`. Flow mẫu/seed dùng Kết thúc thường (không có khoá node); chỉ test dùng node.
⇒ Chọn: giữ "Kết thúc · Hiện bài" (đọc từ `outcomes`), ẩn node khỏi menu.

## Làm
`modules/community/show-post/node.ts` bỏ `menu` · `lib/node-menu.ts` (`isOutcomeOnlyNode`: node chỉ là một Kết thúc đặt sẵn kết quả thì không hiện ở menu, luật chung cho node app sau này) · unit + e2e · sửa Delta của c6.

## Không làm / Chạm
Không gỡ node khỏi MODULES/hub/palette (flow đã lưu có thể mang khoá; palette Hub không đổi). Không migration, không đổi def đã lưu.

## Test tối thiểu
Unit `node-menu.test.ts`; e2e `e2e/community-web/flows.menu.cs.ts` (mở rộng: không có mục node Hiện bài, đúng một mục Hiện bài và một mục Ẩn bài), chạy một lần.

## Quyết định trong lúc làm
Giữ lối "Kết thúc · <kết quả>" vì đã đủ cho mọi app (đọc từ `outcomes`), không đổi def đã lưu, không cổng tính năng riêng.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-web.md
#### Yêu cầu: Menu "+" một lối cho mỗi kết quả Kết thúc (CR-125 c6b)
Node chỉ là một Kết thúc đặt sẵn kết quả (community: Hiện bài) không hiện ở menu "+" vì đã có "Kết thúc · <kết quả>"; node vẫn đăng ký để flow đã lưu mở được. Quyết định: giữ Kết thúc theo kết quả (ít đổi def đã lưu nhất, đủ cho mọi app).
- Kịch bản: menu community chỉ có Kết thúc · Hiện bài, node Hiện bài không hiện cho cả công ty lẫn nền tảng nhưng còn trong sổ [test: apps/admin-web/src/features/processes/lib/node-menu.test.ts » CR-125 c6b · Hiện bài chỉ có MỘT lối là Kết thúc · Hiện bài, node community.show-post không hiện ở menu nào nhưng vẫn đăng ký]
- Kịch bản: node chỉ một Kết thúc đặt sẵn bị ẩn, node nhiều bước thì không [test: apps/admin-web/src/features/processes/lib/node-menu.test.ts » CR-125 c6b · luật chung: node chỉ là một Kết thúc đặt sẵn kết quả thì trùng mục Kết thúc, node nhiều bước thì không]
- Kịch bản: trong trình sửa flow Duyệt bài chỉ có một mục Hiện bài và một mục Ẩn bài [test: e2e/community-web/flows.menu.cs.ts » quản trị community: menu + chữ trong trình sửa flow Duyệt bài đúng ngôn ngữ community]

## Việc còn lại
Không.
