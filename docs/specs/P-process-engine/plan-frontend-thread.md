# P · Phụ lục plan-frontend: run trong phòng = thread X2b (U1, màn ④)

Thuộc [`plan-frontend.md`](plan-frontend.md) FD5, FD11–FD13. **Thay** thẻ run + pane `?run=` cũ. Backend: [`plan-thread.md`](plan-thread.md) (T1–T11, 7 loại tin), [`plan-contract.md`](plan-contract.md) §2 (`RoomProcessPart`, `ProcessRunView.open_tasks/thread`, `TaskDetail.options/has_output`), §3 (`PROCESS_THREAD_NO_AGENT`, `X-Flow-Id`). Câu chữ: [`plan-frontend-i18n-thread.md`](plan-frontend-i18n-thread.md). Nhãn e2e: [`plan-frontend-e2e.md`](plan-frontend-e2e.md) §1 "Thread". Mockup: ④ CopilotRoom + ⑦ AskForward. Ngoài phòng (inbox, `/runs/:id`, Hỏi AI, admin) **không đổi**.

## 1. Mô hình hiển thị
| Thành phần | Cách làm |
|---|---|
| Khối quy trình (timeline) | tin `sender_type="process"`, `placement=main` (= `kind=block`) dựng bằng `ProcessBlock` (dáng `AgentBlock`: `article` thẻ bo 14 px, header, thân, chân `FlowRecent` + `FlowFooter` "Trả lời tiếp"), thêm `StageStrip` |
| Thread | `?flow=<flow_id>` (X2b) → `RoomFlowPane` rẽ theo `useFlowKind`: `process` ⇒ `ProcessFlowContent` (aside "Flow đang mở" ≥ 640 / sheet đáy, `FlowFrame` giữ nguyên, **không** prop `label`); `agent` ⇒ `RoomFlowContent` X2b không đổi. Không còn `?run=` |
| Tin trong thread | `ProcessThreadMessage` rẽ theo `process.kind` (7 loại, §3); tin người = `MessageItem` như X2b; `process` vắng/hỏng (BE bỏ `process`, giữ `content`) ⇒ dòng chữ `content` + tên quy trình |
| Việc cần làm | **trong thread**, gắn vào tin sinh ra việc (`output.review_task_id` → thẻ kiểm; `ask`; `decision`); chỉ **assignee** có nút; người khác `TaskWaitingNote` từ `open_tasks`; việc đã đóng ⇒ không nút (kết quả = tin `task_result` kế tiếp) |
| Nút ở khối timeline | không có Đạt/Chưa đạt/chip (tránh trùng role với thread): assignee chỉ có nút mở thread `Kiểm ngay`/`Trả lời`/`Quyết định`; người khác `TaskWaitingNote` một dòng |
| Composer thread | `ProcessThreadFooter` (§5): chữ thường = người↔người; ràng vào task khi người dùng chủ động bấm `Chưa đạt` / `Trả lời bằng văn bản` |
| Dữ liệu | `useProcessRun(runId)` (`GET /process-runs/:id`, full; `runId` = `message.process_run_id`), tin = `GET /rooms/:id/messages?flow_id=` (X2b). Realtime: `room.message` (tin `process`) ⇒ invalidate `["process","run",id]`; `process.updated` patch; `review_task.created/closed` invalidate (assignee). Không polling |

