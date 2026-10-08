# X2b · Phụ lục plan-frontend: role/nhãn và ca e2e

Nhãn VI (locale mặc định e2e). Frontend-lead giữ đúng khi code; nhãn X2a/C1 dùng lại không đổi.

## 1. Role + nhãn
| Vùng | Phần tử | Role + tên |
|---|---|---|
| Composer phòng | ô nhập | `textbox "Tin nhắn cho nhóm"` / `textbox "Tin nhắn cho <tên>"` (X2a); placeholder "Nhắn cho nhóm… gõ @ để hỏi agent" |
| | gửi | `button "Gửi"` (C1) |
| | lỗi gửi | `alert` chứa "Không tìm thấy agent @<tag>." / "Bạn đang có quá nhiều câu trả lời đang chạy…"; gợi ý `button "@<key>"` sau "Ý bạn là:" |
| | đính kèm (F5) | `button "Đính kèm tệp"`, `list "Tệp đính kèm"` (C1) |
| Menu `@` | danh sách | `listbox "Agent"`; tiêu đề chữ "Agent bạn dùng được"; mục `option` tên chứa "<tên agent>" và "@<key>" |
| | trạng thái | chữ "Đang tải agent…", "Bạn chưa được cấp agent nào", "Không có agent khớp “@q”", "Không tải được danh sách agent" + `button "Thử lại"` |
| Timeline | tin gọi | `article` tên "<tên> · <giờ>" / "Bạn · <giờ>" (X2a) |
| | khối chờ | `article "Trả lời của agent <tên>"` có `status` "<tên agent> đang xử lý…"; `data-run-id` |
| | dừng | người gửi lượt: `button "Dừng"`; người khác: không có nút, chữ "Chỉ <B> dừng được" |
| | khối xong | `article "Trả lời của agent <tên>"`, `data-flow-id`, chữ "<B> hỏi"/"Bạn hỏi", "Chạy bằng quyền của <B>" (B = người gửi lượt của khối); `button "Copy"` (C1) |
| | mở flow | `button "Trả lời tiếp"` (cùng `data-flow-reply`): bật khi `can_reply`; không quyền: `aria-disabled="true"` + chữ "Bạn chưa được cấp agent <tên> nên chưa trả lời tiếp được…" + `button "Xem flow"` |
| | chờ | người gửi lượt: `region "<agent> cần thêm thông tin"` hoặc "<agent> cần bạn xác nhận…" + `button "Đồng ý"`/`button "Huỷ"`; người khác (kể cả người gọi gốc khi lượt là của người khác): `article "Agent <tên> đang chờ xác nhận"` + "Đang chờ <B> xác nhận — chỉ người hỏi mới bấm được.", **không** `button "Đồng ý"` |
| | lỗi | chữ "Agent không trả lời được. Thử hỏi lại sau."; người gửi lượt: `button "Chạy lại"` |
| Khung flow | khung | ≥ 640: `complementary "Flow đang mở"`; < 640: `dialog "Flow đang mở"` (C1) |
| | đóng | `button "Đóng khung flow"`, < 640 thêm `button "Thu nhỏ flow"` (C1) |
| | ô nhập | `can_reply`: `textbox "Tin nhắn trong flow"` + `button "Gửi trong flow"` (mọi người có quyền); không quyền: không textbox, chữ "Bạn chưa được cấp agent <tên>…". Mỗi lượt ghi tên người gửi |
| Không có | panel/chip | không `complementary` nào khác ngoài khung flow; không phần tử liệt kê agent ngoài `listbox "Agent"` (AC13) |

## 2. Ca e2e đề xuất (qc viết; Hub thật + LLM mock, 3 context A/B/C: A, C có `hoadon`; B không)
| Ca | AC | Bước chính |
|---|---|---|
| E-A1 | AC13 | A gõ `@` → `listbox "Agent"` 2 option (hoadon, trello); B → 1 option; chọn → ô = "@hoadon "; không có panel/chip |
| E-A2 | AC13 | thu hồi `trello` của B (seed API) → B mở lại phòng, gõ `@` → không còn option |
| E-A3 | AC01, AC16 | A gửi "@hoadon kiểm tra" → A thấy stream + "Dừng"; B thấy "hoadon đang xử lý…" rồi khối kết quả, "Lan hỏi", huy hiệu B +1, A không +1 |
| E-A4 | AC02 | B gửi "@hoadon …" → `alert` "Không tìm thấy agent @hoadon.", ô vẫn giữ chữ, không có tin mới trong timeline A |
| E-A5 | AC05 | agent `need_input`: A thấy chip, bấm → tin trong flow; B thấy câu hỏi, không chip, "Đang chờ A trả lời agent." |
| E-A6 | AC06 | agent `side_effect`: A thấy "Đồng ý"/"Huỷ"; B chỉ thấy "Đang chờ A xác nhận…", DOM B không chứa mô tả hành động |
| E-A7 | AC15 | A bấm "Trả lời tiếp" → URL `?flow=`, `complementary "Flow đang mở"`, gửi trong flow; viewport 390px → `dialog` sheet; `/c/:id` C1 không đổi |
| E-A9 | AC17 | (Q7) A gọi `@hoadon`; C (có `hoadon`) bấm "Trả lời tiếp" → gửi trong flow → C thấy stream + `button "Dừng"`, A thấy "hoadon đang xử lý…" rồi khối "C hỏi" + "Chạy bằng quyền của C" (A thấy tên C, không "Bạn hỏi"); usage tính C (API); A không có nút Dừng của lượt C |
| E-A10 | AC17 | B (không có `hoadon`): khối có `button "Trả lời tiếp"` `aria-disabled` + chữ giải thích, `button "Xem flow"` mở khung chỉ đọc không `textbox`; gửi forge `flow_id` qua API → 404 `AGENT_NOT_FOUND` |
| E-A11 | AC17, AC06 | lượt của C dừng ở `side_effect`: C thấy "Đồng ý"/"Huỷ"; A và B chỉ thấy "Đang chờ C xác nhận…", DOM không có mô tả; A gửi `answer_run_id` của C qua API → 403 `NOT_RUN_CALLER` |
| E-A8 | AC08 | A đầy `max_concurrent_runs` → `alert` đếm ngược trong ô A, B gọi bình thường, B không thấy lỗi của A |
