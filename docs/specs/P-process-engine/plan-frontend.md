# P · Plan frontend P-a (`apps/chat-web` + `apps/admin-web`)

Spec: [`spec.md`](spec.md) §0, §5, §9 · UC-12 CHAT-AC-51…58 · ui-admin §3, §7.17 · mockup canvas https://claude.ai/artifact/JHGS9iTLVyytdYwXJJ6eLW (board ①②④–⑧; ③⑨ là P-b, bỏ).
Phụ lục: [`plan-frontend-thread.md`](plan-frontend-thread.md) (**màn ④ thread phòng**, U1) · [`plan-frontend-admin.md`](plan-frontend-admin.md) (admin ①②, validate, **bảng lệch mockup**) · [`plan-frontend-i18n.md`](plan-frontend-i18n.md) + [`-i18n-thread.md`](plan-frontend-i18n-thread.md) (câu chữ VI/EN) · [`plan-frontend-e2e.md`](plan-frontend-e2e.md) (role/nhãn + ca e2e).
Contract: chỉ **tiêu thụ** [`plan-contract.md`](plan-contract.md) §1–§6. Backend: [`plan.md`](plan.md) (D12, D14–D15, §5, §7–§9) + [`plan-thread.md`](plan-thread.md) (thay D13, U1) + [`plan-step0.md`](plan-step0.md). **Plan thắng mockup** khi lệch (phụ lục admin §3).