## 2. File mới và chủ sở hữu (thư mục `chat-web/src/features/processes/…`)
| File | Chủ | Vai |
|---|---|---|
| `shared/thread/ProcessThreadMessage.tsx` | Bước 0 | switch 7 loại + fallback; import lười từng loại |
| `shared/thread/thread-binding.tsx` | Bước 0 | context `ThreadBinding {active, begin({kind:"feedback"\|"answer", taskId, agent, submit:(text:string)=>Promise<void>}), cancel(), fill(text)}`; **thẻ gọi `begin` truyền hàm gửi của mình** (`ReviewTaskCard` PF1 ⇒ `decision{fail,feedback}`; `AskTaskCard` PF2 ⇒ `answer`), nên `ProcessThreadFooter` chỉ gọi `binding.submit(text)` — không import hook/thẻ của PF2; xử lý `REVIEW_TASK_CLOSED`/toast nằm trong `submit` của thẻ. Stub Bước 0: type + provider + `useThreadBinding()` (không logic gửi). Ngoài thread = `null` ⇒ thẻ dùng ô nhập tại chỗ (inline) |
| `shared/lib/thread-task.ts` (+test) | Bước 0 | `taskSlot(view, taskId)` → `{state:"mine",task}` (có trong `my_tasks`, hoặc decision và `view.decision.can_decide`) · `{state:"waiting",open}` (có trong `open_tasks`) · `{state:"none"}`; `waitNames(open)` ("A, B và n người khác" / "nhóm X"); `stepsSummary(steps)` (số bước, tổng giây, tổng token); `threadTitle(msg)` |
| `shared/components/TaskWaitingNote.tsx` | Bước 0 | `role="status"` cùng dáng `WaitingNote`; câu theo `kind` (chữ ở i18n-thread §3) |
| `shared/hooks/{use-thread-run,use-in-view}.ts` | Bước 0 | `useThreadRun(runId)` = `useProcessRun` + `taskSlot`; `enabled` theo `use-in-view` cho khối ngoài màn hình (run kết thúc: `staleTime: Infinity`) |
| `rooms/hooks/use-flow-kind.ts` | Bước 0 | `process`/`agent`/`loading`: tìm khối gốc trong cache timeline, chưa có ⇒ suy từ `useFlowMessages` (cùng khoá cache, không fetch thêm) |
| `run-block/components/ProcessBlock.tsx` | PF1 | khối timeline + dạng `inThread` (đầu thread: không chân) |
| `run-block/components/ProcessFlowContent.tsx` + `ProcessFlowMessages.tsx` | PF1 | khung pane: `FlowHeader`, thanh trạng thái (§4), danh sách tin (`role="log"`, `useStickyScroll`), `ProcessThreadFooter` |
| `run-block/components/{OutputMessage,TaskResultMessage,DecisionMessage,RunEndMessage}.tsx` | PF1 | loại `output`, `task_result`, `decision`, `run_end` |
| `run-block/components/{ReviewTaskCard,DecisionCard,CancelRunButton,ProcessThreadFooter,RunCard,ConversationRunCards}.tsx` | PF1 | thẻ kiểm/quyết (cả inline), huỷ, composer thread; `RunCard` + `ConversationRunCards` chỉ còn cho Hỏi AI |
| `ask/components/{AskMessage,ForwardMessage}.tsx` | PF2 | loại `ask`, `forward`; `AskTaskCard` thêm chế độ external (§5) |

## 3. Bảy loại tin (`ProcessThreadMessage`)
Tên người: `actor`/`from`/`to` = `UserRef.display_name` ("Bạn" khi là mình). Giờ `timeOf`. Chữ: i18n-thread §2.
| `kind` | Hiển thị | Việc cần làm |
|---|---|---|
| `block` | `ProcessBlock inThread`: tên quy trình + `!key`, "{{starter}} khởi chạy", `RunStatusBadge`, dòng trạng thái (plan-frontend §6), `StageStrip` đủ tên | — |
| `output` | `article "Kết quả {{stage}} v{{n}}"`: "Giai đoạn {{n}} · {{stage}}", "Làm bởi {{executor}}" (`ExecutorRef.name` theo locale, nhóm ⇒ nhãn "Nhóm"), dòng tóm tắt "✓ {{n}} bước · {{s}} · {{tokens}} token" (từ `steps`), nút `Chi tiết {{n}} bước` (`aria-expanded`) mở danh sách bước (vai · agent · model · giây · token; model `null` ⇒ "—"), `template_ok=false` ⇒ "Thiếu mục bắt buộc: …", nút `Xem nội dung` mở `OutputView` (Markdown, tải lười `/outputs/:oid`; `tablist "Phiên bản"` chuyển giữa các bản của giai đoạn từ `view.stages[idx].outputs`, mặc định bản của tin này). Tin có việc kiểm đang mở của mình ⇒ **mở sẵn** nội dung | `review_task_id` mở: assignee ⇒ `ReviewTaskCard` (Đạt / Chưa đạt); người khác ⇒ `TaskWaitingNote` "Đang chờ {{names}} kiểm"; `after=auto` ⇒ chữ "Tự chạy tiếp giai đoạn kế" |
| `ask` | tên agent/nhóm hỏi + `question` (xuống dòng giữ) + chip `choices` (chip chỉ bấm được khi là assignee) + "lần hỏi {{n}}/{{max}}" | assignee ⇒ `AskTaskCard` external (chip + `Trả lời bằng văn bản` + `Nhờ người khác trả lời`); người khác ⇒ `TaskWaitingNote` "Đang chờ {{names}} trả lời" |
| `decision` | `DecisionMessage`: "Quy trình dừng ở giai đoạn {{stage}}" + lý do (14 mã, i18n §3) | `view.decision.can_decide` ⇒ `DecisionCard` (3 nút theo `options`, ghi chú); không ⇒ `TaskWaitingNote` "Đang chờ {{names}} hoặc quản trị viên quyết định". `DecisionCard` mount **một** lần (tin quyết định mở mới nhất) |
| `task_result` | dáng tin người: avatar chữ + `actor` + giờ + huy hiệu "ngoài phòng" khi `outside` + dòng kết quả theo `task_kind`/`result`: **Đạt** · **Chưa đạt** + góp ý (khối trích nguyên văn, `whitespace-pre-wrap`) · "Đã trả lời" + `answer`/`choice` · quyết định (`add_attempt`/`use_current`/`cancel`) · `sections` (nếu có) "Mục làm lại: …" | — |
| `forward` | một dòng nhẹ, chọn khoá theo `task_kind`: `ask` ⇒ `ask.fwd.line` "↪ {{from}} đã nhờ {{to}} trả lời (chuyển {{depth}}/3)"; `review`/`decision` ⇒ `thread.forward.line` "↪ {{from}} đã chuyển việc cho {{to}} (lần {{depth}}/3)"; **không** có lời nhắn (BE không gửi) | — |
| `run_end` | dòng kết thúc: Hoàn tất · "{{actor}} đã huỷ lượt chạy" (`actor` null ⇒ "Lượt chạy đã bị huỷ") · Lỗi · Hết hạn + link "Mở trang lượt chạy" (`/runs/$id`) | — |
Mọi loại: `article` có `aria-label`; loại có thẻ việc dùng `region` (tên nhãn e2e). Lỗi tải `view` ⇒ thẻ việc ẩn, thanh trạng thái hiện chữ "Không tải được trạng thái quy trình" + `Thử lại` (tin vẫn đọc được).

