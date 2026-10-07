# X2a · Phụ lục plan-frontend: câu chữ i18n VI/EN

Phụ lục của [`plan-frontend.md`](plan-frontend.md) (tách để giữ ≤ 25 KB). Task cần: F1 (rtErr, directory), F3, F4, F5, F6.

## Câu chữ i18n (key trong `packages/i18n/locales/chat/{vi,en}.json`; nhóm mới `rooms`, `directory`, `rtErr`; sửa 2 key `shell`)
Chuỗi `{{x}}` là biến i18next; plural dùng `_one/_other` cho EN và một dạng cho VI.

**shell / sidebar**
| key | VI | EN |
|---|---|---|
| `shell.newChat` | Hỏi AI | Ask AI |
| `shell.newGroup` | Nhóm mới | New group |
| `shell.search` | Tìm hội thoại, người, nhóm | Search chats, people, groups |
| `rooms.section` | Tin nhắn & Nhóm | Messages & Groups |
| `rooms.sectionAi` | Hỏi AI | Ask AI |
| `rooms.unreadBadge` | {{count}} tin chưa đọc | {{count}} unread |
| `rooms.preview.you` / `.other` | Bạn: {{text}} / {{name}}: {{text}} | You: {{text}} / {{name}}: {{text}} |
| `rooms.list.empty` | Chưa có tin nhắn hay nhóm nào. Tìm một người ở ô tìm, hoặc bấm Nhóm mới. | No messages or groups yet. Search for a person, or tap New group. |
| `rooms.list.error` / `.retry` / `.more` | Không tải được danh sách tin nhắn / Thử lại / Tải thêm | Couldn't load your messages / Retry / Load more |
| `directory.people` | Người | People |
| `directory.messageTo` | Nhắn tin với {{name}} | Message {{name}} |
| `directory.noMatch` | Không có ai khớp "{{q}}" | No one matches "{{q}}" |
| `directory.error` | Không tìm được người. Thử lại | Couldn't search people. Retry |

**phòng**
| key | VI | EN |
|---|---|---|
| `rooms.subtitleGroup` | Nhóm · {{count}} thành viên · chủ nhóm {{owner}} | Group · {{count}} members · owner {{owner}} |
| `rooms.members` / `rooms.membersN` | Thành viên / Thành viên ({{count}}) | Members / Members ({{count}}) |
| `rooms.addPeople` | Thêm người | Add people |
| `rooms.menu` | Tuỳ chọn phòng | Room options |
| `rooms.rename` / `.delete` / `.leave` / `.hide` | Đổi tên nhóm / Xoá nhóm / Rời nhóm / Ẩn hội thoại | Rename group / Delete group / Leave group / Hide conversation |
| `rooms.log` | Tin nhắn của phòng | Room messages |
| `rooms.you` | Bạn | You |
| `rooms.msgMeta` | {{name}}, {{time}} | {{name}}, {{time}} |
| `rooms.today` / `.yesterday` | Hôm nay / Hôm qua | Today / Yesterday |
| `rooms.newMessages` | {{count}} tin mới | {{count}} new messages |
| `rooms.start` | Đầu cuộc trò chuyện | Start of conversation |
| `rooms.empty` | Chưa có tin nào. Hãy gửi tin đầu tiên. | No messages yet. Send the first one. |
| `rooms.loadError` / `.retry` | Không tải được tin nhắn / Thử lại | Couldn't load messages / Retry |
| `rooms.composer.group` / `.dm` | Tin nhắn cho nhóm / Tin nhắn cho {{name}} | Message the group / Message {{name}} |
| `rooms.composer.count` | {{n}}/16000 | {{n}}/16000 |
| `rooms.seen` / `.seenBy` / `.seenMore` | Đã xem / Đã xem bởi {{count}} / và {{count}} người khác | Seen / Seen by {{count}} / and {{count}} others |
| `rooms.owner` | Chủ nhóm | Owner |
| `rooms.notFound.title` / `.body` | Không tìm thấy cuộc trò chuyện / Cuộc trò chuyện không tồn tại, đã bị xoá, hoặc bạn không còn trong đó. | Conversation not found / It doesn't exist, was deleted, or you're no longer in it. |
| `rooms.notFound.back` | Về trang chào | Back to start |