## 0. Quyết định chính (Luật 2; "FD" = frontend decision)
| # | Quyết định | Lý do |
|---|---|---|
| FD1 | Một feature `features/processes/` mỗi app; thư mục con **theo PF** (khớp cột `File` của `tasks.md`) + `shared/` + `realtime/` do Bước 0. Mỗi thư mục con PF có `api.ts` riêng (nơi duy nhất gọi API của nó); component trình bày không fetch | CR-059; CONVENTIONS §2 |
| FD2 | **Cờ = dò lúc chạy**, không cờ build: `useProcessEngine()` gọi `GET /me/process-inbox?limit=1` (chat) / `GET /process-defs?limit=1&include_templates=false` (admin). 200 ⇒ `on`; 404/403 ⇒ `off`; lỗi mạng/5xx ⇒ `unknown` (ẩn như off, thử lại 1 lần/30 s). Không `on` ⇒ **ẩn mọi lối vào** (nút, menu, sidebar, nav), route trả `NotFoundState`, không nạp chunk/i18n quy trình | BE D15: cờ tắt ⇒ route 404 |
| FD3 | i18n = **file riêng** `packages/i18n/locales/process/<phần>.{vi,en}.json` (`common`, `composer`, `run`, `thread`, `ask`, `inbox`, `usage`, `admin`; mỗi PF sửa phần mình); loader `@ai/i18n/process-locales` gộp sâu, nạp lười khi `on` rồi `addResourceBundle(lng,"translation",…)`; khoá `process.<phần>.<tên>` | WORKFLOW "i18n riêng theo feature" |
| FD4 | **Hỏi AI**: FE chặn `!key` ở composer chính rồi gọi `POST /process-runs` (`origin` conversation / `none` ở `/c/new`), không dùng 202 của `POST /conversations/:id/messages` (driver SSE `run/api.ts` đòi header run; không đụng file C1). Thẻ dựng từ `GET /process-runs?conversation_id=` | Ít đụng file khoá |
| FD5 | **Phòng = thread X2b (U1)**: khối quy trình `sender_type="process"` trong timeline (`ProcessBlock`, dáng `AgentBlock` + `StageStrip`), mọi diễn biến ở **`?flow=`** (`ProcessFlowContent`, 7 loại tin `process.kind`, thẻ kiểm/hỏi/quyết ngay trong thread). Không `?run=`, không `RunPane`, `FlowFrame` không đổi. Chi tiết: [`plan-frontend-thread.md`](plan-frontend-thread.md) | U1; dùng lại X2b |
| FD6 | DM "Quy trình" = **route `/process-inbox`** (không phải phòng): hàng ghim đầu nhóm "Users", huy hiệu = `unread`; không `textbox` | Plan D12/M6, AC-55 |
| FD7 | `TaskPanel` (shared) rẽ theo `TaskDetail.kind`: `review`→`ReviewTaskCard` (PF1), `ask`→`AskTaskCard` (PF2), `decision`→`DecisionCard` (PF1); dùng ở `/runs/$id` và thẻ DM (**inline**); trong thread `ProcessThreadMessage` gọi thẻ ở chế độ **external** (FD12) | PF độc lập |
| FD8 | "Chờ tôi kiểm" = `SidebarGroup` trên cùng; mục → `/runs/$id?task=<taskId>` (thành viên phòng cũng vậy; pane là đường phụ từ thẻ). Luôn hiện khi `on` (rỗng ⇒ "Không có việc nào chờ bạn") | AC-54; Câu hỏi F2 |
| FD9 | Realtime **chỉ patch/invalidate cache TanStack Query** (`realtime/process-events.ts`); `stream.reset` ⇒ invalidate `["process"]` | Mẫu `event-router` |
| FD10 | Không thư viện mới, **không ADR**. Thêm `components/ui/tabs.tsx` (shadcn từ `radix-ui` có sẵn) ở chat-web. Ô trả lời/góp ý = `textarea` thường. Dùng lại `SuggestMenu`, `Composer`, `SendErrorNotice`, `AskCard` (+`hint?: string \| null`), `PersonPicker` (chọn 1), `FlowFrame`/`FlowRecent`/`FlowFooter`, `Markdown`, `SidebarGroup`, `NotFoundState`, `AlertDialog`, `sonner` | CONVENTIONS §6 |
| FD11 | Thread quy trình **tách khỏi thread agent**: `RoomFlowPane` rẽ bằng `useFlowKind` (`process`→`ProcessFlowContent`, `agent`→`RoomFlowContent` không đổi) ⇒ không đụng test khoá X2b. Mọi chỗ chuyển theo `sender_type` ở phụ lục thread §6, **giao Bước 0** |
| FD12 | Việc cần làm gắn vào tin sinh ra nó; **chỉ assignee có nút** (`taskSlot`: `my_tasks`), người khác `TaskWaitingNote` từ `open_tasks`. Góp ý "Chưa đạt" và trả lời văn bản gõ ở **composer thread** (chế độ ràng task, `ThreadBinding`); ngoài thread thẻ dùng ô inline | T6/T8; mockup ④⑦ |
| FD13 | Composer thread: chữ thường = người↔người; `@agent` ⇒ 422 `PROCESS_THREAD_NO_AGENT` (lỗi trong ô, chữ giữ); `!` là chữ thường, không menu `!`; không `answer_run_id`. Ràng task là **chủ động** (bấm `Chưa đạt` / `Trả lời bằng văn bản`), không tự biến mọi chữ thành câu trả lời | T7 |

## 1. Bản đồ màn
| Board | Màn | App · route | Task (PF) | Chunk lười |
|---|---|---|---|---|
| ⑥ | Menu `!` + nút "Quy trình" | chat · composer của `/rooms/$id`, `/c/new`, `/c/$id` | F1 (PF1) | không (≤ 6 KB gz; dữ liệu nạp lười) |
| ④ | Khối quy trình + thread `?flow=` (7 loại tin, kiểm/quyết) | chat · `/rooms/$id` (+`?flow=`); thẻ Hỏi AI `/c/$id` | F2 (PF1), `AskMessage` F4a (PF2) | `ProcessBlock`, `ProcessFlowContent`, `DecisionCard`, `OutputView` |
| ⑦ | AskCard + nhờ người khác trả lời | trong `TaskPanel` (pane, `/runs/$id`, DM) | F4a (PF2) | `ForwardDialog` |
| ⑤ | "Chờ tôi kiểm", DM "Quy trình", `/runs/$id` | chat · sidebar, `/process-inbox`, `/runs/$id` | F3 (PF3) | cả hai route (autoCodeSplitting) |
| ⑧ | Tab Token | chat `/runs/$id?tab=token`; admin run page | F4b (PF4), F5 | `UsageTab` |
| ① | Danh sách quy trình | admin · `/processes` | F5 (PF4) | route |
| ② | Editor tối thiểu + run | admin · `/processes/new`, `/processes/$processId`, `/processes/$processId/runs/$runId` | F5 (PF4) | route (≤ 50 KB gz/chunk) |

