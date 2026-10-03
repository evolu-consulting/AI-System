# Use case Chat App — mốc C1

`v0.1 · draft · 2026-10-03` · Nguồn: CR-018…022 · UI: `ui-chat-extension.md` · canvas: `canvas/` · Hub: `agent-hub/ba-agent-hub.md` §9.

C1 chạy với **mock Hub** (chưa có Hub/Claude CLI thật). Actor chung: **Member** (user cuối của một tenant). "Consultant" là tên hiển thị duy nhất của mọi câu trả lời (CR-022).

**Ngoài phạm vi C1:** menu `/` và command, đính kèm file, Extension, Knowledge base (CR-024), chat nhóm / agent↔agent (CR-023), Orchestrator và Claude CLI thật, schema `hub` thật, Worker.

## Mục lục

| UC | Tên | AC | Artboard |
|---|---|---|---|
| UC-01 | Đăng nhập, tự refresh, đăng xuất | CHAT-AC-01…04 | (dùng token Login Admin) |
| UC-02 | Hỏi điều mới → flow mới, trả lời hiện dần | CHAT-AC-05…07 | Main |
| UC-03 | Thấy các bước | CHAT-AC-08…09 | States, Main |
| UC-04 | Dừng run | CHAT-AC-10…11 | States |
| UC-05 | Consultant hỏi lại | CHAT-AC-12…13 | States |
| UC-06 | Trả lời tiếp trong flow | CHAT-AC-14…17 | FlowOpen, Mobile, States |
| UC-07 | Quản lý hội thoại | CHAT-AC-18…23 | Welcome, Main |
| UC-08 | Lỗi và kết nối | CHAT-AC-24…30 | States |

---

## UC-01 Đăng nhập, tự refresh, đăng xuất
**Actor:** Member · **Hub (C1):** mock đăng nhập nằm trong mock Hub, **không gọi Admin**; contract giữ đúng dạng `Admin POST /auth/login|refresh|logout` (`packages/contracts/src/auth.ts`) để sau đổi sang Admin thật không sửa Chat.

| Mục | Nội dung |
|---|---|
| Điều kiện trước | Có tenant/user mẫu trong mock (mã công ty, username, mật khẩu) |
| Luồng chính | 1. Nhập mã công ty + username + mật khẩu → 2. Mock trả access token (JWT) + cookie refresh → 3. Vào `/c/new` |
| Phụ / lỗi | Sai thông tin: câu lỗi chung, không tiết lộ trường nào sai. Access token hết hạn khi đang dùng: Chat tự refresh một lần rồi gọi lại. Refresh thất bại: về `/login` kèm "Phiên đã hết hạn". Tài khoản/công ty bị khoá: modal "Tài khoản đang bị khoá. Liên hệ quản trị viên công ty" |

| AC | Given / When / Then |
|---|---|
| CHAT-AC-01 | Given user mẫu hợp lệ, When nhập đúng mã công ty + username + mật khẩu, Then vào `/c/new` và lời chào có tên user |
| CHAT-AC-02 | Given mật khẩu sai, When gửi form, Then ở lại `/login`, hiện câu lỗi chung và không có token nào được lưu |
| CHAT-AC-03 | Given access token đã hết hạn, When Chat gọi Hub nhận `AUTH_EXPIRED`, Then Chat refresh đúng một lần, gọi lại thành công, user không thấy gián đoạn |
| CHAT-AC-04 | Given đã đăng nhập, When bấm Đăng xuất, Then gọi logout, xoá phiên, về `/login`; quay lại `/c/new` thì bị đẩy về `/login` |

## UC-02 Hỏi điều mới → flow mới, trả lời hiện dần
**Actor:** Member.

