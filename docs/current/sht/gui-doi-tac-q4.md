# Lần gửi đầu tới công ty chưa nối được giữ tới khi công ty nhận chấp nhận

Cập nhật: 2026-11-08 · Nguồn: CR-124/125.

## CR-124/125 · Delta gộp 2026-11-08 (đợt cr124-cr125)

#### Yêu cầu: Lần gửi đầu tới công ty chưa nối được giữ tới khi công ty nhận chấp nhận (nguồn: cr124-q4-ui)
Công ty nhận thấy lời mời (Nhận / Chặn); chấp nhận ⇒ lần gửi được giao; chặn ⇒ lần gửi tự trả lời Từ chối kèm gợi ý gửi qua email.
- Kịch bản: khi chưa nối thì lần gửi bị giữ, B thấy lời mời, chấp nhận ⇒ B nhận [test: apps/hub-api/src/modules/packs/contracts/partner-q4.int.test.ts » chưa nối ⇒ kênh nền tảng nhưng GIỮ]
- Kịch bản: khi công ty nhận chặn thì node chờ nhận Từ chối kèm lý do [test: apps/hub-api/src/modules/packs/contracts/partner-q4.int.test.ts » chặn ⇒ lần gửi đang giữ tự trả lời Từ chối]

#### Yêu cầu: Công ty nhận đặt ngưỡng mức quan trọng và người phụ trách (nguồn: cr124-q4-ui)
Mức cuối tính theo ngưỡng của công ty nhận; HĐ nhận có người phụ trách đã đặt.
- Kịch bản: khi đặt ngưỡng Rất quan trọng 500 triệu thì HĐ 600 triệu là Rất quan trọng và thuộc người phụ trách [test: apps/hub-api/src/modules/packs/contracts/partner-q4.int.test.ts » ngưỡng riêng + người phụ trách]

#### Yêu cầu: Ghi nhận kết quả đối tác thủ công (nguồn: cr124-q4-ui)
Chỉ công ty gửi ghi nhận được lần gửi đang mở; lý do bắt buộc với Trả lại/Từ chối; flow bên gửi đi đúng nhánh.
- Kịch bản: khi công ty khác thử ghi nhận thì không thấy lần gửi; công ty gửi ghi nhận Trả lại thì node chờ nhận partner.returned [test: apps/hub-api/src/modules/packs/contracts/partner-q4.int.test.ts » chỉ công ty gửi ghi nhận được lần gửi MỞ của mình]
- Kịch bản: khi thiếu lý do, tên người trả lời hoặc bằng chứng thì form báo đúng ô [test: apps/workspace-web/src/features/partner-inbox/lib/partner-view.test.ts » thiếu lý do / tên / bằng chứng ⇒ báo đúng ô]

#### Yêu cầu: Thẻ 3 dòng hai phía (nguồn: cr124-q4-ui)
Mỗi thẻ có trạng thái, lý do, bước kế; bản sửa lần N hiện lý do lần trước.
- Kịch bản: khi chờ xác nhận thì thẻ bên nhận có 3 dòng (trạng thái · lý do · bước kế) [test: apps/workspace-web/src/features/partner-inbox/lib/partner-view.test.ts » chờ xác nhận: 3 dòng (trạng thái · lý do · bước kế)]
- Kịch bản: khi đối tác trả lại thì thẻ bên gửi nói lý do và bước sửa rồi gửi lại [test: apps/workspace-web/src/features/partner-inbox/lib/partner-view.test.ts » trả lại ⇒ lý do + sửa rồi gửi lại]

#### Yêu cầu: Hai mẫu Thư viện nhận hợp đồng đối tác và sự kiện bắt buộc (nguồn: cr124-q4-ui)
«Nhận HĐ quan trọng» (mức ≥ Quan trọng: Kế toán → Giám đốc) và «Nhận HĐ thường» (không điều kiện, mặc định) seed ở hub 0121 như flow mẫu `contract.submitted`; `contract.received` thành sự kiện bắt buộc với flow mặc định `hd-nhan-thuong`. Không cơ chế gán mới.
- Kịch bản: khi chạy seed thì có đúng 2 flow mẫu trigger `contract.received`, chỉ flow quan trọng có điều kiện [test: apps/hub-api/src/modules/packs/contracts/partner-q4.int.test.ts » 2 flow mẫu seed]
- Kịch bản: khi đối chiếu nguồn TS với migration thì JSON khớp từng byte và hợp lệ theo FlowDef [test: apps/hub-api/src/modules/processes/library/flow-templates-receive.def.test.ts » seed hub 0121 khớp nguồn TS]

