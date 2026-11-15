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

## Quyết định trong lúc làm
- Đính tệp thay vì vẽ chữ ký (opinion_plus cần chữ ký HOẶC tệp; tệp ổn định hơn với Playwright).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ sửa bài kiểm hành trình thật `e2e/smoke-journey`, không đổi code sản phẩm).

## Việc còn lại
- Góc người dùng (ghi để quyết, chưa sửa): ô bằng chứng hiện trong khối duyệt ở cuối trang, nút «Duyệt» ở đầu trang ⇒ bấm xong màn hình đầu trang không đổi gì; nên cuộn tới ô / focus ô ý kiến.
- Bài kiểm bản test 2026-11-15 19:32 (`.data/smoke/20261115-193200`): S8 Đạt; S9 Không đạt mới — 120 s sau khi Trưởng phòng duyệt, «Việc của tôi» của Giám đốc A trống (không có «Chuẩn bị ký»). Chưa chẩn đoán (ngoài phạm vi lát).
