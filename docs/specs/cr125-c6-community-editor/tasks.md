---
id: cr125-c6-community-editor
lát: cr125-c6-community-editor
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Hai lỗi của QC community (`qc-community-flow`: B3, B4). Một nguồn: node khai `menu` ở MODULES, sự kiện khai `outcomes` + `record.label` ở manifest.
- B3: `community.show-post` khai `menu: business` ⇒ hiện ở menu "+" của flow community. `lib/node-menu.ts` lọc MỘT nơi: node của app khác (theo sổ MODULES) không hiện, node có Kết thúc đặt sẵn mà sự kiện không khai thì không hiện; mục Kết thúc tách theo từng `outcomes` của sự kiện ("Kết thúc · Hiện bài" / "Kết thúc · Ẩn bài"; hợp đồng: Đã duyệt / Từ chối / Trả lại).
- B4: `lib/record-words.ts` lấy tên bản ghi từ `record.label` của sự kiện ⇒ hộp bật quy trình (nhiều app ⇒ "hợp đồng và bài đăng"), dòng trạng thái chân trang, thẻ Giới hạn, ghi chú áp dụng. Ghi chú bước công cụ cho người dùng công ty không còn nhắc "Nâng cao".

## Làm
`modules/community/show-post/node.ts` (menu) · `lib/node-menu.ts` · `lib/flow-def.ts` (`NodeEntry.outcome`, `finishPatch(ev, key)`) · `lib/record-words.ts` · `components/flow/NodeMenuContent.tsx` · `flow-ctx.ts` (`useRecordWords`) · ApplyStatusLine / ProcessSaveBar / StagesCard / FlowFormEditor / StageForm · FlowSwitch + CompanyFlowList · i18n vi/en (`{{record}}`, `{{Record}}`, `toolNoteCompany`).

## Không làm / Chạm
Không thêm node "Ẩn bài" riêng (Ẩn bài = Kết thúc · Ẩn bài, từ `outcomes`). Không đụng B1/B2/B5 (lát khác). Hub không đổi (palette đã lọc theo app + tính năng). Chữ "hợp đồng" ở hộp Xuất bản/Lịch sử (chỉ quản trị nền tảng, thư viện hợp đồng) giữ nguyên.

## Test tối thiểu
Unit: `node-menu.test.ts` (lọc theo app/sự kiện, Kết thúc theo kết quả), `record-words.test.ts`. e2e: `e2e/community-web/flows.menu.cs.ts` (đường thật, chạy sau `flows.cs.ts`); `cr122-editor.spec.ts` + `cr122-flows.spec.ts` đổi theo mục Kết thúc theo kết quả / câu "Đã áp dụng".

## Quyết định trong lúc làm
- Testid mục Kết thúc: `flow-node-finish-<outcome>` (thay `flow-node-finish`) vì menu có nhiều mục Kết thúc.
- Câu trạng thái dùng "{{record}} từ giờ dùng quy trình này" (bỏ "gửi": bài đăng/đơn không "gửi").
- Palette Hub vẫn lọc theo app; FE lọc lại theo MODULES để "một nguồn" (palette trả thừa cũng không lộ node app khác).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

### MODIFIED engine/flow-web.md
#### Yêu cầu: Menu "+" theo app và sự kiện của flow (CR-125 c6)
Menu "+" chỉ có node của app của flow (cùng node lõi) và node mà kết quả Kết thúc đặt sẵn nằm trong `outcomes` của sự kiện; node community khai `menu` nghiệp vụ nên công ty thấy ở nhóm nghiệp vụ. Mục Kết thúc tách theo từng kết quả của sự kiện, nhãn "Kết thúc · <kết quả>".
- Kịch bản: flow community không thấy node hợp đồng, flow hợp đồng không thấy node community [test: apps/admin-web/src/features/processes/lib/node-menu.test.ts » CR-125 c6b · flow community không thấy node hợp đồng, flow hợp đồng không thấy node community]
- Kịch bản: Kết thúc community là Hiện bài / Ẩn bài, hợp đồng là Đã duyệt / Từ chối / Trả lại [test: apps/admin-web/src/features/processes/lib/node-menu.test.ts » CR-125 c6 · B3: Kết thúc tách theo kết quả của sự kiện (community: Hiện bài / Ẩn bài, hợp đồng: Đã duyệt / Từ chối / Trả lại)]
- Kịch bản: Kết thúc chọn từ menu mang đúng kết quả đã chọn [test: apps/admin-web/src/features/processes/lib/node-menu.test.ts » CR-125 c6 · B3: Kết thúc chọn từ menu mang đúng kết quả đã chọn]
- Kịch bản: quản trị community mở bản sao flow Duyệt bài, menu có Kết thúc · Hiện bài / Ẩn bài (c6b: không còn mục node Hiện bài riêng), không có bước hợp đồng hay Nâng cao [test: e2e/community-web/flows.menu.cs.ts » quản trị community: menu + chữ trong trình sửa flow Duyệt bài đúng ngôn ngữ community]

#### Yêu cầu: Chữ trong trình sửa theo bản ghi của sự kiện (CR-125 c6)
Câu ở hộp bật quy trình, chân trang, thẻ Giới hạn dùng tên bản ghi từ `record.label` của sự kiện (hợp đồng, bài đăng, đơn tham gia…); công ty có nhiều app ⇒ nối "hợp đồng và bài đăng". Ghi chú bước công cụ không nhắc "Nâng cao" cho người dùng công ty.
- Kịch bản: tên bản ghi lấy từ sự kiện, không sự kiện thì giữ hợp đồng, nhiều app thì nối [test: apps/admin-web/src/features/processes/lib/record-words.test.ts » công ty có flow của nhiều app ⇒ nối không trùng: 'hợp đồng và bài đăng']
- Kịch bản: hộp bật, dòng trạng thái và thẻ Giới hạn của flow community nói bài đăng, không còn hợp đồng [test: e2e/community-web/flows.menu.cs.ts » quản trị community: menu + chữ trong trình sửa flow Duyệt bài đúng ngôn ngữ community]

## Việc còn lại
Chạy e2e `community-web-stack` (flows.cs.ts + flows.menu.cs.ts) + `cr122-editor` một lần cuối đợt; chụp ảnh từ lượt e2e.
