---
id: X2b-room-agents
title: Agent trong phòng - @agent/@orchestrator trong DM/nhóm, menu @ liệt kê agent dùng được
milestone: X2b
status: draft              # draft → ready → approved → in-progress → done
requirements: [HUB-FR-101, HUB-FR-103, HUB-BR-21, AC-H26, AC-H27, CHAT-AC-46..50, X2b-R01..R20, X2b-AC01..AC16]
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
| C | Ngữ cảnh | 20 tin gần nhất của phòng + tin gọi; file chỉ dùng nếu đã gửi vào phòng | FR-101 |
| D | Kết quả cả phòng | Tin `sender_type=agent` trong `room_messages` (+ `run_id`, `trigger_message_id`), phát qua `/me/stream` tới mọi thành viên; khối flow C1 | FR-101, UC-11 |
| E | `need_input` / `side_effect` | Chỉ người gọi trả lời/xác nhận; người khác thấy trạng thái chờ | FR-28, 95, CHAT-AC-48 |
| F | Menu `@` | Composer phòng bật menu `@` (cờ X2a §5.3): tên + `@key` + mô tả, nguồn `GET /agents` | FR-103, AC-H27 |
| G | Đóng mốc | `done:x2b`, review ≤ 2 vòng + **security review riêng** (quyền agent trong phòng, rò ngữ cảnh), I2 | ROADMAP |

**Không làm:** agent↔agent (CR-023, Hoãn) · agent là thành viên cố định / tự lên tiếng · panel hoặc chip agent (CR-048 sửa) · sửa/xoá tin · menu `/` chạy lệnh trong phòng (Q10) · presence/đang gõ · đổi hội thoại riêng user↔agent (giữ AC-H07) · sửa Router/runtime (chỉ dùng lại).

## 2. Nghiệp vụ (X2b-R)
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| X2b-R01 | Chỉ tin `sender_type=user` do **thành viên hiện tại** gửi mới được parse `@`. Tin của agent không bao giờ kích hoạt run (chặn vòng lặp; agent↔agent Hoãn) | FR-101, CR-023 |
| X2b-R02 | Điều kiện gọi = đúng FR-91: tin **bắt đầu** bằng `@<key>` + nội dung; `@@` thoát; `@orchestrator` gọi Orchestrator. Không có `@` đầu tin → chỉ là tin người, không run, không lỗi | FR-91, 101 |
| X2b-R03 | Mỗi tin ≤ 1 run. Nhiều tag → Orchestrator thu hẹp (như FR-91); không sinh nhiều run song song | FR-101, AC-H26 |
| X2b-R04 | Key không có / người gọi không được dùng → `AGENT_NOT_FOUND` (hai trường hợp như nhau, không lộ agent tồn tại), **không run**; tin có vào phòng không: Q4 | FR-77, CHAT-AC-49 |
| X2b-R05 | `runs.user_id` = người gọi; `runs.room_id` = phòng; không dùng chủ phòng/phòng làm chủ thể. Quyền, `max_concurrent_runs` (429 `TOO_MANY_RUNS`), quota/usage đều của người gọi | BR-21, FR-94 |
| X2b-R06 | Thành viên khác **không cần** quyền agent để thấy tin/kết quả agent. Agent không đọc dữ liệu/file mà người gọi không có | BR-21, CHAT-AC-50 |
| X2b-R07 | Ngữ cảnh run = tối đa **20 tin gần nhất của phòng** (user + agent, theo thời gian) + tin gọi; không lấy từ phòng khác/hội thoại riêng. Cách tính tin trong flow: Q6 | FR-101 |
| X2b-R08 | Ngữ cảnh chỉ gồm nội dung phòng mà **người gọi đang là thành viên**; tin trước khi người gọi vào phòng vẫn tính (thành viên mới xem hết lịch sử, X2a). Cắt tại tin gọi, không lấy tin đến sau | FR-96, BR-21 |
| X2b-R09 | File đính kèm chỉ dùng được nếu **đã gửi vào phòng** (bản ghi đính kèm của `room_messages` cùng `room_id`); id file khác → bỏ qua như không có. Người gọi không cần là người gửi file | FR-101, Q9 |
| X2b-R10 | Kết quả = tin `sender_type=agent`, `sender_id` = agent, `run_id`, `trigger_message_id` = tin gọi; trạng thái "<agent> đang xử lý" cả phòng thấy ngay khi nhận tin gọi | FR-101, CHAT-AC-47 |
| X2b-R11 | `need_input` / `side_effect`: chỉ **người gọi** trả lời / bấm Đồng ý-Huỷ; người khác gọi endpoint → 403 `NOT_RUN_CALLER` (đã là thành viên nên không 404). UI người khác: "Đang chờ <tên người gọi> xác nhận" (ẩn nút) | FR-28, 95, CHAT-AC-48 |
| X2b-R12 | Người khác không thấy tham số/mô tả hành động `side_effect` chưa xác nhận (Q5) | BR-21 |
| X2b-R13 | "Trả lời tiếp" trên khối flow mở khung flow bên phải (`?flow=`; điện thoại: sheet); tin trong flow là `room_messages` có `flow_id` (X2a Q4). Chỉ người gọi gốc tiếp tục flow (Q7); khung flow xem được bởi mọi thành viên (Q11) | UC-11, X2a §5.2 |
| X2b-R14 | Menu `@` = `GET /agents` của **chính user đang xem** (tên vi/en, `@key`, mô tả); `@orchestrator` vẫn gõ được như C1. Không panel/chip. Tải lại danh sách khi mở phòng; agent bị thu hồi biến mất sau tải lại | FR-92, 103, AC-H27 |
| X2b-R15 | Chọn mục menu chèn `@key` (kèm khoảng trắng) đầu tin; placeholder composer gợi ý `@`. Dùng lại thành phần menu C1/X1, bật bằng cờ X2a §5.3 | FR-103 |
| X2b-R16 | Run lỗi/huỷ: tin agent trạng thái lỗi cho cả phòng (câu chữ chung, không lộ chi tiết quota của người gọi); `TOO_MANY_RUNS`/hết quota chỉ báo riêng người gọi | FR-94 |
| X2b-R17 | Người gọi rời/bị bớt hoặc phòng bị xoá giữa chừng: huỷ run, không ghi tin vào phòng (Q8) | BR-22 |
| X2b-R18 | Realtime dùng `/me/stream` X2a; thêm sự kiện trạng thái run (Q1). Chỉ phát cho thành viên hiện tại | FR-99 |
| X2b-R19 | Chưa đọc: tin agent tính chưa đọc cho thành viên khác người gọi; với người gọi thì không (như tin của chính mình) | FR-100 |
| X2b-R20 | Hội thoại riêng user↔agent (`/c/:id`, bảng `messages`) giữ nguyên, AC-H07 vẫn xanh | BR-22, AC-H07 |