| Mục | Nội dung |
|---|---|
| Điều kiện trước | Đã đăng nhập; đang ở `/c/new` hoặc `/c/:id`; ô chính có chữ mờ "Hỏi điều mới…" |
| Luồng chính | 1. Gõ câu hỏi, `Enter` (`Shift+Enter` xuống dòng) → 2. Chat gửi message **không** `flow_id` → Hub tạo flow mới + run → 3. Khối flow hiện câu hỏi; SSE `run.started` → các `step.*` → `delta` (markdown, con trỏ nhấp nháy) → `run.finished` → 4. Câu trả lời đầy đủ, có Copy / Trả lời tiếp |
| Phụ / lỗi | `/c/new`: Lần gửi đầu tạo hội thoại, tiêu đề = 40 ký tự đầu. Đang có run: gõ trước được nhưng không gửi được. User cuộn lên khi đang stream: không tự cuộn, hiện "↓ Tin mới". `run.started` mang `quota.state = over`: dòng nhắc xám trên composer, không chặn. Lỗi: xem UC-08 |

| AC | Given / When / Then |
|---|---|
| CHAT-AC-05 | Given hội thoại đã có 1 flow, When gửi câu mới ở ô chính, Then xuất hiện **khối flow thứ hai** (không nối vào flow cũ) và request không có `flow_id` |
| CHAT-AC-06 | Given kịch bản "trả lời thường", When gửi, Then chữ hiện dần theo `delta`, cuối cùng bằng đúng nội dung `run.finished`, tên hiển thị "Consultant" kèm icon EvoluConsulting |
| CHAT-AC-07 | Given đang stream, When user cuộn lên, Then không bị kéo xuống và hiện nút "↓ Tin mới"; bấm nút thì cuộn xuống cuối |

## UC-03 Thấy các bước
**Actor:** Member.

| Mục | Nội dung |
|---|---|
| Luồng chính | `step.started` → dòng có spinner + nhãn mô tả việc ("Đang viết email", không tên agent); `step.finished` → ✓ kèm thời gian (2,1s). `run.finished` → thu gọn thành "✓ 2 bước · 7,8s", bấm để mở lại |
| Phụ / lỗi | Bước `failed`: ✕ và nhãn giữ nguyên. Không có bước nào: không hiện khối |

| AC | Given / When / Then |
|---|---|
| CHAT-AC-08 | Given kịch bản "có bước" (2 bước), When run đang chạy, Then mỗi bước hiện spinner rồi ✓ + thời gian, nhãn không chứa tên agent/provider |
| CHAT-AC-09 | Given run xong, Then khối bước tự thu gọn thành "✓ 2 bước · 7,8s"; bấm thì mở lại danh sách bước, bấm lần nữa thì thu gọn |

## UC-04 Dừng run
**Actor:** Member.

| Mục | Nội dung |
|---|---|
| Luồng chính | Run đang chạy: nút gửi thành ■ Dừng (hoặc `Esc`) → `POST /runs/:id/cancel` → `run.failed` code `CANCELLED` hoặc kết thúc tương đương → hiện "Đã dừng" (xám) + nút "Chạy lại" (gửi lại đúng yêu cầu đó, flow mới nếu là câu ở ô chính) |
| Phụ / lỗi | Run đã xong trước khi Hub nhận huỷ: bỏ qua, hiện kết quả bình thường. Phần chữ đã stream được giữ lại |

| AC | Given / When / Then |
|---|---|
| CHAT-AC-10 | Given run đang stream, When bấm Dừng hoặc nhấn `Esc`, Then gọi cancel đúng `run_id`, hiện "Đã dừng" và nút "Chạy lại", nút gửi trở lại bình thường |
| CHAT-AC-11 | Given đã "Đã dừng", When bấm "Chạy lại", Then gửi lại đúng nội dung câu hỏi và một run mới bắt đầu |

## UC-05 Consultant hỏi lại
**Actor:** Member.

| Mục | Nội dung |
|---|---|
| Luồng chính | SSE `ask {question, choices?}` → thẻ viền primary "Consultant cần thêm thông tin" + câu hỏi + quick-reply chip (nếu có `choices`). Bấm chip → gửi luôn câu đó làm tin kế tiếp **trong cùng flow**. Gõ tự do cũng được |
| Phụ / lỗi | Không có `choices`: chỉ thẻ câu hỏi. Sau khi trả lời, chip cũ vô hiệu hoá |

