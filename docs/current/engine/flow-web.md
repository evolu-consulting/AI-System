# Engine · renderer flow phía web gộp

Cập nhật: 2026-11-04 · Nguồn: CR-118 (cr118-flow-web). Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Renderer theo loại bước, thiếu loại là lỗi biên dịch (nguồn: cr118-flow-web)
Web gộp có registry renderer theo `FlowStepKind` (review, dify, esign, form, wait, system); thêm loại bước vào contract mà thiếu renderer là
lỗi typecheck. Mỗi loại là một chunk lazy riêng. Loại không có trong registry (snapshot cũ) vẽ bằng renderer chung từ các trường nền, không vỡ trang.
- Kịch bản: khi liệt kê registry thì có đủ mọi loại bước của contract và không thừa [test: apps/sohoptac-web/src/platform/flow/ui/flow-ui.test.tsx » RENDERERS có đủ mọi loại bước của contract, không thừa]
- Kịch bản: khi gặp loại bước lạ (kể cả tên trùng thuộc tính Object) thì dùng renderer chung [test: apps/sohoptac-web/src/platform/flow/ui/flow-ui.test.tsx » loại lạ (snapshot cũ) ⇒ GenericStep, kể cả tên trùng thuộc tính Object]
- Kịch bản: khi khe của gói đặt renderer riêng cho một loại thì nó thắng registry [test: apps/sohoptac-web/src/platform/flow/ui/flow-ui.test.tsx » loại đã biết ⇒ renderer của registry · override của khe thắng]
- Kịch bản: khi FlowPanel ở các trạng thái đang tải, lỗi, không có lượt, có bước thì vẽ đúng [test: apps/sohoptac-web/src/platform/flow/ui/flow-ui.test.tsx » có bước ⇒ danh sách theo thứ tự qua renderer của loại · loại lạ ⇒ Generic]

#### Yêu cầu: Bước form hiển thị và gửi qua đường review-tasks sẵn có (nguồn: cr118-flow-web)
Người có task đang mở ở bước `form` thấy form theo định nghĩa trong snapshot (≤ 20 trường; nhãn/gợi ý là text thuần) và gửi bằng
`POST /review-tasks/:id/form`; client báo lỗi sớm theo đúng giới hạn của Hub (cùng `flowFormValuesSchema`), Hub vẫn kiểm lại. Người khác
chỉ thấy dòng bước. Không thay đổi server.
- Kịch bản: khi có task mở thì form có ô theo loại trường, nhãn bị escape, nút Gửi [test: apps/sohoptac-web/src/platform/flow/ui/flow-ui.test.tsx » có task đang mở ⇒ form với ô theo loại trường, nhãn là TEXT (thẻ bị escape), dấu * cho trường bắt buộc, nút Gửi]
- Kịch bản: khi không có task của người xem hoặc bước không mở thì không có form [test: apps/sohoptac-web/src/platform/flow/ui/flow-ui.test.tsx » không có task của người xem (hoặc bước không mở) ⇒ chỉ hiển thị dòng bước, không form]
- Kịch bản: khi giá trị vượt giới hạn trường thì báo lỗi từng trường như Hub [test: apps/sohoptac-web/src/platform/flow/lib/form-values.test.ts » giới hạn: text > max_len ⇒ tooLong · số ngoài khoảng ⇒ range · không nguyên ⇒ integer · chữ ⇒ invalid]
- Kịch bản: khi gửi form thì gọi `POST /review-tasks/:id/form` với `{values}` [test: apps/sohoptac-web/src/platform/flow/adapters/http.test.ts » submitForm ⇒ POST /review-tasks/:id/form {values} (đường sẵn có, không đổi server)]

#### Yêu cầu: Huy hiệu danh sách HĐ từ tóm tắt flow, một yêu cầu cho cả trang (nguồn: cr118-flow-web)
Cột Giai đoạn của danh sách HĐ hiện huy hiệu "Cần xử lý" cho HĐ có `attention` theo `POST /pack/contracts/flow/contracts.approval/summary`
(một yêu cầu cho cả trang, chia lô ≤ 100, không gọi từng HĐ). Runtime chưa bật (404) ⇒ không huy hiệu, không lặp lại yêu cầu trong phiên.
- Kịch bản: khi tải trang danh sách thì summary là MỘT yêu cầu cho cả lô; khi 404 thì null và không gọi lại [test: apps/sohoptac-web/src/platform/flow/adapters/http.test.ts » summary ⇒ một POST cho cả lô · 404 (runtime tắt) ⇒ null và KHÔNG gọi lại ở lần sau]
- Kịch bản: khi danh sách dài hơn trần lô thì chia theo trần của contract [test: apps/sohoptac-web/src/platform/flow/ui/flow-ui.test.tsx » trần lô của web = trần của contract (FLOW_REF_MAX_BATCH)]
