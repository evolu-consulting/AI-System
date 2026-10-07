# X2a · Plan frontend (`apps/chat-web`)

Spec: [`spec.md`](spec.md) §5, §5.3 · [`spec-isolation.md`](spec-isolation.md) §1.1 · canvas `docs/design/chat-app/canvas-x2/` (Main, DM, NewGroup, Mobile; **không** panel agent, **không** hàng chip: spec §5.2) · token `docs/design/canvas/tokens-map.md` (dùng token Tailwind sẵn có: `bg-card`, `bg-accent`, `bg-primary`, `text-muted-foreground`, `bg-warning-bg`…; không hex) · mẫu code: `docs/specs/C1-chat-ui/plan-frontend.md`.
Yêu cầu: HUB-FR-96, 97, 98, 99, 100, 102, 75 (vế phòng) · UC-09, UC-10 · CHAT-AC-37…45 · X2a-AC06, AC08, AC09, AC12, AC15.
Contract: chỉ **tiêu thụ** `@ai/contracts/chat` (`rooms`, `directory`, `me-stream`, `CHAT_ROOM_ERRORS`) do backend-lead chốt ở `plan.md`. Tên schema/hàm dưới đây là **giả định** (đánh dấu `[chờ plan BE]`); lệch tên thì đổi theo contract, không đổi hình dạng plan.

## 0. Quyết định chính
| # | Quyết định |
|---|---|
| D1 | 3 feature mới theo mẫu feature-first: `rooms` (phòng, tin, dialog), `directory` (danh bạ + `PersonPicker`), `realtime` (client `/me/stream`). Sidebar vẫn ở `shell` (thêm mục "Tin nhắn & Nhóm"). Không đụng `thread`/`run`/`flow-panel` C1 |
| D2 | Cache = **TanStack Query** (đã có), không thêm thư viện, không ADR. Realtime **ghi vào cache** bằng `setQueryData`/`invalidateQueries`; component chỉ đọc query. Không dựng store riêng cho dữ liệu phòng. Trạng thái kết nối realtime là store nhỏ ngoài React (như `run-store`) |
| D3 | **Một kết nối `/me/stream` mỗi tab**, mở khi `AppShell` mount (đã đăng nhập), đóng khi đăng xuất/hết phiên. Bearer qua `fetch` (không token trên URL, X2a-AC12) |
| D4 | Mất kết nối realtime dùng lại `ConnectionBanner` "Đang kết nối lại…" (CHAT-AC-40) qua `useConnection` (thêm điều kiện `realtime.phase`) |
| D5 | Trang phòng `/rooms/$id` (Q9) là route tách chunk (router `autoCodeSplitting` đã bật); dialog (Nhóm mới, Thêm người, Thành viên, Đổi tên, Xoá/Rời) `React.lazy`, chỉ tải khi mở |
| D6 | Composer phòng = `Composer` C1 thêm prop `variant="room"`, `menus={false}`, `attachments={false}` (§5). Không viết composer thứ hai |
| D7 | Tin gửi **không optimistic**: chờ `POST` (201/200) rồi chèn kết quả vào cache (khử trùng theo `message.id` với `room.message` đến trước/sau). Lỗi → giữ chữ trong ô + toast. `client_msg_id` sinh một lần cho mỗi lần gõ gửi, giữ nguyên khi bấm Gửi lại (idempotent R15) |
| D8 | Nhãn nhập: tên nhóm 1–80 ký tự sau trim (R08). Giới hạn 50 thành viên tính cả chủ, kiểm ở client **và** hiển thị `ROOM_FULL` nếu server từ chối |
| D9 | Điện thoại (< 1024): giữ mẫu C1 (header ☰ mở Sheet danh sách trái) thay vì thêm "màn danh sách" riêng; trang phòng toàn màn như artboard Mobile, header phòng có nút `button "Danh sách hội thoại"` (dùng lại key `shell.openList`) |

