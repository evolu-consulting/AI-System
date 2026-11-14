# qc-e2e-cr127 — QC phân loại 6 ca e2e `cr127` còn đỏ (đợt CR-146..152)

Nguồn: log evotest `qc-e2e-contracts/.data/evotest/20261114-141242-30504-e2e` (31 pass / 6 fail). Chỉ sửa `e2e/**`, `tests/.lock`, docs. Không sửa code sản phẩm.
Cách làm: đọc lỗi + error-context + ảnh + trace (mạng: phản hồi `GET /contracts/:id`, `GET /messages/people`, `GET /people?ids=`), đối chiếu Delta cr135a, cr146b, cr148.

## Phân loại (a = test cũ theo hành vi đã chốt · b = lỗi sản phẩm · c = chập chờn)
| Ca | Loại | Nguyên nhân + bằng chứng | Đã làm |
|---|---|---|---|
| j01 quản trị nền tảng soạn quy trình | a | Ảnh lỗi: nút «Áp dụng cho công ty» khoá, báo «chưa chọn «Ký qua» — chọn cách ký trong bước Ký của quy trình». CR-146b: node Ký BẮT BUỘC «Ký qua» (`NO_PROVIDER_SELECTED`); test cũ chỉ tick người ký, không chọn ⇒ không lưu được, `expect.poll` chờ hết 60 s | Chọn «Ký qua» = «Tải lên bản đã ký» (luôn hợp lệ) trước khi Áp dụng; «mở lại đúng» kiểm thẻ «Ký số … Ban Giám đốc ký» |
| j16 «Người khác không thấy Xoá hợp đồng» | a | Trace: `GET /contracts/:id` của Trưởng phòng KD có `can.delete=false`; giao diện vẫn hiện «Thao tác ▾» vì CR-135 Q2 đưa «Lưu nháp»/«Huỷ» vào menu ở nháp lần đầu (head-rule.ts `sticky`/`headActs`). Test cũ đòi cả menu vắng; điều cần khẳng định chỉ là mục «Xoá hợp đồng» vắng | Mở menu nếu có, đòi `Xoá hợp đồng` vắng; thêm bằng chứng API `can.delete === false` |
| j18 A nhắn B | a | Ảnh: cột trái là danh bạ chia nhóm theo phòng ban (CR-148), dòng đầu là «Trưởng phòng Kế toán», dòng của A nằm trong «Phòng Kinh doanh» (in đậm, chấm «1», số menu «1» đã đúng). Test cũ lấy `conv-row.first()` (thời CR-132 «hội thoại mới ở đầu») | Tìm dòng theo tên người gửi `E2E Nhân viên Kinh doanh` |
| j19 khoang | a (hệ quả j18 + cùng lỗi dòng đầu) | Huy hiệu «2» vì j18 đỏ giữa chừng ⇒ B chưa mở/đọc tin của j18 (cùng tenant c22, cùng cặp A→B, workers=1 chạy nối tiếp) ⇒ dư 1 tin chưa đọc. Sửa j18 thì hết. Cũng dùng `conv-row.first()` | Tìm dòng theo tên người gửi |
| j20 danh bạ · thẻ người | a | Ảnh + trace: dòng được rê chuột (nền xám) nhưng không có thẻ. `ConversationRow.tsx` gắn `onMouseEnter` chỉ lên ảnh + tên (đúng spec CR-148 «rê lên ảnh đại diện hoặc tên»); Playwright `.hover()` nhắm giữa dòng = khe giữa dòng tên và dòng xem trước. Trace: `/messages/people` 200 và `/people?ids=` 200 có `department` ⇒ dữ liệu thẻ đủ | Rê lên `conv-avatar` |
| cr150-two-companies «B duyệt nội bộ» (+ «Trả lại», «Từ chối» lộ ở lượt 1) | a | Error-context trang B: bước «Giám đốc nhận duyệt · Ban Giám đốc» đang mở nhưng chỉ có «Nhận việc»/«Chuyển cho…» (việc nhóm `need=one`, CR-127 U4 ⇒ phải Nhận việc rồi mới Duyệt/Trả lại/Từ chối). Cả 3 ca B của cr150 thiếu bước nhận việc. Thêm: cặp d5a→d5b của j08 có bước Ký sau bước duyệt (CR-146b) ⇒ B duyệt xong còn chờ ký, A chưa thấy «xác nhận» | Dùng cặp q6a→q6b (j07, Nhận HĐ không có bước Ký); thêm bước «Nhận việc» (`claim-take`) trước Duyệt/Trả lại/Từ chối; Trả lại/Từ chối qua «Thao tác ▾» → ô lý do → xác nhận |

Lỗi sản phẩm (b) xác nhận: 0. Ghi nhận không sửa: UI cho người không phải người tạo (Trưởng phòng KD, có `write` vai trò) thấy «Lưu nháp»/«Huỷ» ở nháp của người khác (`apps/workspace-web/src/features/contract-review/lib/head-rule.ts:90` `sticky: first`, `first = canSave && …`, `canSave` dùng `i.write` chứ không dùng quyền theo hợp đồng) — nếu CEO muốn chỉ người tạo/phụ trách sửa nháp thì là việc cho agent code; chưa kiểm API PUT có chặn không.

## Kết quả chạy lại
- Lượt 1 (`cr127`, -Wave; log `.data/evotest/20261114-143543-16120-e2e`): 37 pass / 2 fail — j16, j18, j19, j20, cr150 «B duyệt nội bộ» xanh; lộ thêm hai lỗi test bị che bởi serial: j01 dòng «mở lại đúng» (`getByText("Ký hợp đồng")` rơi vào `<option>` ẩn; thẻ bước trên sơ đồ ghi «Ký số» + «Ban Giám đốc ký») và cr150 «Trả lại» (nút Trả lại/Từ chối nằm trong «Thao tác ▾» rồi qua ô lý do `data-approval=reason`, CR-128 e) ⇒ cả hai loại a, đã sửa.
- Lượt 2 (log `.data/evotest/20261114-144705-29032-e2e`): **43 pass / 0 fail** (trước: 31 pass / 6 fail). Chạy cần `-Wave` (job 83 spec > 60).

## Quyết định trong lúc làm
- cr150 chuyển sang cặp j07 (q6a→q6b) thay vì dựng cặp mới: Nhận HĐ không có bước Ký, đã dựng sẵn trong `_cr127-stack.ts`; chạy sau `cr127/j07` (xếp tên tệp, workers=1) nên lời mời nối đã được nhận (cr150 đã xử lý cả hai trường hợp).
- j16: giữ ý «người khác không xoá được», chuyển bằng chứng sang API `can.delete` (không phụ thuộc thời điểm vẽ menu).

## Delta (so với docs/current)
Không thay đổi hành vi (lý do: QC e2e)

Trạng thái gộp: chưa gộp
