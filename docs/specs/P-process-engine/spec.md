---
id: P-process-engine
title: Process Engine (Quy trình động) — stage + gate duyệt + hỏi lại + nhóm agent + hiển thị token
milestone: P (spike → P-a → P-b → P-c)
status: approved            # draft → ready → approved → in-progress → done
requirements: [HUB-FR-104..119, HUB-BR-23..28, AC-H28..H35, CHAT-AC-51..58, ADM-FR-65..67]
design:
  - docs/CHANGE-REQUESTS.md#CR-056 (lõi + token) · #CR-057 (Nhóm agent) · #CR-058 (phòng/chat, `!`, người duyệt ≠ người gọi)
  - docs/design/agent-hub/ba-agent-hub.md (§6.10 HUB-FR-104…119, HUB-BR-23…28; §8 `process_defs`, `process_runs`, `stage_runs`, `review_tasks`, `agent_teams*`; §9.1 endpoint quy trình; §9.2 `process.updated`, `review_task.*`; §9.3 mã lỗi; §11 AC-H28…H35; ghi chú mở rộng FR-95, FR-101, BR-20)
  - docs/design/chat-app/usecases-chat.md (UC-12; CHAT-AC-51…58)
  - docs/design/admin/ba-admin.md §5.8 (ADM-FR-65…67) · ui-admin.md §3, §7.17
  - docs/design/agent-hub/ui-agent-studio.md §2, §15 (Nhóm agent)
  - canvas: https://claude.ai/artifact/JHGS9iTLVyytdYwXJJ6eLW (board ①–⑨, đã duyệt 2026-10-09)
  - nền: docs/specs/X2b-room-agents/spec.md (thread chung, `answer_run_id`, Q10), H4a `withConfigWrite`, H2c đính kèm, H3b `agent_grants`, CR-054 (bật agent theo công ty)
owner: backend-lead + frontend-lead + qc
---

# P · Process Engine (Quy trình động)

Intake Đầy đủ xong, người dùng **chốt toàn bộ** 2026-10-09 (mặc định + điều chỉnh Q3, Q9, Q13 + yêu cầu mới hiển thị token). Phiên này được sửa `apps/admin-web`, `apps/chat-web`, `apps/studio-web`, `apps/hub-api`, `apps/agent-runtime`, `packages/db`, `packages/contracts` trong phạm vi CR-056…058 (Q12). Nghiệp vụ **không chép** ở đây — trỏ BA-H §6.10.

## 0. Bảng board mockup
| Board | Màn | App | Mốc |
|---|---|---|---|
| ① | Danh sách Quy trình (Evolu Control, CHỨC NĂNG › Quy trình) | admin-web | P-a (tối thiểu) / P-b |
| ② | Editor quy trình (stage, người làm, output, gate, Hành động thật) | admin-web | P-a (tối thiểu) / P-b |
| ③ | Nhóm agent (Agent Forge) | studio-web | P-b |
| ④ | Copilot: chạy run trong phòng + duyệt trong flow pane | chat-web | P-a |
| ⑤ | Người duyệt ngoài phòng: DM từ "Quy trình" + `/runs/:id` | chat-web | P-a |
| ⑥ | Menu `!` trong composer phòng | chat-web | P-a |
| ⑦ | Agent hỏi lại + "Nhờ người khác trả lời" | chat-web | P-a |
| ⑧ | Token theo run / giai đoạn / lượt gọi (`/runs/:id` tab Token) | chat-web, admin-web | P-a |
| ⑨ | Mức dùng của nhóm agent theo kỳ (theo quy trình, theo thành viên, gợi ý tối ưu) | studio-web | P-b |