## 3. Contract (backend-lead)
<!-- backend-lead -->

## 4. Dữ liệu (backend-lead)
<!-- backend-lead -->
Gợi ý cho PLAN: migration `0014_x2b_*` (sau 0011–0013 X2a); `runs.room_id` nullable (BA §8); kiểm `room_messages` đã có `sender_type`/`run_id`/`trigger_message_id`/`flow_id`/đính kèm từ 0011.

## 5. UI (frontend-lead)
<!-- frontend-lead -->
Bám: bật menu `@` phòng (X2a §5.3), nhánh `sender_type=agent` → `FlowBlock` C1, khung `?flow=`, trạng thái "đang xử lý"/"Đang chờ A", placeholder gợi ý `@`. **Không** panel agent, **không** chip.

## 6. Hiệu năng
Mặc định `CONVENTIONS.md` §6 (ưu tiên thấp, nới được). Dựng ngữ cảnh 20 tin = 1 truy vấn dùng index `(room_id, created_at)`.

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
| X2b-AC02 | (AC-H26, CHAT-AC-49) B gửi "@hoadon …" → `AGENT_NOT_FOUND`, 0 run, UI báo không tìm thấy kèm gợi ý agent B dùng được | int + e2e |
| X2b-AC03 | Tin không tag → 0 run; tag giữa câu → 0 run; "@@hoadon" → tin thường | int |
| X2b-AC04 | (AC-H26) Tin có hai tag → đúng 1 run (Orchestrator thu hẹp) | int |
| X2b-AC05 | (CHAT-AC-48) Agent `need_input`: A trả lời được; B gọi endpoint trả lời → 403 `NOT_RUN_CALLER`; UI B thấy "Đang chờ A", không nút | int + e2e |
| X2b-AC06 | (CHAT-AC-48, FR-95) Agent `side_effect`: chỉ A bấm Đồng ý/Huỷ; B bị 403, UI ẩn nút, không thấy tham số | int + e2e |
| X2b-AC07 | (CHAT-AC-50, BR-21) B không có quyền `hoadon` vẫn thấy kết quả; usage/quota B không đổi, của A tăng | int |
| X2b-AC08 | `max_concurrent_runs` của A đầy → 429 `TOO_MANY_RUNS`, 0 run mới, lỗi chỉ A thấy; B gọi bình thường | int |
| X2b-AC09 | Phòng có 30 tin → input run chứa đúng 20 tin gần nhất + tin gọi; không có tin phòng khác/hội thoại riêng | int |
| X2b-AC10 | Rò ngữ cảnh: C không là thành viên → không kích hoạt run (404 `ROOM_NOT_FOUND`); run của A không chứa dữ liệu/file A không có; C không thấy `runs`/kết quả | int (cách ly) |
| X2b-AC11 | File gửi vào phòng X dùng được ở X; id file phòng Y/hội thoại riêng → bỏ qua | int |
| X2b-AC12 | Tin agent chứa "@hoadon" → không sinh run (chặn vòng lặp) | int |
| X2b-AC13 | (AC-H27, CHAT-AC-46) A có `hoadon`,`trello`, B chỉ `trello`: gõ `@` → menu A 2 mục, B 1 mục (tên + `@key` + mô tả); chọn chèn `@key`; thu hồi quyền → biến mất sau tải lại; DOM không có panel/chip agent | e2e |
| X2b-AC14 | Thu hồi quyền `hoadon` của A trước khi gọi → `AGENT_NOT_FOUND`; giữa lúc run chạy → theo Q2 | int |
| X2b-AC15 | "Trả lời tiếp" mở khung `?flow=` (điện thoại: sheet), tin trong flow có `flow_id`; hội thoại riêng C1 không đổi (AC-H07) | e2e |
| X2b-AC16 | B ở trình duyệt khác thấy "đang xử lý" rồi kết quả, chưa đọc +1 (không tính cho A), qua `/me/stream` (2 instance Hub) | int + e2e |

