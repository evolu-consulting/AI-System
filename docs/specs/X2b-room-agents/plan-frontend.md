# X2b · Plan frontend (`apps/chat-web`)

Spec: [`spec.md`](spec.md) §1–2, §5, §8–9 (Q1–Q12 dùng **mặc định**) · nền X2a: `../X2a-rooms/spec.md` §5.2–5.3, `../X2a-rooms/plan-frontend.md` · canvas `docs/design/chat-app/canvas-x2/` (Main: menu `@`, khối agent, "Đang chờ … xác nhận"; DM: "Dừng"/"Chỉ … dừng được") · token Tailwind sẵn có (indigo UI-1), không hex.
Phụ lục: [`plan-frontend-i18n.md`](plan-frontend-i18n.md) (câu chữ VI/EN) · [`plan-frontend-e2e.md`](plan-frontend-e2e.md) (role/nhãn + ca e2e).
Contract: chỉ **tiêu thụ** `@ai/contracts/chat`; mọi trường mới dưới đây là **đề xuất cho backend-lead** (§10), tên là giả định tới khi `plan.md` chốt.

## 0. Quyết định chính
| # | Quyết định |
|---|---|
| D1 | Không feature mới: agent-trong-phòng nằm ở `features/rooms` (thư mục con `components/agent/`, `components/flow/`). Dùng lại `composer`, `answer` (AnswerBody, AskCard, StepList, ErrorCard), `thread/FlowFooter`, `run` (driver SSE), `flow-panel` (khung) |
| D2 | Menu `@`: `Composer` thêm giá trị `menus="agents"` (chỉ `@`, **không** `/` — Q10; `/x` gửi nguyên văn). Nguồn `useAgentMenu` = `GET /agents` của người đang xem (R14). Mở phòng → `invalidateQueries(["agents","menu"])` một lần theo `roomId` (agent bị thu hồi biến mất sau tải lại, AC13) |
| D3 | Không panel, không chip agent (CR-048). DOM phòng không có vùng nào ngoài menu `@` liệt kê agent (AC13 kiểm) |
| D4 | Placeholder tách khỏi nhãn: giữ `aria-label` X2a (`textbox "Tin nhắn cho nhóm"` / `"Tin nhắn cho <tên>"`, e2e X2a không đổi), thêm prop `placeholder` gợi ý `@` + dòng gợi ý dưới ô (canvas Main) |
| D5 | Gửi tin phòng trả `SubmitResult` như C1: mã composer (`AGENT_NOT_FOUND`, `TOO_MANY_RUNS`, `CMD_MISSING_ARG` dạng `tagOnly`, `ATTACHMENT_NOT_FOUND`) → `SendErrorNotice` trong ô, **giữ nguyên chữ**, gợi ý "Ý bạn là" chèn `@key`; 429 đếm ngược `Retry-After`. Mã khác → toast X2a `rooms.toast.sendFailed`. Tin lỗi không vào timeline (Q4) |
| D6 | Khối agent = `AgentBlock` (bố cục canvas Main: đầu khối "Tên agent · `@key` · <A> hỏi · giờ" → thân `Answer` C1 → `AnswerExtras` → chân "n bước · s" + "Chạy bằng quyền của <A>" + `FlowFooter`). Tin gọi của người vẫn là tin phẳng (X2a `MessageItem`), không lồng câu hỏi vào khối như C1 |
| D7 | Khối "đang chạy" (`PendingAgentBlock`) nằm **cuối timeline** (như đang gõ) chứ không ngay dưới tin gọi: kết quả cuối có `seq` lúc xong nên cũng ở cuối → không nhảy chỗ. Nhiều run song song → nhiều khối theo `started_at` |
| D8 | Stream chữ: chỉ **người gọi** mở `sse:<run_id>` (`GET /runs/:id/events`, driver C1) với phạm vi `room:<roomId>` trong `run-store`; người khác chỉ thấy "<agent> đang xử lý…" rồi kết quả cuối (Q1). Khử trùng theo `run_id`: có `room.message` agent cùng `run_id` → bỏ khối chờ + `dismiss` run |
| D9 | Nút theo vai: người gọi thấy "Dừng" (cancel C1), chip trả lời/Đồng ý-Huỷ, "Trả lời tiếp"; người khác thấy "Chỉ <A> dừng được", "Đang chờ <A> …" (không tham số, Q5/R12), nút "Xem flow" (chỉ-đọc, Q7/Q11). Vai lấy từ `caller.id === me.id`, **không** suy từ quyền agent |
| D10 | Khung flow phòng: `?flow=<flow_id>` trên `/rooms/$id` (route X2a đã nhận). Tách `flow-panel/components/FlowFrame.tsx` (aside ≥ 640 / Sheet < 640, Esc, kéo đóng) từ `FlowPanel`/`FlowSheet`; C1 dùng `FlowFrame + FlowContent` như cũ, phòng dùng `FlowFrame + RoomFlowContent`. `RoomFlowPane` `React.lazy` |
| D11 | Đính kèm (Q9) là **task F5 cắt được**: chỉ bật `attachments` ở `RoomComposer` + `AttachmentList` trong `MessageItem`; cắt → giữ `attachments={false}` X2a, không ảnh hưởng F1–F4 |
| D12 | Không thư viện mới, không ADR |