## 1. Phạm vi & chia mốc
| Mốc | Nội dung | Mã | Điều kiện xong |
|---|---|---|---|
| **Spike P** | Nhóm agent BA thật: so 3 chế độ (trưởng nhóm lập kế hoạch / tuần tự / MCP lai), đo token + thời gian + chất lượng; chốt chế độ mặc định và giới hạn | HUB-FR-114 (đầu vào), 116 | Báo cáo `spike.md` (≤ 1 trang bảng số) + đề xuất; không code sản phẩm |
| **P-a** | Stage runner + máy trạng thái run (Postgres) · gate duyệt · hỏi lại + "Nhờ người khác trả lời" · "Chờ tôi kiểm" · DM hệ thống "Quy trình" · menu `!` + nút "▶ Quy trình" · `/runs/:id` có chi tiết token · 2 quy trình mẫu (SDLC, hoá đơn) · editor tối thiểu (Evolu Control) · nhóm agent dùng bản seed (không editor) · giới hạn + "Cần người quyết" · Hành động thật sau gate | HUB-FR-104 (tối thiểu), 105–107, 109–113, 115, 116, 117 (vế run); HUB-BR-23…28; AC-H28…H34; CHAT-AC-51…58; ADM-FR-65 (không Import/Export JSON), 66 (tối thiểu), 67 | `done:pa` xanh; **security review riêng** (HUB-BR-25) đạt; UAT `qc-uat` |
| **P-b** | Editor đầy đủ ①②③, Nhóm agent ở Agent Forge (+ bật theo công ty, tab Usage), tự quay lại, luật tự duyệt | HUB-FR-104 (đủ + Import/Export JSON, U2), 108, 114 (editor), 117 (vế nhóm), 118; AC-H35; ADM-FR-66 (đủ), ADM-FR-65 (KPI + chuỗi stage + Import/Export, U1·F3/U2) | `done:pb` xanh |
| **P-c** | Workspace code chung + PR thật (SDLC) | HUB-FR-119 | Cần H4b Secrets |

Thứ tự (Q8, đổi 2026-10-10): **spike P** → **P-a** → X2b-2 → H4b → **P-b** → **P-c**.

**Không làm (mọi mốc P):** agent↔agent trực tiếp (CR-023 Hoãn) · `/` trong phòng (X2b Q10 giữ) · duyệt qua email · tự duyệt khi quá hạn · người duyệt sửa output tại chỗ · tiền/quota tháng (H3c tạm dừng) · lịch/API/webhook bắt đầu run (COULD, sau) · email/Zalo/Slack (COULD, chỉ link).

## 2. Nghiệp vụ cụ thể hoá (P-R)
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| P-R01 | Process run là đối tượng riêng (`process_runs`); phòng/Hỏi AI/admin chỉ là `origin`. Thành viên phòng nguồn thấy cả run (khối run trong timeline phòng + flow thread `?flow=`) | Q9, HUB-FR-113 |
| P-R02 | Mỗi stage do **đúng một** agent hoặc **một** nhóm agent làm; chỉ chọn được agent/nhóm đã bật cho tenant (agent: CR-054; nhóm: chỉ `platform_admin` bật) | HUB-FR-104, 114 |
| P-R03 | Output stage = file theo template bắt buộc (Hub kiểm mục bắt buộc), lưu đính kèm có phiên bản | HUB-FR-104, 106 |
| P-R04 | Gate: `review_task` gán Group; người đầu tiên quyết thì khoá; Chưa đạt bắt buộc góp ý; làm lại ≤ 3/stage rồi người duyệt chọn +1 / dùng bản hiện có / huỷ | HUB-FR-107 |
| P-R05 | Hành động thật chỉ chạy sau một gate đạt; gate đạt thay xác nhận `side_effect` của người bắt đầu; audit ghi người duyệt | Q5, HUB-FR-109 |
| P-R06 | Hỏi lại: stage "Chờ trả lời", job kết thúc (không giữ slot/token); ≤ 3 hỏi/stage, không tính làm lại; nhóm: Hub gộp câu hỏi thành một | Q13, HUB-FR-110 |
| P-R07 | Nhờ người khác: chỉ bằng nút; người nhận = user active cùng công ty; chuỗi ≤ 3; trả lời đầu tiên khoá; duyệt chỉ chuyển trong cùng Group | Q13, HUB-FR-111 |
| P-R08 | Người ngoài phòng: grant gắn `review_task`, chỉ output/câu hỏi + tiến độ; còn lại 404 | Q9, HUB-BR-25 |
| P-R09 | Báo việc: "Chờ tôi kiểm" + DM tài khoản hệ thống "Quy trình" (thẻ duyệt trong DM, DM không nhận tin chữ) | Q9, HUB-FR-112 |
| P-R10 | Phiên bản chốt lúc bắt đầu; quyền + trạng thái người bắt đầu kiểm lại trước mỗi stage; mất quyền/khoá ⇒ "Cần người quyết" | Q10, HUB-BR-27 |
| P-R11 | Run chạy bằng quyền + quota + usage người bắt đầu (HUB-BR-21), kể cả khi người khác trả lời/duyệt | HUB-BR-24 |
| P-R12 | `!<key>` đầu tin = chạy quy trình; sai/không được chạy ⇒ `PROCESS_NOT_FOUND`, không tới Orchestrator | Q3, HUB-BR-28 |
| P-R13 | Chạm giới hạn (§2.1) ⇒ "Cần người quyết"; không bao giờ âm thầm chạy tiếp | HUB-FR-115, BR-26 |
| P-R14 | Token đếm từ `usage_logs`/`run_steps` theo run, stage, team-run, lần gọi; chỉ token | Q7, HUB-FR-116, 117 |

