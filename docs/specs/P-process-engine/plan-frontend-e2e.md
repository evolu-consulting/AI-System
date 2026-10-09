# P · Phụ lục plan-frontend: role/nhãn và ca e2e

Thuộc [`plan-frontend.md`](plan-frontend.md). Nhãn VI (e2e đặt `ai.locale=vi`); câu chữ đầy đủ ở [`plan-frontend-i18n.md`](plan-frontend-i18n.md). Frontend-lead giữ đúng các nhãn này khi code; nhãn X2a/X2b/C1 dùng lại không đổi. Chọn bằng role + tên; `data-testid` chỉ khi ghi dưới đây. Nút Đạt/Chưa đạt dùng `exact: true` (tên "Chưa đạt" chứa "đạt").

## 1. Role + nhãn — chat-web
| Vùng | Phần tử | Role + tên |
|---|---|---|
| Composer | nút mở menu | `button "Quy trình"` (`aria-haspopup="listbox"`, `aria-expanded`); chỉ khi engine bật và ở composer phòng / Hỏi AI chính (không ở khung thread) |
| | menu | `listbox "Quy trình"`; tiêu đề chữ "Quy trình bạn được chạy · gõ tiếp để lọc"; `option` tên chứa tên quy trình, `!key`, "n giai đoạn" |
| | trạng thái | "Đang tải quy trình…", "Chưa có quy trình nào bạn được chạy", "Không có quy trình khớp “!q”", "Không tải được danh sách quy trình" + `button "Thử lại"` |
| | lỗi gửi | `alert` "Không tìm thấy quy trình “!key”." + gợi ý `button "!<key>"` sau "Ý bạn là:" (≤ 3); `alert` "Công ty đang chạy tối đa 5 quy trình cùng lúc. Thử lại sau n giây." (Gửi khoá); `alert` "Quy trình chưa nhận tệp đính kèm…" |
| Thẻ run (phòng) | thẻ | `article "Quy trình <tên>"` (dưới tin gọi), `data-run-id`; dòng trạng thái là văn bản (bảng §6 plan-frontend) |
| | nút | `button "Xem tiến độ"` · `button "Kiểm ngay"` · `button "Trả lời"` · `button "Quyết định"` · `button "Xem kết quả"` / `"Xem chi tiết"` |
| Hỏi AI | thẻ run | `article "Quy trình <tên>"` trong `region "Quy trình trong hội thoại này"` phía trên khung nhập; toast "Đã bắt đầu quy trình <tên>" + `button "Mở"` |
| Pane | khung | ≥ 640: `complementary "Quy trình đang mở"`; < 640: `dialog "Quy trình đang mở"`; `button "Đóng"`; URL `?run=<id>` |
| | kết quả | `article "Kết quả <tệp> v<n>"`; `tablist "Phiên bản"` + `tab "v1"`, `tab "v2"`; cảnh báo chữ "Thiếu mục bắt buộc: …" |
| | lịch sử | `button "Lịch sử (n)"` (`aria-expanded`) |
| Kiểm | vùng | `region "Kiểm <giai đoạn>"` |
| | nút | `button "Đạt"` · `button "Chưa đạt"` (người không thuộc Group duyệt: **không có** hai nút); sau "Chưa đạt": `textbox "Góp ý cho <agent> (bắt buộc)"`, `button "Gửi góp ý · làm lại"` (disabled khi trống), `button "Huỷ"` |
| | đã đóng | chữ "Đã có người khác quyết" hoặc "<tên> · Đạt · <giờ>"; không còn nút |
| Quyết | vùng | `region "Cần người quyết"` + lý do (chữ §3 i18n); `button "Thêm 1 lần làm lại"`, `button "Dùng bản hiện có"`, `button "Huỷ lượt chạy"` (+ `alertdialog` "Huỷ lượt chạy này?" `button "Xác nhận huỷ"`), `textbox "Ghi chú (tuỳ chọn)"`; người không quyết: chữ "Đang chờ <tên> hoặc quản trị viên quyết định" |
| | huỷ lượt | `button "Huỷ lượt chạy"` ở tiêu đề pane/trang (chỉ `can_cancel`, ẩn khi đang Cần người quyết) |
| Hỏi lại | vùng | `region "<agent> cần thêm thông tin · lần hỏi n/3"`; chip = `button "<lựa chọn>"`; `textbox "Câu trả lời"`, `button "Gửi trả lời"` |
| | nhờ người khác | `button "Nhờ người khác trả lời"` → `dialog "Nhờ ai trả lời?"`: `searchbox "Tìm người"`, `checkbox "<tên>"`, `textbox "Lời nhắn (tuỳ chọn)"`, `button "Nhờ trả lời"`, `button "Huỷ"`; lỗi `alert`; sau nhờ: chữ "Đã nhờ <tên> (chuyển k/3) …" |
| | khoá | `button "Nhờ người khác trả lời"` `aria-disabled="true"` khi đã chuyển 3 lần; đã đóng: chữ "<tên> đã trả lời · <giờ>" |
| Người được nhờ | thấy | chữ "<A> nhờ bạn trả lời", lời nhắn, "Ngữ cảnh kèm theo", câu hỏi; **không** có tin phòng |
| Sidebar | mục | `button "Chờ tôi kiểm"` (trigger `SidebarGroup`, `aria-expanded`) + huy hiệu `data-testid="process-todo-badge"`; mỗi việc `link "<giai đoạn> · <quy trình>"`; rỗng: chữ "Không có việc nào chờ bạn" |
| | DM | `link "Quy trình"` đầu nhóm Users + huy hiệu `data-testid="process-dm-badge"` (chưa đọc) |
| DM `/process-inbox` | trang | `heading "Quy trình"`, `log "Thông báo quy trình"`, chữ "Đây là kênh thông báo của quy trình, không nhắn trả lời được…"; **không** có `textbox` trong vùng main; thẻ thông báo `article` tên theo `kind` ("Cần bạn kiểm: <quy trình> · <giai đoạn>"), chứa `region "Kiểm …"` với `button "Đạt"`/`"Chưa đạt"` |
| `/runs/$id` | trang | `heading "<tên quy trình>"`; `tablist` có `tab "Tiến độ"`, `tab "Token"`, `tab "Nhật ký"` (người ngoài phòng: không có `tab "Nhật ký"`); `link "Quay lại <phòng>"` chỉ khi thấy phòng; người ngoài phòng: banner chữ "Bạn không ở phòng này…"; không đường tới tin phòng; không thấy ⇒ `NotFoundState` "Không tìm thấy" |
| Token | bảng | `table "Token theo giai đoạn"` (cột Giai đoạn · Lần chạy · Hỏi lại · Lượt gọi · Vào · Ra · Cache · Tổng); `button "Xem lượt gọi giai đoạn <tên>"` (`aria-expanded`) → `table "Lượt gọi giai đoạn <tên>"`; hàng tổng khớp KPI "Tổng token"; người xem `task`: chữ "Bạn chỉ xem tổng theo giai đoạn." và **không** có nút mở rộng |

