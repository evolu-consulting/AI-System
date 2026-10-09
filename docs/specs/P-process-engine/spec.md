---
id: P-process-engine
title: Process Engine (Quy trình động) — stage + gate duyệt + hỏi lại + nhóm agent + hiển thị token
milestone: P (spike → P-a → P-b → P-c)
status: draft            # draft → ready → approved → in-progress → done
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
| **P-a** | Stage runner + máy trạng thái run (Postgres) · gate duyệt · hỏi lại + "Nhờ người khác trả lời" · "Chờ tôi kiểm" · DM hệ thống "Quy trình" · menu `!` + nút "▶ Quy trình" · `/runs/:id` có chi tiết token · 2 quy trình mẫu (SDLC, hoá đơn) · editor tối thiểu (Evolu Control) · nhóm agent dùng bản seed (không editor) · giới hạn + "Cần người quyết" · Hành động thật sau gate | HUB-FR-104 (tối thiểu), 105–107, 109–113, 115, 116, 117 (vế run); HUB-BR-23…28; AC-H28…H34; CHAT-AC-51…58; ADM-FR-65, 66 (tối thiểu), 67 | `done:pa` xanh; **security review riêng** (HUB-BR-25) đạt; UAT `qc-uat` |
| **P-b** | Editor đầy đủ ①②③, Nhóm agent ở Agent Forge (+ bật theo công ty, tab Usage), tự quay lại, luật tự duyệt | HUB-FR-104 (đủ), 108, 114 (editor), 117 (vế nhóm), 118; AC-H35; ADM-FR-66 (đủ) | `done:pb` xanh |
| **P-c** | Workspace code chung + PR thật (SDLC) | HUB-FR-119 | Cần H4b Secrets |

Thứ tự ROADMAP (Q8): X2b-2 → **spike P** → **P-a** → H4b → **P-b** → **P-c**.

**Không làm (mọi mốc P):** agent↔agent trực tiếp (CR-023 Hoãn) · `/` trong phòng (X2b Q10 giữ) · duyệt qua email · tự duyệt khi quá hạn · người duyệt sửa output tại chỗ · tiền/quota tháng (H3c tạm dừng) · lịch/API/webhook bắt đầu run (COULD, sau) · email/Zalo/Slack (COULD, chỉ link).

## 2. Nghiệp vụ cụ thể hoá (P-R)
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| P-R01 | Process run là đối tượng riêng (`process_runs`); phòng/Hỏi AI/admin chỉ là `origin`. Thành viên phòng nguồn thấy cả run trong thread | Q9, HUB-FR-113 |
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
| Thời gian sống run | ~7 ngày | Hết hạn (không tự duyệt) |
| Run đồng thời / tenant | ~5 | `TOO_MANY_PROCESS_RUNS` (429) |
| Nhắc duyệt/trả lời | sau 1 ngày | Chỉ nhắc |

## 3. Contract (backend-lead)
<!-- backend-lead --> Điểm vào ở mức BA: BA-H §9.1 (`/processes`, `/process-runs*`, `/me/review-tasks`, `/review-tasks/:id/*`, `/process-defs*`, `/studio/api/agent-teams*`), §9.2 (`process.updated`, `review_task.created/closed` trên `/me/stream`), §9.3 mã lỗi. Contract chat **chỉ thêm**.

## 4. Dữ liệu (backend-lead)
<!-- backend-lead --> Bảng đề xuất: BA-H §8 (`process_defs` có `version` + `withConfigWrite`, `process_runs` máy trạng thái, `stage_runs`, `review_tasks`, `agent_teams` + thành viên + bật theo tenant); dùng lại `runs`/`run_steps`/`jobs`/`attachments`/`audit_log`/`usage_logs`. RLS theo tenant + grant `review_task` (HUB-BR-25). Tài khoản hệ thống "Quy trình": cách mô hình hoá (sender `system` trong `room_messages` hay user hệ thống) — chốt ở PLAN.

## 5. UI (frontend-lead)
<!-- frontend-lead --> Board §0. chat-web: menu `!` + nút "▶ Quy trình" (⑥), thẻ run + flow pane duyệt (④), "Chờ tôi kiểm" + DM "Quy trình" + `/runs/:id` (⑤), AskCard + "Nhờ người khác trả lời" (⑦), bảng token (⑧). admin-web: ui-admin §7.17. studio-web: ui-agent-studio §15 (P-b).

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
| Q4 | Chế độ "Trưởng nhóm lập kế hoạch": trưởng nhóm chỉ trả kế hoạch, Hub gọi thành viên. CR-023 vẫn Hoãn; MCP lai sau spike |
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
| Lưu trạng thái | Postgres; bảng mới §4; xuất/nhập JSON qua Import/Export |

### Mặc định đề xuất chưa hỏi riêng (spec-readiness xác nhận hoặc hỏi một lượt)
| # | Điểm | Mặc định |
|---|---|---|
| M1 | Ai được chạy một quy trình | Group được chạy cấu hình trên quy trình, mặc định cả công ty |
| M2 | Thoát tiền tố `!` | `!!` gửi chữ bắt đầu bằng "!" (như `//`, `@@`) |
| M3 | Output sai template | Tính một lượt làm lại tự động, lỗi kiểm làm góp ý |
| M4 | Thời hạn grant người ngoài phòng | Tới khi run kết thúc; sau đó chỉ xem lại phần task của mình |
| M5 | Ai quyết "Cần người quyết" | Người bắt đầu + `tenant_admin` (và người duyệt khi chạm giới hạn làm lại) |
| M6 | Tài khoản hệ thống "Quy trình" | Một danh tính hệ thống mỗi tenant, không đăng nhập được, không thêm vào nhóm |

### Trong lúc làm (agent tự quyết theo Luật 2)
- (chưa có)

## 10. Rủi ro mở
| # | Rủi ro | Hướng xử |
|---|---|---|
| K1 | Cách ly tenant / grant cho người duyệt ngoài phòng (hard stop bảo mật) | Ma trận cách ly + security review riêng như X2a (HUB-BR-25) |
| K2 | Subscription chỉ dev/test (CR-019), H2d API key hoãn (CR-041) ⇒ **chưa chạy production** | Ghi chặn production; mở khi có API key/gói phù hợp |
| K3 | Tranh chấp slot subscription theo tenant (nhóm gọi nhiều agent) | Đo ở spike; giới hạn team-run; ~5 run/tenant |
| K4 | Run nhiều ngày cần trạng thái bền | Máy trạng thái trong Postgres, job kết thúc khi chờ người, khôi phục sau khởi động lại |
| K5 | Hành động thật cần secret ngoài | P-c sau H4b Secrets |
| K6 | Chi phí token khó đoán với nhóm | Spike đo; ngân sách token cứng (Q7) |

## 11. Tranh chấp test
- (không)
