# cr165-tenant-flows — CR-165 (bộ quy trình đồng bộ 3 công ty; «Nhờ đối tác ký?» là lựa chọn sau bước Ký)

## Plan
Mỗi công ty (evolu, nitigroup, preschool) đúng 2 quy trình, không phiếu (CR-167). Chỉ đổi script `tenant:flows`; không đổi engine, không migration.
- «Duyệt hợp đồng gửi đi»: [Người gửi là cấp cao nhất? → Trưởng phòng duyệt (leo cấp) | Chuẩn bị ký (công ty chỉ có trưởng gốc / trưởng gốc tự gửi)] → Ký hợp đồng → Chờ ký xong → «Nhờ đối tác ký?» (người ký chọn Có / Không) → Nếu: Có ⇒ Chọn đối tác & người nhận → Gửi đối tác xác nhận (kèm `sign_together`) → Chờ đối tác ⇒ Kết thúc «Đã xác nhận»; Không ⇒ Kết thúc «Đã duyệt» (HĐ có hiệu lực nội bộ). Từ chối / Trả lại như cũ.
- «Nhận hợp đồng từ đối tác»: không đổi.
- Chạy lại trên công ty có quy trình cũ: thay sơ đồ cùng tên (không tạo trùng); quy trình đang Bật mà tên không còn trong bộ ⇒ TẮT (PATCH `enabled=false`), không xoá; chạy lại không đổi gì.

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | Bước form «Nhờ đối tác ký?» (select Có/Không, người ký làm) + node Nếu đọc ô đó + Kết thúc «Đã duyệt» nội bộ; `sign_together` + `sign_reason` ở node Gửi đối tác | `tools/scripts/src/tenant-flows.data.ts` | [x] |
| 2 | Tắt quy trình thừa (`retireExtras`, báo `disabled`, dry-run chỉ báo) | `tools/scripts/src/tenant-flows.core.ts` | [x] |
| 3 | int: đi từng bước theo def đã lưu (a) nhân viên NitiGroup ⇒ Tiên duyệt ⇒ Không ⇒ Đã duyệt, (b) Tiên tự tạo ⇒ không duyệt ⇒ Có, (c) Dung ⇒ Có (+ evolu Không); chạy lại trên quy trình cũ | `tools/scripts/src/tenant-flows.int.test.ts` | [x] |

## Quyết định trong lúc làm
- Bước quyết = form một ô chọn «Nhờ đối tác ký / xác nhận trên hệ thống?» do người ký (trưởng gốc) làm, rồi node Nếu đọc ô đó (kiểu `field`): dùng node có sẵn, không đổi engine. Người ký cũng là người quyết (không loại người gửi, như bước Chuẩn bị ký).
- Nhánh có trưởng phòng duyệt đi thẳng tới Ký (bước duyệt đã là bước duyệt ngay trước Ký, luật REAL_ACTION); «Chuẩn bị ký» chỉ ở nhánh bỏ duyệt.
- Hai bước Kết thúc cùng kết quả `approved` (Đã xác nhận / Đã duyệt nội bộ) khác khoá (`ket-thuc-approved` / `ket-thuc-noi-bo`).
- `sign_together` luôn bật: đối tác trên Evolu đồng ý trước, ngoài Evolu thì ký qua liên kết như cũ (CR-127 P2, BR-66).
- Int đi bước theo def lưu (mô phỏng nhánh vui), không chạy engine thật: engine đã có int riêng; lượt thật trên bản test do điều phối chạy.

## Việc còn lại
- Chạy `tenant:flows` lên bản test (điều phối); xác nhận phiếu cũ của NitiGroup bị tắt.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/onboarding-cong-ty.md

#### Yêu cầu: Bộ quy trình mẫu 3 công ty có bước «Nhờ đối tác ký?» sau Ký (CR-165)
Mỗi công ty có đúng 2 quy trình: «Duyệt hợp đồng gửi đi» và «Nhận hợp đồng từ đối tác». Sau «Ký hợp đồng» và «Chờ ký xong», người ký chọn «Nhờ đối tác ký / xác nhận trên hệ thống?»: Có ⇒ chọn đối tác và người nhận, gửi kèm đề nghị ký cùng lúc, chờ trả lời; Không ⇒ kết thúc «Đã duyệt» (hợp đồng có hiệu lực nội bộ). Chạy lại script trên công ty đã có quy trình cũ thì thay sơ đồ cùng tên và tắt quy trình không còn trong bộ.
- Kịch bản: nhân viên NitiGroup tạo, Tiên duyệt và ký, chọn Không thì kết thúc «Đã duyệt» [test: tools/scripts/src/tenant-flows.int.test.ts » CR-165 (a) nitigroup: nhân viên tạo ⇒ Tiên duyệt ⇒ Tiên ký ⇒ chọn Không ⇒ Kết thúc «Đã duyệt» (nội bộ)]
- Kịch bản: Tiên tự tạo thì không có bước duyệt, ký xong chọn Có thì tới bước chọn đối tác kèm đề nghị ký cùng lúc [test: tools/scripts/src/tenant-flows.int.test.ts » CR-165 (b) nitigroup: Tiên tự tạo ⇒ không bước duyệt ⇒ ký ⇒ chọn Có ⇒ tới bước chọn đối tác, gửi kèm đề nghị ký cùng lúc]
- Kịch bản: Dung (Preschool) tạo, ký, chọn Có thì tới bước chọn đối tác; Julian (evolu) tạo, Thomas duyệt, chọn Không [test: tools/scripts/src/tenant-flows.int.test.ts » CR-165 (c) preschool: Dung tạo ⇒ chuẩn bị ký ⇒ ký ⇒ chọn Có ⇒ tới bước chọn đối tác · evolu: Julian tạo ⇒ Thomas duyệt ⇒ chọn Không]
- Kịch bản: Nhận hợp đồng từ đối tác không có bước «Nhờ đối tác ký?» [test: tools/scripts/src/tenant-flows.int.test.ts » CR-165: Nhận hợp đồng từ đối tác không có bước «Nhờ đối tác ký?» và vẫn kết thúc Đồng ý]
- Kịch bản: chạy lại trên công ty có quy trình cũ thì thay sơ đồ cùng tên, tắt quy trình thừa, lần sau không đổi [test: tools/scripts/src/tenant-flows.int.test.ts » CR-165: chạy lại trên công ty có quy trình cũ ⇒ thay sơ đồ cùng tên (không trùng), tắt quy trình thừa (không xoá), lần sau không đổi]