| AC | Given / When / Then |
|---|---|
| CHAT-AC-12 | Given kịch bản "hỏi lại" có 2 lựa chọn, When nhận `ask`, Then hiện thẻ hỏi + 2 chip |
| CHAT-AC-13 | Given thẻ hỏi lại, When bấm chip "Họp giao ban sáng nay", Then tin đó được gửi ngay (không cần Enter) với `flow_id` của flow hiện tại, và chip bị vô hiệu |

## UC-06 Trả lời tiếp trong flow
**Actor:** Member · Context của AI = **toàn bộ flow đó** (CR-021).

| Mục | Nội dung |
|---|---|
| Điều kiện trước | Flow đã có câu trả lời |
| Luồng chính | 1. Bấm "Trả lời tiếp" → khung flow bên phải mở (mặc định ẩn); điện thoại: sheet trượt từ dưới → 2. Gõ tin → gửi kèm `flow_id` → 3. Stream trả lời hiện trong khung, đồng bộ vào khối flow ở luồng chính → 4. Đóng khung bằng ✕ (không có "đóng flow") |
| Phụ / lỗi | Flow nghỉ lâu (Hub đã tắt CLI): tin đầu sau nghỉ hiện "Đang mở lại flow, lần đầu có thể mất vài giây…" cho tới `run.started`/`delta` đầu. Mở khung của flow khác thì thay nội dung khung. Đổi chủ đề hẳn: Orchestrator định tuyến mọi tin (kể cả tin trong flow, CR-025) nên có thể chọn agent khác; phía Chat không đổi gì |

| AC | Given / When / Then |
|---|---|
| CHAT-AC-14 | Given flow có câu trả lời, When bấm "Trả lời tiếp", Then khung phải mở, hiện lại câu hỏi/trả lời của flow đó và ô nhập focus |
| CHAT-AC-15 | Given khung flow mở, When gửi tin, Then request mang đúng `flow_id`, **không** tạo flow mới, và danh sách flow trong hội thoại vẫn đúng số lượng |
| CHAT-AC-16 | Given kịch bản "flow mở lại chậm", When gửi tin vào flow đã nghỉ, Then hiện "Đang mở lại flow, lần đầu có thể mất vài giây…" rồi biến mất khi stream bắt đầu |
| CHAT-AC-17 | Given viewport điện thoại (390px), When bấm "Trả lời tiếp", Then khung flow là sheet trượt từ dưới, đóng được bằng ✕ hoặc kéo xuống |

## UC-07 Quản lý hội thoại
**Actor:** Member · `GET/POST /conversations`, `PATCH/DELETE /conversations/:id`.

| Mục | Nội dung |
|---|---|
| Luồng chính | **Mới:** `Ctrl+Shift+O` hoặc nút "Hội thoại mới" → `/c/new` (lời chào theo tên + 4 thẻ gợi ý; bấm thẻ chỉ điền sẵn vào ô, không gửi). **Danh sách:** sidebar 260px nhóm Hôm nay / 7 ngày qua / 30 ngày qua / Cũ hơn. **Mở lại:** click mục → tải flow + message, skeleton 3 tin lúc chờ. **Đổi tên / Xoá** (xác nhận) qua `⋯`. **Tìm** theo tiêu đề (không phân biệt dấu) |
| Phụ / lỗi | Hội thoại đã xoá (hoặc của người khác): "Hội thoại không tồn tại" + nút về trang chào. Nháp đang gõ lưu theo hội thoại (localStorage), chuyển qua lại không mất. Xoá hội thoại đang mở: về `/c/new` |

