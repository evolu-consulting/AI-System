# Chat App & Extension — Đặc tả UI/UX

Giao diện người dùng cuối của Agent Hub: chat, command "/", ngữ cảnh trang, stream các bước, file đính kèm

`v0.4 · draft` · `2026-10-01` · `shadcn/ui · song ngữ VI/EN` · `Đáp ứng US-H01 → H08`

## 1. Phạm vi & nguyên tắc

Có hai bề mặt, dùng **chung một thư viện component** (package `ui-chat`, dựng bằng shadcn) và chung API của Hub:

- **Chat App (web):** desktop-first, có danh sách hội thoại, xem được trên điện thoại.
- **Extension (Chrome side panel):** một cột hẹp 360–480px, có thêm ngữ cảnh trang (đoạn bôi đen, nội dung trang).

Từ v0.4, mỗi user thuộc một **tenant** (công ty). User đăng nhập bằng mã công ty, chỉ thấy hội thoại của mình và chỉ thấy command được cấp.

| # | Nguyên tắc | Thể hiện |
|---|---|---|
| C1 | **Một ô nhập cho mọi thứ** | Gõ chữ bình thường là chat, gõ `/` là command. Không có tab hay nút riêng cho từng tính năng |
| C2 | **Luôn biết hệ thống đang làm gì** | Các bước hiện trực tiếp ("Đang kiểm tra hoá đơn…"). Job dài có thanh tiến độ. Luôn có nút Dừng |
| C3 | **Ngữ cảnh là thứ user chủ động chọn** | Đoạn bôi đen và nội dung trang hiện thành chip, bỏ được. Nội dung trang mặc định *không* gửi (theo HUB-BR-07) |
| C4 | **Lỗi phải dẫn tới hành động** | Thẻ lỗi có câu dễ hiểu và nút [Thử lại], [Sửa lệnh] hoặc [Báo admin] |
| C5 | **Không lộ chi tiết kỹ thuật** | Member thấy tên agent thân thiện và các bước. Provider, token, trace đầy đủ thì chỉ `platform_admin` thấy (trong Agent Studio › Vận hành) |

## 2. Kiến trúc thông tin

```
Chat App (web)                       Extension (side panel)
├─ /login                            ├─ Đăng nhập
├─ /c/new       (trang chào)         ├─ Chat (hội thoại hiện tại)
├─ /c/:id       (hội thoại)          │   └─ ☰ danh sách hội thoại (sheet)
└─ Cài đặt (dialog)                  └─ ⚙ Cài đặt (sheet)
    ngôn ngữ · giao diện · tài khoản     + "Dùng nội dung trang" mặc định
```

## 3. Chat App (web)