## 2. Màn ⑥ — Menu `!` và nút "Quy trình" (PF1 · `chat-web/features/processes/composer/`)
| Hạng mục | Chi tiết |
|---|---|
| Mới | `components/ProcessMenu.tsx` (listbox "Quy trình" trên `SuggestMenu`) · `components/ProcessButton.tsx` (nút trong `ComposerRow`) · `hooks/use-bang-suggest.ts` (`Suggest<ProcessItem>` giống `useAgentSuggest`) · `hooks/use-bang-submit.ts` (chặn `!key` ở Hỏi AI, FD4) · `lib/bang.ts` (thuần, khớp plan §7: `bangQuery`, `classifyBang`, `fillBang`, `filterProcesses` bỏ dấu) · `api.ts` (`useProcessMenu`, `useStartProcess`) |
| Mở/đóng | `bangQuery`: `!` ở **đầu tin**, không `!!`, con trỏ trong token đầu; gõ khoảng trắng ⇒ đóng. Nút "Quy trình" bật/tắt cùng listbox (`aria-haspopup="listbox"`, `aria-expanded`); chọn ⇒ `!key ` + phần chữ còn lại. Chỉ bật ở `variant="room"` và `"main"` (không flow/thread, kể cả thread quy trình) khi engine `on`; `menus` của phòng giữ `"agents"` (`/` vẫn chữ, Q10) |
| Hàng menu | tên · `!key` (mono) · `input_hint` 1 dòng · "{{n}} giai đoạn". Sắp theo tên (server). ≤ 200 dòng, không virtualize |
| Trạng thái | tải · rỗng ("Chưa có quy trình nào bạn được chạy") · không khớp · lỗi + "Thử lại" (như `AgentMenu`). Engine tắt ⇒ không menu/nút. `GET /processes` nạp lười lần gõ `!` đầu, `staleTime` 60 s, mở phòng ⇒ invalidate 1 lần |
| Gửi — phòng | đường cũ `useSendRoomText` ⇒ 201 (`process_run_id`, `flow_id`, header `X-Flow-Id`); tin gọi + khối quy trình tới qua `room.message` (không tự mở thread). Lỗi: `PROCESS_NOT_FOUND` ⇒ `alert` + "Ý bạn là" nút `!<key>` (≤ 3); `TOO_MANY_PROCESS_RUNS` ⇒ `alert` đếm ngược `Retry-After`, khoá Gửi; khác ⇒ toast |
| Gửi — Hỏi AI | `use-bang-submit`: `classifyBang` ⇒ `POST /process-runs {process_key,input,origin}`; có tệp đính kèm ⇒ chặn, `alert` "Quy trình chưa nhận tệp đính kèm…" (Câu hỏi F1). `/c/new` ⇒ sau 201 `navigate /runs/$id`; `/c/$id` ⇒ thẻ hiện ở `ConversationRunCards` + toast "Đã bắt đầu quy trình …" (nút "Mở"). Lỗi như phòng. Engine tắt ⇒ `!` là chữ (đường cũ) |