## 1. Cấu trúc file (mỗi file ≤ 250 dòng, component ≤ 200)
```
apps/chat-web/src/features/
├─ realtime/
│  ├─ README.md
│  ├─ me-stream-driver.ts      # fetch SSE, Last-Event-ID, backoff, đóng/mở theo phiên (≤ 200)
│  ├─ realtime-store.ts        # phase: idle|connecting|open|reconnecting|down; lastEventId (store ngoài React)
│  ├─ event-router.ts          # sự kiện → cập nhật cache TanStack Query (bảng §3)
│  ├─ runtime.ts               # singleton driver + queryClient
│  ├─ hooks/use-me-stream.ts   # mount trong AppShell: start/stop theo phiên
│  ├─ lib/read-raw-sse.ts      # ReadableStream → RawSseEvent (createSseParser của contracts; không đụng lib/sse.ts)
│  └─ *.test.ts
├─ directory/
│  ├─ README.md · api.ts       # useDirectory(q) = GET /directory
│  ├─ components/PersonPicker.tsx   # ô tìm + danh sách chọn (≤ 150)
│  └─ hooks/use-person-search.ts
├─ rooms/
│  ├─ README.md · api.ts       # toàn bộ gọi /rooms* (§3 spec): hook query + mutation
│  ├─ hooks/{use-room-list,use-room,use-room-messages,use-send-room-message,use-mark-read,use-room-actions,use-room-scroll}.ts
│  ├─ lib/{room-logic,room-errors,room-cache}.ts   # thuần: xem trước, nhóm ngày, "Đã xem", mã lỗi→key, vá cache
│  ├─ pages/RoomPage.tsx       # chỉ ghép (≤ 120)
│  └─ components/
│     RoomHeader · RoomMenu · MemberAvatars · RoomTimeline · DayDivider · MessageItem · SeenMark ·
│     NewMessagesPill · RoomNotFound · RoomListItem · RoomSection · NewGroupDialog · AddMembersDialog ·
│     MembersDialog · RenameRoomDialog · ConfirmRoomDialog (xoá/rời/bớt/chuyển chủ dùng chung, `alertdialog`)
├─ shell/components/Sidebar.tsx (sửa) · RoomSections.tsx (mới: 2 mục + kết quả "Người")
└─ routes/_authed/rooms.$id.tsx   # `validateSearch` nhận `flow?` (bỏ qua ở X2a, §5.3)
```
`features/rooms/components` sẽ vượt 10 file ngang hàng → chia thư mục con `components/{timeline,dialogs,header}/` ngay từ F3 (CONVENTIONS §4). Gọi API chỉ trong `rooms/api.ts`, `directory/api.ts`, `realtime/me-stream-driver.ts` (stream). `rsbuild.config.ts` proxy thêm `/directory`, `/rooms`, `/me` → `HUB_URL`; README chat-web cập nhật bảng proxy + bảng feature.
`lib/http.ts`: thêm `ChatRoomErrorCode` vào union `ApiErrorCode` (chỉ thêm).

## 2. Route và điều hướng
| Route | Hành vi |
|---|---|
| `/rooms/$id` | `RoomPage`; `?flow=<id>` được `validateSearch` chấp nhận nhưng **bỏ qua** (chưa mở khung); id lạ/không thành viên → `RoomNotFound` (404 từ Hub, CHAT-AC-45, không phân biệt "không tồn tại"/"không có quyền") |
| Mở DM | `POST /rooms {kind:"dm"}` → `navigate /rooms/$id` (200 hay 201 như nhau) |
| Tạo nhóm xong | `navigate /rooms/$id` phòng mới, toast `rooms.toast.created` |
| Rời / xoá / bị bớt / `room.deleted` khi đang mở | `navigate /c/new` + toast tương ứng (`plan-frontend-i18n.md`); mở lại link cũ → `RoomNotFound` |
| Ẩn DM | `navigate /c/new`, toast `rooms.toast.hidden` |
| Tab/URL | `activeId` của sidebar tách 2 loại: `/c/:id` (hội thoại) và `/rooms/:id` (phòng); `lib/conversation-path` thêm `roomIdOf(pathname)` |

## 3. Dữ liệu, cache, realtime
**Query key** (`rooms/lib/room-cache.ts` giữ hằng): `['rooms','list']` (infinite, cursor, `GET /rooms`) · `['rooms','detail',id]` · `['rooms','messages',id]` (infinite lùi theo `before_seq`, trang đầu = 50 tin mới nhất, hiển thị `seq` tăng dần) · `['directory',q]` (`staleTime` 30 s, `q` đã debounce 250 ms như sidebar). `unread_total` lấy từ `pages[0]` của `['rooms','list']` (selector `useUnreadTotal`), được vá bởi sự kiện `room.unread`. Đăng xuất → `queryClient.clear()` (đã có) + driver `stop()`.

