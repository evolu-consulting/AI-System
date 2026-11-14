# CR-146 — Quyết định đã chốt (2026-11-14)

Nguồn: dòng CR-146 trong `docs/CHANGE-REQUESTS.md`; bản mẫu `prototype.json` (cùng thư mục).

1. Cài đặt › «Quy trình duyệt» liệt kê MỌI quy trình đang bật cho hợp đồng, đúng thứ tự xét (`company_flows.position`), mỗi dòng có điều kiện «Bắt đầu khi» bằng chữ nghiệp vụ (vd «Giá trị ≥ 500 triệu», «Phòng = Mua hàng», không điều kiện ⇒ «Mọi hợp đồng còn lại»). Câu dẫn: «Hợp đồng đi theo quy trình ĐẦU TIÊN có điều kiện khớp, xét từ trên xuống.» Luật chọn = `apps/hub-api/src/modules/processes/triggers/match.rules.ts` (không viết luật thứ hai).
2. Bấm một quy trình ⇒ xem SƠ ĐỒ của quy trình đó (công tắc «Sơ đồ | Danh sách» như hiện nay, `FlowCanvasLazy`/`FlowList`) + khối «Ký và đối tác của quy trình này» (chỉ xem: ký qua, người ký bên mình, đối tác ký, gửi đối tác xác nhận).
3. Bật/tắt/đổi thứ tự chỉ ở trang Quy trình (admin); Cài đặt chỉ xem + nút «Mở trang Quy trình» (quản trị).
4. Nhân viên (không phải quản trị) cũng thấy danh sách + sơ đồ, chỉ xem (bản mẫu q1 = mặc định).
5. Tab «Ký & đối tác» ⇒ «Kết nối»: chỉ còn kết nối cấp công ty — công tắc/tài khoản ký số (đã nối nhà cung cấp nào) và trạng thái «Đối tác xác nhận» bật/tắt. Câu dẫn: «Tài khoản công ty dùng chung. Ký thế nào, ai ký, gửi đối tác ra sao: đặt trong từng quy trình.»
6. Bỏ mặc định chung: bước Ký trong quy trình BẮT BUỘC chọn «Ký qua» (nhà cung cấp hoặc «Tải lên bản đã ký (không ký số)» — q2 = có) và «Người ký bên mình»; thiếu ⇒ lỗi theo trường khi LƯU quy trình, không đợi lúc chạy. Bỏ nhóm «Người ký HĐ» cấp công ty (CR-141, `partner_settings.signer_group_id`, `withDefaultSigners` ở `intake.tools.ts:123`) và nhà cung cấp mặc định công ty làm fallback.
7. Ngưỡng «Quan trọng»/«Rất quan trọng» (triệu đồng) + «Người phụ trách hợp đồng nhận» chuyển vào cấu hình quy trình «Nhận HĐ từ đối tác» (panel node/flow ở trang Quy trình), bỏ khỏi Cài đặt.
8. Không có ô «Thử: HĐ X đi quy trình nào» (q3 = chưa cần).
9. Không backfill (chưa có khách — xoá tạo lại); seed demo phải cập nhật theo cấu hình mới.