#### Yêu cầu: Bên gửi thấy lần gửi đang giữ và lần gửi hết hạn, không bao giờ thấy «bị chặn» (nguồn: cr124-q4-ui)
Lần gửi đang giữ hiện «Đang chờ công ty nhận đồng ý kết nối»; hết hạn mà vẫn chưa được nhận hiện «Đối tác không nhận — hết hạn».
- Kịch bản: khi lần gửi đang giữ thì thẻ chờ kết nối; quá hạn thì thẻ hết hạn và không có chữ chặn [test: apps/workspace-web/src/features/partner-inbox/lib/partner-view.test.ts » hết hạn khi vẫn chưa được nhận]
- Kịch bản: khi lần gửi bị giữ thì API vòng gửi trả trạng thái hộp thư `held` và hạn [test: apps/hub-api/src/modules/packs/contracts/partner-q4.int.test.ts » chưa nối ⇒ kênh nền tảng nhưng GIỮ]

#### Yêu cầu: Cài đặt nhận hợp đồng đối tác và ẩn mục khi tắt tính năng (nguồn: cr124-q4-ui)
Quản trị đặt ngưỡng (triệu đồng) và người phụ trách ở Cài đặt › Quy trình; mục «Hợp đồng đối tác gửi» chỉ hiện khi công ty bật `contracts-partner-confirm`.
- Kịch bản: khi nhập ngưỡng thì đổi triệu ⇄ đồng đúng và chặn ngưỡng Rất quan trọng ≤ Quan trọng [test: apps/workspace-web/src/features/partner-inbox/lib/receive-settings.test.ts » ngưỡng Rất quan trọng phải lớn hơn Quan trọng]
- Kịch bản: khi node gửi đối tác được cấu hình thì panel chung dùng chữ nghiệp vụ và không lộ mã hợp đồng [test: apps/admin-web/src/features/processes/modules/panel-registry.test.ts » có cổng cấu hình, ô theo chữ nghiệp vụ và không lộ contract_id]

#### Yêu cầu: Lý do gửi đối tác chỉ lấy từ bước quyết; nhận/chặn đối tác là quyết định của quản trị (nguồn: cr124-q4-ui)
Lý do Trả lại/Từ chối gửi ra ngoài chỉ là góp ý của bước Duyệt đã rẽ nhánh — ghi chú nội bộ của người duyệt trước (đã Đạt) không bao giờ gửi đi; bước quyết không có góp ý ⇒ lý do dự phòng. Nhận hoặc chặn một công ty đối tác cần quyền admin của gói. Người phụ trách HĐ nhận phải là thành viên của chính công ty.
- Kịch bản: khi bước Từ chối có góp ý và bước trước có ghi chú nội bộ thì chỉ góp ý của bước Từ chối được dùng [test: apps/hub-api/src/modules/packs/contracts/partner-q4.int.test.ts » KHÔNG lấy ghi chú nội bộ của người duyệt trước]
- Kịch bản: khi bước quyết không có góp ý thì không lùi về ghi chú của bước trước [test: apps/hub-api/src/modules/packs/contracts/partner-q4.int.test.ts » bước quyết không có góp ý ⇒ null]
- Kịch bản: khi đặt người phụ trách không thuộc công ty thì không lưu [test: apps/hub-api/src/modules/packs/contracts/partner-q4.int.test.ts » người phụ trách không thuộc công ty ⇒ không lưu]
- Kịch bản: khi gọi nhận/chặn lời mời thì route đòi quyền admin của gói [test: thủ công — route khai `packGuard(view, "contracts", "admin")`, bộ guard dùng chung đã có test riêng]
- Kịch bản: khi gửi tới công ty chưa có dòng nối hoặc đã chặn trước thì lần gửi cùng được giữ, bên gửi không phân biệt được [test: apps/hub-api/src/modules/partners/mailbox.int.test.ts » kênh nền tảng chỉ khi bên nhận đã chấp nhận nối]
