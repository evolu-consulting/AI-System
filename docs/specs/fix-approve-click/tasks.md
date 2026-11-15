# fix-approve-click — CR-159: bài kiểm hành trình S8 «Trưởng phòng A duyệt» không gửi gì sau khi bấm Duyệt

## Plan
Nguyên nhân: quy trình của công ty tạm (smoke-flows ⇒ `flowsFor("preschool")` ⇒ `headOfStarter` ⇒ `reviewNew`) đặt bằng chứng
`evidence: "opinion_plus"` (`apps/hub-api/src/modules/processes/library/flow-templates.def.ts:47-51`). Bấm «Duyệt» ở đầu trang chỉ MỞ ô
bằng chứng (`use-approval-ui.tsx:114` ⇒ `setEv("approve")`), chưa gửi gì. Bài kiểm bấm `getByRole("button").last()` trong ô = nút «Huỷ»
(`platform/flow/ui/EvidenceAsk.tsx:46`) ⇒ ô đóng, không request ghi, bước vẫn `open`. Sản phẩm đúng; lỗi ở bài kiểm.

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | `giveEvidence`: ghi ý kiến + đính 1 tệp PDF ⇒ bấm `request-approve-confirm`; sau đó nếu có hộp «Gắn sản phẩm» thì xác nhận | `e2e/smoke-journey/smoke-journey.smoke.ts` | [x] |
| 2 | S9 theo sơ đồ CR-165: nhánh có trưởng phòng duyệt ⇒ Giám đốc «Ký hợp đồng» luôn (bỏ «Chuẩn bị ký», gộp S10) | `e2e/smoke-journey/smoke-journey.smoke.ts` | [x] |
| 3 | `doTask`: chờ ô của ĐÚNG bước (`id=flow-<bước>-<trường>`) biến mất — bước kế cùng người hiện form ngay chỗ cũ | `e2e/smoke-journey/smoke-journey.smoke.ts` | [x] |

## Quyết định trong lúc làm
- Đính tệp thay vì vẽ chữ ký (opinion_plus cần chữ ký HOẶC tệp; tệp ổn định hơn với Playwright).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ sửa bài kiểm hành trình thật `e2e/smoke-journey`, không đổi code sản phẩm).

## Việc còn lại
- Góc người dùng (ghi để quyết, chưa sửa): ô bằng chứng hiện trong khối duyệt ở cuối trang, nút «Duyệt» ở đầu trang ⇒ bấm xong màn hình đầu trang không đổi gì; nên cuộn tới ô / focus ô ý kiến.
- Lượt bản test 19:39: S1–S9 Đạt; S11 lỗi bài kiểm (form «Chọn đối tác» hiện ngay chỗ form cũ) ⇒ đã sửa (#3).
- Lượt bản test 19:45 (lượt 3/3): S7 Không đạt — lượt này AI đọc ra dòng hàng «nuoc suoi», trang báo «Thiếu: dòng … chưa gắn sản phẩm», HĐ vẫn Nháp, không hiện hộp «Gắn sản phẩm» (`.data/smoke/20261115-194526/S7.png`). S7 đã Đạt ở 2 lượt trước ⇒ phụ thuộc kết quả AI; chưa chẩn đoán. S11–S16 chưa chạy được sau sửa #3.