### 2.1 Giới hạn (chốt)
| Giới hạn | Giá trị | Khi chạm |
|---|---|---|
| Làm lại mỗi stage | ≤ 3 | Người duyệt: +1 / dùng bản hiện có / huỷ |
| Team-run | ≤ 10 lần gọi agent · ≤ 200k token · ≤ 10 phút chạy (không tính chờ người) · dừng sớm khi 2 lần gọi liền không đổi | Cần người quyết; làm lại = team-run mới, giới hạn mới |
| Tự quay lại (P-b) | ≤ 3 vòng | Hỏi người được cấu hình (vd Tech lead) |
| Hỏi lại mỗi stage | ≤ 3 | Cần người quyết |
| Chuỗi nhờ trả lời | ≤ 3 | `FORWARD_LIMIT` |
| Job | 10 phút (tối đa 60, cấu hình theo stage) | Cần người quyết |
| Thời gian sống run | 7 ngày (`PROCESS_RUN_TTL_DAYS`) | Hết hạn (không tự duyệt) |
| Run đồng thời / tenant | 5 (`PROCESS_RUNS_PER_TENANT`) | `TOO_MANY_PROCESS_RUNS` (429) |
| Nhắc duyệt/trả lời | sau 1 ngày | Chỉ nhắc |

## 3. Contract (backend-lead)
<!-- backend-lead --> Chốt P-a ở [`plan-contract.md`](plan-contract.md): §1 hằng/trạng thái · §2 thực thể (`ProcessRunView` full/task) · §3 endpoint chat (`/processes`, `/process-runs*`, `/review-tasks/:id/{decision,answer,forward}`, `/me/review-tasks`, `/me/process-inbox*`; `!key` ở `POST /rooms/:id/messages` → 201 + `X-Process-Run-Id`, ở `POST /conversations/:id/messages` → 202) · §4 mã lỗi (`CHAT_PROCESS_ERRORS`, `HUB_ADMIN_PROCESS_ERRORS`) · §5 sự kiện (`ME_STREAM_PROCESS_EVENTS`: `process.updated`, `review_task.created/closed`, `process.notice`) · §6 hub-admin (`/process-defs*`, `/agent-teams`) · §7 chữ ký luật thuần. Contract chat **chỉ thêm**. `/studio/api/agent-teams*` là P-b.

## 4. Dữ liệu (backend-lead)
<!-- backend-lead --> Chốt ở [`plan.md`](plan.md) §2 (migration `0019_pa_process_engine.sql`: `process_defs`, `process_runs`, `stage_runs`, `team_runs`, `process_outputs`, `review_tasks`, `review_task_assignees` = grant, `process_notices`, `agent_teams` + `_members` + `_entitlements`; thêm cột null trên `runs`, `conversations`, `room_messages`; CHECK audit), §3 máy trạng thái, §5 quyền xem, §6 token, §10 thứ tự khoá. Tài khoản "Quy trình" = danh tính ảo + hộp thư `process_notices` (plan D12).

## 5. UI (frontend-lead)
<!-- frontend-lead --> Chốt P-a ở [`plan-frontend.md`](plan-frontend.md) (+ `-admin`, `-i18n`, `-e2e`). Board §0. chat-web: menu `!` + nút "▶ Quy trình" (⑥), thẻ run + flow pane duyệt (④), "Chờ tôi kiểm" + DM "Quy trình" + `/runs/:id` (⑤), AskCard + "Nhờ người khác trả lời" (⑦), bảng token (⑧). admin-web: ui-admin §7.17. studio-web: ui-agent-studio §15 (P-b).

## 6. Hiệu năng
Theo `CONVENTIONS.md` §6; không chặn mốc (người dùng 2026-10-03, `test:perf`).

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| Agent chạy stage | `fake-cli` (kịch bản output theo template, `need_input`, vượt token) |
| `claude-sub` thật | Chỉ smoke/UAT; subscription chỉ dev/test (CR-019) |
| Dify (tool `side_effect`) | mock Dify H2a |
| Secrets ngoài (PR, P-c) | Chờ H4b |