## 3. Màn ④ — Khối quy trình + thread phòng (PF1 · `run-block/`; chi tiết [`plan-frontend-thread.md`](plan-frontend-thread.md))
| Hạng mục | Chi tiết |
|---|---|
| Bố cục | khối timeline (§1–§2 phụ lục) → `?flow=` (§3 bảy loại tin, §4 thanh trạng thái, §5 composer) |
| Còn ở `run-block/` | `RunCard` + `ConversationRunCards` **chỉ cho Hỏi AI** (D14): nút `Xem tiến độ`/`Kiểm ngay`/… → `/runs/$id`; `api.ts` (`useStartRun`, `useRoomRuns`, `useConversationRuns`, `useReviewDecision`, `useDecide`, `useCancelRun`) |
| Trạng thái | tải · lỗi + "Thử lại" · 404 "Bạn không còn xem được lượt chạy này" (quyền = 404, BR-25) · 409 `REVIEW_TASK_CLOSED` ⇒ "Đã có người khác quyết" + refetch · mạng rớt khi gửi ⇒ giữ chữ + toast. Đạt ⇒ toast "Đã duyệt giai đoạn {{stage}}"; Chưa đạt ⇒ "Đã gửi góp ý. {{agent}} sẽ làm lại ({{n}} lần còn lại)" |
| `DecisionCard` | lý do (14 mã) + 3 nút theo `options` (`Thêm 1 lần làm lại` · `Dùng bản hiện có` disabled khi `has_output=false`/`current_output_id=null` · `Huỷ lượt chạy` AlertDialog) + `Ghi chú (tuỳ chọn)` ≤ 500. Lỗi `NOT_PROCESS_DECIDER`/`PROCESS_RUN_STATE` ⇒ toast + refetch; `NO_OUTPUT` ⇒ chữ dưới nút |
| `ReviewTaskCard` | `can_act` ⇒ `Đạt`, `Chưa đạt`. Inline: ô góp ý tại chỗ (trim ≥ 1, ≤ `FEEDBACK_MAX`) + `Gửi góp ý · làm lại`/`Huỷ`; trong thread: `Chưa đạt` chuyển composer sang chế độ Góp ý (thread §5). Chuyển người kiểm: `ForwardAction` (PF2) |

## 4. Màn ⑦ — Hỏi lại và nhờ người khác trả lời (PF2 · `ask/`)
| Hạng mục | Chi tiết |
|---|---|
| Mới | `components/AskTaskCard.tsx` (bọc `AskCard` + textarea; prop `mode`) · `AskMessage.tsx`, `ForwardMessage.tsx` (thread) · `ForwardAction.tsx` (nút) · `ForwardDialog.tsx` (lười) · `hooks/use-ask-actions.ts` · `lib/ask-rules.ts` (thuần: `askMode(question)`, `canForward(task)`, `forwardsLeft`) · `api.ts` (`useAnswerTask`, `useForwardTask`) |
| Hai chế độ | **inline** (`/runs/$id`, DM): thẻ có `textbox "Câu trả lời"` + `Gửi trả lời`. **external** (thread, `ThreadBinding`): thẻ chỉ chip + `Trả lời bằng văn bản` (đưa composer thread sang chế độ Trả lời) + `Nhờ người khác trả lời`; chip gộp điền vào composer qua `fill()`. Tin `ask`/`forward` trong thread: `AskMessage`, `ForwardMessage` (thread §3) |
| Câu hỏi | `question` (giữ xuống dòng; Hub gộp nhóm thành "1. … 2. …") + chip `choices`. Chỉ **một** câu (không có ≥ 2 dòng `^\d+[.)]`) ⇒ chip **gửi ngay** (`answer=choice, choice=choice`, như CHAT-AC-13); gộp nhiều câu ⇒ chip **chèn vào ô trả lời** (không gửi) vì `choices` phẳng. Textarea `Câu trả lời` (1..`ANSWER_MAX`) + `Gửi trả lời`. Tiêu đề "{{agent}} cần thêm thông tin · lần hỏi {{n}}/{{max}}" |
| Người được nhờ | thấy: "{{from}} nhờ bạn trả lời" + lời nhắn + `excerpt` ("Ngữ cảnh kèm theo", ≤ 1000 ký tự, văn bản thuần) + câu hỏi; **không** thấy gì khác (BR-25). Banner: "Bạn chỉ thấy câu hỏi này. Lượt chạy dùng quyền và quota của {{starter}}." |
| Nhờ người khác | `Nhờ người khác trả lời` mở `ForwardDialog`: tìm người (`PersonPicker`, chọn 1, loại mình + người đã là assignee), `Lời nhắn (tuỳ chọn)` ≤ `FORWARD_NOTE_MAX`, `Nhờ trả lời` / `Huỷ`. Sau thành công: thẻ ghi "↪ Đã nhờ {{to}} (chuyển {{k}}/3) · bạn vẫn trả lời được, ai trả lời trước thì khoá" |
| Khoá | `forwards.length ≥ FORWARD_CHAIN_MAX` ⇒ nút `aria-disabled` + tooltip "Đã nhờ tối đa 3 lần"; `status=closed` ⇒ không nút, "✓ {{who}} đã trả lời · {{time}}" + nội dung trả lời (từ `history`); gõ "@Thomas trả lời giúp" ở chat không liên quan (không có UI) |
| Lỗi | `FORWARD_TARGET_INVALID` ⇒ lỗi dưới ô tìm ("Người này không thể nhận…"); `FORWARD_LIMIT` ⇒ khoá nút + chữ; `FORWARD_OUT_OF_GROUP` (review) ⇒ "Chỉ chuyển được cho người cùng nhóm kiểm"; `REVIEW_TASK_CLOSED` ⇒ "Đã có người trả lời" + refetch; `TASK_KIND_MISMATCH` ⇒ toast chung |