## 4. `ProcessBlock` và thanh trạng thái thread
| Hạng mục | Chi tiết |
|---|---|
| Khối timeline | header: biểu tượng quy trình + tên + `!key` (mono) · "{{starter}} khởi chạy"/"Bạn khởi chạy" (`view.started_by`) · giờ · `RunStatusBadge` (góc phải). Thân: dòng trạng thái (plan-frontend §6) + `StageStrip` (tên giai đoạn; run kết thúc: toàn xanh). Dưới: "Chạy bằng quyền của {{starter}}". Nút `Kiểm ngay`/`Trả lời`/`Quyết định` chỉ khi `my_tasks`/`can_decide` (bấm = mở `?flow=`, pane cuộn tới thẻ việc đầu tiên của mình). Chân: `FlowRecent` (≤ 3 tin mới, gồm tin `process`) + `FlowFooter` (`hideCopy`) "Trả lời tiếp ›". Nút "▶ Quy trình" không có tin gọi ⇒ khối vẫn là gốc |
| Thanh trạng thái (pane, dưới `FlowHeader`) | `RunStatusBadge` · `StageStrip` · chip "Làm lại {{a}}/{{max}}" (giai đoạn hiện tại, `attempt`/`attempt_limit`) và "Hỏi lại {{n}}/{{max}}" · `CancelRunButton` (`can_cancel` và không `needs_decision`) · "Chạy bằng quyền của …" · link "Mở trang lượt chạy". Tiêu đề pane = `{{tên}} · !{{key}}`, đếm = `flow.message_count` |
| Trạng thái | tải (3 `Skeleton`, `aria-busy`, X2b) · lỗi tải tin (`roomAgent.flowLoadError` + thử lại, X2b) · flow 404 ⇒ bỏ `?flow` (X2b) · `view` 404 ("Bạn không còn xem được lượt chạy này") ⇒ thẻ việc ẩn, composer chỉ chữ thường · run kết thúc ⇒ thẻ việc biến mất, composer chữ thường · người xem rời phòng giữa chừng (kể cả người bắt đầu, U5) ⇒ flow 404 ⇒ bỏ `?flow`, toast `thread.left`, chuyển sang giao diện ngoài phòng (§5) |
| Hiệu năng | `ProcessBlock` `React.lazy` trong `RoomTimeline` (bundle chính chỉ thêm nhánh rẽ); pane lười sẵn (X2b); `memo` theo `run.updated_at`; `StageStrip`/`OutputView` không nạp trước khi cuộn tới |

