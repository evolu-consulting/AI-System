# X2b · Plan frontend (`apps/chat-web`)

Spec: [`spec.md`](spec.md) §1–2, §5, §8–9 (Q1–Q12 mặc định, trừ **Q7 chốt 2026-10-08 lần 2**: thread = luồng chung của phòng, mọi thành viên nhắn được; chỉ tag `@agent` mới chạy run, bằng quyền + quota **người tag**; trả lời/xác nhận lượt nào chỉ người tag lượt đó, FE gửi `answer_run_id`) · nền X2a: `../X2a-rooms/spec.md` §5.2–5.3, `../X2a-rooms/plan-frontend.md` · canvas `docs/design/chat-app/canvas-x2/` (Main: menu `@`, khối agent, "Đang chờ … xác nhận"; DM: "Dừng"/"Chỉ … dừng được") · token Tailwind sẵn có (indigo UI-1), không hex.
Phụ lục: [`plan-frontend-i18n.md`](plan-frontend-i18n.md) (câu chữ VI/EN) · [`plan-frontend-e2e.md`](plan-frontend-e2e.md) (role/nhãn + ca e2e).
Contract: chỉ **tiêu thụ** `@ai/contracts/chat`; tên trường/lỗi/sự kiện theo contract BE đã chốt ở `plan.md` §2, §12 (commit `8c8ef16`); §10 đối chiếu.

