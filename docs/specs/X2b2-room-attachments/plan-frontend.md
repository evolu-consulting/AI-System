# X2b-2 · Plan frontend (`apps/chat-web`)

Spec: [`spec.md`](spec.md) §2 (R01–R05, R10–R11, R16), §5, §8 AC15 · nền: `../X2b-room-agents/plan-frontend.md` (D11 "F5 đã tách X2b-2"), `../H2c-attachments`, C1 `features/attachments` + `features/composer` · token Tailwind sẵn có, không hex. Không thư viện mới, không ADR, không artboard mới.

## 0. Quyết định
| # | Quyết định |
|---|---|
| D1 | Tái dùng nguyên `Composer attachments` (hook `useAttachments`, `AttachBar`, `AttachButton`, `AttachmentList`, `downloadAttachment`). Không feature mới; sửa nằm ở `features/rooms` + hai chỗ nhỏ ở `composer`/`attachments` |
| D2 | Bật `attachments` ở `RoomComposer` (xoá `attachments={false}`) và composer thread `RoomFlowContent` (Q13). `Composer.onSubmit(text, ids)` đã truyền `ids`; `RoomComposer.onSubmit` hiện bỏ `ids` ở nhánh `send(text)` ⇒ truyền `send(text, ids)`. Nhánh `bang.intercept` (`!quy-trình` + file) **không đổi** (R20) |
| D3 | `useSendRoomText(text, ids?)` và `useFlowSend(text, ids?)`: body thêm `attachment_ids` **chỉ khi có id**. Khoá idempotent `client_msg_id` đổi từ `text` thành `text + "\u0000" + ids.join(",")` (cùng chữ, khác tệp ⇒ id mới; gửi lại đúng cũ ⇒ giữ id, server trả 200 tin cũ, R04). `api.ts` `sendRoomMessage` không đổi (body theo contract) |
| D4 | Tin có tệp thêm vào cache như tin thường (`insertMessage` khử trùng theo `id`). Tệp bất biến sau gắn ⇒ không cần vá riêng; `room.message` realtime đã đi `onMessage` → `insertMessage`/`applyAgentMessage` giữ nguyên, chỉ phụ thuộc schema contract có `attachments` (strictObject sẽ **làm hỏng parse** nếu contract chưa thêm — task F1 phụ thuộc B2) |
| D5 | Hiển thị: `MessageItem` thêm `<AttachmentList items={message.attachments}/>` trong cột bong bóng (cột đã `items-end` khi `mine` ⇒ chip lệch phải). `AgentBlock` thêm `AttachmentList` giữa thân và `AgentWait` (tệp `out/`, R11); khối `inThread` cùng. Timeline và thread dùng chung `MessageItem`/`AgentBlock` ⇒ không code riêng thread |
| D6 | Dòng gợi ý chia sẻ (Q8): `Composer` thêm prop `attachNote?: { share: string; needText: string }`; `Composer` hiện `<p role="note" id=…>` dưới hàng nhập, **trước** `hint`, khi `attachments && chips.length > 0`: `needText` nếu `text.trim()===""`, ngược lại `share`. `aria-describedby` của textarea nối thêm id này. Không hộp xác nhận. Tách `<AttachNote>` nhỏ để `Composer.tsx` không phình (TECH-DEBT #100) |
| D7 | Chữ bắt buộc (Q3): `canSend` đã đòi chữ ⇒ Gửi `disabled`; không đổi logic, chỉ thêm giải thích qua `needText` |
| D8 | Không preview (Q15). Chip tải: `downloadAttachment` (fetch + Authorization) như C1; `available=false` xám + tooltip có sẵn |
| D9 | Danh sách phòng (`preview`) và `FlowRecent` giữ `preview` do server trả (không thêm biểu tượng tệp); BE không cần đổi. Số tệp không tính vào `unread` |
| D10 | Cách ly: FE không gọi `/conversations*` cho tệp phòng; mọi tải qua `/attachments/:id/content` (server quyết quyền R05). Bị bớt khỏi nhóm ⇒ 404 ⇒ toast `attach.downloadFailed`; `useRoomLost` lo phần mất phòng |

## 1. File đụng tới
| File | Việc |
|---|---|
| `features/rooms/components/RoomComposer.tsx` | bỏ `attachments={false}`; `send(text, ids)`; `attachNote` (nhóm/DM) |
| `features/rooms/hooks/use-send-room-text.ts` | nhận `ids`, khoá idempotent D3 |
| `features/rooms/hooks/use-room-actions.ts` (`useSendRoomMessage`) | kiểu biến thêm `attachment_ids?` |
| `features/rooms/hooks/use-room-flow.ts` (`useFlowSend`) | như trên cho thread |
| `features/rooms/components/flow/RoomFlowContent.tsx` | `attachments` bật + `attachNote` thread |
| `features/rooms/components/timeline/MessageItem.tsx` | `AttachmentList` (D5) |
| `features/rooms/components/agent/AgentBlock.tsx` | `AttachmentList` cho `out/` (D5) |
| `features/composer/components/{Composer,composer-types}.tsx` + `AttachNote.tsx` (mới) | prop `attachNote`, D6 |
| `features/rooms/README.md`, `features/composer/README.md`, `features/attachments/README.md` | cập nhật (bỏ "attachments={false}" của phòng) |
| `features/composer/lib/send-error.ts` | 400 `VALIDATION_ERROR` có path `attachment_ids` khi chữ bắt đầu `!key` (D8 plan BE) ⇒ dùng câu `PROCESS_ATTACH_UNSUPPORTED` ("PROCESS_NO_ATTACH") sẵn có; không thêm key; thêm 1 ca vào unit `send-error` |
| `packages/i18n/locales/chat/{vi,en}.json` | key mới §3 |
| Test mới | `use-send-room-text.test.ts`, `AttachNote`/`Composer.test.tsx` (ca note), `MessageItem.test.tsx`, `AgentBlock.test.tsx` (ca có tệp), mở rộng `event-router.test.ts` (tin có `attachments`) |

Giới hạn CONVENTIONS: file ≤ 400, component ≤ 200 (`Composer.tsx` đã ~230 dòng — chỉ thêm ≤ 3 dòng, phần còn lại ở `AttachNote.tsx`).

## 2. Trạng thái
| Trạng thái | Cách hiện |
|---|---|
| Đang tải (upload) | Chip `Đang tải lên…` (spinner), Gửi `disabled` tooltip `attach.waitUpload` |
| Rỗng (không chip) | Không dòng gợi ý chia sẻ; chỉ nút `Đính kèm tệp` |
| Lỗi upload | Chip đỏ + câu `attach.err.*` (415/413/409 như C1) + `Thử lại`/`Xoá` |
| Lỗi gửi | `ATTACHMENT_NOT_FOUND`: `SendErrorNotice` (`sendError.attachmentNotFound`) + chip trong `details.ids` → lỗi `attach.err.missing`; mã composer khác (`AGENT_NOT_FOUND`, `TOO_MANY_RUNS`): như X2b, giữ chữ + chip; còn lại toast `rooms.toast.sendFailed`, giữ chữ + chip |
| Không có quyền | Không phải thành viên ⇒ `ROOM_NOT_FOUND` → luồng `useRoomLost` có sẵn; tải tệp 404 ⇒ toast `attach.downloadFailed` |
| Tệp không còn | `available=false`: chip xám, `aria-disabled`, tooltip `attach.unavailable` |
| Xung đột 409/429 | `FLOW_BUSY` ⇒ `roomAgent.flowBusy`; 429 đếm ngược — không đổi |
| Realtime | Người khác gửi: tin + chip xuất hiện qua `room.message`; mình gửi: chèn sau POST, SSE dội lại bị khử trùng |

## 3. Câu chữ (namespace chat; đủ `vi.json` + `en.json`, chạy `bun run i18n:check`)
Dùng lại nguyên: `attach.button` ("Đính kèm tệp" / "Attach files"), `attach.list`, `attach.messageList`, `attach.uploading`, `attach.remove`, `attach.retry`, `attach.unavailable`, `attach.download`, `attach.waitUpload`, `attach.downloadFailed`, `attach.err.*`, `sendError.attachmentNotFound`, `rooms.toast.sendFailed`.

Key mới:
| Key | VI | EN |
|---|---|---|
| `rooms.attach.shareGroup` | Mọi thành viên của nhóm đều xem và tải được tệp này. Agent được @ trong nhóm cũng đọc được. | Everyone in this group can view and download these files. Agents tagged with @ here can read them too. |
| `rooms.attach.shareDm` | {{name}} sẽ xem và tải được tệp này. Agent được @ ở đây cũng đọc được. | {{name}} can view and download these files. Agents tagged with @ here can read them too. |
| `rooms.attach.shareThread` | Mọi thành viên của phòng đều xem và tải được tệp này. Agent được @ trong thread cũng đọc được. | Everyone in the room can view and download these files. Agents tagged with @ in this thread can read them too. |
| `rooms.attach.needText` | Nhập nội dung tin để gửi kèm tệp. | Write a message to send the files with. |

## 4. Validate phía client
| Trường | Luật (khớp contract/H2c) | Câu lỗi |
|---|---|---|
| Tệp | loại/cỡ ≤ 20 MB/rỗng/tên dài: `validate.rules` C1 (đã khớp H2c) | `attach.err.tooLarge` · `type` · `empty` · `name` |
| Số tệp | ≤ 10 mỗi tin, không trùng tệp | toast `attach.err.max` |
| Nội dung | 1…16000 ký tự khi gửi (tệp không thay chữ) | Gửi `disabled` + `rooms.attach.needText`; quá dài: `CharCount` có sẵn |
| Dung lượng tenant (409) | server | `attach.err.quota` |

## 5. Role + nhãn cho e2e (giữ đúng khi code)
| Phần tử | Role / nhãn |
|---|---|
| Nút chọn tệp | `button "Đính kèm tệp"` (EN "Attach files"); input file ẩn trong `AttachButton` (QC dùng `setInputFiles`) |
| Danh sách chip trước khi gửi | `list "Tệp đính kèm"`; mỗi chip `listitem`, `button "Xoá <tên>"`, `button "Thử lại"` |
| Dòng gợi ý | `note` chứa "Mọi thành viên của nhóm đều xem và tải được tệp này" (nhóm) / "<Tên> sẽ xem và tải được tệp này" (DM) |
| Gửi | `button "Gửi"` (disabled khi upload dở / ô trống) |
| Ô nhập | `textbox "Tin nhắn cho nhóm"` / `"Tin nhắn cho <tên>"` (không đổi) |
| Tệp trong tin | `list "Tệp trong tin"`; `button "Tải <tên>"` (chip xám: `aria-disabled=true`, tooltip "Tệp đã bị xoá") |
| Tệp `out/` của agent | cùng `list "Tệp trong tin"` bên trong `article "Trả lời của agent …"` |

## 6. Cần từ backend (contract; FE không tự đổi)
| # | Đề nghị |
|---|---|
| C-1 | `SendRoomMessageRequestSchema`: thêm `attachment_ids: z.array(UuidSchema).max(10).optional()` (cũng cho thread `flow_id`); `superRefine` giữ nguyên |
| C-2 | `RoomMessageSchema`: thêm `attachments: z.array(AttachmentRefSchema).max(10).optional()` (dùng lại `AttachmentRef` của `attachments.ts`; tin agent `out/` tối đa 5). Vắng ≡ mảng rỗng. Phải có trong mọi đường trả `RoomMessage`: `GET /rooms/:id/messages`, thread `?flow_id=`, 201/200 của POST, payload `room.message` — vì schema là `strictObject`, thiếu trường ở contract làm parse FE lỗi |
| C-3 | `ATTACHMENT_NOT_FOUND` của tin phòng giữ `details.ids` đúng như C1 (FE đánh dấu chip lỗi theo `ids`) |
| C-4 | `attachments[].available=false` khi nội dung bị xoá/hết hạn nhưng metadata còn (như C1) |

## 7. Hiệu năng (CONVENTIONS §6)
`AttachmentList` chỉ render khi có tệp; `MessageItem`/`AgentBlock` đã `memo`. Không thêm chunk (code đính kèm đã nằm trong chunk composer); `check:bundle` không đổi ngân sách. Danh sách tin phòng chưa virtualize (không thuộc mốc).

## 8. Tests FE
Unit (`bun test`): `use-send-room-text` (body có/không `attachment_ids`; khoá idempotent đổi khi đổi tệp; giữ khi gửi lại), `AttachNote` (ẩn khi không chip; `needText` khi ô trống; `share` khi có chữ; DM/nhóm/thread), `MessageItem` (chip + mine lệch phải), `AgentBlock` (tệp `out/`, `available=false`), `event-router` (room.message có `attachments` → vào cache, không lặp). E2E: do `qc` (AC15) theo §5.