## 8. Tiêu chí nghiệm thu (qc)
| AC | Nguồn | Mốc | Test |
|---|---|---|---|
| AC-H28 Stage + gate duyệt | BA-H §11 | P-a | int + e2e |
| AC-H29 Người duyệt ngoài phòng chỉ thấy phần của mình | BA-H §11 | P-a | int (ma trận cách ly) + security review |
| AC-H30 Hỏi lại + nhờ người khác | BA-H §11 | P-a | int + e2e |
| AC-H31 Hành động thật sau gate | BA-H §11 | P-a | int |
| AC-H32 Giới hạn ⇒ Cần người quyết | BA-H §11 | P-a | int |
| AC-H33 Kiểm lại quyền mỗi stage | BA-H §11 | P-a | int |
| AC-H34 Hiển thị token | BA-H §11 | P-a (run) / P-b (nhóm) | int + e2e |
| AC-H35 Nhóm agent | BA-H §11 | P-b (spike đo trước) | int |
| CHAT-AC-51…58 | usecases-chat UC-12 | P-a | e2e chat |
| ADM-FR-65…67 | ba-admin §5.8 | P-a tối thiểu / P-b | e2e admin |

Lệnh xong: `bun run done:pa` (qc + backend-lead định nghĩa ở PLAN, mẫu `done-x2b.ts`).

## 9. Quyết định
### Trước Gate (người dùng chốt 2026-10-09)
| # | Quyết định |
|---|---|
| Mô hình | Quy trình = stage có thứ tự; mỗi stage 1 agent hoặc 1 nhóm; output khai báo (file + template Hub kiểm); sau stage: gate duyệt (Group) hoặc "Tự chạy tiếp"; tự quay lại (SHOULD, P-b); "Hành động thật" chỉ sau gate đạt; Hub điều phối + kiểm quyền + audit |
| Q1 | `tenant_admin` soạn quy trình công ty mình ở Evolu Control (nav "Quy trình" dưới CHỨC NĂNG); `platform_admin` có 2 mẫu (SDLC, hoá đơn) để chép |
| Q2 | Nhóm agent định nghĩa ở Agent Forge (nav "Nhóm agent", `platform_admin`); bật cho công ty chỉ `platform_admin` (đối xứng CR-054); `tenant_admin` chỉ chọn nhóm đã bật |
| Q3 (điều chỉnh) | Bắt đầu bằng **`!`** (vd `!hoa-don`), không phải `/`; X2b Q10 giữ. Composer: `@` agent, `!` quy trình, nút "▶ Quy trình"; menu `!` = quy trình user được chạy; namespace riêng với command. Còn: Hỏi AI, nút "Chạy" admin; lịch/API/webhook COULD |
| Q4 (đổi U3) | Mặc định nhóm = `sequential` (spike); `lead_plan` chọn được (trưởng nhóm chỉ trả 1 kế hoạch ≤ 5 bước, Hub gọi thành viên, không kiểm cuối bằng LLM). CR-023 vẫn Hoãn; MCP lai sau |
| Q5 | Gate đạt thay xác nhận `side_effect` của người bắt đầu (HUB-FR-95) cho stage "Hành động thật"; audit ghi người duyệt |
| Q6 | File chung của nhóm do Hub giữ (đính kèm có phiên bản); mỗi job thành viên nhận bản mới nhất vào `work/<job_id>/` (WRK-BR-07 giữ); trưởng nhóm đọc tóm tắt ≤ 200 token |
| Q7 | Ngân sách token theo team-run, stage, run: đếm + chặn ở "Cần người quyết"; tiền/quota tháng chờ H3c |
| Q8 | Thứ tự: spike P → P-a → X2b-2 → H4b → P-b → P-c (đổi 2026-10-10: người dùng cho Process Engine làm trước X2b-2) |
| Q9 (điều chỉnh) | Người duyệt **không cần** là thành viên phòng; run là đối tượng riêng (`/runs/:id`). Báo: "Chờ tôi kiểm", DM hệ thống "Quy trình" (duyệt trong DM, không trả lời chữ), email/Zalo/Slack sau (chỉ link). Người ngoài phòng chỉ thấy output đang kiểm + tiến độ qua grant gắn task (audit) |
| Q10 | Phiên bản chốt lúc bắt đầu; quyền + trạng thái user kiểm lại mỗi stage (thu hồi ⇒ "Cần người quyết") |
| Q11 | Tự duyệt = luật khai báo trên trường output có cấu trúc (vd `tong_tien ≤ 20000000`), không do LLM |
| Q12 | Được sửa admin-web, chat-web, studio-web trong phạm vi CR-056…058 |
| Q13 (mới) | Agent hỏi lại giữa stage (need_input/AskCard), "Chờ trả lời", job kết thúc khi chờ; người trả lời mặc định = người bắt đầu (cấu hình theo stage); báo như review; nhóm gộp câu hỏi; ≤ 3 hỏi/stage, không tính làm lại; "Nhờ người khác trả lời" (bất kỳ user cùng công ty, ghi chú, chuỗi ≤ 3, trả lời đầu khoá, quyền/quota người bắt đầu, audit); gõ "@Thomas trả lời giúp" không phải uỷ quyền; duyệt chỉ chuyển trong cùng Group |
| Token (mới) | Hiển thị token theo run/stage/team-run/lần gọi (in/out, model, thời gian, số làm lại/hỏi) + tổng theo nhóm theo kỳ; ở `/runs/:id`, Evolu Control, Agent Forge; nguồn `usage_logs`/`run_steps` |
| Giới hạn | §2.1 |
| Lưu trạng thái | Postgres; bảng mới §4; xuất/nhập JSON qua Import/Export (P-b, U2) |