## 1. Cấu trúc file (file ≤ 250 dòng, component ≤ 200)
```
features/rooms/
├─ api.ts                       # + sendRoomMessage trả {message, run?}; listFlowMessages(roomId, flowId, before_seq); dùng cancelRun của run/api
├─ hooks/
│  ├─ use-send-room-text.ts     # (sửa) trả SubmitResult; có run → runDriver.attach phạm vi phòng
│  ├─ use-room-runs.ts          # run đang chạy/chờ của phòng (từ detail.active_runs + sự kiện)
│  ├─ use-agent-block.ts        # RoomMessage agent + run store → props AgentBlock
│  ├─ use-room-flow.ts          # ?flow= → flow + tin flow (infinite) + gửi trong flow
│  └─ use-agent-menu-refresh.ts # invalidate menu @ khi đổi roomId
├─ lib/room-agent.ts            # thuần: vai (caller/khác), nhãn chờ, lọc tin main/flow, đếm chưa đọc/pill, tag đầu tin
├─ components/agent/
│  ├─ AgentBlock.tsx            # khối kết quả (D6)
│  ├─ AgentBlockHeader.tsx      # tên · @key · "<A> hỏi" · giờ · trạng thái
│  ├─ PendingAgentBlock.tsx     # "<agent> đang xử lý…" + Dừng/"Chỉ A dừng được"; stream cho người gọi
│  └─ WaitingNote.tsx           # "Đang chờ A xác nhận/trả lời" (người khác)
├─ components/flow/
│  ├─ RoomFlowPane.tsx          # FlowFrame + RoomFlowContent (lazy)
│  └─ RoomFlowContent.tsx       # FlowHeader + tin flow + composer (người gọi) | ghi chú chỉ-đọc
├─ components/timeline/MessageItem.tsx   # (sửa) nhánh agent → AgentBlock; tô `@key` đầu tin
└─ components/RoomComposer.tsx  # (sửa) menus="agents", placeholder, gợi ý, attachments (F5)
features/composer/components/{Composer,composer-types}.tsx   # menus: boolean | "agents"; placeholder; menuTitle
features/composer/hooks/use-suggest.ts                        # bỏ nhánh `/` khi "agents"
features/flow-panel/components/{FlowFrame(mới),FlowPanel,FlowSheet,FlowContent}.tsx  # tách khung; export FlowHeader
features/realtime/event-router.ts                             # + room.run_started/waiting/finished; room.message có flow → cache flow
features/answer/components/AskCard.tsx                        # + prop `title?` ("<agent> cần thêm thông tin")
```
`Composer.tsx` đang 200 dòng: phần `menus`/`placeholder` đưa vào `composer-logic`/`use-suggest`, không phình component (nếu vẫn vượt → tách `ComposerMenus.tsx`). `lib/http.ts`: thêm `NOT_RUN_CALLER` vào `ApiErrorCode` khi contract có.