## 5. Màn ⑤ — "Chờ tôi kiểm", DM "Quy trình", `/runs/$id` (PF3 · `inbox/`, `run-page/`)
| Hạng mục | Chi tiết |
|---|---|
| Mới (inbox) | `components/{TodoGroup,ProcessDmRow,NoticeCard,InboxLog}.tsx` · `pages/ProcessInboxPage.tsx` · `hooks/{use-todo,use-inbox,use-mark-read}.ts` · `events.ts` (`onProcessNotice`) · `api.ts` (`useReviewTasks`, `useInbox` infinite, `useMarkInboxRead`) |
| Mới (run-page) | `pages/RunPage.tsx` (route `/runs/$id?tab&task`) · `components/{RunHeader,ProgressTab,LogTab,TaskAccessBanner}.tsx` |
| `TodoGroup` | `GET /me/review-tasks?status=open&limit=50`; huy hiệu = số mục (`next_cursor`≠null ⇒ "50+"); mỗi mục `link` "{{stage}} · {{process}}" + phụ đề loại ("Kiểm"/"Trả lời"/"Quyết định") · thời gian tương đối; ≤ 10 mục hiện, còn lại "Xem thêm" (mở rộng tại chỗ). `review_task.closed` ⇒ mục **biến mất ngay** (patch cache); rỗng ⇒ "Không có việc nào chờ bạn". Tải: 3 `Skeleton`; lỗi: chữ + "Thử lại" |
| `ProcessInboxPage` | tiêu đề "Quy trình" + phụ đề "Tài khoản hệ thống · Hub gửi việc cần bạn xử lý…"; `log` thông báo cũ→mới, ngày chia nhóm; tải trang cũ khi chạm đỉnh (`next_cursor`); **không textbox**; chân "Đây là kênh thông báo của quy trình, không nhắn trả lời được." Rỗng: "Chưa có thông báo nào." |
| `NoticeCard` | tiêu đề theo `kind` (phụ lục i18n §6); `task_id` còn mở (có trong cache `tasks.open`) ⇒ **tự mở rộng** `TaskPanel` (3 thẻ mở mới nhất; còn lại có nút "Xem & xử lý" mở khi bấm); đã đóng ⇒ dòng kết quả ("Bạn đã Đạt · 16:52" / "Đã có người khác xử lý"). Link "Mở trang lượt chạy ›". Đánh dấu đã đọc: khi trang mở và `log` cuộn tới đáy ⇒ `POST /me/process-inbox/read {up_to_id}` (debounce 500 ms); huy hiệu theo `unread` |
| `RunPage` | tiêu đề tên quy trình + `!key` + badge; link quay lại ("‹ {{phòng}}" nếu `origin.room_id` và thấy phòng, kèm link "Mở luồng trong phòng" → `/rooms/$id?flow=<thread.flow_id>` khi `thread`≠null; "‹ Hỏi AI" nếu conversation; không có khi `access:task`). **Tabs** `Tiến độ` · `Token` · `Nhật ký` (`Nhật ký` ẩn khi `access:task`). Tiến độ (`full`): `StageStrip`, từng giai đoạn mở được (output các phiên bản, `OutputView`), `TaskPanel` (`?task=` cuộn + focus), `DecisionCard`, `CancelRunButton`. Nhật ký: `history` thời gian ngược. `ProgressTab` `access:task` ⇒ `TaskAccessBanner` ("Bạn không ở phòng này. Bạn chỉ xem được phần cần xử lý…, quyền xem ghi nhật ký."), `StageStrip` chỉ tên+trạng thái (rỗng khi run đã kết thúc, M4) |
| Trạng thái trang | tải (skeleton) · lỗi + "Thử lại" · **404** `NotFoundState` ("Không tìm thấy" — gồm cả không có quyền, CHAT-AC-56) · engine tắt ⇒ 404 · `?task=` đã đóng ⇒ thẻ đóng + kết quả · `?task` lạ ⇒ bỏ qua |