**Client `/me/stream`** (`me-stream-driver`): `fetch('/me/stream', {headers: Authorization, Accept: text/event-stream, 'Last-Event-ID': lastId?})` qua `~/lib/http` getToken/refresh (401 → refresh 1 lần như C1; refresh hỏng → `session` expired, dừng). Đọc bằng `createSseParser` + zod strict của contract `[chờ plan BE: MeStreamEventSchema/parseMeStreamEvent]`; khung hỏng bị bỏ (như `sse.ts`). Ghi `id:` mỗi khung vào `lastEventId` (chỉ bộ nhớ, không `localStorage`). Stream đóng/lỗi mạng → phase `reconnecting`, nối lại sau 0,5 → 1 → 2 → 4 → 8 s (trần 8 s, **không** bỏ cuộc; từ lần thứ 5 liên tiếp phase `down` ⇒ banner đỏ "Không kết nối được máy chủ" + Thử lại, vẫn tiếp tục thử); nối lại kèm `Last-Event-ID`. Phase `open` khi có byte đầu tiên (kể cả `: ping`). Tab ẩn: vẫn giữ kết nối (không tự đóng) để badge tab nền đúng; `online`/`visibilitychange` visible khi đang `down` → nối ngay. JWT hết hạn: server đóng stream ⇒ vòng nối lại ở trên đi qua refresh. Quá 5 kết nối/user → server đóng kết nối cũ: tab đó nối lại bình thường (chấp nhận, ≤ 5 tab).

| Sự kiện | `event-router` làm gì |
|---|---|
| `room.message` | nếu `['rooms','messages',id]` đã nạp: chèn (khử trùng `id`, giữ thứ tự `seq`); cập nhật `last_message`/`last_activity_at` trong list và **đưa lên đầu**; phòng chưa có trong list → `invalidate list` |
| `room.unread` | vá `unread` của phòng + `unread_total` ở `pages[0]` |
| `room.read` | vá `members[user_id].last_read_seq = max(cũ, seq)` trong detail (nuôi "Đã xem") |
| `room.member_added` | `user_id` = tôi và có `room` → chèn vào list; ngược lại `invalidate detail` + `member_count` list |
| `room.member_removed` | `user_id` = tôi → xoá phòng khỏi list + `removeQueries` detail/messages; nếu đang mở → `RoomNotFound`-redirect (§2) + toast; người khác → `invalidate detail`, `member_count` |
| `room.updated` | vá `name`/`owner_id` (list + detail; `my_role` tính lại từ `owner_id`) |
| `room.deleted` | như "tôi bị bớt" |
| `stream.reset` | `invalidate ['rooms']` (list + detail + messages đang mở được refetch), **không** xoá cache trước (giữ UI, tránh nháy); xoá `lastEventId` |
| nối lại thành công sau `reconnecting`/`down` | không cần refetch (Last-Event-ID); nếu server trả `stream.reset` thì như trên (X2a-AC08) |

**Đánh dấu đã đọc** (`use-mark-read`): gọi `POST /rooms/:id/read {seq: lastSeq}` khi đồng thời (phòng mở) ∧ (`document.visibilityState==='visible'`) ∧ (đang ở đáy dòng thời gian) ∧ (`lastSeq` > mốc đã gửi); throttle ≤ 1 lần/giây (gộp, trailing). Kết quả `{unread, unread_total}` vá cache. Gửi tin của chính mình không cần gọi (server tự đọc, R18) — chỉ vá `unread=0`. Tin đến khi tab ẩn hoặc không ở đáy: không đánh dấu; pill "n tin mới"; tab hiển thị lại + ở đáy → đánh dấu.

**Dòng thời gian** (`RoomTimeline`, `role="log"`, `aria-label="Tin nhắn của phòng"`, `aria-live=polite`): nhóm theo ngày (DayDivider "Hôm nay"/"Hôm qua"/`dd/MM/yyyy`; tái dùng `lib/time-groups` nếu khớp, không thì `room-logic`); tin của người khác: avatar chữ cái đầu + tên + giờ; tin mình: "Bạn · 09:15", lệch phải; **chuỗi `@xxx` hiện chữ thường** (R16, không highlight, không link). `sender_type==="agent"` ở X2a: nhánh `AgentMessageSlot` trả `null` (X2b cắm `FlowBlock`; không crash nếu server lỡ trả). Cuộn lên đỉnh → tải trang cũ (`before_seq`, giữ vị trí cuộn); `has_more=false` → "Đầu cuộc trò chuyện". Không virtualize ở X2a (50 tin/trang; ghi TECH-DEBT, perf thấp ưu tiên). Tự cuộn đáy khi đang ở đáy hoặc tin do mình gửi; ngược lại `NewMessagesPill`.