Lệnh xong: `bun run typecheck && bun test && bunx playwright test X2b`

## 9. Câu hỏi mở (đều có mặc định; không trả lời = chấp nhận mặc định)
| Q | Câu hỏi | Mặc định đề xuất |
|---|---|---|
| Q1 | Run trong phòng phát gì qua `/me/stream`? | Thêm `room.run_started`, `room.run_waiting` (kèm `caller_id`, loại `need_input`/`side_effect`), `room.run_finished`; kết quả vẫn là `room.message`. Không phát token từng đoạn cho cả phòng: người gọi xem stream run `sse:<run_id>` như C1, người khác thấy kết quả cuối |
| Q2 | Quyền agent bị thu hồi giữa chừng? | Run đang chạy **chạy nốt** (quyền kiểm lúc tạo run, như hội thoại riêng); `side_effect` chưa xác nhận kiểm lại quyền lúc xác nhận, thiếu → huỷ, tin agent "đã huỷ" |
| Q3 | Giới hạn tần suất gọi agent trong phòng? | Không thêm limit mới: chỉ `max_concurrent_runs` + quota người gọi hiện có. Nếu spam phòng thành vấn đề → TECH-DEBT |
| Q4 | Tin gọi bị `AGENT_NOT_FOUND`/`TOO_MANY_RUNS` có vào phòng? | **Không lưu**, trả lỗi cho người gửi (không lộ cho người khác); UI giữ nội dung trong composer |
| Q5 | Người khác thấy gì khi chờ `side_effect`? | Chỉ "Đang chờ A xác nhận" + tên agent; không hiện tham số/hành động; người gọi thấy đầy đủ |
| Q6 | Tin trong flow (`flow_id`) có vào 20 tin ngữ cảnh? | Run ở timeline chính: 20 tin gần nhất của timeline chính (khối flow gốc tính 1 tin = kết quả cuối). Run trong flow: lịch sử flow + 20 tin timeline gần nhất trước flow |
| Q7 | Người không phải người gọi gốc tiếp tục flow? | **Không**: khung flow chỉ-đọc với họ + gợi ý gõ `@agent` ở timeline để mở flow riêng |
| Q8 | Người gọi rời/bị bớt/phòng xoá khi run đang chạy? | Huỷ run (như cancel C1), không ghi tin vào phòng; usage đã dùng vẫn tính người gọi |
| Q9 | Đính kèm file phòng (X2a Q3 hoãn sang X2b)? | **X2b thêm nút đính kèm ở composer phòng** theo FR-44 (cùng lưu trữ như hội thoại riêng, gắn tin phòng); agent chỉ thấy file của phòng này. Nếu PLAN thấy quá lớn → tách X2b-2, báo điều phối |
| Q10 | Menu `/` trong phòng? | Không ở X2b; placeholder chỉ gợi ý `@` |
| Q11 | Quyền xem khung flow cho thành viên khác? | Mọi thành viên **xem** (chỉ-đọc) nội dung flow (đã là tin phòng); không xem trace/tham số công cụ nội bộ |
| Q12 | Tin agent lưu ở đâu? | `room_messages` (`sender_type=agent`, `run_id`); `runs` giữ vòng đời/usage; không thêm bảng. Tin gọi + tạo run trong **một transaction** |

**Hard-stop bảo mật (security review riêng, như X2a):** (1) quyền agent trong phòng: R04–R06, R11–R12, AC01/02/05–08/14; (2) rò ngữ cảnh phòng sang run và ngược lại: R07–R09, R17, AC09–AC12. Không qua review → không `done:x2b`.

## 10. Quyết định
### Trước Gate (đã chốt với người dùng)
- 2026-10-07 · CR-048: không panel/chip agent; menu `@` trong composer; giữ mô hình thread/flow C1; agent↔agent Hoãn.
### Trong lúc làm (agent tự quyết theo Luật 2)
- (chưa có)

## 11. Rủi ro
| Rủi ro | Giảm |
|---|---|
| Rò ngữ cảnh/file qua run (BR-21) | R07–R09, AC09–AC12, security review |
| Vòng lặp agent tự gọi | R01, AC12 |
| Lẫn quyền người xem với người gọi | R05/R06/R11, AC05–AC07 |
| Chạm Router/runtime dùng chung | Chỉ thêm đường vào từ phòng; qc kiểm hồi quy AC-H07, C1 |
| Q9 làm phình mốc (đính kèm) | Tách X2b-2 nếu PLAN > 1.500 dòng |

## 12. Tranh chấp test
- (không)