## 2. Role + nhãn — admin-web
| Vùng | Phần tử | Role + tên |
|---|---|---|
| Nav | mục | `link "Quy trình"` trong nhóm CHỨC NĂNG, cả `tenant_admin` và `platform_admin`; không có khi engine tắt / `member` |
| Danh sách | tab | `tab "Của công ty"`, `tab "Mẫu"` |
| | bảng | `table "Quy trình"` (cột Quy trình · Ký hiệu · Giai đoạn · Lượt đang chạy · Cập nhật · Bật); `switch "Bật <tên>"` |
| | nút | `link "Tạo quy trình"`, `button "Chép mẫu"` (tab Mẫu), `button "Chạy"` → `dialog "Chạy quy trình <tên>"` có `textbox "Nội dung đầu vào"` + `button "Chạy"`; menu dòng: `Sửa`, `Xoá` (gõ tên) |
| Editor | thông tin | `textbox "Tên quy trình"`, `textbox "Ký hiệu chạy"`, `textbox "Mô tả"`, `textbox "Gợi ý nhập"`, `combobox "Group được chạy (để trống = cả công ty)"`, `switch "Bật"` |
| | giai đoạn | `button "Thêm giai đoạn"`; mỗi giai đoạn `region "Giai đoạn n: <tên>"` (accordion): `textbox "Tên giai đoạn"`, `combobox "Làm bởi"`, `textbox "Hướng dẫn"`, `textbox "Tên tệp kết quả"`, `textbox "Mẫu kết quả"`, `textbox "Mục bắt buộc"`, `combobox "Sau giai đoạn"`, `combobox "Nhóm kiểm"`, `switch "Hành động thật"` (disabled + tooltip khi chưa đủ điều kiện), `combobox "Người trả lời"`, `spinbutton "Hạn giai đoạn (giây)"`, `button "Lên"`, `button "Xuống"`, `button "Xoá giai đoạn"` |
| | lưu | `button "Lưu"` (EditorSaveBar), `ConflictDialog` chung; mẫu + `tenant_admin`: chữ "Đây là quy trình mẫu, chỉ xem…" + `button "Chép mẫu"` |
| Run | tab | `tab "Tiến độ"`, `tab "Token"`, `tab "Nhật ký"`; Cần người quyết: `button "Thêm 1 lần làm lại"` / `"Dùng bản hiện có"` / `"Huỷ lượt chạy"`; `button "Xem kết quả"` → `dialog` |

