---
id: ai-system
title: AI System — Hỏi AI (chat)
title_en: AI System — chat
audience: all
pack: none
keywords: chat hỏi ai hội thoại flow agent tệp lịch sử ứng dụng
---

## Bắt đầu một hội thoại mới
Trong AI System (Evolu Copilot), bấm nút **Hỏi AI** ở thanh bên trái (hoặc vào trang chào "Chào <tên>, hôm nay cần gì?").
1. Bấm **Hỏi AI** ở thanh bên trái.
2. Gõ câu hỏi vào ô **Hỏi điều mới…** (có thể bấm một thẻ gợi ý như "Soạn email", "Tóm tắt văn bản", "Dịch", "Lên dàn ý" để điền sẵn; thẻ chưa gửi ngay).
3. Bấm **Gửi**. Mỗi câu hỏi mới mở một **flow** riêng trong hội thoại; đang có câu trả lời chạy thì chờ xong hoặc bấm **Dừng**.

EN: Click "Hỏi AI" in the left sidebar, type your question in "Hỏi điều mới…" and click "Gửi". Each new question opens its own flow.

## Hỏi tiếp trong cùng một flow (Trả lời tiếp)
Muốn hỏi tiếp đúng việc vừa hỏi, đừng gõ ở ô câu hỏi mới.
1. Tìm flow đó trong hội thoại.
2. Bấm **Trả lời tiếp** trên flow. Khung flow mở bên phải ("Flow đang mở").
3. Gõ vào ô **Trả lời trong flow…** rồi bấm **Gửi trong flow**. AI nhớ cả flow ("nhớ cả flow").
Đóng khung bằng **Đóng khung flow** hoặc **Thu nhỏ flow**.

EN: Use "Trả lời tiếp" on a flow to continue it; the AI remembers the whole flow.

## Gọi một agent bằng @ và dùng lệnh /
- Gõ **@** trong ô nhập để chọn một **agent** (danh sách "Agent bạn dùng được"). Ví dụ "@Trợ lý ...". Không gõ @ thì câu hỏi đi vào agent mặc định của công ty / Orchestrator (Điều phối), nó tự chọn agent phù hợp.
- Gõ **/** để chọn một **Lệnh** (command) được cấp cho bạn.
- Nếu menu báo "Bạn chưa được cấp agent nào" hoặc "Bạn chưa được cấp lệnh nào": nhờ quản trị viên công ty cấp quyền (xem phần Quản trị > Phân quyền).
- Trong nhóm hay tin nhắn riêng, agent chỉ trả lời khi được @, và chạy bằng quyền và quota của người hỏi.

EN: Type @ to pick an agent, / to pick a command. Ask your company admin if the menus are empty.

## Đính kèm tệp
1. Bấm nút **Đính kèm tệp** cạnh ô nhập.
2. Chọn tệp (tối đa 10 tệp mỗi tin, mỗi tệp tối đa 20 MB). Chờ "Đang tải lên…" xong.
3. Gõ câu hỏi về tệp (ví dụ "Tóm tắt tệp này") rồi **Gửi**. Agent đọc tệp và nêu tên tệp làm nguồn.
Xoá tệp đã chọn bằng nút "Xoá <tên tệp>"; lỗi "Loại tệp không được hỗ trợ" nghĩa là định dạng chưa hỗ trợ.

EN: Use "Đính kèm tệp" (max 10 files, 20 MB each), then send your question.

## Xem lại lịch sử, đổi tên, xoá hội thoại
- Danh sách **Hội thoại** ở thanh bên trái, gom theo **Hôm nay**, **7 ngày qua**, **30 ngày qua**, **Cũ hơn**; bấm **Tải thêm** để xem thêm.
- Tìm nhanh ở ô **Tìm hội thoại, người, nhóm**.
- Đổi tên hoặc xoá: bấm **Thao tác khác** trên dòng hội thoại, chọn **Đổi tên** hoặc **Xoá** (xoá hội thoại là xoá mọi flow trong đó).

EN: History is in the left sidebar, grouped by day; use the search box or the "Thao tác khác" menu to rename or delete.

## Tin nhắn riêng và Nhóm
Mục **Tin nhắn & Nhóm** ở thanh bên: tìm một người ở ô tìm để nhắn riêng, hoặc bấm **Nhóm mới** (**Tạo nhóm**, đặt **Tên nhóm**, chọn **Thành viên**, tối đa 50 người). Chủ nhóm có thể **Thêm người**, **Đổi tên nhóm**, **Chuyển quyền chủ nhóm**, **Xoá nhóm**; thành viên có thể **Rời nhóm**.

EN: "Tin nhắn & Nhóm" holds direct messages and groups ("Nhóm mới" creates one).

## Chuyển sang ứng dụng khác (Ứng dụng)
Bấm **Ứng dụng** (bộ chuyển ứng dụng ở thanh bên) để mở **Sổ Hợp Tác** (hợp đồng, đối tác, thanh toán, chữ ký số) hoặc **Quản trị** (dành cho quản trị viên). Chỉ hiện những ứng dụng công ty bạn được dùng. Từ Sổ Hợp Tác, bộ chuyển **Ứng dụng** cũng đưa bạn về **AI System**.

EN: Use "Ứng dụng" to switch between AI System, Sổ Hợp Tác and Quản trị (admins only).

## Cài đặt, ngôn ngữ, giao diện
Bấm **Cài đặt** (thanh bên): đổi **Ngôn ngữ** (Tiếng Việt / English), **Giao diện** (Sáng / Tối / Theo hệ thống) và **Đăng xuất**. Quản trị công ty không xem được nội dung hội thoại của bạn, chỉ xem mức sử dụng.

EN: "Cài đặt" changes language and theme and logs you out.

## Khi gặp lỗi hoặc hết hạn mức
- "Hệ thống đang quá tải" hoặc "Dịch vụ AI đang gặp sự cố": bấm **Thử lại** sau ít phút; nếu vẫn lỗi bấm **Báo admin**.
- "Công ty bạn đã dùng vượt hạn mức tháng này": vẫn dùng bình thường, quản trị xem ở Chi phí & quota.
- "Bạn chưa có quyền dùng agent mặc định của công ty": gõ @ chọn agent bạn được cấp, hoặc liên hệ quản trị viên.

EN: Use "Thử lại" / "Báo admin" on errors; over-quota does not block you.