## 5. Composer thread (`ProcessThreadFooter`, PF1) và thẻ việc
| Trạng thái composer | Nhãn textbox / nút gửi | Gửi |
|---|---|---|
| **Thường** (mặc định) | `textbox "Tin nhắn trong flow"` (X2b) / `Gửi`; gợi ý `thread.hint` ("Đây là trao đổi giữa người với người… Muốn hỏi agent, nhắn ở khung chat chính của phòng."); `menus={false}`, `attachments={false}`, `maxChars=CHAT_CONTENT_MAX` | `POST /rooms/:id/messages {content, client_msg_id, flow_id}` — **không** `answer_run_id`. `!…` là chữ thường (không menu `!`). `@agent` đầu tin ⇒ 422 `PROCESS_THREAD_NO_AGENT` ⇒ lỗi trong ô (`alert` `thread.err.noAgent`), chữ giữ nguyên |
| **Góp ý** (sau `Chưa đạt` trong `ReviewTaskCard`) | `textbox "Góp ý cho {{agent}} (bắt buộc)"` / `button "Gửi góp ý · làm lại"`; viền cảnh báo, dải trên ô: "Chưa đạt · góp ý cho {{agent}}" + `button "Huỷ"`; focus vào ô; `maxChars=FEEDBACK_MAX` | `POST /review-tasks/:id/decision {result:"fail", feedback}` (qua `submit` của `ReviewTaskCard`) |
| **Trả lời** (sau `Trả lời bằng văn bản` trong `AskTaskCard`; chip gõ vào ô) | `textbox "Câu trả lời"` / `button "Gửi trả lời"`; dải "Trả lời {{agent}}" + `Huỷ`; `maxChars=ANSWER_MAX` | `POST /review-tasks/:id/answer {answer}` (qua `submit` của `AskTaskCard`, PF2; chip đơn câu: `{answer:choice, choice}` gửi ngay, không qua ô) |
- Cơ chế: `ThreadBinding` ở `ProcessFlowContent`; thẻ gọi `begin({…, submit})`, footer (PF1) chỉ gọi `binding.submit(text)` rồi thoát chế độ khi resolve (reject ⇒ giữ chữ + lỗi trong ô); ô nhập vẫn `Composer variant="flow"`, đổi `inputLabel`/`placeholder`/`draftKey` (`…:fb:<taskId>`, `…:ans:<taskId>`; nháp giữ theo việc); **Bước 0 thêm `sendLabel?: string`** vào `ComposerProps`/`ComposerRow` (mặc định "Gửi"). Dải trên + `Huỷ` dựng ngoài `Composer` (không đổi nó thêm).
- Thành công: thoát chế độ (ô về Thường, remount), toast (`run.review.sent` / `ask.toast.answered`), invalidate view; tin `task_result` của mình tới qua `room.message`. Việc đã đóng khi gửi (`REVIEW_TASK_CLOSED`) ⇒ thoát chế độ + chữ "Đã có người khác quyết"/"Đã có người trả lời" + refetch; mất mạng ⇒ giữ chữ + toast.
- Thẻ **inline** (inbox/`/runs/:id`/DM): `useThreadBinding()` = `null` ⇒ `ReviewTaskCard` mở ô góp ý tại chỗ, `AskTaskCard` có `textbox "Câu trả lời"` + `Gửi trả lời` (như plan-frontend §3–§4 cũ). Cùng nhãn nút ở hai nơi nhưng **không bao giờ cùng màn** (nút việc không có ở khối timeline).
- Người ngoài phòng làm việc ở inbox/`/runs/:id`; việc của họ hiện trong thread dưới dạng `task_result` (`outside`).
- **Người bắt đầu đã rời phòng (U5)** = cùng trạng thái người duyệt ngoài phòng: `?flow` ⇒ thread 404 ⇒ bỏ `?flow`, không timeline/composer phòng; vẫn thấy `/process-inbox` và `/runs/:id` dạng ngoài phòng (banner "Bạn không ở phòng này…", không `tab "Nhật ký"`, không link phòng/thread), nút `Huỷ lượt chạy` theo `can_cancel`. Việc của mình (nếu còn) làm ở inbox/`/runs/:id` như §5 dòng trên; không còn nút `Mở luồng`.

