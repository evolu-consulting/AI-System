# P · Phụ lục plan-frontend: role/nhãn và ca e2e

Thuộc [`plan-frontend.md`](plan-frontend.md); màn ④ thread: [`plan-frontend-thread.md`](plan-frontend-thread.md). Nhãn VI (e2e đặt `ai.locale=vi`); câu chữ đầy đủ ở [`plan-frontend-i18n.md`](plan-frontend-i18n.md). Frontend-lead giữ đúng các nhãn này khi code; nhãn X2a/X2b/C1 dùng lại không đổi. Chọn bằng role + tên; `data-testid` chỉ khi ghi dưới đây. Nút Đạt/Chưa đạt dùng `exact: true` (tên "Chưa đạt" chứa "đạt").

## 1. Role + nhãn — chat-web
| Vùng | Phần tử | Role + tên |
|---|---|---|
| Composer | nút mở menu | `button "Quy trình"` (`aria-haspopup="listbox"`, `aria-expanded`); chỉ khi engine bật và ở composer phòng / Hỏi AI chính (không ở khung thread) |
| | menu | `listbox "Quy trình"`; tiêu đề chữ "Quy trình bạn được chạy · gõ tiếp để lọc"; `option` tên chứa tên quy trình, `!key`, "n giai đoạn" |
| | trạng thái | "Đang tải quy trình…", "Chưa có quy trình nào bạn được chạy", "Không có quy trình khớp “!q”", "Không tải được danh sách quy trình" + `button "Thử lại"` |
| | lỗi gửi | `alert` "Không tìm thấy quy trình “!key”." + gợi ý `button "!<key>"` sau "Ý bạn là:" (≤ 3); `alert` "Công ty đang chạy tối đa 5 quy trình cùng lúc. Thử lại sau n giây." (Gửi khoá); `alert` "Quy trình chưa nhận tệp đính kèm…" |
| Khối quy trình (timeline phòng) | khối | `article "Quy trình <tên>"` (`data-flow-id`, `data-run-id`) ngay sau tin gọi (hoặc đứng một mình khi bắt đầu bằng nút "▶ Quy trình"); tên quy trình + `!key`, "<A> khởi chạy"/"Bạn khởi chạy", badge trạng thái, dòng trạng thái (plan-frontend §6), thanh giai đoạn |
| | nút | assignee: `button "Kiểm ngay"` · `"Trả lời"` · `"Quyết định"` (chỉ **mở** thread, không phải nút thao tác); mọi người: `button "Trả lời tiếp"` (X2b) + "n tin trong flow"; **không** có `Đạt`/`Chưa đạt`/chip ở timeline; người khác: `status` "Đang chờ <tên> kiểm — chỉ người kiểm mới bấm được." |
| | bình luận mới | vùng `FlowRecent` X2b (≤ 3 dòng, gồm tin của quy trình, tên người gửi = tên quy trình) |
| Thread (pane) | khung | ≥ 640: `complementary "Flow đang mở"`; < 640: `dialog "Flow đang mở"` (X2b); `heading` "<tên> · !<key>"; `log "Tin nhắn trong flow"`; URL `?flow=<id>`; không còn `?run=` |
| | thanh trạng thái | badge + thanh giai đoạn (tên) + "Làm lại a/3" + `button "Huỷ lượt chạy"` (chỉ `can_cancel`, ẩn khi Cần người quyết) + link "Mở trang lượt chạy" |
| | kết quả (`output`) | `article "Kết quả <giai đoạn> v<n>"`; `button "Chi tiết n bước"` (`aria-expanded`) → danh sách bước; `button "Xem nội dung"`/`"Thu gọn"`; `tablist "Phiên bản"` + `tab "v1"`, `tab "v2"`; cảnh báo "Thiếu mục bắt buộc: …" |
| | hỏi/quyết/xong | `region "<agent> cần thêm thông tin · lần hỏi n/3"`; `region "Cần người quyết"`; `article "<người> · Đạt` hoặc `Chưa đạt · <giờ>"` (`task_result`; chứa góp ý/câu trả lời, huy hiệu "ngoài phòng"); dòng "↪ <A> đã chuyển việc cho <B> (lần k/3)"; dòng "Lượt chạy hoàn tất"/"<A> đã huỷ lượt chạy"/… + link "Mở trang lượt chạy" |
| Kiểm (trong thread) | vùng | `region "Kiểm <giai đoạn>"` dưới tin `output` đang chờ; chỉ assignee; người khác: `status` "Đang chờ … kiểm" |
| | nút | `button "Đạt"` · `button "Chưa đạt"` (`exact: true`). Sau "Chưa đạt": composer đổi — `textbox "Góp ý cho <agent> (bắt buộc)"` (focus), `button "Gửi góp ý · làm lại"` (disabled khi trống), `button "Huỷ"`; dải "Chưa đạt · góp ý cho <agent>" |
| | đã đóng | thẻ biến mất; tin kế tiếp `article "<tên> · Đạt · <giờ>"`; gửi muộn ⇒ chữ "Đã có người khác quyết" |
| Quyết | vùng | `region "Cần người quyết"` + lý do; `button "Thêm 1 lần làm lại"`, `button "Dùng bản hiện có"` (disabled khi chưa có bản), `button "Huỷ lượt chạy"` (+ `alertdialog "Huỷ lượt chạy này?"` `button "Xác nhận huỷ"`), `textbox "Ghi chú (tuỳ chọn)"`; người không quyết: `status` "Đang chờ <tên> hoặc quản trị viên quyết định" |
| Composer thread | thường | `textbox "Tin nhắn trong flow"` + `button "Gửi"`; gợi ý "Đây là trao đổi giữa người với người…"; **không** menu `@`/`!`; `@agent …` ⇒ `alert` "Trong luồng quy trình không gọi được agent bằng @…", chữ giữ; `!abc` ⇒ gửi như chữ thường (không tạo run) |
| Hỏi AI | thẻ run | `article "Quy trình <tên>"` trong `region "Quy trình trong hội thoại này"` phía trên khung nhập; toast "Đã bắt đầu quy trình <tên>" + `button "Mở"`; nút `Xem tiến độ` · `Kiểm ngay` · `Trả lời` · `Quyết định` · `Xem kết quả` → `/runs/<id>` |
| Hỏi lại (thread) | vùng | `region "<agent> cần thêm thông tin · lần hỏi n/3"` (assignee: chip = `button "<lựa chọn>"`, `button "Trả lời bằng văn bản"`, `button "Nhờ người khác trả lời"`); người khác: chỉ câu hỏi + `status` "Đang chờ <tên> trả lời" |
| | trả lời gõ | sau `Trả lời bằng văn bản`: composer `textbox "Câu trả lời"`, `button "Gửi trả lời"`, `button "Huỷ"`; chip đơn câu gửi ngay; chip gộp điền vào `textbox "Câu trả lời"` |
| Hỏi lại (inline `/runs/$id`, DM) | vùng | như thread nhưng thẻ có sẵn `textbox "Câu trả lời"` + `button "Gửi trả lời"` |
| | nhờ người khác | `button "Nhờ người khác trả lời"` → `dialog "Nhờ ai trả lời?"`: `searchbox "Tìm người"`, `checkbox "<tên>"`, `textbox "Lời nhắn (tuỳ chọn)"`, `button "Nhờ trả lời"`, `button "Huỷ"`; lỗi `alert`; sau nhờ: dòng "↪ <A> đã nhờ <B> trả lời (chuyển k/3)" |
| | khoá | `button "Nhờ người khác trả lời"` `aria-disabled="true"` khi đã chuyển 3 lần; đã đóng: tin `task_result` `article "<tên> · Đã trả lời · <giờ>"` |
| Người được nhờ | thấy | chữ "<A> nhờ bạn trả lời", lời nhắn, "Ngữ cảnh kèm theo", câu hỏi; **không** có tin phòng |
| Sidebar | mục | `button "Chờ tôi kiểm"` (trigger `SidebarGroup`, `aria-expanded`) + huy hiệu `data-testid="process-todo-badge"`; mỗi việc `link "<giai đoạn> · <quy trình>"`; rỗng: chữ "Không có việc nào chờ bạn" |
| | DM | `link "Quy trình"` đầu nhóm Users + huy hiệu `data-testid="process-dm-badge"` (chưa đọc) |
| DM `/process-inbox` | trang | `heading "Quy trình"`, `log "Thông báo quy trình"`, chữ "Đây là kênh thông báo của quy trình, không nhắn trả lời được…"; **không** có `textbox` trong vùng main; thẻ thông báo `article` tên theo `kind` ("Cần bạn kiểm: <quy trình> · <giai đoạn>"), chứa `region "Kiểm …"` với `button "Đạt"`/`"Chưa đạt"` |
| `/runs/$id` | trang | `heading "<tên quy trình>"`; `button "Huỷ lượt chạy"` (chỉ `can_cancel`); `link "Mở luồng trong phòng"` (khi `thread`≠null); `tablist` có `tab "Tiến độ"`, `tab "Token"`, `tab "Nhật ký"` (người ngoài phòng: không có `tab "Nhật ký"`); `link "Quay lại <phòng>"` chỉ khi thấy phòng; người ngoài phòng: banner chữ "Bạn không ở phòng này…"; không đường tới tin phòng; không thấy ⇒ `NotFoundState` "Không tìm thấy" |
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
| E-P3 | 52 | PF1 | A gửi "!sdlc …" ⇒ mọi thành viên thấy tin gọi + `article "Quy trình …"` ngay dưới (cùng `data-flow-id`); trạng thái/đếm tin đổi qua sự kiện (không reload); "Trả lời tiếp" mở `?flow=` thấy khối + `Kết quả … v1` khi giai đoạn xong; nút "▶ Quy trình" ⇒ khối không có tin gọi |
| E-P4 | 53 | PF1 | B (thành viên phòng, thuộc Group duyệt) thấy `Kiểm ngay` ở khối, mở thread ⇒ `Kết quả … v1` + `region "Kiểm …"` `Đạt`/`Chưa đạt`; "Chưa đạt" ⇒ composer chế độ Góp ý, Gửi disabled khi trống; gửi ⇒ tin `article "B · Chưa đạt · …"` chứa góp ý, khối "Đang chạy", sau đó `Kết quả … v2`; X (không thuộc Group) thấy `Kết quả` + "Đang chờ B kiểm…" **không** có nút; timeline không có `Đạt` |
| E-P5 | 53 | PF1 | hai người cùng mở thẻ kiểm, B Đạt trước: thẻ của người sau biến mất qua sự kiện, gửi muộn ⇒ "Đã có người khác quyết"; thread có tin `B · Đạt` |
| E-P6 | 52 | PF1 | Hỏi AI: A gõ `!hoa-don …` ở `/c/new` ⇒ `/runs/<id>`; ở `/c/<id>` ⇒ thẻ trên khung nhập + toast; có tệp đính kèm ⇒ `alert` chặn |
| E-P7 | (BR-26) | PF1 | stage chạm giới hạn làm lại ⇒ `region "Cần người quyết"` cho A và Adm (không cho B, B thấy "Đang chờ … quyết định"); chọn "Thêm 1 lần làm lại" ⇒ chạy lại; "Huỷ lượt chạy" ⇒ tin `run_end` "A đã huỷ lượt chạy"; 429 `TOO_MANY_PROCESS_RUNS` ⇒ `alert` đếm ngược |
| E-P8 | 57 | PF2 | agent hỏi lại ⇒ thread có `region "… cần thêm thông tin"`; A thấy chip, X (không assignee, như test-plan-e2e) chỉ thấy câu hỏi + "Đang chờ A trả lời"; chip đơn câu gửi ngay ⇒ `article "Bạn · Đã trả lời · …"` (người khác thấy "A · Đã trả lời · …"); hỏi gộp nhiều câu ⇒ chip điền vào `textbox "Câu trả lời"`, không gửi; `Trả lời bằng văn bản` + `Gửi trả lời` ⇒ cùng kết quả |
| E-P9 | 57 | PF2 | A "Nhờ người khác trả lời" chọn H + lời nhắn ⇒ thread có dòng "↪ A đã nhờ H trả lời (chuyển 1/3)" (`forward.task_kind=ask`; review/decision ⇒ "↪ A đã chuyển việc cho H (lần k/3)") **không** có lời nhắn; H nhận thông báo, chỉ thấy câu hỏi + lời nhắn + ngữ cảnh (H không ở phòng: `GET /rooms/R/messages` 404); H trả lời ⇒ thread có `article "H · Đã trả lời · …"` (huy hiệu "ngoài phòng"), thẻ của A biến mất; A gửi sau ⇒ "Đã có người trả lời" |
| E-P10 | 57 | PF2 | chuyển lần 4 ⇒ nút khoá `aria-disabled` + tooltip; đích sai ⇒ `alert` lỗi; chuyển người kiểm ngoài Group ⇒ "Chỉ chuyển được cho người cùng nhóm kiểm" |
| E-P11 | 54 | PF3 | T có việc ⇒ `button "Chờ tôi kiểm"` huy hiệu = n, mục link tới `/runs/<id>?task=`; B quyết xong ⇒ mục của T **biến mất** không reload |
| E-P12 | 55 | PF3 ⇢PF1 (`ReviewTaskCard`) | T không ở phòng: `link "Quy trình"` có huy hiệu; trang có thẻ duyệt với `Đạt`/`Chưa đạt`; không `textbox`; T bấm Đạt ⇒ thẻ thành "Bạn · Đạt"; đọc ⇒ huy hiệu về 0; thành viên phòng thấy trong thread tin "T · Đạt" + huy hiệu "ngoài phòng" |
| E-P13 | 56 | PF3 | T mở `/runs/<id>`: chỉ output của việc mình + tiến độ + banner; không `tab "Nhật ký"`; tab Token có mặt (nội dung → E-P14b); T gõ `/rooms/<id>` ⇒ "Không tìm thấy"; người lạ mở `/runs/<id>` ⇒ "Không tìm thấy" |
| E-P14 | 58 | PF4 | A/B/thành viên phòng mở `?tab=token` ⇒ bảng khớp Σ (so với `GET /usage`); mở rộng giai đoạn nhóm ⇒ lượt gọi từng thành viên + model + thời gian; số làm lại / hỏi lại hiện |
| E-P15 | ADM-65–67 | PF4 | Adm: nav "Quy trình"; tab Mẫu ⇒ "Chép mẫu" ⇒ quy trình tắt (thiếu Group kiểm); bật ⇒ lỗi chọn Group; chọn Group ⇒ bật; "Chạy" ⇒ lượt chạy; 409 `VERSION_CONFLICT` ⇒ ConflictDialog; mẫu chỉ xem với `tenant_admin`; run page có Token |
| E-P16 | (cờ) | F6 | cờ `off`: không nav/menu/sidebar/DM; `/runs/x` và `/process-inbox` ⇒ "Không tìm thấy"; test khoá cũ xanh |
| E-P17 | 52, BR-25 | PF1 | thread: `@agent hi` ở composer thread ⇒ `alert` PROCESS_THREAD_NO_AGENT, chữ giữ, không tin; chữ thường ⇒ tin người↔người, 0 run; `!hoa-don x` trong thread ⇒ tin chữ, **không** tạo run |
| E-P18 | AC-H29 | PF3 ⇢PF1 | (số của qc: test-plan-e2e) T ngoài phòng bấm `Đạt` ở `/runs/<id>?task=` ⇒ B (đang mở thread) thấy `article "T · Đạt · …"` + "ngoài phòng"; T không có link tới phòng/thread |
| E-P19 | 52 | PF1 | chưa đọc: tin quy trình mới ⇒ `FlowRecent` highlight + "Chưa xem"; mở thread ⇒ hết; tin quy trình không tính là "của mình" kể cả A khởi chạy; xem trước phòng ở sidebar hiện "<tên quy trình>: …" |
| E-P20 | 52, U5 | PF1 | X (thành viên, không assignee) mở thread: thấy mọi loại tin + "Đang chờ …", không nút; X rời phòng ⇒ thread 404 → bỏ `?flow`; < 640 px thread là `dialog "Flow đang mở"`. Cùng ca với A (người bắt đầu) rời phòng: thread 404, nhưng `/runs/<id>` và `link "Quy trình"` vẫn mở được dạng ngoài phòng (banner "Bạn không ở phòng này…", không `tab "Nhật ký"`, không link phòng) |