### Mặc định M1–M6 (M4, M5 người dùng xác nhận 2026-10-10 — U4; còn lại áp dụng mặc định)
| # | Điểm | Mặc định |
|---|---|---|
| M1 | Ai được chạy một quy trình | Group được chạy cấu hình trên quy trình, mặc định cả công ty |
| M2 | Thoát tiền tố `!` | `!!` gửi chữ bắt đầu bằng "!" (như `//`, `@@`) |
| M3 | Output sai template | Tính một lượt làm lại tự động, lỗi kiểm làm góp ý |
| M4 | Thời hạn grant người ngoài phòng | Tới khi run kết thúc; sau đó chỉ xem lại phần task của mình |
| M5 | Ai quyết "Cần người quyết" | Người bắt đầu + `tenant_admin` (và người duyệt khi chạm giới hạn làm lại) |
| M6 | Tài khoản hệ thống "Quy trình" | Một danh tính hệ thống mỗi tenant, không đăng nhập được, không thêm vào nhóm |

### Trong lúc làm (agent tự quyết theo Luật 2)
- P1 · M1 → Group được chạy = `run_group_ids` trên quy trình, rỗng = cả công ty; `tenant_admin` chạy được mọi quy trình bật của công ty từ Evolu Control (spec/BA HUB-FR-104, `canRun`).
- P1 · M2 → `!!` = chữ bắt đầu "!" (BA HUB-BR-28 mặc định; giống `@@` trong `routeMessage`).
- P1 · M3 → Output sai template = một lượt làm lại tự động, lỗi kiểm làm góp ý, tính vào giới hạn làm lại; hết lượt ⇒ "Cần người quyết" `template_invalid` (mặc định spec).
- P1 · M4 → Grant người ngoài phòng = hàng `review_task_assignees`; run chưa kết thúc: phần task + tiến độ; run kết thúc: chỉ phần task, không hết hạn; audit `view` lần đầu mỗi task + mỗi lần đọc output (mặc định spec).
- P1 · M5 → Người quyết = người bắt đầu + `tenant_admin` (+ thành viên Group duyệt khi lý do `redo_limit`) (mặc định spec).
- P1 · M6 → "Quy trình" = danh tính ảo (không hàng `admin.users`, không đăng nhập, không thêm nhóm) + hộp thư `process_notices`; không thêm kiểu phòng/sender X2a (giữ test khoá) — plan D12, xác nhận ở Câu hỏi C3.
- P1 · Spike (spike.md) → nhóm mặc định `sequential`; `lead_plan` = kế hoạch JSON 1 lần ≤ 5 bước, Hub chạy, không kiểm cuối bằng LLM, Hub kiểm template bằng mã; thành viên chỉ trả mục của mình, Hub ghép file có phiên bản; tóm tắt cắt cứng 200 token; làm lại chọn lọc mặc định; `parallel_merge` có nhưng không mặc định (Hub ghép theo mục, không lần gộp LLM); MCP lai không ở P-a; giới hạn §2.1 giữ; token = in+out+cache; không thiết kế quanh cache (plan D7–D9).
- P1 · Stage = `hub.runs` `direct` của người bắt đầu trên hội thoại nền ẩn, không qua Orchestrator ⇒ không sửa Orchestrator (plan D1–D3); Hành động thật = Hub chèn sẵn `tool_confirmations` `confirmed` cho run stage (plan D4).
- P1 · Hỏi AI `!key` ⇒ 202 JSON, không lưu tin; phòng: khối run trong timeline + flow thread `?flow=` (mô hình thread, U1·F4), không tin hệ thống trong phòng (plan D13, D14).
- P2 · FE: cờ dò lúc chạy (`GET /me/process-inbox` / `GET /process-defs` 404 ⇒ ẩn UI), không cờ build (plan-frontend FD2). Hỏi AI `!key` ⇒ FE gọi `POST /process-runs` (FD4). Phòng: khối run + flow thread `?flow=` (U1·F4 giữ thread mockup ④; FD5 cũ "thẻ + pane" do plan cập nhật). DM "Quy trình" = route `/process-inbox` (FD6). Khởi chạy chưa nhận tệp (F1). Admin KPI/chuỗi stage ① hoãn P-b (F3).
- P1 · Cờ `HUB_PROCESS_ENGINE` (mặc định off; off ⇒ `!` là chữ thường như cũ) (plan D15).

