# cr159-flows-chain — CR-159 vòng 2 (luật duyệt chung «trưởng phòng người tạo, leo cấp» cho 3 tenant)

## Plan
Mọi quy trình có bước duyệt (HĐ gửi đi, Nhận HĐ, phiếu) dùng một luật: duyệt đầu = trưởng phòng của người tạo (`approver_mode: starter_head`; engine tự leo lên phòng cha khi người tạo là trưởng hoặc phòng không có trưởng). Bỏ người duyệt thay (`escalate.user_id`) và bước «Tiên duyệt» / «Thomas duyệt» riêng. Cây phòng ban đọc từ `deploy/tenants/<key>.yaml` (`tenant-flows.org.ts`), không khai lại.

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | Đọc yaml → cây phòng, `headOfCreator` (đúng luật engine), `shapeOf` (none / branch / chain) | `tools/scripts/src/tenant-flows.org.ts` | [x] |
| 2 | Dựng bước theo `shapeOf`; bỏ escalate + bước duyệt riêng | `tools/scripts/src/tenant-flows.data.ts` | [x] |
| 3 | int: chuỗi người duyệt theo TỪNG người tạo, cấp cao nhất, chạy lại không đổi | `tools/scripts/src/tenant-flows.int.test.ts` | [x] |

## Quyết định trong lúc làm
- Engine tự leo cấp (`pickStarterHead`) nhưng KHÔNG có «bỏ bước khi người tạo là cấp cao nhất»: không có người ⇒ giao đích dự phòng (R#15: quản trị công ty ≠ người tạo). Bỏ bước chỉ dựng được bằng nhánh `if` trên dữ kiện `creator_department` (phòng người tạo + phòng cha; chỉ có ở sự kiện HĐ, không có dữ kiện người).
- evolu HĐ gửi đi: `if creator_department ∈ {phòng con trong yaml}` ⇒ trưởng phòng; ngược lại (chỉ phòng gốc = Thomas) ⇒ bước «Chuẩn bị ký» (Thomas tự làm, không duyệt) rồi Ký. Bước «Chuẩn bị ký» là bắt buộc: `REAL_ACTION` đòi Ký đứng sau một bước kiểu duyệt (bước đầu không được) — engine không cho Ký đứng đầu. Giữ cả preschool (Dung): không bước duyệt nào, chỉ «Chuẩn bị ký».
- nitigroup: KHÔNG bỏ được bước cho Tiên. Tiên và Ngân đều chỉ thuộc phòng gốc ⇒ dữ kiện phòng không tách được; nếu bỏ theo phòng thì Ngân cũng được bỏ (trái «Ngân → Tiên»). Giữ `starter_head`: Tiên tạo ⇒ không có trưởng ⇒ engine giao đích dự phòng (quản trị công ty ≠ Tiên: `admin@`). Muốn bỏ hẳn cần dữ kiện «người tạo» ở sự kiện hợp đồng (đổi engine/contract — ngoài phạm vi).
- Phiếu (không có sự kiện HĐ nên không có dữ kiện phòng): không rẽ được ⇒ người tạo cấp cao nhất (Thomas / Tiên) cũng đi đích dự phòng; Phương tạo phiếu: Tiên duyệt → Phương kiểm (giữ; Phương là người tạo nên «Kế toán kiểm» do đích dự phòng nhận).
- Nhận HĐ: người tạo = người phụ trách ở trigger (Julian / Vy) ⇒ chuỗi trưởng phòng của họ (Thomas / Tiên) rồi Ký.
- Chuỗi trong int do test tính bằng `headOfCreator` (hàm thuần engine `pickStarterHead` + cây yaml) và duyệt def ĐÃ LƯU qua API; khớp engine vì cùng một hàm (có int engine riêng `starter-head.int.test.ts`).

## Việc còn lại
- Nitigroup/Tiên, phiếu cấp cao nhất: chờ CR bổ sung dữ kiện «người tạo» (hoặc người dùng chấp nhận đích dự phòng).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ đổi dữ liệu quy trình do script vận hành `tenant:flows` dựng; không đổi engine, contract API hay màn hình).
