# manual start ui

Cập nhật: 2026-11-08 · Nguồn: CR-125.

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Tạo yêu cầu từ phiếu ở workspace (nguồn: cr125-manual-start-ui)
Nhân viên mở «Tạo yêu cầu», chọn loại yêu cầu mà flow bắt đầu bằng phiếu cho phép mình, điền phiếu dựng từ cấu hình flow rồi gửi; hệ thống mở lượt
và đưa tới trang yêu cầu (trạng thái, nội dung phiếu, các bước). Người được giao duyệt thấy nội dung phiếu trên thẻ và Duyệt/Từ chối tại đó.
- Kịch bản: khi quản trị công ty bật phiếu ở flow, đặt ô và áp dụng, rồi nhân viên điền phiếu và gửi thì người duyệt thấy dữ liệu phiếu và duyệt xong thì yêu cầu hoàn tất [test: e2e/journey-approval/cr125-manual-start.spec.ts » 2 · nhân viên: Tạo yêu cầu → điền phiếu (tải file) → gửi → trang yêu cầu, người duyệt thấy dữ liệu phiếu → Duyệt → hoàn tất]
- Kịch bản: khi ô bắt buộc để trống hoặc tiền sai thì lỗi hiện cạnh ô và không gửi; lỗi API theo mã nói bằng lời nghiệp vụ [test: apps/workspace-web/src/features/requests/lib/request-form.test.ts » ô bắt buộc trống ⇒ lỗi theo ô, tiền sai ⇒ money, đủ ⇒ không lỗi]

#### Yêu cầu: Quản trị công ty dựng phiếu yêu cầu ở trình sửa flow (nguồn: cr125-manual-start-ui)
Thẻ «Bắt đầu khi» có ô «Bắt đầu bằng phiếu yêu cầu»: bật thì node «Phiếu yêu cầu» đứng đầu sơ đồ (các bước khác lùi một, đích bước được đánh lại), tắt thì gỡ;
panel node sửa ô (nhãn, loại gồm tệp đính kèm, bắt buộc, gợi ý; mã tự sinh từ nhãn), ai được bắt đầu và tên yêu cầu; kiểm ngay tại chỗ.
- Kịch bản: khi bật phiếu thì node phiếu đứng bước 0 và các bước còn lại lùi một; gỡ thì dồn lại [test: apps/admin-web/src/features/processes/lib/start-form.test.ts » thêm node phiếu ở ĐẦU flow đẩy các bước lùi một và đánh lại đích bước, gỡ thì dồn lại]
- Kịch bản: khi nhãn trống, mã trùng hoặc trùng mã hệ thống, mẫu tên trống thì báo lỗi theo ô [test: apps/admin-web/src/features/processes/lib/start-form.test.ts » kiểm tại chỗ: cần ≥ 1 ô, nhãn, mã không trùng/không phải mã hệ thống, mẫu tên, nhóm khi chọn nhóm]

#### Yêu cầu: Trang yêu cầu cho người được xem (nguồn: cr125-manual-start-ui)
`GET /processes/requests/:run_id` trả lượt (cùng quyền xem với `GET /process-runs/:id`) kèm giá trị phiếu có nhãn theo phiếu của bản flow đã chạy.
- Kịch bản: khi lượt có giá trị phiếu thì trả danh sách ô theo thứ tự phiếu, ô vắng bị bỏ [test: apps/hub-api/src/modules/processes/triggers/manual-request.test.ts » nhãn theo phiếu, tiền lấy từ value, ô vắng bỏ]

#### Yêu cầu: Trang yêu cầu nói rõ ai đang giữ việc và cho làm việc ngay đầu trang (nguồn: cr126-request-page)
Trang yêu cầu hiện «Đang chờ: <người/nhóm> · Phần N – <bước>» (gộp chờ duyệt / cần quyết định / chờ trả lời) hoặc «Đã hoàn tất», tóm tắt «<đối tác> · <tổng tiền> · Người đề xuất <tên>» từ ô phiếu, nút Gửi / Duyệt / Trả lại / Từ chối của người xem ở đầu trang (một component), Phần hiện tại mở sẵn, bước đã duyệt ghi «Duyệt bởi X, dd/mm», sau khi gửi nói bước tiếp, nút Từ chối kiểu cảnh báo, sau quyết định có link «Việc kế tiếp».
- Kịch bản: khi bước đang mở có người nhận và lượt có nhiều Phần thì dòng chờ ghi người và «Phần N – tên bước»; lượt xong ghi «Đã hoàn tất» [test: apps/workspace-web/src/features/requests/lib/request-view.test.ts » waitingOf]
- Kịch bản: khi phiếu có đối tác, tổng tiền, người đề xuất thì tóm tắt nối bằng « · », thiếu ô nào bỏ ô đó [test: apps/workspace-web/src/features/requests/lib/request-view.test.ts » summaryOf]
- Kịch bản: khi bước đã duyệt thì hiện «Duyệt bởi X, dd/mm» [test: apps/workspace-web/src/features/requests/lib/request-view.test.ts » approvedBy]
- Kịch bản: khi cây có nhiều Phần thì Phần có bước đang mở là Phần hiện tại, mở sẵn [test: apps/workspace-web/src/features/requests/lib/request-view.test.ts » currentNode: bước mở > gốc]

#### Yêu cầu: Trang «Yêu cầu» liệt kê yêu cầu mình đã gửi và mô tả loại yêu cầu (nguồn: cr126-requests-mine)
Dưới danh sách loại yêu cầu có khối «Đã gửi của tôi» (`GET /processes/requests/mine`: ≤ 50 lượt gốc bắt đầu bằng phiếu của chính người dùng, loại lượt thử; tên, ngày gửi, một nhóm trạng thái: Đang chờ <ai> / Đã hoàn tất / Bị trả lại / Từ chối; bấm mở trang yêu cầu). Mỗi loại yêu cầu hiện dòng mô tả quy trình (không có thì không hiện), không hiện số ô.
- Kịch bản: khi người dùng đã gửi yêu cầu thì `GET /processes/requests/mine` chỉ trả yêu cầu phiếu của chính họ, người khác và công ty khác không thấy [test: apps/hub-api/src/modules/processes/triggers/my-requests.int.test.ts » chặn đọc chéo: người khác cùng công ty và công ty khác không thấy yêu cầu của A]
- Kịch bản: khi lượt đang chạy / xong / bị trả lại / bị từ chối thì hiện đúng một nhóm trạng thái [test: apps/hub-api/src/modules/processes/triggers/my-requests.test.ts » kết thúc không xong: Trả lại ⇒ returned, còn lại ⇒ rejected]