**"Đã xem"** (`SeenMark`, `room-logic#seenBy`, Q5): dưới **tin cuối của mình** nếu có người khác có `last_read_seq ≥ seq` của nó. DM: chữ "Đã xem". Nhóm: "Đã xem bởi {{n}}" (n ≥ 1), `title`/Tooltip liệt kê tên (≤ 10 tên, thêm "và {{n}} người khác"). Chỉ tin cuối của mình; không hiện nếu n=0.

## 4. Màn ↔ artboard ↔ trạng thái
| Màn | Artboard | Thành phần shadcn/có sẵn | Đang tải | Rỗng | Lỗi | Khác |
|---|---|---|---|---|---|---|
| Sidebar mục "Tin nhắn & Nhóm" | Main/DM | `RoomListItem` (avatar chữ cái, tên, xem trước, huy hiệu) | 4 `Skeleton` hàng | "Chưa có tin nhắn hay nhóm nào. Tìm một người ở ô tìm, hoặc bấm Nhóm mới." | "Không tải được danh sách tin nhắn" + Thử lại | "Tải thêm" khi `next_cursor` |
| Sidebar "Hỏi AI" | Main | `ConversationList` C1 giữ nguyên | như C1 | như C1 | như C1 | nhóm thời gian h2 giữ nguyên (`plan-frontend-e2e.md` §1) |
| Kết quả tìm "Người" | Main (ô tìm) | `PersonRow` | 2 skeleton | "Không có ai khớp "{{q}}"" | "Không tìm được người. Thử lại" | Enter/click = mở DM |
| Màn phòng | Main/DM/Mobile | `Dialog`, `DropdownMenu`, `Tooltip`, `Skeleton`, `Button` | skeleton header + 5 dòng tin | "Chưa có tin nào. Hãy gửi tin đầu tiên." | `alert` "Không tải được tin nhắn" + Thử lại | 404 → `RoomNotFound` |
| Tạo nhóm | NewGroup | `Dialog` + `PersonPicker` | skeleton danh sách | "Không có ai khớp "{{q}}"" | lỗi từng mã (`plan-frontend-i18n.md`) hiện `alert` trong dialog | đủ 50 người |
| Thêm người / Thành viên | (mô tả NewGroup) | `Dialog` + `PersonPicker` / danh sách | skeleton | — | `alert` | — |
| Mất kết nối realtime | — | `ConnectionBanner` | — | — | — | "Đang kết nối lại…" (vàng) / "Không kết nối được máy chủ" + Thử lại (đỏ) |
| 404 | — | `RoomNotFound` | — | — | — | tiêu đề + nút "Về trang chào" |
| 403 hết quyền gọi | — | không phát sinh ở phòng (R03 luôn 404); `NOT_ROOM_OWNER` hiện toast "Chỉ chủ nhóm mới làm được việc này" khi UI lệch (vừa mất quyền chủ) và `invalidate detail` | | | | |
| 409 xung đột | — | `DM_IMMUTABLE`, `ROOM_FULL`, `OWNER_MUST_TRANSFER` (`plan-frontend-i18n.md`) | | | | |

**Bố cục phòng** (desktop ≥ 1024, theo Main/DM): `main` = cột (header 60 px · dòng thời gian · composer max 800 px); khung flow bên phải **chưa mount** ở X2a, bố cục dùng wrapper `flex` giống `ConversationPage` (`<div flex-1>` cột chính + chỗ cho `FlowPane` khi X2b) để X2b chỉ thêm 1 dòng `open.flow && <FlowPane…>` (§5.3). < 1024: toàn màn, header có `button "Danh sách hội thoại"` + avatars thu gọn (chỉ "+n"). Nút "Thêm người" ở < 640 chỉ icon + `aria-label`.