## 0. Quyết định chính
| # | Quyết định |
|---|---|
| D1 | Không feature mới: agent-trong-phòng nằm ở `features/rooms` (thư mục con `components/agent/`, `components/flow/`). Dùng lại `composer`, `answer` (AnswerBody, AskCard, StepList, ErrorCard), `thread/FlowFooter`, `run` (driver SSE), `flow-panel` (khung) |
| D2 | Menu `@`: `Composer` thêm giá trị `menus="agents"` (chỉ `@`, **không** `/` — Q10; `/x` gửi nguyên văn). Nguồn `useAgentMenu` = `GET /agents` của người đang xem (R14). Mở phòng → `invalidateQueries(["agents","menu"])` một lần theo `roomId` (agent bị thu hồi biến mất sau tải lại, AC13) |
| D3 | Không panel, không chip agent (CR-048). DOM phòng không có vùng nào ngoài menu `@` liệt kê agent (AC13 kiểm) |
| D4 | Placeholder tách khỏi nhãn: giữ `aria-label` X2a (`textbox "Tin nhắn cho nhóm"` / `"Tin nhắn cho <tên>"`, e2e X2a không đổi), thêm prop `placeholder` gợi ý `@` + dòng gợi ý dưới ô (canvas Main) |
| D5 | Gửi tin phòng trả `SubmitResult` như C1; 201 body = `RoomMessage`, run đọc từ header `X-Run-Id`/`X-Flow-Id` (BE D11). Mã composer (`AGENT_NOT_FOUND` — `details` chỉ `{suggestions}`, tag lấy từ ô nhập; trong thread chỉ khi có tag, `details.suggestions`; `TOO_MANY_RUNS`; `FLOW_BUSY` 409 (cùng người đang chạy) → `roomAgent.flowBusy`; `CMD_MISSING_ARG` dạng `tagOnly`) → `SendErrorNotice` trong ô, **giữ nguyên chữ**, gợi ý "Ý bạn là" chèn `@key`; 429 đếm ngược `Retry-After`. Mã khác → toast X2a `rooms.toast.sendFailed`. Tin lỗi không vào timeline (Q4) |
| D6 | Khối agent = `AgentBlock` (đầu khối "Tên agent · `@key` · <B> hỏi · giờ" → thân `Answer` C1 → `AnswerExtras` → chân "n bước · s" + "Chạy bằng quyền của <B>" + `FlowFooter`). **<B> = `message.caller` của chính tin đó**: mỗi lượt có thể khác người (Q7), nên khối đầu flow "Lan hỏi", khối trả lời tiếp "Hà hỏi". Tin gọi của người vẫn là tin phẳng (X2a `MessageItem`) |
| D7 | Khối "đang chạy" (`PendingAgentBlock`) nằm **cuối timeline** (như đang gõ) chứ không ngay dưới tin gọi: kết quả cuối có `seq` lúc xong nên cũng ở cuối → không nhảy chỗ. Nhiều run song song → nhiều khối theo `started_at` |
| D8 | Stream chữ: chỉ **người gửi lượt** (`caller.id === me`) mở `sse:<run_id>` (`GET /runs/:id/events`, driver C1; `run_id` từ header `X-Run-Id`) với phạm vi `room:<roomId>` trong `run-store`; người khác chỉ thấy "<agent> đang xử lý…" rồi kết quả cuối (Q1). Khử trùng theo `run_id`: có `room.message` agent cùng `run_id` → bỏ khối chờ + `dismiss` run |
| D9 | Nút theo vai **theo từng lượt**. Vai = `message.caller.id === me.id`, không suy từ quyền agent. Người tag lượt: "Dừng", chip trả lời/Đồng ý-Huỷ. Người khác: "Chỉ <B> dừng được", "Đang chờ <B> …" (không tham số, Q5/R12) và **vẫn nhắn thường** trong thread. "Trả lời tiếp" luôn bật cho mọi thành viên (mở thread, có composer); **không** còn `can_reply`, nút tắt, "Xem flow" chỉ-đọc, `noReplyAccess`, `flowNoAccess` |
| D10 | Khung flow phòng: `?flow=<flow_id>` trên `/rooms/$id`. Tách `flow-panel/components/FlowFrame.tsx` (aside ≥ 640 / Sheet < 640, Esc, kéo đóng) từ `FlowPanel`/`FlowSheet`; C1 dùng `FlowFrame + FlowContent` như cũ, phòng dùng `FlowFrame + RoomFlowContent`. `RoomFlowPane` `React.lazy`. Nội dung = mọi tin flow (`GET …?flow_id=`, gồm tin gốc), **mỗi lượt ghi tên người gửi** (tin người: tên X2a; tin agent: "<B> hỏi" + "Chạy bằng quyền của <B>"/"của bạn"); FE hiển thị như **một** luồng hội thoại dù server tách flow theo người (BE D12) |
| D11 | Đính kèm (Q9) BE đề xuất **tách X2b-2** (chờ người dùng duyệt); F5 giữ riêng, **có thể cắt**: chỉ bật `attachments` ở `RoomComposer` + `AttachmentList` trong `MessageItem`; cắt → giữ `attachments={false}` X2a, không ảnh hưởng F1–F4 |
| D12 | Không thư viện mới, không ADR |
| D13 | Gửi trong thread: `{content, flow_id}` cho **mọi** thành viên. Không tag đầu tin = tin người↔người (201, không `X-Run-Id`/`X-Flow-Id`, không chạy agent, không kiểm quyền agent). Tag `@agent` (menu `@` như composer phòng) = run mới bằng quyền + quota người tag; thiếu quyền → 404 `AGENT_NOT_FOUND`: **giữ nội dung composer**, gợi ý từ `details.suggestions`. Trả lời ask/xác nhận lượt **của mình** đang `waiting`: PHẢI gửi `{flow_id, answer_run_id}` (từ `active_runs`/tin agent có `ask` và `caller.id===me`; chip bấm = `choice` kèm id; thiếu `answer_run_id` server coi là tin thường). Người khác không có chip (lệch → 403 `NOT_RUN_CALLER`); run không chờ/thread lạ → 404 `NOT_FOUND` → toast + invalidate. Hai người tag song song → 2 run, 2 khối "đang xử lý" (D7). Cùng người đang chạy → `FLOW_BUSY`. Gợi ý nhỏ dưới composer thread: `roomAgent.threadContextHint` (agent đọc cả thread ≤ `ROOM_THREAD_CONTEXT_MAX` = 50 tin + 20 tin timeline) |