## 2. Route và điều hướng
| Hành vi | Chi tiết |
|---|---|
| `/rooms/$id?flow=<flow_id>` | Mở `RoomFlowPane` bên phải (≥ 640) / sheet đáy (< 640). Flow lạ hoặc không thuộc phòng (404 từ `listFlowMessages`) → bỏ `flow` (replace), không báo lỗi — như C1 `useOpenFlow` |
| "Trả lời tiếp"/"Xem flow" | `navigate({ search: { flow } })`; đóng ✕/Esc/kéo → xoá `flow`, focus lại nút trên khối (`[data-flow-reply]`) |
| Mất phòng khi khung mở | X2a `useRoomLost` giữ nguyên (về `/c/new` + toast); khung đóng theo route |
| Chọn agent ở menu | Chèn `@key ` đầu tin (R15), con trỏ cuối; `@@` không mở menu |

## 3. Dữ liệu, cache, realtime
| Nguồn | Cache / xử lý |
|---|---|
| `GET /rooms/:id/messages` | Như X2a; FE coi tin có `flow_id` mà **không phải tin gốc flow** là tin-trong-flow → không vào timeline chính, không tính pill (giả định cờ `placement`, §10 #2) |
| `GET /rooms/:id` | Thêm `active_runs[]` (§10 #4) → nguồn khối chờ khi tải lại / vào phòng giữa chừng |
| `POST /rooms/:id/messages` | 201 `{message, run?}` (§10 #1): chèn tin gọi; có `run` → `runDriver.attach({ convId: "room:"+roomId, runId, flowId, origin:"main" })` + thêm vào `active_runs` cache (người gọi thấy ngay, không chờ sự kiện) |
| `room.run_started` | `patchDetail` thêm run (khử trùng `run_id`) → mọi thành viên thấy "<agent> đang xử lý…" (R10, AC16) |
| `room.run_waiting` | Cập nhật `status=waiting`, `wait_kind`; người khác: `WaitingNote`; người gọi: chờ tin agent có `ask` |
| `room.run_finished` | Bỏ run khỏi `active_runs`; `cancelled` không có tin (Q8) → khối biến mất; `failed` → tin agent lỗi (R16) đến qua `room.message` |
| `room.message` agent | Chèn timeline (main) hoặc cache flow `roomKeys.flow(roomId, flowId)` (flow); tăng `flow.message_count` của tin gốc; `dismiss` run trùng `run_id` |
| `stream.reset` | X2a đã `invalidate` phòng; thêm `invalidate` detail (active_runs) và các cache flow đang mở |

Chưa đọc/pill (R19): `NewMessagesPill` và `lastIsMine` (đánh dấu đã đọc) coi tin agent có `caller.id === me` là "của mình"; tin-trong-flow không tính pill. Huy hiệu sidebar vẫn lấy từ server (`room.unread`). Xem trước sidebar: tin agent → "<tên agent>: …" (X2a `sender.display_name`).

## 4. Màn ↔ artboard ↔ trạng thái
| Thành phần | Artboard | Trạng thái (câu chữ ở phụ lục i18n) |
|---|---|---|
| Composer phòng | Main/DM/Mobile | placeholder gợi ý `@`; gợi ý dưới ô (≥ 640); menu `@`: đang tải / rỗng "Bạn chưa được cấp agent nào" / không khớp / lỗi + "Thử lại" (C1); lỗi gửi trong ô (D5) |
| Menu `@` | Main | tiêu đề "Agent bạn dùng được"; mục = tên (vi/en theo ngôn ngữ) + `@key` mono + mô tả 1 dòng; điện thoại: cùng menu, mục cao ≥ 44px |
| Tin gọi | Main | tin phẳng X2a; `@key` đầu tin tô `text-primary font-medium` (chỉ hiển thị, R16 X2a giữ chữ) |
| `PendingAgentBlock` | DM | người gọi: stream chữ + con trỏ + "Dừng"; người khác: "<agent> đang xử lý…" (`role="status"`) + "Chỉ <A> dừng được"; cold-start: `ColdResumeNote` C1 (người gọi) |
| `AgentBlock` xong | Main | thân Markdown, bước, Copy, "Chạy bằng quyền của <A>", `FlowFooter` ("+n tin trong flow · thời gian", "Trả lời tiếp"/"Xem flow") |
| Chờ `need_input` | (C1 AskCard) | người gọi: AskCard "<agent> cần thêm thông tin" + chip (bấm = gửi trong flow); người khác: câu hỏi hiện (là tin phòng, U1) nhưng **không** chip + "Đang chờ <A> trả lời agent." |
| Chờ `side_effect` | Main ("Đang chờ … xác nhận") | người gọi: mô tả hành động + chip "Đồng ý"/"Huỷ" (choices từ server); người khác: **chỉ** "Đang chờ <A> xác nhận — chỉ người hỏi mới bấm được." + tên agent, không mô tả hành động (Q5; khác canvas "Agent muốn gửi email thật" — spec thắng) |
| Lỗi run | — | `ErrorCard` C1 với câu chung `roomAgent.failed` cho cả phòng (không lộ quota, R16); "Chạy lại" chỉ người gọi; đã dừng: `CancelledNote` (chỉ người gọi có "Chạy lại") |
| Huỷ do mất quyền (Q2) | — | tin agent trạng thái huỷ: "Đã huỷ vì <A> không còn quyền dùng agent này." chỉ người gọi; người khác "Đã huỷ" |
| Khung flow | C1 Flow panel | người gọi: như C1 ("Trả lời trong flow…"); người khác: thay composer bằng ghi chú chỉ-đọc (Q7) + không có "Dừng"; đang tải: skeleton C1; lỗi tải: "Không tải được flow" + "Thử lại" |
| Mất quyền phòng | X2a | như X2a (về `/c/new`); run của người gọi bị huỷ phía server (Q8), FE chỉ `dismiss` khi nhận `run_finished` |
| `NOT_RUN_CALLER` (403) | — | đua quyền hiếm (UI đã ẩn nút): toast `roomAgent.toast.notCaller` + `invalidate` detail |
| `TOO_MANY_RUNS` / quota | — | chỉ người gọi, trong composer (D5); không phát cho phòng (AC08) |

## 5. Composer phòng
`<Composer variant="room" menus="agents" attachments={F5} inputLabel={nhãn X2a} placeholder={roomAgent.placeholder.*} menuTitle={menu.agentsYours} />`. Khoá Gửi khi run của chính mình trong phòng đang chạy? **Không** (phòng là chat người↔người; giới hạn do `max_concurrent_runs` server); chỉ khoá khi `submitting`. Nháp theo phòng như X2a. Composer khung flow: `variant="flow"`, `menus="agents"` (C1 cho phép `@` trong flow), `running` = run của flow đang chạy → nút Dừng.

## 6. Validate phía client
| Trường | Luật | Câu lỗi |
|---|---|---|
| Nội dung | trim 1…`CHAT_CONTENT_MAX` (X2a) | X2a (bộ đếm, Gửi disabled) |
| Tag đầu tin | không kiểm ở client (server là nguồn, R02/R04); chỉ `@key` rỗng nội dung → để server trả `CMD_MISSING_ARG` → `sendError.tagOnly` | "Hãy nhập nội dung sau @{{tag}}." |
| Tệp (F5) | luật C1 `attachments/lib/validate.rules.ts` | câu C1 `attach.*` |

## 7. Hiệu năng
`AgentBlock` `memo` theo `message.id` + `updated` của run; selector `run-store` theo `run_id` (không re-render cả timeline khi stream). `AnswerBody` (Markdown) đã trong chunk C1 — chunk `/rooms/$id` tăng, chấp nhận (ưu tiên thấp, CONVENTIONS §6 nới được); `RoomFlowPane` lazy. Timeline chưa virtualize (TECH-DEBT X2a giữ nguyên).

## 8. Trả lời câu hỏi mở (FE) — theo mặc định spec §9
| Q | FE áp dụng |
|---|---|
| Q1 | Không token từng đoạn cho người khác; chỉ người gọi stream (D8) |
| Q2 | Câu "Đã huỷ…" (§4); không kiểm quyền ở client |
| Q4 | Lỗi → chữ ở lại ô, không chèn tin (D5) |
| Q5 | `WaitingNote` không có mô tả/tham số; người gọi thấy đủ |
| Q6 | Không ảnh hưởng FE |
| Q7/Q11 | "Xem flow" + khung chỉ-đọc cho người khác |
| Q8 | Khối chờ biến mất khi `run_finished: cancelled`; không toast cho người khác |
| Q9 | F5 cắt được (D11) |
| Q10 | `menus="agents"`; placeholder không nhắc `/` (khác canvas Main "/ để chạy lệnh" — spec thắng) |

## 9. Task BUILD (chi tiết hoá F1 của `tasks.md` → F1–F6; mỗi task một commit, diff ≈ ≤ 400 dòng không tính test)
"L" = `bunx biome check --write <file đổi>` · `bun run check:size` · `bun run depcruise --all` · `bun run check:fn` · `bun run i18n:check` · `bun run --filter @ai/chat-web typecheck`.
| # | Task | File chính | Đọc | Lệnh xong (ngoài L) | Phụ thuộc |
|---|---|---|---|---|---|
| F1 | Menu `@` phòng: `menus="agents"`, `placeholder`, `menuTitle`, refresh menu khi mở phòng; gửi trả `SubmitResult` (D5) + `{message, run?}`; tô `@key` đầu tin; i18n `roomAgent.placeholder/hint` | `composer/**`, `rooms/components/RoomComposer.tsx`, `rooms/hooks/use-send-room-text.ts`, `rooms/api.ts`, `timeline/MessageItem.tsx` | §0 D2–D5, §5, i18n §1, e2e §1 Composer | `bun test apps/chat-web/src/features/{composer,rooms}` · e2e X2a cũ xanh · AC13 | B1 (contract) |
| F2 | Khối agent: `event-router` 3 sự kiện run, `use-room-runs`, `PendingAgentBlock` (stream người gọi, Dừng), `AgentBlock` + header, lỗi/đã dừng, pill/đã đọc (§3) | `rooms/components/agent/**`, `rooms/hooks/{use-room-runs,use-agent-block}.ts`, `rooms/lib/room-agent.ts`, `realtime/event-router.ts` | §0 D6–D9, §3, §4, i18n §2 | `bun test …/rooms …/realtime` · AC01, AC16 | F1, B2 |
| F3 | Chờ: AskCard (`title`), chip gửi trong flow (người gọi), `WaitingNote` (người khác), `NOT_RUN_CALLER`, huỷ Q2 | `answer/components/AskCard.tsx`, `agent/WaitingNote.tsx`, `use-agent-block.ts` | §4 (chờ), i18n §2 | `bun test …/rooms …/answer` · AC05, AC06 | F2 |
| F4 | Khung flow phòng: tách `FlowFrame`, `RoomFlowPane` lazy, `use-room-flow`, chỉ-đọc người khác, sheet điện thoại | `flow-panel/components/**`, `rooms/components/flow/**`, `rooms/hooks/use-room-flow.ts` | §0 D10, §2, i18n §3 | `bun test …/flow-panel …/rooms` · AC15 · `bun run e2e:chat` (C1, AC-H07 không đổi) | F2 |
| F5 | (cắt được → X2b-2) Đính kèm trong phòng: bật `attachments`, `attachment_ids` khi gửi, `AttachmentList` trong tin, lỗi `ATTACHMENT_NOT_FOUND` | `rooms/components/RoomComposer.tsx`, `timeline/MessageItem.tsx`, `use-send-room-text.ts` | §0 D11, §10 #7 | `bun test …/rooms …/attachments` · AC11 (vế UI) | F1, B (đính kèm) |
| F6 | Đóng FE: README `rooms`/`flow-panel`/chat-web, TECH-DEBT, a11y bàn phím menu/khối, `check:bundle` | README, `docs/TECH-DEBT.md` | §7 | `bun run check:fn --all` · `bun run --filter @ai/chat-web build && bun run --filter @ai/chat-web check:bundle` · `bunx playwright test X2b` · `bun run e2e:chat` | F1–F4 (+F5) |

## 10. Đề xuất cho backend-lead (FE cần; BE chốt tên ở `plan.md`)
| # | Cần | Lý do |
|---|---|---|
| 1 | `POST /rooms/:id/messages` → `{ message, run?: { id, flow_id, agent } }` (201); lỗi `AGENT_NOT_FOUND` (`details.tag`, `details.suggestions` ≤ 3 key **người gửi** dùng được), `TOO_MANY_RUNS` 429 + `Retry-After`, `CMD_MISSING_ARG` | Người gọi stream ngay (D8), lỗi trong ô (D5, AC02) |
| 2 | `RoomMessage` thêm: `placement: "main" \| "flow"` (hoặc cách tương đương phân biệt tin gốc flow), `agent?: { key, name: {vi,en} }`, `caller?: RoomUserRef`, `flow?: { message_count, last_active_at }` (tin gốc), `status?: "ok" \| "failed" \| "cancelled"`, `ask?: { kind: "need_input" \| "side_effect", question?, choices? }`, `steps?: { count, ms }` | Dựng khối D6, "<A> hỏi", "Chạy bằng quyền của <A>", đếm flow |
| 3 | `ask.question/choices` của `side_effect` **chỉ trả cho người gọi** (lọc theo người xem ở list và `/me/stream`); người khác nhận `ask: { kind }` | Q5/R12 không dựa vào UI ẩn |
| 4 | `GET /rooms/:id` thêm `active_runs: [{ run_id, trigger_message_id, flow_id, agent, caller, status: "running"\|"waiting", wait_kind?, started_at }]` | Khối chờ sau tải lại / thành viên vào giữa chừng |
| 5 | Sự kiện `room.run_started {room_id, run_id, trigger_message_id, flow_id, agent, caller}`, `room.run_waiting {room_id, run_id, caller_id, kind}`, `room.run_finished {room_id, run_id, status: "finished"\|"failed"\|"cancelled"}`; kết quả qua `room.message` | Q1, AC16 |
| 6 | `GET /rooms/:id/messages?flow_id=&before_seq=` (tin flow, seq tăng, 404 nếu flow không thuộc phòng); `POST /rooms/:id/messages` nhận `flow_id?` (chỉ người gọi gốc, khác → 403 `NOT_RUN_CALLER`) | Khung flow D10, Q7 |
| 7 | (F5) `SendRoomMessageRequest.attachment_ids?`, `RoomMessage.attachments?: AttachmentRef[]`; `GET /attachments/:id/content` cho thành viên phòng chứa tin | Q9 |
| 8 | `NOT_RUN_CALLER` trong `CHAT_ROOM_ERRORS`; cancel `POST /runs/:id/cancel` của run phòng chỉ người gọi | D9 |

## 11. Câu hỏi UX mới (có mặc định)
| # | Câu hỏi | Mặc định FE |
|---|---|---|
| U1 | Câu hỏi `need_input` có hiện cho người khác? | **Có** (là nội dung trả lời của agent), chỉ ẩn chip; `side_effect` thì ẩn hết (Q5) |
| U2 | Nút trên khối cho người không phải người gọi? | "Xem flow" thay "Trả lời tiếp" (tránh hứa điều không làm được) |
| U3 | Khối "đang xử lý" đặt đâu? | Cuối timeline (D7) |
| U4 | Canvas DM tag giữa câu ("Ok em. @assistant …") | Không gọi agent (R02); tô màu chỉ `@key` đầu tin |

## 12. Rủi ro
| Rủi ro | Giảm |
|---|---|
| Tách `FlowFrame` làm hỏng khung flow C1 | F4 chạy `bun run e2e:chat` + AC-H07; giữ nguyên props/aria C1 |
| `Composer.tsx` vượt 200 dòng | Logic `menus` vào hook/lib; tách `ComposerMenus` nếu cần |
| Contract BE khác giả định §10 | F1 làm sau B1; chỉnh tên trong `rooms/api.ts`/`room-agent.ts`, không lan component |
| Lộ `side_effect` qua UI | Không chỉ ẩn ở UI: §10 #3; e2e B kiểm DOM không có mô tả |