## 5. Composer phòng (§5.3)
`Composer` (237 dòng, đã > 200 từ trước — chỉ thêm prop, không tách; TECH-DEBT) nhận: `variant: "main"|"flow"|"room"`, `menus?: boolean` (mặc định `true`; `false` ⇒ `useComposerSuggest` không mở menu `@`/`/`, không gọi `GET /agents`/`/commands`; `@@x`/`//x` không đổi nghĩa — gửi nguyên văn), `attachments?: boolean` (mặc định `true`; `false` ẩn `AttachButton`/`AttachBar`, Q3). Phòng: `menus={false} attachments={false}`; nút Dừng/quota/`locked` không dùng. X2b bật = đổi `menus` thành `true` + placeholder. `draftKey`: `room:<id>` qua `use-draft` (nháp theo phòng). Enter gửi · Shift+Enter xuống dòng (như C1). Giới hạn 16.000 ký tự (`CHAT_CONTENT_MAX`): vượt → nút Gửi `disabled` + hiện "{{n}}/16000" khi ≥ 90 %. `onSubmit` trả `SubmitResult` (`{ok:false,error}` giữ chữ).

## 6. Role + nhãn cho e2e
Nguyên văn locator (sidebar, header, dòng thời gian, composer, tạo nhóm, thêm người, thành viên, xác nhận, đổi tên, trạng thái, `data-testid`) và ghi chú tương thích C1: [`plan-frontend-e2e.md`](plan-frontend-e2e.md) §1. Nhãn đó là hợp đồng với qc, không đổi khi code.

## 7. Câu chữ i18n
Toàn bộ key VI/EN (shell, phòng, dialog, toast, mã lỗi `CHAT_ROOM_ERRORS` → `rtErr.*`): [`plan-frontend-i18n.md`](plan-frontend-i18n.md). Nhóm key mới `rooms`, `directory`, `rtErr`; sửa `shell.newChat`, `shell.search`.

## 8. Validate phía client
| Trường | Luật (khớp contract) | Câu lỗi |
|---|---|---|
| Tên nhóm (tạo, đổi tên) | trim; 1–80 ký tự (R08) | `rooms.name.empty` / `rooms.name.max` (hiện khi blur/submit; nút Tạo `disabled` khi rỗng) |
| Thành viên khi tạo | ≤ 49 người khác + chủ; không ép tối thiểu (khớp spec; `[chờ plan BE]` nếu BE đặt `min(1)`) | `rooms.newGroup.full` |
| Thêm người | chọn ≥ 1; `đã có + chọn ≤ 50`; người đã trong nhóm `disabled` | `rooms.newGroup.full` |
| Nội dung tin | trim; 1…16.000 (`CHAT_CONTENT_MAX` từ contract) | nút Gửi `disabled` |
| Tìm danh bạ | `q` ≤ `LIST_Q_MAX` (cắt ở ô nhập `maxLength`) | — |

## 9. Hiệu năng và bundle
Baseline `check:bundle`: JS 139,9 KB / 150 · CSS 12,9 KB / 25 · chunk lớn nhất 43,4 KB / 50 (đo 2026-10-07). Ước tính thêm vào **bundle ban đầu** (sidebar + realtime + api + i18n, không lười được): ≈ 7–10 KB gzip ⇒ có thể chạm 150 KB. Cách xử lý theo thứ tự: (1) `RoomPage` + mọi dialog lười (chunk riêng ≤ 50 KB); (2) chuỗi i18n `rooms.*` đã nằm trong `vi/en.json` (nạp theo ngôn ngữ như hiện tại, không tách); (3) nếu vẫn > 150 KB → nâng `JS_BUDGET_BYTES` lên 160 KB trong `scripts/check-bundle.ts` kèm dòng trong "Quyết định" (perf thấp ưu tiên, nới ngưỡng, tối ưu sau). Re-render: `RoomListItem` `memo` + selector theo phòng; `unread_total` chỉ cập nhật component badge. Không thêm thư viện, không ADR.

## 10. Trả lời câu hỏi mở FE
| Q | Quyết định |
|---|---|
| Q5 "đã xem" | DM "Đã xem"; nhóm "Đã xem bởi n" + tooltip tên, chỉ dưới tin cuối của mình (§3) |
| Q9 route | `/rooms/$id`; C1 giữ `/c/$id` (§2) |
| Q3 | Composer phòng không nút đính kèm (§5) |
| Q7 | e2e chat chạy **hub-api thật + DB test** (`plan-frontend-e2e.md` §2) |
| Mới FE-1 | Mở DM = ô tìm sidebar mục "Người" (không có nút "Tin nhắn mới" riêng, đúng artboard) |
| Mới FE-2 | Không chip/panel agent; placeholder phòng X2a chưa nhắc `@`/`/` (§5.3) |
| Mới FE-3 | Mobile giữ Sheet danh sách C1 (D9); không màn danh sách riêng |
| Mới FE-4 | Tạo nhóm không bắt buộc ≥ 1 thành viên khác (`[chờ plan BE]`) |