## 6. Trạng thái → câu chữ + nút (khối phòng, thẻ Hỏi AI, trang; chuỗi ở phụ lục i18n §2)
| `status` | Dòng trạng thái | Nút ở **khối phòng** (chỉ assignee; bấm = mở `?flow=`) | Nút ở thẻ Hỏi AI (→ `/runs/$id`) |
|---|---|---|---|
| `running` | Đang chạy · Giai đoạn {{n}}/{{t}} · {{stage}} (`queued` ⇒ "Đang xếp hàng") | — | `Xem tiến độ` |
| `waiting_review` | `my_tasks` có review ⇒ **Chờ bạn kiểm**; khác ⇒ Chờ người kiểm | `Kiểm ngay` | `Kiểm ngay` / `Xem tiến độ` |
| `waiting_answer` | có ask của mình ⇒ **Cần bạn trả lời**; khác ⇒ Chờ {{to}} trả lời | `Trả lời` | `Trả lời` / `Xem tiến độ` |
| `needs_decision` | `can_decide` ⇒ **Cần bạn quyết định**; khác ⇒ Cần người quyết · {{lý do}} | `Quyết định` | `Quyết định` / `Xem tiến độ` |
| `done` · `cancelled` · `failed` · `expired` | Hoàn tất · Đã huỷ · Lỗi · Hết hạn (7 ngày, không tự duyệt) | — | `Xem kết quả` / `Xem chi tiết` |

## 7. Màn ⑧ — Token (PF4 · chat `usage/`, admin `components/usage/`)
Chi tiết (KPI, bảng giai đoạn, `summary` cho người xem `task`, trạng thái): [`plan-frontend-usage.md`](plan-frontend-usage.md). Gọi `GET /process-runs/:id/usage` (`staleTime` 15 s, invalidate theo `process.updated`); `UsageTab` lười.

## 8. Cờ, hiệu năng, a11y
| Mục | Quy tắc |
|---|---|
| Cờ | FD2. `useProcessEngine` cache `["process","engine"]` `staleTime` 5 phút; xoá khi `session.cleared/expired`. Mọi cửa vào bọc `ProcessEngineGate`; Hub bật cờ giữa phiên ⇒ cần tải lại trang (không thử lại vô hạn) |
| Bundle | Bundle chính chat-web thêm ≤ 8 KB gzip (probe, `bang.ts`, `TodoGroup`, `ProcessDmRow`, móc); mọi thứ khác lười: `ProcessBlock`, `ProcessFlowContent`, `DecisionCard`, `ForwardDialog`, `UsageTab`, 2 route. Chunk ≤ 50 KB gzip (`check:bundle`, F6). Admin: 4 route lười ≤ 50 KB gzip; editor tách `StageForm` lười theo accordion |
| Render / mạng | `ProcessBlock`/`RunCard`/`NoticeCard` `memo`; `process.updated` **patch** `status/stage_idx` rồi invalidate view (`refetchType:"active"`); không polling (chỉ sự kiện); view `staleTime` 10 s, `usage` 15 s, nội dung output `Infinity` theo `output_id`; danh sách ≤ 200 không virtualize, inbox phân trang 50 |
| A11y | phần tử thật (`button`, `label`, `table`, `tablist`); `aria-label` nút icon; khối/tin thread `article` có `aria-label`; thẻ việc `region`; pane `complementary "Flow đang mở"` (X2b); trạng thái đổi báo bằng `aria-live="polite"` ở dòng trạng thái; `Chưa đạt` mở ô ⇒ focus vào ô góp ý; đóng pane trả focus về "Trả lời tiếp" (X2b); menu `!` theo mẫu `listbox`/`aria-activedescendant`; tương phản ≥ 4.5:1 (badge dùng token theme, không hex) |