## 3. Ca e2e đề xuất (qc viết; chia theo PF; Hub thật hoặc mock B2, LLM `fake-cli`; context: A người bắt đầu, B thành viên phòng thuộc Group duyệt, T người duyệt ngoài phòng, H người được nhờ, X thành viên không thuộc Group duyệt, Adm `tenant_admin`)
| Ca | AC | PF | Bước chính |
|---|---|---|---|
| E-P1 | 51 | PF1 | A gõ `!` ở phòng → `listbox "Quy trình"` chỉ quy trình A được chạy; gõ `!hoa` lọc; Enter ⇒ ô = "!hoa-don "; `@` vẫn mở `listbox "Agent"`; `/` vẫn là chữ; engine tắt ⇒ không nút "Quy trình", `!` là chữ |
| E-P2 | 51, 52 | PF1 | nút "Quy trình" mở menu như gõ `!`; `!sai-key abc` ⇒ `alert` "Không tìm thấy quy trình “!sai-key”.", chữ giữ, phòng không thêm tin/thẻ |
| E-P3 | 52 | PF1 | A gửi "!sdlc …" ⇒ mọi thành viên thấy `article "Quy trình …"` dưới tin gọi, trạng thái đổi qua sự kiện (không reload); không có thread, không tin hệ thống trong phòng |
| E-P4 | 53 | PF1 | B (thành viên trong phòng, thuộc Group duyệt) mở pane `?run=` ⇒ thấy output + `Đạt`/`Chưa đạt`; "Chưa đạt" thiếu góp ý ⇒ Gửi disabled; gửi ⇒ stage làm lại, thẻ "Đang chạy"; X thấy output **không** thấy nút |
| E-P5 | 53 | PF1 | hai người cùng Đạt: người đến sau ⇒ "Đã có người khác quyết"; nút biến mất |
| E-P6 | 52 | PF1 | Hỏi AI: A gõ `!hoa-don …` ở `/c/new` ⇒ `/runs/<id>`; ở `/c/<id>` ⇒ thẻ trên khung nhập + toast; có tệp đính kèm ⇒ `alert` chặn |
| E-P7 | (BR-26) | PF1 | stage chạm giới hạn làm lại ⇒ `region "Cần người quyết"` cho A và Adm (không cho B); chọn "Thêm 1 lần làm lại" ⇒ chạy lại; "Huỷ lượt chạy" ⇒ Đã huỷ; 429 `TOO_MANY_PROCESS_RUNS` ⇒ `alert` đếm ngược |
| E-P8 | 57 | PF2 | agent hỏi lại ⇒ A thấy `region "… cần thêm thông tin"` + chip; bấm chip gửi ngay; hỏi gộp nhiều câu ⇒ chip chèn vào ô, không gửi |
| E-P9 | 57 | PF2 | A "Nhờ người khác trả lời" chọn H + lời nhắn ⇒ A thấy "Đã nhờ H (chuyển 1/3)…"; H nhận thông báo, chỉ thấy câu hỏi + lời nhắn + ngữ cảnh; H trả lời ⇒ A thấy "H đã trả lời", ô khoá; A gửi sau ⇒ "Đã có người trả lời" |
| E-P10 | 57 | PF2 | chuyển lần 4 ⇒ nút khoá `aria-disabled` + tooltip; đích sai ⇒ `alert` lỗi; chuyển người kiểm ngoài Group ⇒ "Chỉ chuyển được cho người cùng nhóm kiểm" |
| E-P11 | 54 | PF3 | T có việc ⇒ `button "Chờ tôi kiểm"` huy hiệu = n, mục link tới `/runs/<id>?task=`; B quyết xong ⇒ mục của T **biến mất** không reload |
| E-P12 | 55 | PF3 | T không ở phòng: `link "Quy trình"` có huy hiệu; trang có thẻ duyệt với `Đạt`/`Chưa đạt`; không `textbox`; T bấm Đạt ⇒ thẻ thành "Bạn · Đạt"; đọc ⇒ huy hiệu về 0 |
| E-P13 | 56 | PF3 | T mở `/runs/<id>`: chỉ output của việc mình + tiến độ + banner; không `tab "Nhật ký"`; tab Token bản `summary`; T gõ `/rooms/<id>` ⇒ "Không tìm thấy"; người lạ mở `/runs/<id>` ⇒ "Không tìm thấy" |
| E-P14 | 58 | PF4 | A/B/thành viên phòng mở `?tab=token` ⇒ bảng khớp Σ (so với `GET /usage`); mở rộng giai đoạn nhóm ⇒ lượt gọi từng thành viên + model + thời gian; số làm lại / hỏi lại hiện |
| E-P15 | ADM-65–67 | PF4 | Adm: nav "Quy trình"; tab Mẫu ⇒ "Chép mẫu" ⇒ quy trình tắt (thiếu Group kiểm); bật ⇒ lỗi chọn Group; chọn Group ⇒ bật; "Chạy" ⇒ lượt chạy; 409 `VERSION_CONFLICT` ⇒ ConflictDialog; mẫu chỉ xem với `tenant_admin`; run page có Token |
| E-P16 | (cờ) | F6 | cờ `off`: không nav/menu/sidebar/DM; `/runs/x` và `/processes` ⇒ "Không tìm thấy"; test khoá cũ xanh |
