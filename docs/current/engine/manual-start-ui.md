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