## 1. Cấu trúc file (file ≤ 250 dòng, component ≤ 200)
```
features/rooms/
├─ api.ts                       # + sendRoomMessage trả {message, runId?, flowId?} (đọc header; body = RoomMessage); + flow_id/answer_run_id; listFlowMessages(roomId, flowId, before_seq); dùng cancelRun của run/api
├─ hooks/
│  ├─ use-send-room-text.ts     # (sửa) trả SubmitResult; có run → runDriver.attach phạm vi phòng
│  ├─ use-room-runs.ts          # run đang chạy/chờ của phòng (từ detail.active_runs + sự kiện)
│  ├─ use-agent-block.ts        # RoomMessage agent + run store → props AgentBlock
│  ├─ use-room-flow.ts          # ?flow= → thread + tin (infinite) + gửi (flow_id, answer_run_id?)
│  └─ use-agent-menu-refresh.ts # invalidate menu @ khi đổi roomId
├─ lib/room-agent.ts            # thuần: vai theo lượt (caller/khác), canReply, answerRunId, nhãn chờ, lọc tin main/flow, đếm chưa đọc/pill, tag đầu tin
├─ components/agent/
│  ├─ AgentBlock.tsx            # khối kết quả (D6)
│  ├─ AgentBlockHeader.tsx      # tên · @key · "<A> hỏi" · giờ · trạng thái
│  ├─ PendingAgentBlock.tsx     # "<agent> đang xử lý…" + Dừng/"Chỉ A dừng được"; stream cho người gọi
│  └─ WaitingNote.tsx           # "Đang chờ <B> xác nhận/trả lời" (người không gửi lượt đó)
├─ components/flow/
│  ├─ RoomFlowPane.tsx          # FlowFrame + RoomFlowContent (lazy)
│  └─ RoomFlowContent.tsx       # FlowHeader + tin thread (tên người gửi) + composer (mọi thành viên, menu @)
├─ components/timeline/MessageItem.tsx   # (sửa) nhánh agent → AgentBlock; tô `@key` đầu tin
└─ components/RoomComposer.tsx  # (sửa) menus="agents", placeholder, gợi ý, attachments (F5)
features/composer/components/{Composer,composer-types}.tsx   # menus: boolean | "agents"; placeholder; menuTitle
features/composer/hooks/use-suggest.ts                        # bỏ nhánh `/` khi "agents"
features/flow-panel/components/{FlowFrame(mới),FlowPanel,FlowSheet,FlowContent}.tsx  # tách khung; export FlowHeader
features/realtime/event-router.ts                             # + room.run_started/waiting/finished; room.message có flow → cache flow
features/answer/components/AskCard.tsx                        # + prop `title?` ("<agent> cần thêm thông tin")
```
`Composer.tsx` đang 200 dòng: phần `menus`/`placeholder` đưa vào `composer-logic`/`use-suggest`, không phình component (nếu vẫn vượt → tách `ComposerMenus.tsx`). `lib/http.ts`: thêm `NOT_RUN_CALLER` (từ `CHAT_ROOM_AGENT_ERRORS`) vào `ApiErrorCode`.

## 2. Route và điều hướng
| Hành vi | Chi tiết |
|---|---|
| `/rooms/$id?flow=<flow_id>` | Mở `RoomFlowPane` bên phải (≥ 640) / sheet đáy (< 640). Flow lạ hoặc không thuộc phòng (404 `NOT_FOUND` từ `listFlowMessages`) → bỏ `flow` (replace), không báo lỗi — như C1 `useOpenFlow` |
| "Trả lời tiếp" | `navigate({ search: { flow } })` (luôn bật, D9); đóng ✕/Esc/kéo → xoá `flow`, focus lại nút trên khối (`[data-flow-reply]`) |
| Mất phòng khi khung mở | X2a `useRoomLost` giữ nguyên (về `/c/new` + toast); khung đóng theo route |
| Chọn agent ở menu | Chèn `@key ` đầu tin (R15), con trỏ cuối; `@@` không mở menu |

