# cr171-kinds-fix — CR-171 (HĐ Nhượng quyền báo thiếu dù đã điền; dòng chưa gắn SP làm kẹt hộp «Gắn sản phẩm»)

## Plan
Hai lỗi người dùng ở màn xác nhận HĐ sau AI đọc / nhập tay.
1. Nhượng quyền «điền hết vẫn báo thiếu»: web không có luật thiếu-trường theo loại (chỉ máy chủ có) nên (a) ô «Đã đăng ký Bộ Công Thương» (ô tick, hiện khi bên nhượng ở nước ngoài) để trống bị máy chủ đòi dù người dùng hiểu là «chưa đăng ký»; (b) trường riêng AI đọc được KHÔNG điền sẵn vào form khi AI đã chọn loại; (c) lỗi 422 chỉ báo câu chung, ô viền đỏ chỉ hiện khi bản đã lưu cũ báo thiếu và ở tab khác thì không thấy.
2. «Thiếu: dòng "nuoc suoi" chưa gắn sản phẩm»: lưu nháp ở bước xác nhận cũng chặn dòng chưa gắn SP, trong khi chính hộp «Gắn sản phẩm» (sau khi lưu nháp) mới là nơi gắn ⇒ khi gợi ý SP chưa về / không có gợi ý, người dùng kẹt, hộp không bao giờ hiện.
Sửa: MỘT luật thiếu-trường dùng chung `kindTermsMissing` (@ai/contracts) ở web; ô tick BCT không tick = false; AI đọc điền sẵn; câu báo nêu đúng tên ô, viền đỏ theo form đang sửa và tự mở tab có ô đỏ; máy chủ trả `details.missing`; bước xác nhận không đòi gắn SP ở lưu nháp.

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | Test đỏ rồi sửa luật thiếu-trường + chặn lưu theo loại + bỏ chặn dòng chưa gắn SP ở bước xác nhận | `apps/workspace-web/src/features/contract-form/lib/{kind-terms,blocker}.ts`, `kind-missing.test.ts` | [x] |
| 2 | Điền sẵn trường riêng AI đọc, viền đỏ theo form, mở tab có ô đỏ (tách `use-kind-terms.ts` cho đủ ≤ 400 dòng) | `contract-review/hooks/{use-info-form,use-kind-terms}.ts`, `KindTermsFields.tsx`, `use-contract-form.ts`, `DealNewPage.tsx` | [x] |
| 3 | Máy chủ trả `details.missing`; web nêu tên ô | `review.rules.ts`, `review.usecase.ts`, `review.routes.ts`, `save-error.ts`, `v2f.{vi,en}.json` | [x] |
| 4 | e2e 5 loại × AI đọc (Lưu nháp + Gửi) + ca BCT + ô thiếu + hộp Gắn SP (bán, mua) | `e2e/contracts-web/cr171-kinds.cw.ts` | [x] |

## Quyết định trong lúc làm
- Không đổi luật máy chủ (Nhượng quyền: vai, thương hiệu, cách tính phí + mức, kỳ; nước ngoài ⇒ BCT): chỉ đưa luật đó xuống web và làm ô tick không bị coi là «chưa trả lời».
- Phí ban đầu giữ dấu * trên form (không bắt buộc ở máy chủ) — không đổi trong CR này.
- e2e dùng backend giả nhưng gọi ĐÚNG `kindTermsMissing` thật (import từ packages/contracts) để giả 422 như máy chủ.

## Việc còn lại
- e2e nhập tay (9 ca) và «dùng sản phẩm có sẵn» đang `test.fixme`: màn nhập tay Lưu nháp không qua menu `act-saveDraft`; cần dò nút rồi bật. Câu báo «Thiếu: …» chưa có ca e2e (aria-invalid đã có).
- Ca e2e «Gửi duyệt» đi hết engine duyệt (bước kế) chưa phủ: backend giả dừng ở lệnh xác nhận.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Nhượng quyền và Hợp tác báo đúng ô còn thiếu và không đòi ô đã điền
Trước khi lưu/gửi, màn hình kiểm trường riêng của loại bằng cùng luật với máy chủ; thiếu ô nào thì nêu tên và viền đỏ đúng ô đó (tự mở tab chứa ô). Ô «Đã đăng ký Bộ Công Thương» không tick nghĩa là chưa đăng ký. Trường AI đọc được điền sẵn vào form.
- Kịch bản: khi Nhượng quyền phí % hoặc phí cố định đủ ô thì không bị báo thiếu [test: apps/workspace-web/src/features/contract-form/lib/kind-missing.test.ts » phí % đủ]
- Kịch bản: khi chọn cách tính phí mà chưa nhập mức thì chỉ ô mức đó bị báo [test: apps/workspace-web/src/features/contract-form/lib/kind-missing.test.ts » chọn cách tính phí mà chưa nhập mức]
- Kịch bản: khi bên nhượng ở nước ngoài và không tick đã đăng ký BCT thì vẫn gửi được [test: apps/workspace-web/src/features/contract-form/lib/kind-missing.test.ts » bên nhượng ở nước ngoài]
- Kịch bản: khi Nhượng quyền thiếu ô thì câu báo nêu đúng tên ô [test: apps/workspace-web/src/features/contract-form/lib/kind-missing.test.ts » câu báo nêu đúng tên ô thiếu]
- Kịch bản: khi máy chủ báo thiếu trường riêng thì trả kèm danh sách khoá thiếu [test: apps/hub-api/src/modules/packs/contracts/domain/review.rules.test.ts » khoá riêng còn thiếu]
- Kịch bản: khi AI đọc đủ trường Nhượng quyền thì ô điền sẵn và Gửi không báo thiếu [test: e2e/contracts-web/cr171-kinds.cw.ts » AI đọc đủ]
- Kịch bản: khi Nhượng quyền thiếu ô ở tab Phí thì nêu tên ô và viền đỏ [test: e2e/contracts-web/cr171-kinds.cw.ts » thiếu ô ở tab Phí]

#### Yêu cầu: Dòng hàng chưa gắn sản phẩm không chặn bước xác nhận
Lưu nháp ở bước xác nhận không đòi gắn sản phẩm; hộp «Gắn sản phẩm» hiện khi xác nhận để tạo mới hoặc dùng sản phẩm có sẵn.
- Kịch bản: khi lưu nháp ở bước xác nhận thì dòng chưa gắn SP không chặn [test: apps/workspace-web/src/features/contract-form/lib/kind-missing.test.ts » dòng chưa gắn SP KHÔNG chặn lưu nháp]
- Kịch bản: khi dòng chưa có gợi ý SP thì hộp Gắn sản phẩm vẫn hiện và gửi được [test: e2e/contracts-web/cr171-kinds.cw.ts » chưa gắn SP]
