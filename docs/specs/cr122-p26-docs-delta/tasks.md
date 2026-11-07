---
id: cr122-p26-docs-delta
lát: cr122-p26-docs-delta
cr: CR-122
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Chỉ ghi Delta cho các sửa thẳng trên `platform/gd0` (Luật 0d.6) không có lát: a7e0748fb, d878f3786, a9e6b5c62, c9980d833, 77ad70459, d5142b3f5, 6c1230f96. Không đổi code.

## Làm
Delta bên dưới.

## Không làm / Chạm
Chỉ tài liệu. Không merge.

## Test tối thiểu
`bun run openspec:check`.

## Quyết định trong lúc làm
Hành vi khoá/banner và bước Ký số gom vào `sht/duyet-ky-so.md` (§2, §4b); trigger DEFERRED gom vào `engine/flow-runtime.md`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Trang HĐ không ghi "Chưa xác nhận" sau khi đã gửi duyệt
Sau "Xác nhận và lưu" (lượt duyệt đang mở) trang HĐ không còn dải/dòng dẫn "Chưa xác nhận". HĐ đã khoá do bước Ký số nhưng chưa xác nhận hiện dải "Đang ký số", không ghi "Đã xác nhận".
- Kịch bản: khi đã Xác nhận và lưu và lượt duyệt đang chạy thì không còn dải "Chưa xác nhận" [test: apps/workspace-web/src/features/contract-lock/lib/lock-view.test.ts » CR-122 · đã Xác nhận và lưu (lượt duyệt đang chạy) ⇒ không còn banner Chưa xác nhận]
- Kịch bản: khi bước Ký số đã khoá HĐ chưa xác nhận thì dải là "Đang ký số" [test: apps/workspace-web/src/features/contract-lock/lib/lock-view.test.ts » CR-122 · bước Ký số đã khoá HĐ chưa xác nhận ⇒ banner signing (không ghi 'Đã xác nhận')]
- Kịch bản: khi HĐ đã gửi duyệt thì lời dẫn đầu trang không còn nhắc "chưa xác nhận" [test: apps/workspace-web/src/features/contract-review/lib/review.test.ts]

#### Yêu cầu: Bước Ký số khoá HĐ trước khi gửi ký
Bước Ký số giữa flow khoá HĐ (`lockForSign`) rồi mới gửi ký; Từ chối / Trả lại mở khoá. Migration contracts 0082: bản cũ chỉ bị thay (supersede) khi xác nhận, không phải lúc gửi ký.
- Kịch bản: khi HĐ đang trong lượt duyệt thì bước Ký số khoá HĐ rồi gửi; bản cũ chỉ bị thay khi xác nhận [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.int.test.ts]

#### Yêu cầu: Bước Ký số/Chờ ký của mẫu Thư viện là node `contracts.esign`
Các stage Ký số/Chờ ký của mẫu flow Thư viện là node `contracts.esign` nên trình sửa hiện ô chọn người ký; hub 0113 gán node này cho flow đã lưu.
- Kịch bản: khi nạp mẫu Thư viện thì stage Ký số là node `contracts.esign` [test: apps/hub-api/src/modules/processes/library/flow-templates.seed.int.test.ts]
- Kịch bản: khi chạy hub 0113 trên flow đã lưu thì stage Ký số được gán node `contracts.esign` [test: thủ công — chưa có test riêng cho 0113, ghi vào việc còn lại]

#### Yêu cầu: Hạn tải phong bì DocuSign theo dung lượng tệp
Hạn tạo phong bì = 15 s + 6 s mỗi MB, tối đa 110 s (nhỏ hơn hạn bước tool 120 s), để HĐ scan lớn không hết hạn sớm.
- Kịch bản: khi tệp nhỏ thì hạn ≈ 15 s, 11 MB đủ > 60 s, trần 110 s [test: apps/hub-api/src/modules/packs/contracts/adapters/docusign.timeout.test.ts]

### MODIFIED engine/flow-runtime.md
#### Yêu cầu: Trigger DEFERRED của gói chạy dưới role gói
Trigger ràng buộc DEFERRED của gói chạy dưới role gói trong `withPackRoleInTx`, nên HĐ bán được duyệt qua flow sang hiệu lực không kẹt lúc COMMIT bằng `hub_api`.
- Kịch bản: khi HĐ bán được duyệt qua flow thì trigger DEFERRED chạy dưới role gói, không lỗi lúc COMMIT [test: apps/hub-api/src/modules/packs/kit/adapters/pack-role-in-tx.int.test.ts » CR-122 · trigger DEFERRED của gói (HĐ bán sang hiệu lực) chạy dưới role gói, không lỗi lúc COMMIT bằng hub_api]

## Việc còn lại
- Chưa có test riêng cho hub 0113 (backfill node `contracts.esign`); `flow-templates.seed.int.test.ts` chỉ phủ mẫu seed.
