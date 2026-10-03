# Plan frontend C1 · Phụ lục: câu chữ VI/EN

Phụ lục của `plan-frontend.md` §6. Namespace `chat.*`, file `packages/i18n/locales/chat/{vi,en}.json` (D7). VI nguyên văn canvas / `ui-chat-extension.md` §7–8; EN do frontend-lead dịch.

| Key | VI (nguyên văn canvas/ui-chat) | EN |
|---|---|---|
| `login.title` · `login.subtitle` | Đăng nhập · Dùng mã công ty và tài khoản do quản trị viên cấp. | Sign in · Use your company code and the account your administrator gave you. |
| `login.tenant` · `login.username` · `login.password` | Mã công ty · Tên đăng nhập · Mật khẩu | Company code · Username · Password |
| `login.changeTenant` · `login.submit` · `login.submitting` | Đổi công ty · Đăng nhập · Đang đăng nhập… | Change company · Sign in · Signing in… |
| `login.invalid` | Sai mã công ty, tên đăng nhập hoặc mật khẩu | Incorrect company code, username or password |
| `login.locked` | Tài khoản đang bị khoá. Liên hệ quản trị viên công ty | Your account is locked. Contact your company administrator |
| `login.useAdmin` | Tài khoản cần hoàn tất bước bảo mật trong Admin Console trước khi dùng Chat | Finish the security step in Admin Console before using Chat |
| `session.expired` | Phiên đã hết hạn | Your session has expired |
| `shell.brand` | AI Chat · {{tenant}} | AI Chat · {{tenant}} |
| `shell.newChat` · `shell.search` · `shell.settings` | Hội thoại mới · Tìm hội thoại · Cài đặt | New chat · Search chats · Settings |
| `shell.nav` · `shell.openList` | Hội thoại · Danh sách hội thoại | Chats · Chat list |
| `group.today` · `group.week` · `group.month` · `group.older` | Hôm nay · 7 ngày qua · 30 ngày qua · Cũ hơn | Today · Previous 7 days · Previous 30 days · Older |
| `sidebar.empty` · `sidebar.noMatch` | Chưa có hội thoại nào · Không có hội thoại khớp "{{q}}" | No chats yet · No chats match "{{q}}" |
| `item.more` · `item.rename` · `item.delete` | Thao tác khác · Đổi tên · Xoá | More actions · Rename · Delete |
| `rename.title` · `rename.label` · `rename.save` | Đổi tên hội thoại · Tên hội thoại · Lưu | Rename chat · Chat name · Save |
| `delete.title` · `delete.body` · `delete.confirm` | Xoá hội thoại? · "{{title}}" và mọi flow trong đó sẽ bị xoá. · Xoá | Delete chat? · "{{title}}" and all its flows will be deleted. · Delete |
| `welcome.greeting` · `welcome.hint` | Chào {{name}}, hôm nay cần gì? · Mỗi câu hỏi mở một flow riêng. Muốn hỏi tiếp việc nào, bấm Trả lời tiếp trên flow đó. | Hi {{name}}, what do you need today? · Each question opens its own flow. To follow up on one, click Reply in flow on it. |
| `welcome.cards.{email,summary,translate,outline}.{title,prompt}` | Soạn email / Soạn email báo giá gửi khách hàng · Tóm tắt văn bản / Tóm tắt 3 ý chính của một biên bản họp · Dịch / Dịch một đoạn hợp đồng sang tiếng Anh · Lên dàn ý / Lên dàn ý báo cáo tháng cho phòng kinh doanh | Draft an email / Draft a quotation email to a customer · Summarize / Summarize the 3 key points of meeting minutes · Translate / Translate a contract clause into English · Outline / Outline the monthly report for the sales team |
| `welcome.cardsHint` | Bấm một thẻ để điền sẵn vào ô nhập. Chưa gửi ngay. | Click a card to fill the input. Nothing is sent yet. |
| `thread.flowCount` · `thread.notFound` · `thread.backHome` | {{count}} flow · Hội thoại không tồn tại · Về trang chào | {{count}} flows · This chat doesn't exist · Back to start |
| `thread.newMessages` · `thread.log` | ↓ Tin mới · Nội dung hội thoại | ↓ New messages · Conversation |
| `flow.label` | Flow: {{title}} | Flow: {{title}} |
| `flow.more` · `flow.openRight` · `flow.panelMeta` | +{{count}} tin trong flow · {{time}} · Đang mở bên phải · {{count}} tin · {{count}} tin · nhớ cả flow | +{{count}} messages in flow · {{time}} · Open on the right · {{count}} messages · {{count}} messages · remembers the whole flow |
| `flow.reply` · `flow.close` · `flow.minimize` · `flow.panel` | Trả lời tiếp · Đóng khung flow · Thu nhỏ flow · Flow đang mở | Reply in flow · Close flow panel · Minimize flow · Open flow |
| `flow.cold` · `flow.noClose` | Đang mở lại flow, lần đầu có thể mất vài giây… · Flow không có nút đóng. Rảnh lâu thì hệ thống tự nghỉ, chat lại thì tự mở lại đủ ngữ cảnh. | Reopening the flow, the first reply may take a few seconds… · Flows never close. When idle the system pauses them and restores full context when you chat again. |
| `answer.who` · `answer.copy` · `answer.copied` | Consultant · Copy · Đã sao chép | Consultant · Copy · Copied |
| `steps.summary` · `steps.toggle` | {{count}} bước · {{seconds}}s · Xem các bước | {{count}} steps · {{seconds}}s · Show steps |
| `ask.title` · `ask.hint` | Consultant cần thêm thông tin · Bấm chip là gửi luôn. Vẫn gõ tự do được. | Consultant needs more information · Clicking a chip sends it right away. You can still type freely. |
| `composer.newLabel` · `composer.newHint` | Câu hỏi mới · Mỗi câu hỏi ở đây mở một flow mới. Muốn hỏi tiếp một việc, bấm Trả lời tiếp trên flow đó. | New question · Each question here opens a new flow. To follow up, click Reply in flow on that flow. |
| `composer.placeholder` · `composer.flowPlaceholder` | Hỏi điều mới… · Trả lời trong flow… | Ask something new… · Reply in this flow… |
| `composer.input` · `composer.flowInput` | Tin nhắn · Tin nhắn trong flow | Message · Message in flow |
| `composer.send` · `composer.sendInFlow` · `composer.stop` · `composer.busy` | Gửi · Gửi trong flow · Dừng · Đang có câu trả lời chạy, chờ xong hoặc bấm Dừng | Send · Send in flow · Stop · A reply is running; wait or press Stop |
| `composer.quotaOver` · `composer.quotaDismiss` | Công ty bạn đã dùng vượt hạn mức tháng này. Bạn vẫn dùng bình thường. · Ẩn nhắc | Your company has exceeded this month's quota. You can keep using Chat. · Dismiss |
| `run.cancelled` · `run.rerun` | Đã dừng · Chạy lại | Stopped · Run again |
| `errors.ALL_PROVIDERS_EXHAUSTED.{title,body}` | Hệ thống đang quá tải · AI tạm hết lượt dùng. Hãy thử lại sau ít phút. | The system is overloaded · AI capacity is temporarily used up. Please try again in a few minutes. |
| `errors.TIMEOUT.title` · `errors.UPSTREAM_ERROR.title` | Hệ thống xử lý quá lâu · Dịch vụ AI đang gặp sự cố | Processing took too long · The AI service is having problems |
| `errors.BUDGET_EXCEEDED.title` · `errors.NOT_CONFIGURED.title` · `errors.unknown.title` | Yêu cầu quá lớn để xử lý một lần. Hãy chia nhỏ ra · Tính năng này chưa được cấu hình xong · Có lỗi khi xử lý yêu cầu | The request is too large to process at once. Please split it up · This feature isn't fully configured yet · Something went wrong processing the request |
| `errors.retry` · `errors.report` · `errors.meta` | Thử lại · Báo admin · {{code}} · run {{runId}} | Retry · Report to admin · {{code}} · run {{runId}} |
| `conn.reconnecting` · `conn.down` · `conn.retry` | Đang kết nối lại… · Không kết nối được máy chủ · Thử lại | Reconnecting… · Can't reach the server · Retry |
| `settings.title` · `settings.language` · `settings.account` · `settings.privacy` · `settings.logout` | Cài đặt · Ngôn ngữ · Tài khoản · Quản trị nền tảng có thể xem nội dung hội thoại để hỗ trợ và gỡ lỗi. Quản trị viên công ty bạn không xem được nội dung, chỉ xem mức sử dụng · Đăng xuất | Settings · Language · Account · Platform administrators may view chat content for support and debugging. Your company administrators cannot see content, only usage · Sign out |
| `toast.flowBusy` | Flow này đang trả lời, chờ xong rồi gửi tiếp. | This flow is still replying; wait for it to finish. |
| `toast.renameFailed` · `toast.deleteFailed` · `toast.sendFailed` | Không đổi được tên. Thử lại sau. · Không xoá được hội thoại. Thử lại sau. · Không gửi được tin. Nội dung vẫn còn trong ô nhập. | Couldn't rename. Try again later. · Couldn't delete the chat. Try again later. · Couldn't send. Your text is still in the input. |

Thời gian tương đối (`flow.more`) dùng `Intl.RelativeTimeFormat` theo locale. Mã lỗi giữ nguyên (ui-chat §10). Mã lỗi lạ/`INTERNAL_ERROR` → `errors.unknown`; `message`/`hint` của Hub **không** hiển thị (CHAT-AC-30).

