---
id: cr135c-file-record
lát: cr135c-file-record — «Hồ sơ» cho từng file của HĐ (Q5)
cr: CR-135
làn: nhanh
migration: không
phụ thuộc: CR-133 (khối «Tài liệu kèm»), CR-134 (Btn, TruncText)
---
## Plan (ngắn)
Mỗi file của HĐ có nút «Hồ sơ» mở ngăn bên phải: (1) thông tin file, (2) duyệt, (3) ký số, (4) tệp là bằng chứng của bước nào. Chỉ ghép dữ liệu/khối ĐÃ CÓ — không endpoint mới, không migration, không nguồn dữ liệu thứ hai.
| Nơi đặt nút | Mục tiêu (`FileRecordTarget`) |
|---|---|
| Dòng thông tin HĐ, cạnh «Xem file gốc» (`ContractBody.tsx`) | `main` của HĐ đang xem |
| Mỗi dòng phiên bản (`VersionsBlock.tsx`) | `main` của phiên bản đó (mỗi phiên bản là một HĐ riêng ⇒ lượt duyệt riêng) |
| Mỗi tệp gắn vào HĐ / tệp kèm bước duyệt (`ContractFilesPanel.tsx`) | `attachment` / `step` |

## Làm
`features/contract-file-record/` (`lib/file-record.ts` luật thuần + test, `hooks/use-file-record.ts`, `FileRecordDrawer/Sections/Button.tsx`) · export `RecordBody` của `ApprovalRecord.tsx` để tái dùng · i18n `contracts.frec.*` (vi/en, trong `docframe.*.json`).

## Không làm / Chạm
Không đổi hub/DB (lấy mọi dữ liệu từ API sẵn có). Không sửa `EsignPanel`, `ApprovalRecord` ngoài việc export. Chạm: `ContractBody.tsx`, `VersionsBlock.tsx`, `ContractFilesPanel.tsx`.

## Test tối thiểu
unit `contract-file-record/lib/file-record.test.ts` (loại tệp, tên người, bằng chứng của bước nào, khối ký) · không có endpoint mới ⇒ không int · tsc + biome + `check:bundle`.

## Quyết định trong lúc làm
- Nguồn dữ liệu = API sẵn có, cùng khoá react-query với trang chi tiết: `GET /contracts/:id` (file, người tạo, lúc tạo, phiên bản), `GET …/approval-record` (khối «Hồ sơ duyệt» dùng lại nguyên `RecordBody`), `GET …/esign` + `…/signed-link` (từng bên ký + bản đã ký), `GET /members` (tên người). Quyền xem do các API đó quyết (HĐ không xem được ⇒ 404 ⇒ ngăn nói rõ cách xử lý).
- «Phiên bản nào của HĐ»: mỗi phiên bản là một hàng HĐ riêng có lượt duyệt + phong bì ký riêng ⇒ «lượt duyệt áp cho phiên bản đó» = hồ sơ duyệt của chính id đó.
- Tệp gắn vào HĐ (CR-133) và tệp kèm bước duyệt (hub) hiện trạng thái duyệt/ký của HĐ chứa chúng; ghi rõ «tệp kèm không đem đi ký». Tệp kèm bước duyệt ⇒ liệt kê bước mà tệp được gắn làm bằng chứng (so id tệp với `attachment_ids`/chữ ký của hồ sơ duyệt); tệp gắn thẳng vào HĐ không có liên kết bằng chứng ⇒ câu «chỉ đính kèm vào hợp đồng».
- HĐ không ký số (không có phong bì và công ty không bật/không cấu hình ký số) ⇒ «Không ký số — xác nhận bằng bằng chứng duyệt ở trên». Bật ký số mà chưa gửi ký ⇒ câu riêng.
- Người tải của tệp bước duyệt không lưu ở bản ghi liên kết gọn ⇒ hàng «Người tải / nguồn» hiện nguồn («Khi gửi duyệt»…); tên người không có trong danh bạ ⇒ «Không rõ» (không in id).
- Ngăn = `Dialog` cũ ép sang phải (không thêm thư viện); nút dùng `Btn`, tên file dùng `TruncText`; đang tải ⇒ khung xương, lỗi ⇒ câu + «Thử lại».

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp
### ADDED pack-contracts/ho-so-file.md
#### Yêu cầu: Mỗi file của hợp đồng có «Hồ sơ» cho biết ai đã duyệt và đã ký chưa (nguồn: CR-135 Q5)
File chính (HĐ và từng phiên bản), tệp gắn vào hợp đồng và tệp kèm bước duyệt đều có nút «Hồ sơ» mở ngăn bên phải gồm: thông tin file (tên, loại, người tải, lúc tải, phiên bản hợp đồng), các bước duyệt của phiên bản đó (ai, lúc nào, quyết định, ý kiến, chữ ký/tệp bằng chứng — dùng lại «Hồ sơ duyệt»), trạng thái ký của từng bên kèm nút tải bản đã ký, và tệp kèm là bằng chứng của bước nào. Hợp đồng không ký số ghi «Không ký số — xác nhận bằng bằng chứng duyệt ở trên».
- Kịch bản: gom tệp là bằng chứng của bước nào, khối ký và loại tệp từ dữ liệu có sẵn [test: apps/workspace-web/src/features/contract-file-record/lib/file-record.test.ts » hồ sơ file]
- Kịch bản: bấm «Hồ sơ» ở file chính của hợp đồng đã duyệt thấy người duyệt và trạng thái ký; bấm ở tệp kèm thấy cùng hồ sơ kèm bước mà tệp làm bằng chứng [test: thủ công — chụp ảnh UAT out6 (Hồ sơ file chính, Hồ sơ tệp kèm), e2e chạy một lần cuối đợt]

## Việc còn lại
e2e hành trình (mở «Hồ sơ» ở file chính + tệp kèm của HĐ đã duyệt) chưa viết/chạy — cùng lượt e2e cuối đợt.