- B2 · Contract tách 4 file (≤ 400 dòng): `processes.ts` (hằng/enum), `processes-entities.ts` (§2), `processes-api.ts` (§3 req/res), `processes-errors.ts`; `hub-admin/processes.ts` export lại hằng + `ProcessRunSummary/View/Usage`, `ProcessRunList*`. `ProcessDefInputSchema` = hình dạng + luật chéo stage (R-K08); route dùng `ProcessDefInputBaseSchema` + `validateProcessDef` để trả 422 `paths`; `processDefStagePaths` dùng chung. Tên `agent` ở bước/usage (`StepAgentRef.name`) = chuỗi snapshot, không `{vi,en}`. `parseMeStreamProcessEvent(event, data)` nhận chuỗi SSE hoặc object. `FLOW_ID_HEADER` dùng lại của `entities.ts`.
- B2 · Mock: id `PA_FIX` dạng `00000000-0000-4000-8000-0000000a0NNN` (plan ghi `pa<NNN>` không phải hex); persona thêm `tam`/`cuc` "Thomas"/`q01`/`q02`/`tadmin` vào `MOCK_USERS`; `lan-left` = `POST /__mock/process {action:"leave"}` (thêm ngoài 5 action plan); phòng R chỉ qua `GET /rooms/:id(/messages)` — danh sách `/rooms` stub X2a giữ rỗng, mock chưa nhận `POST /rooms/:id/messages`; usage + route nằm ở `runs.ts`/`seed.ts` (không file `usage.ts`). Dify N6: khoá đếm = header `X-Mock-Workflow` → `inputs.workflow_key` → `_`.