**dialog**
| key | VI | EN |
|---|---|---|
| `rooms.newGroup.title` | Tạo nhóm | Create group |
| `.name` / `.namePh` | Tên nhóm / Ví dụ: Dự án Minh Phát | Group name / e.g. Project Minh Phat |
| `.members` | Thành viên | Members |
| `.selfOwner` | {{name}} (bạn) · chủ nhóm | {{name}} (you) · owner |
| `.count` | {{n}} / 50 · gồm bạn | {{n}} / 50 · including you |
| `.search` | Tìm người trong công ty | Search people in your company |
| `.remove` | Bỏ {{name}} | Remove {{name}} |
| `.full` | Nhóm đã đủ 50 người | The group is full (50 people) |
| `.cancel` / `.create` / `.creating` | Huỷ / Tạo nhóm / Đang tạo… | Cancel / Create group / Creating… |
| `rooms.add.title` / `.submit` / `.already` | Thêm người vào nhóm / Thêm / Đã trong nhóm | Add people to group / Add / Already in group |
| `rooms.renameDlg.title` / `.save` | Đổi tên nhóm / Lưu | Rename group / Save |
| `rooms.name.empty` / `.max` | Tên nhóm không được để trống / Tên nhóm tối đa 80 ký tự | Group name is required / Group name can be at most 80 characters |
| `rooms.deleteDlg.title` / `.body` / `.ok` | Xoá nhóm? / Mọi thành viên sẽ không xem được nhóm và tin nhắn nữa. Không khôi phục được. / Xoá | Delete group? / Everyone will lose access to the group and its messages. This can't be undone. / Delete |
| `rooms.leaveDlg.title` / `.body` / `.ok` | Rời nhóm? / Bạn sẽ không xem được tin của nhóm này nữa, cho tới khi chủ nhóm thêm bạn lại. / Rời nhóm | Leave group? / You won't see this group's messages until the owner adds you back. / Leave group |
| `rooms.leaveLast.body` / `.ok` | Bạn là người duy nhất trong nhóm, rời nhóm sẽ xoá nhóm. / Rời và xoá nhóm | You're the only member, so leaving deletes the group. / Leave and delete |
| `rooms.mustTransfer.title` / `.body` / `.open` | Chuyển quyền chủ nhóm trước khi rời / Bạn đang là chủ nhóm. Hãy chuyển quyền cho một thành viên khác, hoặc xoá nhóm. / Mở danh sách thành viên | Transfer ownership before leaving / You own this group. Transfer ownership to another member, or delete the group. / Open members |
| `rooms.transferDlg.title` / `.body` / `.ok` | Chuyển quyền chủ nhóm? / {{name}} sẽ là chủ nhóm mới. Bạn trở thành thành viên thường. / Chuyển quyền | Transfer ownership? / {{name}} becomes the owner. You become a regular member. / Transfer |
| `rooms.removeDlg.title` / `.body` / `.ok` | Bớt khỏi nhóm? / {{name}} sẽ không xem được nhóm nữa. / Bớt | Remove from group? / {{name}} will lose access to the group. / Remove |
| `rooms.memberOptions` / `.transfer` / `.remove` | Tuỳ chọn của {{name}} / Chuyển quyền chủ nhóm / Bớt khỏi nhóm | Options for {{name}} / Transfer ownership / Remove from group |

**toast**
| key | VI | EN |
|---|---|---|
| `rooms.toast.created` | Đã tạo nhóm "{{name}}" | Created group "{{name}}" |
| `.renamed` / `.added` | Đã đổi tên nhóm / Đã thêm {{count}} người | Group renamed / Added {{count}} people |
| `.removed` / `.transferred` | Đã bớt {{name}} khỏi nhóm / Đã chuyển quyền chủ nhóm | Removed {{name}} / Ownership transferred |
| `.left` / `.deleted` / `.hidden` | Bạn đã rời nhóm / Đã xoá nhóm / Đã ẩn hội thoại. Tin mới sẽ làm nó hiện lại. | You left the group / Group deleted / Conversation hidden. A new message will bring it back. |
| `.kicked` | Bạn không còn trong nhóm "{{name}}" | You're no longer in "{{name}}" |
| `.gone` | Nhóm "{{name}}" đã bị xoá | The group "{{name}}" was deleted |
| `.sendFailed` | Không gửi được tin. Nội dung vẫn còn trong ô nhập. | Couldn't send. Your message is still in the box. |
| `.actionFailed` | Không thực hiện được. Thử lại sau. | That didn't work. Try again later. |

**Mã lỗi `CHAT_ROOM_ERRORS` → `rtErr.<CODE>`** (hiện qua `rooms/lib/room-errors.ts#roomErrorKey(code)`; mã lạ → `rtErr.unknown`; trong dialog là `alert`, ngoài dialog là toast)
| Mã (HTTP) | VI | EN |
|---|---|---|
| `ROOM_NOT_FOUND` (404) | Không tìm thấy cuộc trò chuyện này. | We couldn't find this conversation. |
| `NOT_ROOM_OWNER` (403) | Chỉ chủ nhóm mới làm được việc này. | Only the group owner can do this. |
| `DM_IMMUTABLE` (409) | Tin nhắn riêng không đổi được tên hay thành viên. Bạn chỉ ẩn được hội thoại. | Direct messages can't be renamed or changed. You can only hide them. |
| `ROOM_FULL` (409) | Nhóm đã đủ 50 người. | The group is full (50 people). |
| `OWNER_MUST_TRANSFER` (409) | Hãy chuyển quyền chủ nhóm cho người khác trước khi rời. | Transfer ownership to someone else before leaving. |
| `GROUP_NOT_HIDEABLE` (409) | Nhóm không ẩn được. Bạn có thể rời nhóm. | Groups can't be hidden. You can leave the group instead. |
| `DM_SELF` (400) | Bạn không thể nhắn tin cho chính mình. | You can't message yourself. |
| `USER_NOT_FOUND` (404) | Không tìm thấy người này trong công ty. | We couldn't find this person in your company. |
| `VALIDATION_FAILED` (400) | Thông tin chưa hợp lệ. Kiểm tra lại. | Some details are invalid. Check and try again. |
| `unknown` | Có lỗi khi xử lý. Thử lại sau. | Something went wrong. Try again later. |

Câu mã lỗi dùng cho người dùng; `ApiError.message` của server không hiện ra. Cả bảng này `i18n:check` bắt buộc VI/EN đủ; số nhiều EN dùng `_one/_other`.