## 6. Mọi chỗ chuyển theo `sender_type` ở chat-web (`apps/chat-web/src/…`; **tất cả giao Bước 0** — dùng chung PF1+PF2, X2b có test khoá)
| # | File:dòng | Hiện tại | Đổi |
|---|---|---|---|
| 1 | `features/realtime/event-router.ts:97` | `=== "agent"` ⇒ `applyAgentMessage` | thêm `=== "process"` ⇒ invalidate `["process","run",message.process_run_id]` (bỏ qua `block`); **không** đụng `active_runs` |
| 2 | `features/rooms/lib/room-agent.ts:26` `isOwnTurn` | agent theo `caller`, còn lại theo `sender.id` | `process` ⇒ `false` (không bao giờ "của mình": pill/chưa đọc đúng) |
| 3 | `room-agent.ts:182–186` `withRecent` | `mine` theo `sender`/`caller` | `process` ⇒ `mine=false`; copy `process:{kind}` vào `RoomFlowRecent` |
| 4 | `features/rooms/components/agent/FlowRecent.tsx:20` | agent ⇒ `agentName`, khác ⇒ `sender.display_name` | `process` ⇒ `sender.display_name` (= tên quy trình), avatar biểu tượng quy trình thay chữ cái; preview = `preview` server |
| 5 | `features/rooms/components/timeline/RoomTimeline.tsx:60` | `agent` ⇒ `AgentBlock`, khác ⇒ `MessageItem` | thêm nhánh `process` ⇒ `ProcessBlock` (lazy, `onReply`) |
| 6 | `features/rooms/components/flow/RoomFlowPane.tsx` | luôn `RoomFlowContent` | `useFlowKind`: `process` ⇒ `ProcessFlowContent` (lazy); `loading` ⇒ khung + skeleton |
| 7 | `features/rooms/components/timeline/MessageItem.tsx:15` | `!== "user"` ⇒ `null` | giữ (process không tới đây); chỉ cập nhật chú thích |
| 8 | `features/thread/components/FlowFooter.tsx` | luôn có `Copy` | prop `hideCopy?: boolean` |
| 9 | `features/rooms/components/RoomView.tsx` | slot pane `?run` (kế hoạch cũ) | **không thêm** `?run`; chỉ mở lazy `RoomFlowPane` như X2b |
**Đã kiểm, không đổi:** `room-agent.ts:145` `pendingRuns` (chỉ tin `agent`) · `room-cache.ts:135` `applySentMessage` (chỉ tin của mình = `user`) · `room-logic.ts:12/30` `previewOf`/`seenBy` (tên người gửi = tên quy trình, "Tên: …" đúng) · `RoomListItem.tsx` · `use-room-flow.ts` `useFlowSend` (thread quy trình không dùng) · `RoomFlowContent`/`RoomFlowMessages` (chỉ thread agent; thread quy trình có bản riêng) · `event-router.ts:49` `lastMessageOf` (sao chép `sender_type` — chấp nhận `process` nhờ contract).
Test X2b khoá (AgentBlock, FlowRecent, RoomFlowMessages, event-router) phải xanh với cờ tắt; Bước 0 thêm test cho #1–#4.

## 7. Lệch mockup ④⑦ (sau U1) — bảng đầy đủ ở [`plan-frontend-admin.md`](plan-frontend-admin.md) §3
Khớp mockup: khối trong timeline với thanh giai đoạn · "Trả lời tiếp ›" · tin trong thread (kết quả + phiên bản v1/v2, thẻ kiểm, góp ý của người kiểm, nhờ chuyển) · góp ý/câu trả lời gõ ở composer · người không kiểm chỉ thấy "Đang chờ … kiểm" · người ngoài phòng chỉ thấy tin riêng ở DM.

## 8. Đề xuất cho backend-lead / qc (không chặn; mặc định ghi cột phải)
| # | Đề xuất | Mặc định nếu không đổi |
|---|---|---|
| 1 | Mock B2 (plan-step0 §3): tin `process` đủ 7 loại, persona assignee/không-assignee, `open_tasks`, `thread`; `POST /__mock/process` phát `room.message` (tin `process`) + `review_task.*` | FE dựng fixture riêng (chậm hơn) |
| 2 | `ProcessRunView.open_tasks[]` luôn có `assignees` (≤ 20) hoặc `group.name` để dựng "Đang chờ …" | Chữ chung "Đang chờ người xử lý" |
| 3 | `forward.task_kind` (review\|ask\|decision) đã thêm ở plan-contract ⇒ FE chọn khoá theo loại (§3) | — |
| 4 | `OutputRef` không có tên tệp ⇒ nhãn `Kết quả <giai đoạn> v<n>` | — |
| 5 | ADM-FR-65 cột "Lượt chạy gần nhất" cần `last_run` ở `GET /process-defs` ⇒ P-b | Chỉ "Lượt đang chạy" |
| 6 | qc: `X-Flow-Id` cạnh `X-Process-Run-Id` ở tin gọi; thread quy trình không nhận `answer_run_id` (404) — FE không gửi | — |