| AC | Given / When / Then |
|---|---|
| CHAT-AC-18 | Given vào `/c/new`, Then thấy lời chào có tên user và 4 thẻ gợi ý; When bấm một thẻ, Then ô nhập chứa câu mẫu và **chưa** có request gửi đi |
| CHAT-AC-19 | Given mock có hội thoại ở các mốc thời gian khác nhau, Then sidebar nhóm đúng Hôm nay / 7 ngày / 30 ngày / Cũ hơn |
| CHAT-AC-20 | Given click một hội thoại cũ, Then tải đủ các khối flow theo thứ tự thời gian |
| CHAT-AC-21 | Given `⋯` › Đổi tên, When lưu tên mới, Then sidebar và tiêu đề cập nhật (PATCH) |
| CHAT-AC-22 | Given `⋯` › Xoá, When xác nhận, Then mục biến mất khỏi sidebar; When huỷ, Then còn nguyên |
| CHAT-AC-23 | Given gõ "hoa don" vào ô tìm, Then danh sách chỉ còn hội thoại có tiêu đề khớp (gồm "Hoá đơn…") |

## UC-08 Lỗi và kết nối
**Actor:** Member · lỗi từ `run.failed {code, message, hint}`; mã theo `ba-agent-hub.md` §9.3, câu chữ theo `ui-chat-extension.md` §8.

| Mã / tình huống | Hiển thị (thẻ đỏ trong khối flow) | Nút |
|---|---|---|
| `ALL_PROVIDERS_EXHAUSTED` | "Hệ thống đang quá tải" · "AI tạm hết lượt dùng. Hãy thử lại sau ít phút." | Thử lại · Báo admin |
| `TIMEOUT` | "Hệ thống xử lý quá lâu" | Thử lại |
| `UPSTREAM_ERROR` | "Dịch vụ AI đang gặp sự cố" | Thử lại |
| `CANCELLED` | "Đã dừng" (xám) | Chạy lại |
| Mất mạng khi stream | Banner "Đang kết nối lại…"; nối lại bằng `GET /runs/:id/events` + `Last-Event-ID` (HUB-FR-42), không lặp / không mất `delta` | — (tự) |
| Hub không phản hồi | Banner đỏ "Không kết nối được máy chủ" | Thử lại |

Mọi thẻ lỗi có dòng nhỏ `CODE · run <id>`. "Báo admin" copy sẵn mã và run id vào clipboard.

| AC | Given / When / Then |
|---|---|
| CHAT-AC-24 | Given kịch bản "lỗi hết lượt", When run kết thúc `ALL_PROVIDERS_EXHAUSTED`, Then thẻ đỏ có đúng câu chữ trên, nút Thử lại + Báo admin, dòng `ALL_PROVIDERS_EXHAUSTED · run <id>` |
| CHAT-AC-25 | Given thẻ lỗi, When bấm Báo admin, Then clipboard chứa mã lỗi và run id; When bấm Thử lại, Then gửi lại yêu cầu và run mới bắt đầu |
| CHAT-AC-26 | Given kịch bản "timeout", Then thẻ "Hệ thống xử lý quá lâu" + nút Thử lại |
| CHAT-AC-27 | Given `UPSTREAM_ERROR`, Then thẻ "Dịch vụ AI đang gặp sự cố" + nút Thử lại |
| CHAT-AC-28 | Given kịch bản "mất kết nối giữa stream" (mock cắt sau N `delta`), Then hiện banner "Đang kết nối lại…", Chat nối lại với `Last-Event-ID` = id sự kiện cuối, nội dung cuối cùng đầy đủ và **không trùng lặp**, banner ẩn |
| CHAT-AC-29 | Given Hub không trả lời (mock tắt), When gửi hoặc tải danh sách, Then banner đỏ "Không kết nối được máy chủ" + Thử lại; Hub chạy lại và bấm Thử lại thì banner biến mất |
| CHAT-AC-30 | Given mọi thẻ lỗi ở trên, Then không bao giờ hiện tên agent, provider hay stack trace |

---

## Canvas
`docs/design/chat-app/canvas/` (xem `canvas/README.md`): Main (UC-02/03/07), FlowOpen (UC-06), Welcome (UC-07), States (UC-03/04/05/06/08), Mobile (UC-06/17).