## 3. Dữ liệu, cache, realtime
| Nguồn | Cache / xử lý |
|---|---|
| `GET /rooms/:id/messages` | Như X2a; vắng `flow_id` = timeline chính (`placement` vắng ≡ `main`); tin `placement="flow"` không vào timeline chính. Có `flow_id` = mọi tin flow (main+flow, seq tăng) cho khung flow. `ask.question/choices` của `side_effect` chỉ có khi người xem là người gửi lượt |
| `GET /rooms/:id` | Thêm `active_runs[]` (§10 #4) → nguồn khối chờ khi tải lại / vào phòng giữa chừng |
| `POST /rooms/:id/messages` | 201 `RoomMessage` + header `X-Run-Id`/`X-Flow-Id` (200 trùng `client_msg_id`: không header): chèn tin gọi; có header → `runDriver.attach({ convId: "room:"+roomId, runId, flowId, origin })` + thêm vào `active_runs` cache (người gửi thấy ngay). Gửi trong flow: thêm `flow_id`, `answer_run_id?` (D13) |
| `room.run_started` | `patchDetail` thêm run (khử trùng `run_id`; `agent: null` = Orchestrator → `roomAgent.orchestratorName`) → mọi thành viên thấy "<agent> đang xử lý…" (R10, AC16), kể cả lượt trả lời tiếp của B trong flow của A |
| `room.run_waiting` | Cập nhật `status=waiting`, `wait_kind`; `caller_id === me`: chờ tin agent có `ask` để hiện chip; người khác: `WaitingNote` với tên `caller` của run |
| `room.run_finished` | Bỏ run khỏi `active_runs`; `message_id=null` (huỷ, R17/Q8) → khối biến mất; còn lại tin agent (kể cả "đã huỷ", lỗi) đến qua `room.message` |
| `room.message` agent | `placement=main` → timeline; `flow` → cache `roomKeys.flow(roomId, flowId)`; tăng `flow.message_count`/`last_active_at` của tin gốc; `dismiss` run trùng `run_id`. Payload theo người nhận (`ask` của `side_effect` chỉ `{kind}` với người khác) |
| `stream.reset` | X2a đã `invalidate` phòng; thêm `invalidate` detail (active_runs) và các cache flow đang mở |

Chưa đọc/pill (R19): `NewMessagesPill` và `lastIsMine` (đánh dấu đã đọc) coi tin agent có `caller.id === me` là "của mình"; tin `placement=flow` không vào pill timeline nhưng **có tính chưa đọc** ở server (BE Q13): `FlowFooter` hiện "n tin mới trong flow" (đếm phía client từ lúc mở phòng). Huy hiệu sidebar lấy từ server (`room.unread`). Xem trước sidebar: tin agent → "<tên agent>: …" (X2a `sender.display_name`).

## 4. Màn ↔ artboard ↔ trạng thái
| Thành phần | Artboard | Trạng thái (câu chữ ở phụ lục i18n) |
|---|---|---|
| Composer phòng | Main/DM/Mobile | placeholder gợi ý `@`; gợi ý dưới ô (≥ 640); menu `@`: đang tải / rỗng "Bạn chưa được cấp agent nào" / không khớp / lỗi + "Thử lại" (C1); lỗi gửi trong ô (D5) |
| Menu `@` | Main | tiêu đề "Agent bạn dùng được"; mục = tên (vi/en theo ngôn ngữ) + `@key` mono + mô tả 1 dòng; điện thoại: cùng menu, mục cao ≥ 44px |
| Tin gọi | Main | tin phẳng X2a; `@key` đầu tin tô `text-primary font-medium` (chỉ hiển thị, R16 X2a giữ chữ) |
| `PendingAgentBlock` | DM | người gọi: stream chữ + con trỏ + "Dừng"; người khác: "<agent> đang xử lý…" (`role="status"`) + "Chỉ <A> dừng được"; cold-start: `ColdResumeNote` C1 (người gọi) |
| `AgentBlock` xong | Main | thân Markdown, bước, Copy, "Chạy bằng quyền của <B>", `FlowFooter` ("+n tin trong flow · thời gian", `button "Trả lời tiếp"` luôn bật) |
| Chờ `need_input` | (C1 AskCard) | người gửi lượt: AskCard "<agent> cần thêm thông tin" + chip (bấm = gửi trong flow kèm `answer_run_id`); người khác (kể cả A khi lượt là của B): câu hỏi hiện (U1) nhưng **không** chip + "Đang chờ <B> trả lời agent." |
| Chờ `side_effect` | Main | người gửi lượt: mô tả + chip "Đồng ý"/"Huỷ"; người khác: **chỉ** "Đang chờ <B> xác nhận — chỉ người hỏi mới bấm được." + tên agent, không mô tả (Q5; khác canvas — spec thắng). Chống rò: BE không gửi `question/choices` cho người khác |
| Lỗi run | — | `ErrorCard` C1 với câu chung `roomAgent.failed` cho cả phòng (không lộ quota, R16); "Chạy lại" chỉ người gửi lượt đó; đã dừng: `CancelledNote` (cùng quy tắc) |
| Huỷ do mất quyền (Q2/BE D15) | — | tin agent huỷ: "Đã huỷ vì bạn không còn quyền dùng agent này." chỉ **người gửi lượt đó**; người khác "Đã huỷ" |
| Khung flow | C1 Flow panel | Mọi thành viên mở được và có composer (không còn chỉ-đọc/tắt): như C1 ("Trả lời trong flow…", "Gửi trong flow") + menu `@`; tin người↔người và khối agent xen kẽ, mỗi lượt ghi tên người gửi + "chạy bằng quyền của <B>"; "Dừng" chỉ trên run của mình. Đang tải: skeleton C1; lỗi tải: "Không tải được flow" + "Thử lại"; 404 `NOT_FOUND`: toast `rooms.toast.sendFailed` + invalidate |
| Mất quyền phòng | X2a | như X2a (về `/c/new`); run của người gọi bị huỷ phía server (Q8), FE chỉ `dismiss` khi nhận `run_finished` |
| `NOT_RUN_CALLER` (403) | — | chỉ khi **trả lời/xác nhận lượt của người khác** (đua hiếm, UI đã ẩn chip): toast `roomAgent.toast.notCaller` + `invalidate` detail. **Không** liên quan quyền gửi tin flow (thiếu quyền agent = `AGENT_NOT_FOUND` 404, D5) |
| `TOO_MANY_RUNS` / quota | — | chỉ người gửi lượt đó, trong composer (D5); quota/usage tính người gửi từng lượt; không phát cho phòng (AC08) |

## 5. Composer phòng
`<Composer variant="room" menus="agents" attachments={F5} inputLabel={nhãn X2a} placeholder={roomAgent.placeholder.*} menuTitle={menu.agentsYours} />`. Khoá Gửi khi run của chính mình trong phòng đang chạy? **Không** (phòng là chat người↔người; giới hạn do `max_concurrent_runs` server); chỉ khoá khi `submitting`. Nháp theo phòng như X2a. Composer khung flow: `variant="flow"`, `menus="agents"`, luôn render; `running` = run **của mình** trong flow đang chạy → nút Dừng; gửi theo D13.

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
| Q7/Q11 | **Q7 lần 2**: thread chung, mọi thành viên nhắn; tag = run người tag (D9/D13); Q11: ai cũng mở khung thread và có composer |
| Q8 | Khối chờ biến mất khi `run_finished: cancelled`; không toast cho người khác |
| Q9 | BE đề xuất tách X2b-2; F5 giữ riêng, có thể cắt (D11) |
| Q10 | `menus="agents"`; placeholder không nhắc `/` (khác canvas Main "/ để chạy lệnh" — spec thắng) |

## 9. Task BUILD (chi tiết hoá F1 của `tasks.md` → F1–F6; mỗi task một commit, diff ≈ ≤ 400 dòng không tính test)
"L" = `bunx biome check --write <file đổi>` · `bun run check:size` · `bun run depcruise --all` · `bun run check:fn` · `bun run i18n:check` · `bun run --filter @ai/chat-web typecheck`.
| # | Task | File chính | Đọc | Lệnh xong (ngoài L) | Phụ thuộc |
|---|---|---|---|---|---|
| F1 | Menu `@` phòng: `menus="agents"`, `placeholder`, `menuTitle`, refresh menu khi mở phòng; gửi trả `SubmitResult` (D5), đọc header run; tô `@key` đầu tin; i18n `roomAgent.placeholder/hint` | `composer/**`, `rooms/components/RoomComposer.tsx`, `rooms/hooks/use-send-room-text.ts`, `rooms/api.ts`, `timeline/MessageItem.tsx` | §0 D2–D5, §5, i18n §1, e2e §1 Composer | `bun test apps/chat-web/src/features/{composer,rooms}` · e2e X2a cũ xanh · AC13 | B2 (contract + stub) |
| F2 | Khối agent: `event-router` 3 sự kiện run, `use-room-runs`, `PendingAgentBlock` (stream người gửi lượt, Dừng), `AgentBlock` + header theo `caller`, lỗi/đã dừng, pill/đã đọc (§3) | `rooms/components/agent/**`, `rooms/hooks/{use-room-runs,use-agent-block}.ts`, `rooms/lib/room-agent.ts`, `realtime/event-router.ts` | §0 D6–D9, §3, §4, i18n §2 | `bun test …/rooms …/realtime` · AC01, AC16 | F1, B2 (e2e: B4, B5) |
| F3 | Chờ: AskCard (`title`), chip gửi trong flow kèm `answer_run_id` (người gửi lượt), `WaitingNote` (người khác), `NOT_RUN_CALLER`, huỷ Q2 | `answer/components/AskCard.tsx`, `agent/WaitingNote.tsx`, `use-agent-block.ts` | §0 D13, §4 (chờ), i18n §2 | `bun test …/rooms …/answer` · AC05, AC06, AC17 (vế UI) | F2, B6 |
| F4 | Khung thread phòng: tách `FlowFrame`, `RoomFlowPane` lazy, `use-room-flow` (gửi D13: không tag/tag/`answer_run_id`), composer + menu `@` cho mọi thành viên, mỗi lượt ghi người gửi, `AGENT_NOT_FOUND` giữ nội dung, hint ngữ cảnh, sheet điện thoại | `flow-panel/components/**`, `rooms/components/flow/**`, `rooms/hooks/use-room-flow.ts` | §0 D9, D10, D13, §2, i18n §3 | `bun test …/flow-panel …/rooms` · AC15, AC17 · `bun run e2e:chat` (C1, AC-H07 không đổi) | F2, B6 |
| F5 | (**có thể cắt** → X2b-2, chờ người dùng duyệt) Đính kèm trong phòng: bật `attachments`, `attachment_ids`, `AttachmentList`, lỗi `ATTACHMENT_NOT_FOUND` | `rooms/components/RoomComposer.tsx`, `timeline/MessageItem.tsx`, `use-send-room-text.ts` | §0 D11 | `bun test …/rooms …/attachments` · AC11 (vế UI) | F1, BE đính kèm của X2b-2 (không thuộc B1–B7) |
| F6 | Đóng FE: README `rooms`/`flow-panel`/chat-web, TECH-DEBT, a11y bàn phím menu/khối/nút tắt, `check:bundle` | README, `docs/TECH-DEBT.md` | §7 | `bun run check:fn --all` · `bun run --filter @ai/chat-web build && bun run --filter @ai/chat-web check:bundle` · `bunx playwright test X2b` · `bun run e2e:chat` | F1–F4, B7 (+F5 nếu giữ) |

## 10. Đối chiếu contract BE (`plan.md` §2, §12) — FE đã khớp, không còn đề xuất mở
| FE giả định cũ | BE chốt → FE dùng |
|---|---|
| Body `{message, run?}` | Body `RoomMessage`; `X-Run-Id`/`X-Flow-Id`; `AGENT_NOT_FOUND.details` chỉ `{suggestions}` |
| `status: ok\|failed\|cancelled` | `run_status: finished\|failed\|cancelled`; `agent`, `caller`, `ask{kind,question?,choices?}`, `steps{count,ms}`, `placement`, `flow{message_count,last_active_at}` |
| `NOT_RUN_CALLER` chặn gửi flow | Chỉ xác nhận/trả lời lượt người khác (`CHAT_ROOM_AGENT_ERRORS`); thiếu quyền agent khi gửi flow = `AGENT_NOT_FOUND` 404 |
| `run_*` trong `ME_STREAM_EVENTS` | `ME_STREAM_RUN_EVENTS` + `parseMeStreamRunEvent`; `run_finished` có `flow_id`, `message_id` |
| `active_runs` | Có (`RoomActiveRun`, `agent` null = Orchestrator, `caller`, `wait_kind`) |
| Đính kèm trong mốc | Tách X2b-2 (chờ duyệt) |
Cần backend-lead/qc: fixture dev có **người thứ ba C có `hoadon`** (B không có) để chạy E-A9/E-A10 (B7 hiện ghi "quyền A/B").

## 11. Câu hỏi UX mới (có mặc định)
| # | Câu hỏi | Mặc định FE |
|---|---|---|
| U1 | Câu hỏi `need_input` có hiện cho người khác? | **Có** (là nội dung trả lời của agent), chỉ ẩn chip; `side_effect` thì ẩn hết (Q5) — [x] Người dùng chấp nhận mặc định 2026-10-08 |
| U2 | Nút trên khối cho người không phải người gọi gốc? (**sửa theo Q7 lần 2**) | "Trả lời tiếp" luôn bật; mở thread chung, nhắn thường tự do, tag mới chạy agent (D9) |
| U3 | Khối "đang xử lý" đặt đâu? | Cuối timeline (D7) — [x] Người dùng chấp nhận mặc định 2026-10-08 |
| U4 | Canvas DM tag giữa câu ("Ok em. @assistant …") | Không gọi agent (R02); tô màu chỉ `@key` đầu tin — [x] Người dùng chấp nhận mặc định 2026-10-08 |

## 12. Rủi ro
| Rủi ro | Giảm |
|---|---|
| Tách `FlowFrame` làm hỏng khung flow C1 | F4 chạy `bun run e2e:chat` + AC-H07; giữ nguyên props/aria C1 |
| `Composer.tsx` vượt 200 dòng | Logic `menus` vào hook/lib; tách `ComposerMenus` nếu cần |
| Contract BE khác giả định §10 | F1 làm sau B1; chỉnh tên trong `rooms/api.ts`/`room-agent.ts`, không lan component |
| B mất `hoadon` rồi tag trong thread | 404 `AGENT_NOT_FOUND`: giữ nội dung, gợi ý `suggestions`, invalidate menu `@`; tin không tag vẫn gửi được |
| Lộ `side_effect` qua UI | Không chỉ ẩn ở UI: §10 #3; e2e B kiểm DOM không có mô tả |