## 11. Cần backend-lead / phụ thuộc BE (`plan.md`, tên là giả định)
| # | Cần | Dùng ở |
|---|---|---|
| 1 | Schema `RoomSummary`, `RoomDetail`, `RoomMessage`, `DirectoryUser`, `CreateRoomRequest`, trang `{items,next_cursor,unread_total}`, `{items,has_more}`; hằng `CHAT_CONTENT_MAX`, `LIST_Q_MAX` | `rooms/api.ts`, `directory/api.ts` |
| 2 | `MeStreamEventSchema` (+ `parseMeStreamEvent(event: string, data: string)`) khớp bảng `spec-isolation.md` §1.1; `ChatRoomErrorCode` export | `realtime`, `lib/http.ts` |
| 3 | `RoomSummary` có sẵn: `kind`, `name` hoặc `peer{id,display_name,username}`, `last_message{sender{id,display_name},preview,created_at,seq}`, `unread`, `member_count`, `last_seq` (để tính "tin cuối") | sidebar, mark-read |
| 4 | `RoomDetail.members[]` có `last_read_seq` (đã có trong spec §3); `owner_id` + `members[]` cho subtitle (tên chủ) | header, "Đã xem" |
| 5 | `POST /rooms/:id/messages` trả `RoomMessage` đầy đủ (kể cả 200 do trùng) và `room.message` gửi cả cho người gửi (có trong spec) — để chèn khử trùng theo `id` | gửi tin |
| 6 | Trong `room.member_added` cho người được thêm có `room: RoomSummary` (có trong spec) | event-router |
| 7 | Thứ tự id của `/me/stream` (`id:` = id Redis Stream, chuỗi) — FE coi là chuỗi mờ, chỉ lưu và gửi lại | driver |
| 8 | Xác nhận không bắt `member_ids.min(1)` khi tạo nhóm (FE-4) | NewGroupDialog |

## 12. E2E
Hub-api thật + DB test (Q7), 2 context trình duyệt; ca E-R1…E-R11 và unit FE: [`plan-frontend-e2e.md`](plan-frontend-e2e.md) §2.