## 9. Bước 0 FE (làm trước PF; thin, không logic nghiệp vụ) và sở hữu file PF
**Bước 0 FE** (một session, cùng nhánh/`main` với B0; chờ B2 mock):
| # | Việc | File |
|---|---|---|
| 1 | Thư mục + README + **stub đúng chữ ký** (render `null`/no-op) cho mọi file PF được móc/`ProcessThreadMessage` tham chiếu: `useBangSuggest`, `ProcessMenu`, `ProcessButton`, `useBangSubmit`, `ProcessBlock`, `ProcessFlowContent`, `ProcessThreadFooter`, `OutputMessage`, `TaskResultMessage`, `DecisionMessage`, `RunEndMessage`, `RunCard`, `ReviewTaskCard`, `DecisionCard`, **`CancelRunButton`** (RunPage PF3 dùng, readiness #4), `ConversationRunCards`, `AskTaskCard`, `AskMessage`, `ForwardMessage`, `ForwardAction`, `TodoGroup`, `ProcessDmRow`, `ProcessInboxPage`, `RunPage`, `UsageTab`, `onProcessNotice` | `chat-web/src/features/processes/**` (§10), `admin-web/.../processes/**` (pages stub) |
| 2 | `shared/` thật (mỏng): `keys.ts`, `types.ts`, `api.ts` (`probeEngine`,`fetchRun`,`fetchOutput`), `engine.ts`, `components/{RunStatusBadge,StageStrip,OutputView,TaskPanel,TaskWaitingNote}.tsx`, `lib/{status,format,decision-reason,thread-task}.ts`, `hooks/{use-thread-run,use-in-view}.ts`, `thread/{ProcessThreadMessage,thread-binding}.tsx` (+test thuần) | như cột trái |
| 3 | Realtime: `realtime/process-events.ts` (FD9); `event-router.ts` thêm `case` 4 sự kiện + `stream.reset` + nhánh `process` của `room.message` (thread §6 #1); `me-stream-driver.ts` thử `parseMeStreamProcessEvent`; `RoutedEvent` += `MeStreamProcessEvent` | `features/realtime/{event-router,me-stream-driver}.ts` |
| 4 | Route rỗng: `runs.$id.tsx`, `process-inbox.tsx` (**không** thêm `?run` ở `rooms.$id.tsx`); chạy sinh `routeTree.gen.ts` | `routes/_authed/*` |
| 5 | Móc composer: `Composer.tsx` (prop `processMenu`; tách `ComposerMenus` để ≤ 200 dòng), `composer-types.ts` (+`sendLabel?`), `ComposerRow.tsx` (slot nút + `sendLabel`), `use-suggest.ts` (menu thứ 3), `menu-ids.ts`, `send-error.ts` + `SendErrorNotice.tsx` + `use-send-error.ts` (mã `PROCESS_NOT_FOUND`/`TOO_MANY_PROCESS_RUNS`/**`PROCESS_THREAD_NO_AGENT`**, tiền tố `!`, đếm ngược), `RoomComposer.tsx`, `WelcomePage.tsx`, `ConversationPage.tsx` | `features/composer/**`, `rooms/components/RoomComposer.tsx`, `thread/pages/*` |
| 6 | Móc phòng/shell: **9 chỗ `sender_type` ở thread §6** (`event-router`, `room-agent` ×2, `FlowRecent`, `RoomTimeline`, `RoomFlowPane`, `MessageItem`, `FlowFooter` `hideCopy`, `RoomView`) + `rooms/hooks/use-flow-kind.ts`; `Sidebar.tsx` (`TodoGroup`), `RoomSections.tsx` (`usersPinned`), `answer/AskCard.tsx` (`hint`), `lib/http.ts` (`ApiErrorCode` += `ChatProcessErrorCode`), `components/ui/tabs.tsx`. **Không** còn prop `label` ở `FlowFrame` | file tương ứng |
| 7 | i18n: `packages/i18n/locales/process/{common,composer,run,thread,ask,inbox,usage,admin}.{vi,en}.json` (`common` đầy đủ, phần khác khung rỗng), `src/process-locales.ts`, `package.json` exports; `app/i18n.ts` (hai app) gọi `ensureProcessLocale(lng)`; **`tools/scripts/src/i18n-check.ts`** thêm `locales/process/` (gộp sâu `<phần>.{vi,en}.json`, so khoá vi/en, tiền tố lỗi `process:`; ~6 dòng — file thuộc **B0**, readiness #11) | `packages/i18n/**`, `apps/*/src/app/i18n.ts`, `tools/scripts/src/i18n-check.ts` |
| 8 | admin-web: `nav.ts` (`NavId "processes"`, mục CHỨC NĂNG cả hai role, `navGroups(role, opts)`, crumbs), `ConflictEntity` += `"process_def"` + `conflict.*`, 4 route + `pages/*` stub, `features/shell` truyền cờ nav | `features/shell/lib/nav.ts`, `components/shared/conflict/*`, `routes/_authed/processes/*` |
| 9 | Kiểm: `typecheck`, `bun test` (test khoá H2b/X2a/X2b/C1 xanh khi engine `off`; test mới cho thread §6 #1–#4), `bun run i18n:check`, `check:size`, `depcruise` | — |
Mock/fixture B2: plan-step0 §3 (persona, 6 run + tin thread, `POST /__mock/process`).

## 10. Sở hữu file PF (chỉ sửa file của mình; ngoài ⇒ dừng, báo session chính)
| PF · task | Chat-web (`features/processes/…`) hoặc admin | i18n (`locales/process/…`) |
|---|---|---|
| Bước 0 | `shared/**`, `engine.ts`, `realtime/**`, `README.md`, các móc §9 | `common` |
| PF1 · F1 | `composer/{api.ts,components/{ProcessMenu,ProcessButton}.tsx,hooks/{use-bang-suggest,use-bang-submit}.ts,lib/bang.ts}` | `composer` |
| PF1 · F2 | `run-block/{api.ts,components/{ProcessBlock,ProcessFlowContent,ProcessFlowMessages,ProcessThreadFooter,OutputMessage,TaskResultMessage,DecisionMessage,RunEndMessage,ReviewTaskCard,DecisionCard,CancelRunButton,RunCard,ConversationRunCards}.tsx,hooks/{use-room-runs,use-review-actions,use-decide}.ts}` | `run`, `thread` |
| PF2 · F4a | `ask/{api.ts,components/{AskTaskCard,AskMessage,ForwardMessage,ForwardAction,ForwardDialog}.tsx,hooks/use-ask-actions.ts,lib/ask-rules.ts}` | `ask` |
| PF3 · F3 | `inbox/**`, `run-page/**` | `inbox` |
| PF4 · F4b | `usage/**` (chat) | `usage` |
| PF4 · F5 | `admin-web/src/features/processes/**` (trừ stub nav Bước 0) | `admin` |
Chéo PF do Bước 0 giữ: `TaskPanel`, `ProcessThreadMessage` (switch), `ThreadBinding`, chữ ký `ForwardAction` (PF1 gọi, PF2 hiện thực). Chỉ test `*.test.ts(x)` cạnh file PF của mình.

## 11. Cần backend-lead / qc và Câu hỏi
**Đã chốt (người dùng 2026-10-10, spec §9):** F1 không tệp ở P-a · F2 "Chờ tôi kiểm" luôn hiện · F3 KPI/chuỗi giai đoạn admin ① → P-b · F4 **bỏ**: giữ thread (FD5) · U2 Import/Export JSON → P-b. Đã nhận: `process_key`, `open_count`; `StageView.sections` → P-b.
**Đề xuất cho backend-lead/qc** (5 mục, mặc định ghi cột phải): [`plan-frontend-thread.md`](plan-frontend-thread.md) §8.
**Câu hỏi:** Q-F5 — ràng task vào composer thread là **chủ động** (FD13), không tự biến mọi chữ thành trả lời/góp ý. Mặc định: chủ động; đổi thành tự động chỉ cần bỏ bước `begin`.