- B0 · `!!` bỏ một `!` cả trong thread; tin thread tóm tắt `vi` (tenant chưa có locale); cắt UTF-16 không tách surrogate; `core/` 15 file theo plan §9; route mọi PF mount sẵn (stub); `prepareProcess` nhóm: PF1 `team-runner` kiểm nhóm (C2); poster lỗi ⇒ chặn sự kiện sau cùng run tới lượt sau.
- B0 · `messages.service.ts` `page`/`sendOnce`/`markFlowRead` nhận thread hợp lệ = thread phòng (`threadRoot`, `placement=main`) HOẶC thread quy trình (`repo.isProcessThread`, is_room_thread nhánh iii) — khớp policy `room_messages_insert` ở 0019; gửi/đọc/đánh dấu đọc trong thread quy trình chưa có khối `main` không còn 404 trước DB. Gate thành viên (`guard findAccess`/`lockFor`) + RLS `rooms.read`/`commit` giữ nguyên ⇒ người ngoài phòng vẫn 404. `room-run.service.ts:82` dùng `root.seq` nên giữ `threadRoot` [HUB-FR-105].
- B4 · `origin.kind="none"`/▶ không ngữ cảnh ⇒ `origin_kind="admin"` (CHECK chỉ room/conversation/admin). `suggestProcesses` (`runs/start.service.ts`) Levenshtein ngưỡng `max(2,⌊len/2⌋)` (không `suggestCommands` ⌊len/3⌋) vì test khoá đòi cả `hoa-dn`→`hoa-don` (R-G05, dist 1) và `hoa-dn`→`hoa-don-t` (P1-02, dist 3); B6a export lại ở `gate.rules.ts`.
- B4 · Tin gọi `!key` chèn thẳng (`insertCallMessage`, cột `process_run_id`) rồi `setTrigger` (is_process_trigger đòi `trigger_message_id IS NULL` lúc INSERT; `messages.repo.insertMessage` không có cột đó). Sau COMMIT: `launcher.kick` (lỗi⇒log) + `postThread` (origin room). `runs.routes.ts` mới mount GET/POST catalog+runs; `:id`/`/outputs`/`cancel`/`decide` để B5/B6a.
- B5 · `view.service` đọc dưới **scope user người xem** (plan §5), KHÔNG scope system: `hub.rooms`/`room_members` (X2a) RLS chỉ theo tenant, scope system ⇒ không thấy phòng ⇒ `originRoom`/`thread` sai. platform_admin + `?tenant_id` ⇒ scope `{user, tenantId=tenant đích}` (RLS T cho bảng quy trình + nhìn phòng tenant đích). View read-SQL chia `view.service.ts` + `runs.repo.ts` (`loadHistory`/`openTaskViews`/`assigneeTaskIds`) do trần 400 dòng/file. `StageView.executor` dùng id làm key+name (không truy vấn `agents` mỗi lần xem — tên agent/team hiện ở thread/usage); `history` = task review/decision đã đóng (ask/forward ở thread).
- B5 · `sweeps.expired` chạy scope system (không một người xem): khoá run, set `expired` + đóng stage/`review_tasks` (`result='expired'`) + `enqueueThread(run_end)` + `notifier.runFinished`, phát sự kiện/postThread sau COMMIT.
- B5 phần B (engine) · launcher dùng custom-driver (không `onClosed` chain): `launch(p, files, {driver: stageDriver})`; stage-driver tự `runJob` (AgentRunner in-memory), áp máy trạng thái trong tx scope **system** (RLS T), `writer.finish` sau (D11), `kick` kế. Idempotent: khoá `process_runs` + `stage_runs.current_run_id === hub.run.id`. Seam ngoài cột PF1 (được session chính duyệt, RV1 soát): `core/ports.ts` thêm `runner: AgentRunner`; `processes.mount.ts` `createStageLauncher(base)` nhận deps (self-ref launcher, không TDZ); `app.ts` `processRunner()` dựng runner riêng + `processHooks` gộp cờ `processEngine`. depcruise: `start.service` import `messages.service` (seam) thay `messages.repo`; re-export 4 hàm ở `messages.service`.
### Tranh chấp test
- P1-52 (`view.int`, khoá) · `has_output` kỳ vọng `true` khi `redo` có output, nhưng fixture `insertOutput` chèn `process_outputs` mà KHÔNG set `stage_runs.current_output_id`; `core/task-view.ts` (B0) tính `has_output = current_output_id IS NOT NULL`. B5 không sửa fixture khoá / file B0. Đề nghị: fixture set `current_output_id`, hoặc B0 đổi sang `EXISTS process_outputs`.
### Câu hỏi PLAN (C1–C5: người dùng chấp nhận mặc định 2026-10-10 — "Ok")
| # | Câu hỏi | Mặc định đã chấp nhận |
|---|---|---|
| C1 | Ngân sách token stage/run khi không khai báo? | Không giới hạn (null); chỉ team-run 200k cứng; editor cho nhập `token_budget` tuỳ chọn |
| C2 | Stage dùng **nhóm**: kiểm `agent_grants` của người bắt đầu từng thành viên? | Không — chỉ kiểm nhóm đã bật cho tenant (`platform_admin`) + thành viên đang bật; mất entitlement/tắt thành viên lúc `kick` ⇒ `permission_lost`; stage agent đơn vẫn kiểm grant (HUB-BR-23). Ngoại lệ đã ghi vào BA |
| C3 | DM "Quy trình" = hộp thư riêng (hiển thị như DM ghim)? | Có (plan D12) |
| C4 | Trích đoạn ngữ cảnh cho người được nhờ | Hub lấy ≤ 1 000 ký tự đầu input run + tên stage; agent tự đính kèm để P-b |
| C5 | Người duyệt/trả lời ngoài phòng xem token? | Chỉ tổng run + từng stage (không chi tiết lần gọi) |