## 13. Task BUILD (chi tiết hoá F1–F3 của `tasks.md` → F1–F6; mỗi task một commit, diff ≈ ≤ 400 dòng không tính test)
"Lệnh chung" (L) = `bunx biome check --write <file đổi>` · `bun run check:size` · `bun run depcruise --all` · `bun run check:fn` (+ `--all` ở F6) · `bun run i18n:check` · `bun run --filter @ai/chat-web typecheck`.
| # | Task | File chính | Đọc | Lệnh xong (ngoài L) | Phụ thuộc |
|---|---|---|---|---|---|
| F1 | Nền: proxy `/directory` `/rooms` `/me`; `ApiErrorCode` + `ChatRoomErrorCode`; `directory/api.ts`, `rooms/api.ts` + hooks query/mutation; `rooms/lib/{room-cache,room-errors,room-logic}`; i18n `rtErr.*`, `directory.*` | `rsbuild.config.ts`, `lib/http.ts`, `features/{directory,rooms}/**` | plan-frontend §1, §3 (key), plan-frontend-i18n (rtErr, directory), §11 | `bun test apps/chat-web/src/features/rooms apps/chat-web/src/features/directory` | B2 |
| F2 | Realtime: `realtime/{driver,store,event-router,runtime,hooks}`; mount trong `AppShell`; `useConnection` thêm `realtime.phase`; xử lý `stream.reset`, 401 | `features/realtime/**`, `shell/components/AppShell.tsx`, `shell/hooks/use-connection.ts` | plan-frontend §3 (client + bảng sự kiện), `spec-isolation §1.1` | `bun test apps/chat-web/src/features/realtime apps/chat-web/src/features/shell` | F1, B6 (để e2e) |
| F3 | Sidebar: `RoomSections`, `RoomListItem`, huy hiệu + tổng, tìm "Người" → mở DM, nút "Hỏi AI"/"Nhóm mới", đổi `shell.*`; route `rooms.$id` (trang tạm `RoomPage` khung) + `roomIdOf` | `shell/components/{Sidebar,RoomSections}.tsx`, `rooms/components/RoomListItem.tsx`, `routes/_authed/rooms.$id.tsx` | plan-frontend §2, §4 (Sidebar), plan-frontend-e2e §1 (Sidebar), plan-frontend-i18n | `bun test apps/chat-web/src/features/shell` · `bun run --filter @ai/chat-web build && bun run --filter @ai/chat-web check:bundle` | F2, B4 |
| F4 | Màn phòng: header, timeline (ngày, tải cũ, pill), `Composer` prop `variant="room"` `menus`/`attachments`, gửi + `client_msg_id`, `use-mark-read`, `SeenMark`, `RoomNotFound`, khung §5.3 | `rooms/{pages,components,hooks}/**`, `composer/components/Composer.tsx` | plan-frontend §3 (timeline, đã đọc, đã xem), §4, §5, plan-frontend-e2e §1 (Header, Dòng thời gian, Composer), plan-frontend-i18n | `bun test apps/chat-web/src/features/{rooms,composer}` · e2e qc E-R1,E-R3,E-R7,E-R8,E-R10 (`bunx playwright test -c e2e/chat/playwright.x2a.config.ts --reporter=line` + `tail -40`)\| tail -40`) | F3, B5 |
| F5 | Tạo nhóm: `PersonPicker`, `NewGroupDialog`, đếm/50, lỗi `ROOM_FULL`…, điều hướng sau tạo | `directory/components/PersonPicker.tsx`, `rooms/components/dialogs/NewGroupDialog.tsx` | plan-frontend-e2e §1 (Tạo nhóm), plan-frontend-i18n (dialog, toast, lỗi), §8 | `bun test` thư mục `rooms`,`directory` · e2e E-R2,E-R4 | F4 |
| F6 | Quản lý: `MembersDialog`, `AddMembersDialog`, `RenameRoomDialog`, `ConfirmRoomDialog` (xoá/rời/bớt/chuyển chủ/mustTransfer), ẩn DM, xử lý sự kiện mất quyền khi đang mở; tổng kết: i18n đủ, a11y, `check:bundle`, README (`realtime`,`directory`,`rooms`, chat-web), TECH-DEBT (virtualize timeline, tách `Composer`, bỏ dấu tìm danh bạ Q6) | `rooms/components/dialogs/**`, README các feature, `docs/TECH-DEBT.md` | plan-frontend-e2e §1 (Thêm người…Xác nhận), plan-frontend-i18n, §9 | `bun run check:fn --all` · `bun run depcruise --all` · `bun run --filter @ai/chat-web build && bun run --filter @ai/chat-web check:bundle` · `bun test apps/chat-web` · e2e QC `x2a` đủ (E-R1…R11) · `bun run test:lock:verify` | F5 |
Cuối F6: `bun run typecheck` · `bun test apps/chat-web` · e2e chat C1 cũ không đổi (`bun run e2e:chat`) · `bun run trace --check`.

## 14. Quyết định trong lúc làm (FE, PLAN)
- 2026-10-07 D1–D9, FE-1…FE-4 ở trên; ngưỡng JS nới 150 → 160 KB nếu vượt (perf thấp ưu tiên).
- Đổi chữ `shell.newChat`/`shell.search` theo canvas; e2e C1 hiện dùng substring nên không vỡ — qc xác nhận ở QC1.
- Tiêu đề hai mục sidebar là `h3`, giữ `h2` cho nhóm thời gian "Hỏi AI" (khoá bởi e2e C1 `CHAT-AC-19`).

## 15. Rủi ro
| Rủi ro | Giảm |
|---|---|
| Bundle ban đầu chạm 150 KB | lười hoá trang + dialog; nới ngưỡng có ghi (§9) |
| Tin trùng/mất khi `room.message` và `POST` đến lệch thứ tự | khử trùng theo `message.id`, sắp theo `seq`; unit `event-router` |
| `Composer` > 200 dòng thêm prop | chỉ thêm prop; ghi TECH-DEBT, tách khi chạm đoạn khác |
| Tab ẩn nhiều: nhiều kết nối | giới hạn server ≤ 5/user; chấp nhận |
| Contract BE đổi tên | mọi tham chiếu tên ở §11 là giả định; đổi ở F1 |
