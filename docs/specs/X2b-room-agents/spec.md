---
id: X2b-room-agents
title: Agent trong phòng - @agent/@orchestrator trong DM/nhóm, menu @ liệt kê agent dùng được
milestone: X2b
status: draft              # draft → ready → approved → in-progress → done
requirements: [HUB-FR-101, HUB-FR-103, HUB-BR-21, AC-H26, AC-H27, CHAT-AC-46..50, X2b-R01..R20, X2b-AC01..AC17]
design:
  - docs/CHANGE-REQUESTS.md#CR-048 (gồm "Sửa 2026-10-07": bỏ panel/chip agent; CR-023 agent↔agent vẫn Hoãn)
  - docs/design/agent-hub/ba-agent-hub.md (§6.9 FR-101, FR-103; HUB-BR-21; §6 FR-91/92/94/95/77/28; §8 `room_messages` (sender_type, run_id, trigger_message_id), `runs.room_id`; §11 AC-H26, H27)
  - docs/design/chat-app/usecases-chat.md (UC-11; CHAT-AC-46…50)
  - canvas: docs/design/chat-app/canvas-x2/ (Main: menu @, khối flow; https://claude.ai/artifact/GS6GeKK6ycaY6seR77iKs3) · token docs/design/canvas/tokens-map.md
  - nền X2a: docs/specs/X2a-rooms/spec.md (§5.2 flow, §5.3 khung chừa sẵn), spec-isolation.md
owner: backend-lead + frontend-lead + qc
---

# X2b · Agent trong phòng

CR-048 (2026-10-07): sau X2a, trước H4b. Phiên được sửa `apps/chat-web`, `apps/hub-api`, `packages/db`, `packages/contracts/src/chat` (chỉ thêm). Phòng/RLS/`/me/stream`/chưa đọc dùng lại X2a, **không viết lại**.

## 1. Phạm vi
**Làm:**

| # | Nhóm | Nội dung | Nguồn |
|---|---|---|---|
| A | Gọi agent trong phòng | Tin phòng có `@<key>`/`@orchestrator` (đầu tin, như FR-91) → Hub tạo đúng 1 run; không tag → không run | FR-101 |
| B | Quyền + quota người gọi | `runs.user_id` = người gọi; quyền FR-77, `max_concurrent_runs` FR-94, usage tính người gọi | BR-21, AC-H26 |
| C | Ngữ cảnh | Timeline: 20 tin gần nhất; trong thread: 50 tin thread + 20 tin timeline trước tin gốc (sửa 2026-10-08 lần 2); file chỉ dùng nếu đã gửi vào phòng | FR-101 |
| D | Kết quả cả phòng | Tin `sender_type=agent` trong `room_messages` (+ `run_id`, `trigger_message_id`), phát qua `/me/stream` tới mọi thành viên; khối flow C1 | FR-101, UC-11 |
| E | `need_input` / `side_effect` | Chỉ người tag lượt đó trả lời/xác nhận (không cần tag); người khác thấy trạng thái chờ | FR-28, 95, CHAT-AC-48 |
| F | Menu `@` | Composer phòng bật menu `@` (cờ X2a §5.3): tên + `@key` + mô tả, nguồn `GET /agents` | FR-103, AC-H27 |
| G | Đóng mốc | `done:x2b`, review ≤ 2 vòng + **security review riêng** (quyền agent trong phòng, rò ngữ cảnh), I2 | ROADMAP |

**Không làm:** agent↔agent (CR-023, Hoãn) · agent là thành viên cố định / tự lên tiếng · panel hoặc chip agent (CR-048 sửa) · sửa/xoá tin · menu `/` chạy lệnh trong phòng (Q10) · presence/đang gõ · đổi hội thoại riêng user↔agent (giữ AC-H07) · sửa Router/runtime (chỉ dùng lại).

## 2. Nghiệp vụ (X2b-R)
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| X2b-R01 | Chỉ tin `sender_type=user` do **thành viên hiện tại** gửi mới được parse `@`. Tin của agent không bao giờ kích hoạt run (chặn vòng lặp; agent↔agent Hoãn) | FR-101, CR-023 |
| X2b-R02 | Điều kiện gọi = đúng FR-91: tin **bắt đầu** bằng `@<key>` + nội dung; `@@` thoát; `@orchestrator` gọi Orchestrator. Không có `@` đầu tin → chỉ là tin người, không run, không lỗi — ở timeline **và trong thread** (sửa 2026-10-08 lần 2) | FR-91, 101 |
| X2b-R03 | Mỗi tin ≤ 1 run. Nhiều tag → Orchestrator thu hẹp (như FR-91); không sinh nhiều run song song | FR-101, AC-H26 |
| X2b-R04 | Key không có / người gọi không được dùng → `AGENT_NOT_FOUND` (hai trường hợp như nhau, không lộ agent tồn tại), **không run**; tin có vào phòng không: Q4 | FR-77, CHAT-AC-49 |
| X2b-R05 | `runs.user_id` = người gọi (= người **tag** của lượt đó, hoặc người trả lời `answer_run_id` của chính run mình — sửa 2026-10-08 lần 2); `runs.room_id` = phòng; không dùng chủ phòng/phòng làm chủ thể. Quyền, `max_concurrent_runs` (429 `TOO_MANY_RUNS`), quota/usage đều của người gọi | BR-21, FR-94 |
| X2b-R06 | Thành viên khác **không cần** quyền agent để thấy tin/kết quả agent. Agent không đọc dữ liệu/file mà người gọi không có | BR-21, CHAT-AC-50 |
| X2b-R07 | (sửa 2026-10-08 lần 2) Ngữ cảnh run ở timeline = ≤ **20 tin timeline** gần nhất (user + agent, theo `seq`) + tin gọi. Run trong thread = ≤ **50 tin gần nhất của thread** (mọi người gửi, gồm tin người↔người) + ≤ **20 tin timeline** trước tin gốc mở thread + tin gọi; tin user kèm tên người gửi. Chỉ tin của **đúng phòng/thread đó**; không lấy phòng khác/hội thoại riêng (Q6) | FR-101 |
| X2b-R08 | Ngữ cảnh chỉ gồm nội dung phòng mà **người gọi đang là thành viên**; tin trước khi người gọi vào phòng vẫn tính (thành viên mới xem hết lịch sử, X2a). Cắt tại tin gọi, không lấy tin đến sau | FR-96, BR-21 |
| X2b-R09 | File đính kèm chỉ dùng được nếu **đã gửi vào phòng** (bản ghi đính kèm của `room_messages` cùng `room_id`); id file khác → bỏ qua như không có. Người gọi không cần là người gửi file | FR-101, Q9 |
| X2b-R10 | Kết quả = tin `sender_type=agent`, `sender_id` = agent, `run_id`, `trigger_message_id` = tin gọi; trạng thái "<agent> đang xử lý" cả phòng thấy ngay khi nhận tin gọi | FR-101, CHAT-AC-47 |
| X2b-R11 | `need_input` / `side_effect`: chỉ **người tag lượt sinh ra nó** trả lời / bấm Đồng ý-Huỷ, **không cần tag** (gửi kèm `answer_run_id`); người khác gửi `answer_run_id` → 403 `NOT_RUN_CALLER` (đã là thành viên nên không 404). Sửa 2026-10-08 lần 2: mã này chỉ cho `answer_run_id`; tin thường trong thread không bị chặn. UI người khác: "Đang chờ <tên người tag> xác nhận" (ẩn nút) | FR-28, 95, CHAT-AC-48 |
| X2b-R12 | Người khác không thấy tham số/mô tả hành động `side_effect` chưa xác nhận (Q5) | BR-21 |
| X2b-R13 | "Trả lời tiếp" trên khối flow mở khung thread bên phải (`?flow=`; điện thoại: sheet); tin trong thread là `room_messages` có `flow_id` (X2a Q4). **Sửa 2026-10-08 lần 2 (Q7):** thread là **một luồng chung** cả phòng; **mọi thành viên** (kể cả không có quyền agent) nhắn được vào thread; tin không tag = người↔người, không run; tag đầu tin trong thread = run mới bằng quyền + quota **người tag** (BR-21 theo lượt), thiếu quyền → `AGENT_NOT_FOUND` 404 (giữ nội dung composer). Khung thread xem được bởi mọi thành viên (Q11) | UC-11, X2a §5.2 |
| X2b-R14 | Menu `@` = `GET /agents` của **chính user đang xem** (tên vi/en, `@key`, mô tả); `@orchestrator` vẫn gõ được như C1. Không panel/chip. Tải lại danh sách khi mở phòng; agent bị thu hồi biến mất sau tải lại | FR-92, 103, AC-H27 |
| X2b-R15 | Chọn mục menu chèn `@key` (kèm khoảng trắng) đầu tin; placeholder composer gợi ý `@`. Dùng lại thành phần menu C1/X1, bật bằng cờ X2a §5.3 | FR-103 |
| X2b-R16 | Run lỗi/huỷ: tin agent trạng thái lỗi cho cả phòng (câu chữ chung, không lộ chi tiết quota của người gọi); `TOO_MANY_RUNS`/hết quota chỉ báo riêng người gọi | FR-94 |
| X2b-R17 | Người gọi rời/bị bớt hoặc phòng bị xoá giữa chừng: huỷ run, không ghi tin vào phòng (Q8) | BR-22 |
| X2b-R18 | Realtime dùng `/me/stream` X2a; thêm sự kiện trạng thái run (Q1). Chỉ phát cho thành viên hiện tại | FR-99 |
| X2b-R19 | Chưa đọc: tin agent tính chưa đọc cho thành viên khác người gọi; với người gọi thì không (như tin của chính mình) | FR-100 |
| X2b-R20 | Hội thoại riêng user↔agent (`/c/:id`, bảng `messages`) giữ nguyên, AC-H07 vẫn xanh | BR-22, AC-H07 |

## 3. Contract (backend-lead)
Chi tiết trường, thứ tự kiểm: [`plan.md`](plan.md) §2–§3. `@ai/contracts/chat` **chỉ thêm**; `CHAT_ROOM_ERRORS`, `ME_STREAM_EVENTS` giữ nguyên (test khoá X2a đòi đúng 8).

| Mục | Chốt |
|---|---|
| `POST /rooms/:id/messages` | Body + `flow_id?` (gửi vào thread — mọi thành viên; không tag ⇒ 201, không run) + `answer_run_id?` (trả lời ask/xác nhận run của chính mình, cần `flow_id`; không `attachment_ids`, X2b-2). Trả 201 `RoomMessage` (tin gọi) + header `X-Run-Id`, `X-Flow-Id` khi có run; 200 trùng `client_msg_id` (không run). Lỗi: 404 `ROOM_NOT_FOUND` · 400 `VALIDATION_ERROR` · 404 `NOT_FOUND` (thread không thuộc phòng / run không chờ) · 403 **`NOT_RUN_CALLER`** (`answer_run_id` của người khác) · 404 `AGENT_NOT_FOUND{suggestions}` · 422 `CMD_MISSING_ARG` · 409 `FLOW_BUSY` · 429 `TOO_MANY_RUNS` + `Retry-After: 5`. Lỗi ⇒ tin không lưu (Q4) |
| `GET /rooms/:id/messages` | + `flow_id?`: có ⇒ tin của flow; vắng ⇒ timeline (`placement=main`) |
| `GET /rooms/:id` | + `active_runs[]` ≤ 50: `{run_id, flow_id, trigger_message_id, agent\|null, caller, status running\|waiting, wait_kind?, started_at}` |
| `RoomMessage` + (optional) | `placement` `main\|flow` · `agent {key, name{vi,en}}` · `caller {id, display_name}` · `run_status` `finished\|failed\|cancelled` · `ask {kind need_input\|side_effect, question?, choices?}` (`side_effect`: question/choices **chỉ người gọi**) · `steps {count, ms}` · `flow {message_count, last_active_at}` (tin gốc; **bỏ `can_reply`** — sửa 2026-10-08 lần 2) |
| Lỗi mới | `CHAT_ROOM_AGENT_ERRORS = { NOT_RUN_CALLER: 403 }` |
| `/me/stream` | Hằng riêng `ME_STREAM_RUN_EVENTS`: `room.run_started {room_id, run_id, flow_id, trigger_message_id, agent\|null, caller}`, `room.run_waiting {room_id, run_id, flow_id, caller_id, kind}`, `room.run_finished {room_id, run_id, flow_id, status, message_id\|null}` + `parseMeStreamRunEvent`. Tin agent qua `room.message` (payload theo người nhận) |
| Không đổi | `GET /agents` (menu `@`), `GET /runs/:id/events`, `POST /runs/:id/cancel`, trace: RLS `runs` ⇒ chỉ người gọi. Hội thoại nền của run phòng ⇒ 404 qua `/conversations*` |
| Luật thuần | `rooms/agents/room-agent.rules.ts` — chữ ký ở `plan.md` §8 |

## 4. Dữ liệu (backend-lead)
Migration `0014_x2b_room_agents.sql` — chi tiết [`plan.md`](plan.md) §4–§5. `room_messages` (0011) đã có `sender_type`, `sender_id`, `run_id`, `flow_id`, `trigger_message_id` (chưa FK/index), **không** có đính kèm.

| Bảng | Thay đổi |
|---|---|
| `flows` | `room_flow_id` NULL; unique `(room_flow_id, user_id)` — flow nền của người tag gắn thread chung (thread id = flow nền người mở) |
| `conversations` | `room_id` NULL + FK phòng; unique `(room_id, user_id)` — hội thoại nền ẩn của người tag (run phòng tái dùng nguyên runtime C1) |
| `runs` | `room_id` NULL + FK (BA §8), `room_posted_at`; index run đang chạy theo phòng, run chưa đăng |
| `room_messages` | `placement`, `run_status`, `wait_kind`, `ask` (chỉ `need_input`), `step_count`, `run_ms`; FK `flow_id→flows`, `run_id→runs`, `trigger_message_id`; CHECK user/agent thay `room_messages_user_no_agent_ck`; unique tin agent theo `run_id`; index timeline `(room_id, seq) WHERE placement='main'`, flow `(room_id, flow_id, seq)` |
| RLS / definer | policy insert tin thêm `flow_id` phải là thread của phòng (`is_room_thread`; mọi thành viên, không đòi quyền agent); definer `room_post_agent_message` + `room_fanout_sys` (chỉ scope `system`), `room_run_states` |

## 5. UI (frontend-lead)
Chi tiết: [`plan-frontend.md`](plan-frontend.md) (+ phụ lục i18n, e2e). **Không** panel agent, **không** chip (CR-048).

| Thành phần | Hành vi chốt (artboard) |
|---|---|
| Composer phòng | `menus="agents"` (chỉ `@`, không `/` — Q10); nhãn textbox giữ X2a, placeholder "Nhắn cho nhóm… gõ @ để hỏi agent"; lỗi `AGENT_NOT_FOUND`/`TOO_MANY_RUNS` hiện trong ô, giữ chữ (Q4) (Main/DM/Mobile) |
| Menu `@` | "Agent bạn dùng được": tên + `@key` + mô tả từ `GET /agents` người xem; tải lại khi mở phòng (R14) (Main) |
| Khối agent | Tin gọi phẳng; khối "Trả lời của agent X": "<B> hỏi" (B = người gửi lượt của khối), thân C1, "Chạy bằng quyền của <B>", `FlowFooter`; khối "đang xử lý" ở cuối timeline; chỉ người gửi lượt stream + "Dừng" (Main/DM) |
| Chờ | Người gửi lượt: AskCard/chip Đồng ý-Huỷ; người khác: "Đang chờ <B> xác nhận — chỉ người hỏi mới bấm được.", không mô tả hành động (Q5) (Main) |
| Khung flow | `?flow=`; "Trả lời tiếp" luôn bật, mọi thành viên mở thread và có composer + menu `@` (không chỉ-đọc, Q7 lần 2/Q11); tin không tag = người↔người; mỗi lượt ghi tên người gửi + "chạy bằng quyền của <B>"; điện thoại sheet (C1) |
| Đính kèm | Task F5 cắt được sang X2b-2 (Q9) |

Contract BE đã khớp (`plan.md` §2, §12; `plan-frontend.md` §10). Cần fixture người thứ ba C có `hoadon` (B7).

## 6. Hiệu năng
Mặc định `CONVENTIONS.md` §6 (ưu tiên thấp, nới được). Dựng ngữ cảnh 20 tin = 1 truy vấn dùng index `(room_id, seq) WHERE placement='main'` (plan §10).

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| Runtime/Router/Orchestrator Hub (FR-24, 91) | LLM mock sẵn có của e2e Hub; không chạy Dify thật |
| X2a (rooms, RLS, `/me/stream`) | Bắt buộc `done:x2a`; DB test + 2–3 user cùng tenant |
| `GET /agents` + entitlement | Seed `hoadon`, `trello` với quyền khác nhau cho A/B |

Env mới: (không dự kiến).

## 8. Tiêu chí nghiệm thu (qc)
| AC | Given / When / Then (dữ liệu cụ thể) | Test |
|---|---|---|
| X2b-AC01 | (AC-H26, CHAT-AC-47) A được dùng `hoadon`, B (cùng nhóm) không. A gửi "@hoadon kiểm tra" → đúng 1 run, `runs.user_id=A`, `runs.room_id`=phòng, usage tính A; A và B đều thấy tin agent | int + e2e |
| X2b-AC02 | (AC-H26, CHAT-AC-49) B gửi "@hoadon …" → `AGENT_NOT_FOUND`, 0 run, UI báo không tìm thấy; `details.suggestions` = ≤ 3 key gần giống trong quyền B theo `suggestAgents` (Levenshtein, C1), có thể rỗng (dữ liệu AC ⇒ rỗng, không hiện "Ý bạn là"); ca typo `@trelo` ⇒ `["trello"]` | int + e2e |
| X2b-AC03 | Tin không tag → 0 run; tag giữa câu → 0 run; "@@hoadon" → tin thường | int |
| X2b-AC04 | (AC-H26) Tin có hai tag → đúng 1 run (Orchestrator thu hẹp) | int |
| X2b-AC05 | (CHAT-AC-48) Agent `need_input`: A trả lời được (không tag, `answer_run_id`); B gọi endpoint trả lời → 403 `NOT_RUN_CALLER`; UI B thấy "Đang chờ A", không nút | int + e2e |
| X2b-AC06 | (CHAT-AC-48, FR-95) Agent `side_effect`: chỉ A bấm Đồng ý/Huỷ; B bị 403, UI ẩn nút, không thấy tham số | int + e2e |
| X2b-AC07 | (CHAT-AC-50, BR-21) B không có quyền `hoadon` vẫn thấy kết quả; usage/quota B không đổi, của A tăng | int |
| X2b-AC08 | `max_concurrent_runs` của A đầy → 429 `TOO_MANY_RUNS`, 0 run mới, lỗi chỉ A thấy; B gọi bình thường | int |
| X2b-AC09 | Phòng có 30 tin timeline → input run ở timeline chứa đúng 20 tin gần nhất + tin gọi; không có tin phòng khác/hội thoại riêng | int |
| X2b-AC10 | Rò ngữ cảnh: C không là thành viên → không kích hoạt run (404 `ROOM_NOT_FOUND`); run của A không chứa dữ liệu/file A không có; C không thấy `runs`/kết quả | int (cách ly) |
| X2b-AC11 | (rút gọn Q9) `attachment_ids` vào tin phòng → 400 `VALIDATION_ERROR`; run phòng không file | int |
| X2b-AC12 | Tin agent chứa "@hoadon" → không sinh run (chặn vòng lặp) | int |
| X2b-AC13 | (AC-H27, CHAT-AC-46) A có `hoadon`,`trello`, B chỉ `trello`: gõ `@` → menu A 2 mục, B 1 mục (tên + `@key` + mô tả); chọn chèn `@key`; thu hồi quyền → biến mất sau tải lại; DOM không có panel/chip agent | e2e |
| X2b-AC14 | Thu hồi quyền `hoadon` của A trước khi gọi → `AGENT_NOT_FOUND`; giữa lúc run chạy → theo Q2 | int |
| X2b-AC15 | "Trả lời tiếp" mở khung `?flow=` (điện thoại: sheet), tin trong flow có `flow_id`; hội thoại riêng C1 không đổi (AC-H07) | e2e |
| X2b-AC16 | B ở trình duyệt khác thấy "đang xử lý" rồi kết quả, huy hiệu chưa đọc của B tăng 2 (tin gọi + tin agent, X2a-R17 + R19), của A không tăng, qua `/me/stream` (2 instance Hub) | int + e2e |
| X2b-AC17 | (viết lại 2026-10-08 lần 2) A gọi `@hoadon` ở timeline → thread T. B (không có `hoadon`) gửi "ok" trong T → 201, 0 run, A và C thấy tin. B gửi "@hoadon …" trong T → 404 `AGENT_NOT_FOUND`, 0 run, tin không lưu. C (có `hoadon`) gửi "@hoadon tiếp" trong T → run mới `runs.user_id=C`, usage tính C; ngữ cảnh run C có tin của A và B trong T (kèm tên) + ≤ 20 tin timeline trước tin gốc, không tin phòng khác. Run C chờ `side_effect`: A gửi `answer_run_id` → 403 `NOT_RUN_CALLER`; C gửi `answer_run_id` không tag → run tiếp. T có 60 tin → ngữ cảnh đúng 50 tin T gần nhất | int + e2e |

Lệnh xong: `bun run done:x2b` (typecheck, `bun test`, int X2b bằng `bunfig.int.toml`, `tests/acceptance/X2b/rules`, e2e `bun run e2e:chat:x2b`; script do B7 thêm)

## 9. Câu hỏi mở (đều có mặc định; không trả lời = chấp nhận mặc định)
| Q | Câu hỏi | Mặc định đề xuất |
|---|---|---|
| Q1 | Run trong phòng phát gì qua `/me/stream`? | Thêm `room.run_started`, `room.run_waiting` (kèm `caller_id`, loại `need_input`/`side_effect`), `room.run_finished`; kết quả vẫn là `room.message`. Không phát token từng đoạn cho cả phòng: người gọi xem stream run `sse:<run_id>` như C1, người khác thấy kết quả cuối — [x] Người dùng chấp nhận mặc định 2026-10-08 |
| Q2 | Quyền agent bị thu hồi giữa chừng? | Run đang chạy **chạy nốt** (quyền kiểm lúc tạo run, như hội thoại riêng); `side_effect` chưa xác nhận kiểm lại quyền lúc xác nhận, thiếu → huỷ, tin agent "đã huỷ" — [x] Người dùng chấp nhận mặc định 2026-10-08 |
| Q3 | Giới hạn tần suất gọi agent trong phòng? | Không thêm limit mới: chỉ `max_concurrent_runs` + quota người gọi hiện có. Nếu spam phòng thành vấn đề → TECH-DEBT — [x] Người dùng chấp nhận mặc định 2026-10-08 |
| Q4 | Tin gọi bị `AGENT_NOT_FOUND`/`TOO_MANY_RUNS` có vào phòng? | **Không lưu**, trả lỗi cho người gửi (không lộ cho người khác); UI giữ nội dung trong composer — [x] Người dùng chấp nhận mặc định 2026-10-08 |
| Q5 | Người khác thấy gì khi chờ `side_effect`? | Chỉ "Đang chờ A xác nhận" + tên agent; không hiện tham số/hành động; người gọi thấy đầy đủ — [x] Người dùng chấp nhận mặc định 2026-10-08 |
| Q6 | Tin trong flow (`flow_id`) có vào 20 tin ngữ cảnh? | Run ở timeline: 20 tin timeline gần nhất (khối flow gốc tính tin `main`). Run trong thread: cả thread của mọi người (≤ 50 gần nhất) + 20 tin timeline trước tin gốc — [x] Người dùng chốt 2026-10-08 (lần 2): thread chung, tin không tag là người↔người, ngữ cảnh cả thread trần 50 + 20 timeline |
| Q7 | Người không phải người gọi gốc tiếp tục flow? | [x] Người dùng chốt 2026-10-08 (lần 2): thread chung, tin không tag là người↔người, ngữ cảnh cả thread trần 50 + 20 timeline. Mọi thành viên nhắn vào thread; agent chỉ chạy khi tag (quyền + quota người tag); trả lời/xác nhận chờ chỉ người tag lượt đó (`answer_run_id`); bỏ `can_reply` (plan D12, D13) |
| Q8 | Người gọi rời/bị bớt/phòng xoá khi run đang chạy? | Huỷ run (như cancel C1), không ghi tin vào phòng; usage đã dùng vẫn tính người gọi — [x] Người dùng chấp nhận mặc định 2026-10-08 |
| Q9 | Đính kèm file phòng (X2a Q3 hoãn sang X2b)? | [x] **Người dùng chốt 2026-10-08: tách X2b-2** (đính kèm file trong phòng; ROADMAP). X2b: gửi file vào tin phòng → 400. Cũ: **X2b thêm nút đính kèm ở composer phòng** theo FR-44 (cùng lưu trữ như hội thoại riêng, gắn tin phòng); agent chỉ thấy file của phòng này. Nếu PLAN thấy quá lớn → tách X2b-2, báo điều phối |
| Q10 | Menu `/` trong phòng? | Không ở X2b; placeholder chỉ gợi ý `@` — [x] Người dùng chấp nhận mặc định 2026-10-08 |
| Q11 | Quyền xem khung flow cho thành viên khác? | Mọi thành viên xem và nhắn trong thread (Q7 lần 2 thay "chỉ-đọc"); nội dung flow (đã là tin phòng); không xem trace/tham số công cụ nội bộ — [x] Người dùng chấp nhận mặc định 2026-10-08 |
| Q12 | Tin agent lưu ở đâu? | `room_messages` (`sender_type=agent`, `run_id`); `runs` giữ vòng đời/usage; không thêm bảng. Tin gọi + tạo run trong **một transaction** — [x] Người dùng chấp nhận mặc định 2026-10-08 |
| Q13 | Tin trong flow có tính chưa đọc? | Có (mọi tin phòng có `seq`) — `plan-questions.md` §13.2 — [x] Người dùng chấp nhận mặc định 2026-10-08 |
| Q14 | File `out/` agent tạo trong run phòng? | X2b không hiện trong phòng; X2b-2 — [x] Người dùng chấp nhận mặc định 2026-10-08 |
| Q15 | `@orchestrator` là tag dành riêng chỉ trong phòng? | Có; Studio cấm key `orchestrator` → TECH-DEBT — [x] Người dùng chấp nhận mặc định 2026-10-08 |

**Q9 — PLAN đề xuất tách X2b-2** (`plan-questions.md` §14: đính kèm ≈ 40% mốc, thêm bề mặt rò file): X2b không nhận file trong phòng; AC11 ở X2b rút còn "`attachment_ids` vào tin phòng → 400, run phòng không file".

**Hard-stop bảo mật (security review riêng, như X2a):** (1) quyền agent trong phòng: R04–R06, R11–R12, AC01/02/05–08/14; (2) rò ngữ cảnh phòng sang run và ngược lại: R07–R09, R17, AC09–AC12. Không qua review → không `done:x2b`.

## 10. Quyết định
### Trước Gate (đã chốt với người dùng)
- 2026-10-07 · CR-048: không panel/chip agent; menu `@` trong composer; giữ mô hình thread/flow C1; agent↔agent Hoãn.
### Trong lúc làm (agent tự quyết theo Luật 2)
- 2026-10-08 (Luật 2, bắt chước C1): (a) thiếu quyền agent khi gửi tin flow → `AGENT_NOT_FOUND` 404 như C1 (không lộ agent tồn tại), không thêm mã 403 mới; (b) `agent: null` hiện nhãn "Orchestrator" (`roomAgent.orchestratorName`; chat C1 không có key riêng, trùng studio `orchestrator`); (c) lý do huỷ không có trong contract (`run_status: cancelled` thôi): mọi người thấy "Đã huỷ", không phân biệt mất quyền (khớp Q2); (d) tin agent tính chưa đọc cho người gọi ở biên D14 (plan); (e) fixture dev cần người C có quyền `hoadon`, B không (plan.md).
- 2026-10-08 (lần 2) · Người dùng chốt mô hình thread chung (thay Q7 lần 1): tin thread không tag = người↔người; mỗi tag = run người tag; trả lời/xác nhận chỉ người tag (`answer_run_id`); ngữ cảnh thread ≤ 50 + 20 timeline; bỏ `flow.can_reply`; (a) ở trên áp cho **tag** trong thread.
- 2026-10-08 · B4 (backend-lead, Luật 2): (a) tin gọi agent `poll` phiên bản cấu hình (1 truy vấn) trước khi kiểm AU ⇒ thu hồi quyền có hiệu lực ngay cả khi NOTIFY chưa tới (AC14); (b) run chờ (`answer_run_id`) xác định qua definer `room_run_states` (thành viên thấy run người khác ⇒ 403 `NOT_RUN_CALLER` thay vì 404); (c) D15 = run xác nhận tạo với `declineConfirm` (xác nhận `declined`) + driver rỗng rồi huỷ ngay bằng E15 (`CancelService.cancel`) ⇒ một đường đóng run duy nhất; (d) tin gọi `@orchestrator …` lưu `hub.messages` phần sau tag; tin `@agent` lưu cả tin (như C1); (e) `/me/stream` reader nhận thêm `MeStreamRunEvent` (fallback `parseMeStreamRunEvent`).
- 2026-10-08 · B5 (backend-lead, Luật 2): (a) `sender_id` tin agent = `runs.agent_id` ?? agent Orchestrator đã chọn (`flows.agent_id`) ?? tenant Orchestrator; tên người gửi = `agent.name.vi`, không agent ⇒ "Orchestrator" (`agent` vắng); (b) bản riêng (D3) chỉ áp cho `side_effect` (nội dung + `ask` từ `hub.messages` nền, RLS `runs` ⇒ chỉ người gọi); `need_input`/kết thúc/lỗi mọi người cùng bản công khai; (c) agent trả rỗng ⇒ nội dung "…" (CHECK 1–16000), dài ⇒ cắt 16000; (d) chờ (`need_input`/`side_effect`) ⇒ phát `room.run_waiting` rồi vẫn `room.run_finished` (run C1 đã `finished`); `skipped` (R17) ⇒ chỉ `run_finished {message_id: null}`; (e) timeline đọc trường agent (`run_id`, `trigger_message_id`, `agent`, `caller`, `run_status`, `ask`, `steps`) từ B5 vì `room.message` và trang tin dùng chung `room-post.view` (B6 còn `flow`, `?flow_id`, `active_runs`).

## 11. Rủi ro
| Rủi ro | Giảm |
|---|---|
| Rò ngữ cảnh/file qua run (BR-21) | R07–R09, AC09–AC12, security review |
| Vòng lặp agent tự gọi | R01, AC12 |
| Lẫn quyền người xem với người gọi | R05/R06/R11, AC05–AC07 |
| Chạm Router/runtime dùng chung | Chỉ thêm đường vào từ phòng; qc kiểm hồi quy AC-H07, C1 |
| Q9 làm phình mốc (đính kèm) | Tách X2b-2 nếu PLAN > 1.500 dòng |

## 12. Tranh chấp test
- 2026-10-08 · B4 (backend-lead) · `tests/acceptance/X2a/messages.int.test.ts` M08 "@ là chữ" (X2a-R16/AC14: tin `@assistant tóm tắt` ⇒ 201, 0 run) mâu thuẫn X2b-R02/AC01 (tag đầu tin trong phòng = gọi agent; thiếu quyền ⇒ 404 `AGENT_NOT_FOUND`, Q4). Test khoá X2a không đổi; đề xuất QC: M08 đổi sang `@@assistant …`/tag giữa câu (vẫn là chữ ở X2b) hoặc chuyển sang X2b-AC03. Code giữ hành vi X2b.
  - Kết luận (qc, 2026-10-08): **Test sai — qc sửa**, CR-048 + X2b-R02 (U4) thay X2a-R16 cho tag đầu tin; M08 đổi sang tag giữa câu "Nhờ @assistant tóm tắt giúp" (vẫn 201, nguyên văn, 0 run — giữ ý định R16), lock cập nhật. Code giữ hành vi X2b.
- 2026-10-08 · B5 (backend-lead) · `tests/acceptance/X2b/db.int.test.ts` "RLS: … tam (thành viên) thấy tin agent" đếm tin agent **ngay** sau `answer()` (Runtime giả ghi job xong) mà không chờ: tin agent đăng ở tx2 bất đồng bộ (D4, sau khi driver đọc kết quả job + tx1 COMMIT) ⇒ luôn thấy 0 (đua). Đề xuất QC: `await waitAgentMsg(c, "tam", t.room, t.runId)` trong `thread()` trước khi `look`. Code giữ D4.
  - Kết luận (qc, 2026-10-08): **Test sai — qc sửa**. Tin agent đăng bất đồng bộ (D4) là hành vi hợp spec; ý định ca (tam thấy tin agent, không thấy run của lan; cuc không thấy gì) giữ nguyên. Ca RLS chờ `waitAgentMsg(c, "tam", …)` (đòi defined) rồi mới `look`. Lock cập nhật. Code không đổi.
- 2026-10-08 · B5 (backend-lead) · `invoke.int.test.ts` X2b-AC07 và `thread.int.test.ts` AC17 "usage C" đòi `hub.usage_logs` > 0 nhưng `ScriptRuntime` (H1 `_runtime.ts`) không ghi `usage_logs` (Runtime thật ghi cùng tx kết thúc job — `agent_runtime/db/usage_sql.py`; hub-api chỉ đọc) ⇒ luôn 0 dù run đúng của A/C. Đề xuất QC: Runtime giả ghi `usage_logs` khi `result`, hoặc kiểm `runs.user_id` (BR-21 đã kiểm ở AC01). Code không đổi.
  - Kết luận (qc, 2026-10-08): **Test sai — qc sửa**. `usage_logs` do Runtime ghi (`agent_runtime/db/usage_sql.py` INSERT, khoá `user_id` lấy từ payload job — `runtimes/cli/outcome.py:214`); `hub_api` không có quyền INSERT (H1 A51) ⇒ Hub không phải tự ghi, không phải lỗi code. Thêm `runtimeUsage(c, job)` ở `_x2b.ts` ghi 1 dòng như Runtime thật (khoá từ payload Hub dựng); `answer()` và AC17 gọi trước `agent()`. Vẫn chứng minh BR-21: usage mang `user_id` mà Hub giao cho job = người gửi lượt (A ở AC07, C ở AC17), B/người mở thread không bị tính. Lock cập nhật.