### Quyết định người dùng 2026-10-10 (sau spec-readiness lần 1)
| # | Quyết định | Nguồn |
|---|---|---|
| U1·F1 | Không đính kèm tệp khi `!` ở P-a; Hỏi AI chặn gửi khi có tệp | người dùng 2026-10-10 |
| U1·F2 | "Chờ tôi kiểm" luôn hiện khi engine bật (kể cả 0 việc) | người dùng 2026-10-10 |
| U1·F3 | KPI + chuỗi stage ở danh sách admin ① dời P-b | người dùng 2026-10-10 |
| U1·F4 | **Từ chối** bỏ thread: run trong phòng giữ **mô hình thread** mockup ④ — khối run trong timeline phòng + flow thread `?flow=` (kết quả stage, thẻ duyệt, câu hỏi); góp ý của người duyệt và câu trả lời gõ ở composer flow. CHAT-AC-52, HUB-FR-113 giữ chữ "thread" | người dùng 2026-10-10 |
| U2 | Export/Import JSON quy trình (ADM-FR-65, HUB-FR-104) dời P-a → P-b | người dùng 2026-10-10 |
| U3 | Nhóm mặc định `sequential`; `lead_plan` chọn được (thay Q4 cũ) | người dùng 2026-10-10 |
| U4 | Xác nhận M4 (người duyệt ngoài phòng giữ xem phần task của mình sau khi run kết thúc, có audit, không hết hạn) và M5 (người quyết "Cần người quyết": người bắt đầu + `tenant_admin`, + thành viên Group duyệt kể cả ngoài phòng khi lý do `redo_limit`; chạy bằng quota người bắt đầu) | người dùng 2026-10-10 |
| U5 | Starter rời phòng ⇒ run chạy tiếp và vẫn đăng vào thread, nhưng starter mất quyền đọc thread phòng; giữ xem ngoài phòng (`/runs/:id` + inbox: tiến độ, output, task của mình; có audit). Khác X2b-R17 (huỷ) có chủ đích; R17 vẫn áp cho run `@agent`. Phòng bị xoá ⇒ bỏ qua sự kiện thread, run chạy tiếp | người dùng 2026-10-10 |
| Q-F5 | Task chỉ gắn vào composer thread sau khi bấm rõ ràng nút ở thẻ (không tự động) | người dùng 2026-10-10 |
| Mặc định áp dụng | QC Q1, Q3–Q7 (Q2 nằm trong U4), N1, N6, N7; yêu cầu FE: `process_key` (lọc client), `open_count` ("50+"), `StageView.sections` (P-b) | mặc định áp dụng (Luật 2) |

## 10. Rủi ro mở
| # | Rủi ro | Hướng xử |
|---|---|---|
| K1 | Cách ly tenant / grant cho người duyệt ngoài phòng (hard stop bảo mật) | Ma trận cách ly + security review riêng như X2a (HUB-BR-25) |
| K2 | Subscription chỉ dev/test (CR-019), H2d API key hoãn (CR-041) ⇒ **chưa chạy production** | Ghi chặn production; mở khi có API key/gói phù hợp |
| K3 | Tranh chấp slot subscription theo tenant (nhóm gọi nhiều agent) | Đo ở spike; giới hạn team-run; 5 run/tenant |
| K4 | Run nhiều ngày cần trạng thái bền | Máy trạng thái trong Postgres, job kết thúc khi chờ người, khôi phục sau khởi động lại |
| K5 | Hành động thật cần secret ngoài | P-c sau H4b Secrets |
| K6 | Chi phí token khó đoán với nhóm | Spike đo; ngân sách token cứng (Q7) |
- B1 · 0019: FK con → `process_runs (id, tenant_id)` (kép tenant, như rooms) cho stage/team/outputs/tasks/notices/outbox; `assignees` → `review_tasks (id, tenant_id)`. CHECK origin chỉ cấm cột của kind khác (FK SET NULL phòng/hội thoại vẫn thoả). `process_runs.flow_id` unique (T2). Outbox CHECK `block` ⇔ `main`. `process_run_viewer` = `runAccess` (admin ∨ thành viên phòng chưa xoá ∨ người bắt đầu khi không phòng/phòng xoá ⇒ full; người bắt đầu đã rời / assignee bất kỳ task kể cả đã đóng (M4) ⇒ task). FK `process_outputs.attachment_id` thêm ngoài CREATE TABLE (test idempotent 0007 gỡ attachments CASCADE).

## 11. Tranh chấp test
- **B4 (2026-10-10, backend-lead PF1):** `tests/acceptance/P-a/pf1/_local.ts` `insertAgents` (dòng ~166) chèn agent `description = \`Agent thử ${key}.\`` = 18 ký tự, vi phạm `agents_description_check` (0000: `char_length BETWEEN 20 AND 400`) ⇒ `beforeAll` của **mọi** file `pf1/*.int.test.ts` ném 23514, không chạy được ca nào (baseline QC1b1 "trước B1" bỏ qua vì schema chưa sẵn ⇒ lỗi tiềm ẩn). Không sửa file khoá. Đề xuất qc: đổi description ≥ 20 ký tự, ví dụ `\`Agent thử cho bộ test P-a: ${key}.\``. Đã xác minh logic B4 bằng harness tạm (seed hợp lệ, `_support/pa.ts`) — 10/10 ca (catalog, POST none/room/conversation 201+404, gợi ý, 429+Retry-After, list mine/tenant 403/cursor, 202 Hỏi AI, tin gọi `!key`+block+trigger, trùng `client_msg_id`, key sai ⇒ ROLLBACK) xanh.

Readiness: [`readiness.md`](readiness.md) READY lần 5 (2026-10-10). Gate: [`P-a-gate.md`](../P-a-gate.md) tự duyệt (Luật 2b). Trạng thái `approved`.
