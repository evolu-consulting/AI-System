# Engine · Chi tiết lượt chạy và nhật ký bước (admin)

Cập nhật: 2026-11-09 · Nguồn: cr121-r2-run-log (CR-121 R-2). Code: `apps/hub-api/src/modules/processes/runs/run-detail*`, `processes/domain/runs/run-timeline`, `run-log-text`, `run-redact`.

#### Yêu cầu: Chi tiết lượt chạy cho admin (nguồn: cr121-r2-run-log)
Admin xem header, danh sách bước (trạng thái, thời lượng, điều kiện rẽ nhánh khớp) và dòng thời gian sự kiện của một lượt chạy bằng số câu SQL cố định (≤ 4, không theo số bước). Dòng thời gian gom: bắt đầu, xong bước, rẽ nhánh, nhắc, chuyển cấp, lỗi, thử lại, quyết định, quay lại, dừng/chạy lại. Tenant khác 404; không phải admin 403; `?tenant_id` sai định dạng ⇒ 422.

#### Yêu cầu: Nhật ký một bước theo vai (nguồn: cr121-r2-run-log)
Mức nhật ký do service quyết theo vai: platform_admin xem debug (mã lỗi, thông điệp gốc, các lần thử, payload job, đầu ra, số truy vấn kh_stage_usage; ≤ 3 câu SQL); tenant_admin/member chỉ basic (ai xử lý, lúc nào, kết quả, lý do, bình luận, lỗi diễn đạt dễ hiểu; ≤ 2 câu) và không bao giờ nhận payload/error_message/mã lỗi, kể cả khi xin mức debug. Mã lỗi lạ hoặc vắng ⇒ "Bước … chưa chạy được, hệ thống đang thử lại".

#### Yêu cầu: Dừng / chạy lại hiện trên dòng thời gian (nguồn: cr121-r2-run-log)
Mỗi thao tác R-1 (dừng, chạy lại từ bước, chạy lại cả lượt) hiện cùng người làm và lý do ("Dừng bởi … · lý do …", "Chạy lại từ bước n", "Chạy lại cả lượt" kèm liên kết lượt gốc `rerun_of`).

#### Yêu cầu: Debug che secret (nguồn: cr121-r2-run-log)
Payload job, thông điệp lỗi gốc, nội dung đầu ra được che khoá/chuỗi nhạy cảm (api_key, token, password, authorization, cookie, Bearer) thành `***` ở mọi độ sâu trước khi trả; mở debug ghi audit view với `stage_idx` + mức.