[[WF chat-app/ui-chat-extension.html#1]]

*Hình 3.1: Chat App. Sidebar hội thoại nhóm theo thời gian. Các bước hiện phía trên câu trả lời. Khi đang chạy, nút gửi đổi thành nút Dừng. Dòng xám trên composer là nhắc vượt quota (chỉ hiện khi tenant đã vượt, không chặn gửi).*

| Vùng | Đặc tả |
|---|---|
| Sidebar | Rộng 260px, thu gọn được. Nút "Hội thoại mới" (`Ctrl`+`Shift`+`O`). Ô tìm theo tiêu đề. Nhóm theo Hôm nay / 7 ngày qua / 30 ngày qua / Cũ hơn. Hover một mục thì hiện `⋯`: Đổi tên, Xoá (xác nhận). Tiêu đề tự đặt từ tin nhắn đầu (40 ký tự đầu), sửa được |
| Luồng tin | Rộng tối đa 720px, căn giữa. Tin của user căn phải, nền nhạt. Câu trả lời căn trái, không có khung (đọc như tài liệu). Tự cuộn xuống khi đang stream, *trừ khi* user đã cuộn lên, khi đó hiện nút "↓ Tin mới" |
| Trang chào (/c/new) | Lời chào theo tên, và 4 thẻ gợi ý lấy từ các command phổ biến *mà user được cấp* (`/dich`, `/tom`…) cùng ví dụ câu hỏi. User chưa được cấp lệnh nào thì chỉ hiện ví dụ câu hỏi. Click thẻ thì điền sẵn vào composer, không gửi ngay |

## 4. Composer & menu command

[[WF chat-app/ui-chat-extension.html#2]]

*Hình 4.1: gõ "/di" thì menu lọc gần đúng. Phần chữ mờ (ghost text) gợi ý cú pháp của lệnh đang chọn. Chip ngữ cảnh nằm ngay trong composer.*

| Hành vi | Đặc tả |
|---|---|
| Mở menu | Gõ `/` ở đầu ô nhập. Danh sách lấy từ `GET /commands` (cache theo phiên, làm mới khi mở lại ứng dụng hoặc sau 5 phút). Hub chỉ trả **command user được cấp** (qua feature của user hoặc group). Menu không hiện lệnh bị khoá hay mờ: lệnh không có quyền thì không có trong danh sách. Lọc gần đúng theo tên, alias và mô tả (không phân biệt dấu). Cả alias cũng khớp: gõ `/tr` ra `/dich` |
| Chọn lệnh | `Tab` hoặc `Enter` hoàn tất tên lệnh và thêm một dấu cách. Sau đó ghost text hiện tham số tiếp theo ("<lang = vi>"), tự cập nhật khi user gõ đến tham số sau |
| Gửi command | `Enter` gửi. Nếu thiếu tham số bắt buộc và không có fallback thì *không gửi*: ô nhập rung nhẹ và hiện "Thiếu <text>: nhập nội dung hoặc bôi đen một đoạn". Đây là kiểm tra phía client, Hub vẫn kiểm tra lại |
| Chat thường | `Enter` gửi, `Shift`+`Enter` xuống dòng. Ô nhập tự giãn tối đa 8 dòng. Muốn gửi chữ bắt đầu bằng "/" thì gõ `//` |
| Đính kèm | Nút 📎, kéo-thả vào vùng chat, hoặc dán ảnh. Chip file có tên, dung lượng, tiến độ upload và nút ✕. Tối đa 20MB/file, 5 file/tin. Sai định dạng hoặc quá dung lượng thì chip đỏ kèm lý do |
| Chip ngữ cảnh | ✂ Đoạn đã chọn · 128 ký tự (chỉ Extension) và 🌐 Trang này (bấm để bật/tắt). Hover chip thì xem trước 200 ký tự. Chip chỉ áp dụng cho *một* tin nhắn, gửi xong thì tự bỏ |
| Đang chạy | Nút gửi thành ■ Dừng (hoặc `Esc`). Trong lúc run đang chạy vẫn gõ trước được, nhưng không gửi được |
| Nháp | Nội dung đang gõ dở được lưu theo từng hội thoại (localStorage), chuyển qua lại hội thoại không mất |
| Quyền đổi giữa phiên | Quyền bị thu hồi thì Hub chặn ngay (≤ 5 giây), dù menu còn cache. Chạy lệnh đó sẽ nhận `CMD_NOT_FOUND`. Khi nhận mã này, client làm mới danh sách command ngay |
| Nhắc vượt quota | Khi tenant của user đã vượt quota tháng, phía trên composer hiện một dòng nhỏ màu xám: "Công ty bạn đã dùng vượt hạn mức tháng này. Bạn vẫn dùng bình thường." Không chặn gửi. Bấm ✕ để ẩn đến hết phiên |

## 5. Hiển thị câu trả lời

[[WF chat-app/ui-chat-extension.html#3]]

| Thành phần | Đặc tả |
|---|---|
| Khối các bước | Hiện ngay khi có `step.started`. Mỗi bước có icon trạng thái (spinner, ✓, ✕) và nhãn thân thiện lấy từ `label` của step. Xong run thì tự thu gọn thành một dòng "✓ 3 bước · 8.4s", bấm vào để mở lại. Command sync chạy dưới 1 giây thì không hiện khối này |
| Nội dung | Stream theo `delta`, render markdown GFM: bảng, code (có highlight và nút copy), link (mở tab mới), danh sách. Con trỏ nhấp nháy ở cuối trong lúc đang stream |
| Nhãn command | Kết quả của command có chip đầu: tên lệnh, tham số chính, nguồn ngữ cảnh. User nhờ đó biết kết quả đến từ lệnh nào |
| Job nền | Thanh tiến độ lấy từ `job.progress` (có percent thì hiện, không có thì chạy vô định). Dòng "có thể rời trang" chỉ hiện với job async. Nếu tab không được focus khi xong thì gửi browser notification (xin quyền ở lần đầu) |
| Hỏi lại (ask) | Thẻ viền màu primary. Có quick-reply chip nếu Hub gửi lựa chọn. Bấm chip thì gửi luôn câu trả lời. Có thể gõ tự do thay cho chip |
| Lỗi | Thẻ đỏ gồm tiêu đề, một câu giải thích theo mã lỗi (bảng ở mục 8), các nút hành động, và dòng nhỏ có mã lỗi và run id (để báo admin). [Báo admin] copy sẵn run id và mã lỗi vào clipboard |
| Hành động trên tin | Hover thì hiện: Copy · Chạy lại (gửi lại đúng yêu cầu đó) · (với command) Sửa lệnh (đưa lại vào composer) |
| Nhãn agent | Nếu Coordinator giao việc cho agent chuyên trách thì ghi tên hiển thị của agent trong khối các bước ("Trợ lý hoá đơn"). Member không thấy provider và token |

## 6. Extension (side panel)

[[WF chat-app/ui-chat-extension.html#4]]

*Hình 6.1: Extension. Đoạn user bôi đen trên trang tự thành chip trong composer. Chip "Trang này" mặc định tắt.*

| Hành vi | Đặc tả |
|---|---|
| Bố cục | Chrome Side Panel, một cột. Header: ☰ (mở sheet danh sách hội thoại), tiêu đề, ＋ (hội thoại mới), ⚙. Không có sidebar cố định |
| Bắt đoạn bôi đen | Content script lắng nghe việc chọn text (≥ 3 ký tự). Nếu panel đang mở thì chip "✂ Đoạn đã chọn" cập nhật ngay. Bôi đen đoạn khác thì chip thay theo. Bấm ✕ để bỏ. Không đọc được trang (chrome://, PDF viewer…) thì chip hiện gạch ngang kèm tooltip giải thích |
| Nội dung trang | Chip "🌐 Trang này" mặc định *tắt*. Bật thì gửi URL, tiêu đề và nội dung đọc được của trang. Command khai báo nguồn `$page.*` (như `/tom`) thì chip *tự bật* khi chọn lệnh đó, kèm tooltip "Lệnh này cần nội dung trang" |
| Hội thoại theo tab | Mặc định mỗi lần mở panel là tiếp tục hội thoại gần nhất. Tiêu đề hội thoại mới lấy từ tiêu đề trang |
| Nút nổi "Hỏi AI" | COULD. Hiện cạnh đoạn bôi đen, bấm thì mở panel với chip đã gắn sẵn. Tắt được trong Cài đặt |
| Phím tắt | `Alt`+`J` (tuỳ chỉnh được) để mở/đóng panel và focus composer |
| Quyền | Chỉ xin `sidePanel`, `storage`, `activeTab` và `scripting`. Host permission là domain của Hub và Admin. Không xin `<all_urls>` thường trực |

## 7. Đăng nhập & cài đặt

[[WF chat-app/ui-chat-extension.html#5]]

*Hình 7.1: màn đăng nhập (web và Extension dùng chung). Ba ô: mã công ty, tên đăng nhập, mật khẩu.*

- **Đăng nhập** gọi `Admin /auth/login` với **mã công ty (tenant key) + username + password**. Giao diện giống bản của Admin (xem UI/UX Admin, mục 7.1). Username chỉ duy nhất trong một công ty, nên thiếu mã công ty thì không đăng nhập được.
  - Mã công ty được nhớ lại trên thiết bị (localStorage, hoặc `chrome.storage.local` với Extension) và điền sẵn ở lần sau. Có link "Đổi công ty" để sửa.
  - Sai bất kỳ ô nào thì chỉ báo chung: "Sai mã công ty, tên đăng nhập hoặc mật khẩu". Không nói ô nào sai.
  - Sai 5 lần thì khoá tạm 15 phút. User hoặc công ty bị khoá thì báo "Tài khoản đang bị khoá. Liên hệ quản trị viên công ty".
  - Lần đầu (`must_change_password`) thì đổi mật khẩu ngay trong app. Mật khẩu mới ≥ 10 ký tự.
  - Web lưu token trong bộ nhớ và refresh token trong cookie httpOnly. Extension lưu trong `chrome.storage.local`.
- **Hết phiên:** tự refresh ngầm. Nếu refresh thất bại thì hiện modal đăng nhập và giữ nguyên hội thoại cùng bản nháp.
- **Cài đặt** (dialog trên web, sheet trên Extension):
  - *Ngôn ngữ* VI/EN.
  - *Giao diện* Sáng/Tối/Theo hệ thống.
  - *Tài khoản*: tên, công ty, đổi mật khẩu, đăng xuất.
  - (Extension) *Nút nổi Hỏi AI* bật/tắt, *Phím tắt*.
  - *Quyền riêng tư*: dòng cố định "Quản trị nền tảng có thể xem nội dung hội thoại để hỗ trợ và gỡ lỗi. Quản trị viên công ty bạn không xem được nội dung, chỉ xem mức sử dụng".

## 8. Trạng thái & lỗi

| Mã / tình huống | Câu hiển thị (VI) | Hành động |
|---|---|---|
| `CMD_NOT_FOUND` | Không có lệnh /dihc. Có phải bạn muốn: /dich? (chỉ gợi ý lệnh user được cấp) | Chip gợi ý, bấm để sửa lệnh. Lệnh có tồn tại nhưng user không có quyền cũng hiện câu này |
| `CMD_MISSING_ARG` | Lệnh /dich cần <text>: nhập nội dung hoặc bôi đen một đoạn | [Sửa lệnh] |
| `NOT_CONFIGURED` | Tính năng này chưa được cấu hình xong | [Báo admin] |
| `UPSTREAM_ERROR` | Dịch vụ AI đang gặp sự cố | [Thử lại] |
| `ALL_PROVIDERS_EXHAUSTED` | Hệ thống đang quá tải, hãy thử lại sau ít phút | [Thử lại] · [Báo admin] |
| `BUDGET_EXCEEDED` | Yêu cầu quá lớn để xử lý một lần. Hãy chia nhỏ ra | — |
| `TIMEOUT` | Hệ thống xử lý quá lâu | [Thử lại] |
| `CANCELLED` | Đã dừng | [Chạy lại] (hiện nhỏ, màu xám) |
| Mất mạng khi đang stream | Banner "Đang kết nối lại…", tự nối lại bằng `Last-Event-ID` | Nối lại thành công thì ẩn banner |
| Chưa được cấp command nào | Menu "/" hiện "Bạn chưa được cấp lệnh nào. Liên hệ quản trị viên công ty" | — |
| Tenant vượt quota tháng | Dòng nhắc nhẹ trên composer (xem mục 4). Không phải lỗi, run vẫn chạy | [✕] ẩn |
| Tài khoản hoặc công ty bị khoá giữa phiên | Refresh thất bại, hiện modal đăng nhập kèm "Tài khoản đang bị khoá. Liên hệ quản trị viên công ty" | — |
| Hub không phản hồi | Banner đỏ "Không kết nối được máy chủ" | [Thử lại] |

Đang tải lịch sử thì hiện skeleton 3 tin. Hội thoại đã bị xoá thì hiện "Hội thoại không tồn tại" kèm nút về trang chào.

## 9. Phím tắt

| Phím | Tác dụng |
|---|---|
| `/` (ở đầu ô nhập) | Mở menu command |
| `Enter` · `Shift`+`Enter` | Gửi · Xuống dòng |
| `Esc` | Đóng menu, hoặc dừng run đang chạy |
| `↑` (khi ô nhập trống) | Đưa lệnh gần nhất trở lại ô nhập để sửa |
| `Ctrl`+`Shift`+`O` | Hội thoại mới |
| `Ctrl`+`K` | Tìm hội thoại (web) |
| `Alt`+`J` | Mở/đóng side panel (Extension) |

## 10. Song ngữ

- **Chuỗi giao diện:** dùng i18n theo key (`chat.composer.placeholder`…). VI mặc định, EN là bản thứ hai. Thiếu bản EN thì dùng bản VI và ghi cảnh báo ở môi trường dev.
- **Nội dung lấy từ cấu hình:** mô tả command, mô tả tham số, tên hiển thị agent, nhãn step. Mỗi trường có bản `vi` và `en` (EN không bắt buộc, thiếu thì dùng VI). Hub trả đúng ngôn ngữ theo header `Accept-Language`.
- **Câu trả lời của AI:** theo ngôn ngữ user dùng trong tin nhắn, không theo ngôn ngữ giao diện.
- **Định dạng:** số, ngày và giờ theo locale. Mã lỗi và tên lệnh giữ nguyên.
- Ngôn ngữ đã chọn lưu vào `users.locale`, nên đồng bộ giữa web, extension và Admin.

## 11. Responsive & accessibility

| Kích thước | Chat App |
|---|---|
| ≥ 1024px | Sidebar cố định cộng luồng tin |
| 640–1023px | Sidebar thành sheet (☰) |
| < 640px | Toàn màn hình. Composer dính đáy và né bàn phím ảo. Menu command chiếm toàn chiều rộng và mở từ dưới lên |

- Luồng tin là `role="log"` với `aria-live="polite"`. Chỉ đọc câu trả lời khi xong run, không đọc từng token.
- Menu command là combobox đúng chuẩn ARIA (`aria-activedescendant`). Mọi thao tác đều làm được bằng bàn phím.
- Icon trạng thái bước luôn đi kèm chữ. Tương phản chữ ≥ 4.5:1 ở cả hai theme. Chip có nhãn cho trình đọc màn hình ("Đoạn đã chọn, 128 ký tự, bấm để bỏ").

## 12. Cấu trúc code & câu hỏi mở

```
packages/ui-chat/        # dùng chung web + extension (shadcn + Tailwind)
  Thread, Message, StepList, AskCard, ErrorCard, Composer, CommandMenu,
  ContextChip, AttachmentChip, Markdown
  hooks: useHubStream (SSE + reconnect), useCommands, useConversation
apps/chat-web/           # Chat App: routing, sidebar, auth cookie
apps/extension/          # WXT/MV3: side panel, content script (selection, page text)
```

| shadcn component | Dùng cho |
|---|---|
| Command (cmdk) + Popover | Menu "/" |
| Textarea (tự giãn) | Composer |
| Sheet | Sidebar trên màn nhỏ, danh sách hội thoại và cài đặt của Extension |
| Dialog / AlertDialog | Cài đặt (web), xác nhận xoá hội thoại |
| Badge, Button, Tooltip, ScrollArea, Skeleton, Sonner | Chip, nút, gợi ý, cuộn, đang tải, toast |
| Collapsible | Khối các bước |
| Progress | Tiến độ job |

### Câu hỏi mở

1. Có cần Mobile app riêng (Expo), hay web responsive là đủ cho v1?
2. Có cho user *chia sẻ* một hội thoại cho đồng nghiệp cùng công ty xem không? (Hiện dữ liệu cách ly tuyệt đối theo tenant và user.)
3. Có cần nút đánh giá câu trả lời (👍/👎) để admin theo dõi chất lượng agent không?
4. ~~Chat App biết tenant đã vượt quota bằng cách nào?~~ Đã chốt: sự kiện SSE `run.started` mang `quota: {state: ok|warn|over, pct}` (xem BA Agent Hub mục 9.2). Dòng nhắc hiện khi `state = over`.
5. Dòng nhắc chỉ hiện khi vượt 100%, hay cả khi chạm 80% như cảnh báo cho `tenant_admin`? Tạm chọn: chỉ khi vượt 100%.
6. Có cho đăng nhập bằng link chứa sẵn mã công ty (vd. `/login?tenant=acme`) không? Tạm chưa làm.
