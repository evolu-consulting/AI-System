# P-b2-canvas · quyết định Gate & mặc định readiness lần 1

Nguồn: spec-readiness lần 1 (NOT READY: 4 Chặn, 15 Cao, 14 Thấp) → người dùng **duyệt Gate 2026-10-12 với mọi mặc định**. Spec §9 trỏ về đây. Số `#n` theo báo cáo readiness lần 1.

## Gate người dùng 2026-10-12
| # | Quyết định | Áp vào |
|---|---|---|
| G-1 | ADR-0013: `@xyflow/react` 12.11.6 ghim cứng, chỉ admin-web, lazy chunk; trần riêng chunk `canvas*` 80 KB gz; giữ ghi công "React Flow". ADR-0013 → **Accepted** | `adr/0013`, `adr/README.md`, spec §7 |
| G-2 | D11 (resume chỉ ở Hub) chấp nhận cho **cả quy trình cũ**: stage sau cùng agent chạy mới (nhận Bàn giao + file); resume chỉ khi redo cùng stage hoặc chạy tiếp sau trả lời | spec §9, PB2-R12, plan D11/§4.2, `CHANGE-REQUESTS` (amend CR-063/064) |
| G-3 | Quá 3 vòng quay lại: người quyết **như `redo_limit`** (người bắt đầu + Group kiểm), không thêm trường vào def | BA HUB-FR-118(d), PB2-R08, Q2 |
| G-4 | UI đếm bước từ 1 ("Bước 1" = `step` 0); `spinbutton "Chạy ở bước"` 1…10; contract giữ 0-based | PB2-R17, plan-fe FB12, i18n, test-plan |
| G-5 | Stage `team` **không** tự thêm `## Bàn giao` ở P-b2 (giữ hành vi cũ) | PB2-R10, plan §4.1, test-plan RH-09/DF-09 |
| G-6 | `plan-frontend.md` là nguồn duy nhất khi BUILD; mockup Part B chỉ để đối chiếu ở UAT | spec §5 (Q5), plan-fe đầu + §8 |
| G-7 | `SESSION_RESUME_MAX_AGE_S = 86400`: `cli_sessions.updated_at` cũ hơn ⇒ chạy mới + xoá hàng. UAT **bắt buộc** 1 ca resume Claude thật. Tra session lỗi ⇒ `resume=false` | PB2-R12, plan §4.2/§9, test-plan RZ-09, §7 |

## Mặc định readiness đã áp
| # | Nội dung | Nơi sửa |
|---|---|---|
| 2 | Bàn giao đọc từ `process_outputs.content` bằng `sectionMap` (`runs/template.rules.ts`), không từ `sections` | plan §3.9/§4.1, spec §3 |
| 3 | `ensureHandoff` bỏ qua `executor.kind='team'` | plan §4.1, test-plan RH-09, DF-09 |
| 4 | R07 + AC-PB2-06 theo D7: bước X `queued`, > X `pending`, `round+1` chỉ stage đã chạy | spec R07, AC-PB2-06 |
| 5 | `sessionPlan` thêm `continuing` (vừa `waiting_answer` cùng attempt ⇒ resume, prompt cũ, không delta) | plan §4.2, test-plan RR-08, RZ-08 |
| 6 | = G-7 | — |
| 7 | Vẫn hiện radio khi `back_rounds_left=0` + note `run.review.backLimitNote` | plan-fe §4, i18n §2 |
| 8 | plan-frontend dùng `add_attempt` nhãn cũ; bỏ `extend`/`issues[]`/`outputs{version,round}` → theo plan BE §1.4 | plan-fe §5, §9 |
| 9 | `persist` nhận idx stage thật; `current_stage_idx = firstIdxOfStep(current_step)`; cập nhật stage theo `stageRunId`; mọi chuyển bước qua `runs/step-persist.ts` | plan §3.3 |
| 10–12 | T7 rủi ro `cao`; T11 tạo `done-pb2.ts` + script; spec §8 lệnh xong trỏ test-plan §7 | tasks, spec §8 |
| 13 | PI-13 dùng `runsPerTenant=1` | test-plan |
| 14–15 | Nhãn checkbox `Quay lại bước {{step}}`, tên stage vào `aria-describedby`; `tablist "Chế độ xem"` + `tab` | plan-fe §1/§7 |
| 16 | Chỉ cờ `OutputRef.handoff_truncated`; không sửa content, không UI | spec R10, plan §3.9 |
| 17 | = G-6 · 18 = G-3 · 19 = G-2 | — |
| 20–22 | Link `design/chat-app/usecases-chat.md`; ADR path `D:\AI\ai-sdlc-rowan`; `CHAT_PROCESS_ERRORS` ở `chat/processes-errors.ts` | spec, ADR, plan §1.1 |
| 23 | `realLocked` = chú thích switch khoá; `err.realStep` = lỗi; luật server tên `REAL_ACTION` | plan-fe §1, i18n §1 |
| 24 | Câu chữ i18n thắng plan-fe khi lệch | plan-fe đầu |
| 25 | R02: > 10 stage ⇒ lỗi schema cũ (không `STEP_TOO_WIDE`) | spec R02 |
| 26 | Prompt thêm dòng nhắc Bàn giao ≤ 200 token | spec R11, plan §4.1 |
| 27 | BA HUB-FR-136(a): "cắt, không từ chối" | BA |
| 28 | admin Run view không đổi ở P-b2 | spec §1.2 |
| 29 | Bỏ 2 dòng sửa `_pa-runtime`/`_pb-runtime`; thêm ghi kiểm ca e2e assert tên mục thiếu (mục cuối nay là Bàn giao) | test-plan §5 |
| 30 | Seed (a') `pb2-par2` | test-plan §4 |
| 31 | tasks cột File theo plan §3; tasks-frontend thêm cột Rủi ro=thường; FB-3 điều kiện xong chặt | tasks*, |
| 32 | Nhập bước > bước cuối + 1 ⇒ thành bước mới cuối | plan-fe §1, R17 |
| 33 | Giữ nguyên | — |

**Docs-architect tự chọn (ghi để rà):** thứ tự ưu tiên `sessionPlan` = team → `sameAgentInStep` → `continuing` → rerun (cùng bước cùng agent không có session nên không thể resume).

## Mặc định readiness lần 2 (2026-10-12; điều phối chấp nhận mọi mặc định)
| # | Quyết định | Nơi áp |
|---|---|---|
| 1 | `sectionMap` **export**; đọc `.get(HANDOFF_SECTION.trim().toLowerCase())`; `template.rules.ts` vào File T7 | plan §3.9, tasks T7 |
| 2 | `continuing` = ask `answer` của stage_run với `decided_at` > `started_at` của `hub.runs` mới nhất | plan §4.2, RR-11 |
| 3 | `continuing ∧ ¬sessionExists` ⇒ `{true,false,true}`, prompt cũ không delta | plan §4.2, RR-10, RZ-10 |
| 4 | `continuing ∧ ¬resume` ⇒ nối `Câu hỏi trước:/Trả lời:` (≤3) | plan §4.2, RZ-10 |
| 5 | Lỗi hình dạng def ⇒ 400 `VALIDATION_ERROR`; 422 chỉ 6 luật | spec §3/R02/AC-04, plan D10, DF-02, i18n |
| 6 | Đường `useSession`: `ProcessRunInput→RunContext→AgentTask→PayloadInput`; File T7 thêm `runs.service`, `stage-driver`, `launcher`, `launcher-step` | plan §4.2, tasks T7 |
| 7 | `sameAgentInStep` tĩnh theo snapshot | plan §4.2 |
| 8 | G3 chốt theo RB-11/D7 | test-plan §G3 |
| 9 | `group "Nếu bị trượt"` luôn hiện; gate auto chỉ có `backNone` | plan-fe, E-PB2-07 |
| 10 | `step.backLine`: event mới nhất, `step`=`to_step+1`, `n`=`back_events.length` | i18n |
| 11 | FB8 dùng `live.moved` | plan-fe FB8 |
| 12 | PI-09 `status='closed', result='pass'` | test-plan-cases |
| 13 | DF-01: stage 0 ở step 0 + 4 stage ở step 1 | test-plan-cases |
| 14 | T12 bỏ "ADR-0013 → Accepted" | tasks |
| 15 | Bỏ key `backNeedsReview` | i18n |
| 16 | Bỏ "thêm directive trễ" | spec §6 |
| 17 | HUB-FR-114 phần Bàn giao cho trưởng nhóm ngoài P-b2 | spec §1.2 |

## Tranh chấp test (spec §10 trỏ về đây — spec.md đã ở trần kích thước)
Định dạng: `- [T#·agent] <file> · "<tên test>" · kỳ vọng test ≠ <nguồn> · đề xuất` → qc VERIFY ghi "đã xử lý — …".

**Sửa test khoá cũ có chủ đích (T2·qc, trước relock — test-plan §5, §8):**
- [T2·qc] `tests/acceptance/P-a/step0/rules/contracts-pa.test.ts` · R-K01 `DECISION_REASONS` 15 ⇒ 16 (+ cuối `back_limit`); R-K02 `CHAT_PROCESS_ERRORS` 12 ⇒ 13 mã (+ `BACK_TARGET_INVALID: 422`) · nguồn plan §1.1, §8 · đã xử lý — test sửa, relock T2.
- [T2·qc] `tests/acceptance/P-b/pfs3/_local.ts` · `MD_AUTO` (output của def tạo qua `POST /process-defs`) thêm `## Bàn giao` · nguồn PB2-R10, Q3, plan §4.1/§8 (`ensureHandoff` ⇒ thiếu mục = `template_invalid`) · đã xử lý — test sửa, relock T2.
- Các test khoá còn lại ở test-plan §5 đã kiểm: không cần sửa (chi tiết test-plan §8).

**Mở (T4·backend-lead):**
- [T4·backend-lead] `tests/acceptance/P-a/step0/rules/contracts-pa.test.ts` · "R-K04 · ProcessRunView task hợp lệ…" + "R-K10 · TaskDetail decision…; full view…" · fixture `summary`/`stageView`/`fullView`/`taskView` thiếu trường **bắt buộc** mới (`current_step`, `step_count`, `step`, `round`, `back_to_steps`, `back_rounds`, `back_limit`, `back_events`, task `stages[].step/round`) ≠ plan §1.3/§8 + test khoá P-b2 C-10/C-11 (thiếu ⇒ phải lỗi) — hai test không thể cùng xanh · đề xuất qc thêm các trường vào fixture P-a (bước = idx, round 1, `back_to_steps: []`, `back_rounds 0`, `back_limit 3`, `back_events: []`).
  - **Đã xử lý (T4·qc, 2026-10-12) — test sai, đã sửa:** contract bắt buộc trường mới (plan §1.3) và C-10/C-11 đòi thiếu ⇒ lỗi, nên fixture P-a phải đủ trường (current_step 0, step_count 2, step 0, round 1, back_to_steps [], back_rounds 0, back_limit 3, back_events [], task stages step/round). Test P-a vẫn giữ ý nghĩa (strict, không rò). Relock.
- [T4·backend-lead] `tests/acceptance/P-b2/s0/migration.int.test.ts` · "M-07 · FK: xoá review_tasks ⇒ task_id NULL…" · `insertTask(kind:"review")` không có `outputId` ⇒ vỡ `review_tasks_kind_cols_ck` (0019: review cần `output_id`) trước khi chạm 0024 ≠ DDL 0019 · đề xuất dùng `kind:"decision"` (reason mặc định) hoặc chèn output trước. Đã kiểm tay (tx rollback, DB `pb2_s0`): xoá task ⇒ `task_id` NULL, xoá run ⇒ event CASCADE.
  - **Đã xử lý (T4·qc, 2026-10-12) — test sai, đã sửa:** M-07 chèn review không output vi phạm `review_tasks_kind_cols_ck` (0019); ý định M-07 là FK của `task_id`, không phụ thuộc kind ⇒ đổi sang `kind:"decision", reason:"back_limit"`. Int s0 (DB pb2_s0) 8/8 xanh. Relock.

**Mở (T9·frontend-lead, FB-4):**
- [T9·frontend-lead] `e2e/P-b2/admin/canvas.pb2.ts` · "E-PB2-04 · kéo Tổng hợp (chuột)…" · kỳ vọng test ≠ thực tế: `src.boundingBox()` lấy toạ độ tương đối **viewport**, nhưng canvas nằm dưới thẻ Thông tin/Nguồn/Đầu vào (plan-frontend §1: thứ tự thẻ đã duyệt) nên node ở y ≈ 1373 > 800 (viewport 1280×800) ⇒ `page.mouse.move/down/up` rơi ngoài khung nhìn, không có sự kiện nào tới node ⇒ bước không đổi. Đã kiểm bằng ca tạm (đã xoá): thêm `await canvas(p).scrollIntoViewIfNeeded()` (hoặc `src.scrollIntoViewIfNeeded()`) trước `boundingBox()` ⇒ kéo Tổng hợp sang cột bước 2 cho `spinbutton "Chạy ở bước"` = 2 và `button "Thêm giai đoạn vào bước 2"` `aria-disabled=true` (UI đúng). Đề xuất: qc thêm một dòng cuộn vào khung nhìn trước khi lấy toạ độ.
- [T9·frontend-lead] `e2e/P-b2/admin/canvas.pb2.ts` · "E-PB2-06 …" · đỏ **không do FE**: dòng cuối đòi `required_sections` của def lưu chứa "Bàn giao" (`ensureHandoff` khi lưu def = T7, backend chưa xong); phần UI (checkbox 'Quay lại bước 2' mô tả = tên stage, lưu, tải lại còn, node '↩ bước 2', `back_to_steps` [1]) đã chạy tới dòng này.


- [T9·qc] Phân xử tranh chấp E-PB2-04: **test sai** (thiếu bước dựng điều kiện, không đổi kỳ vọng nghiệp vụ). Canvas nằm dưới các thẻ Thông tin/Nguồn/Đầu vào đúng plan đã duyệt; `boundingBox()` theo viewport nên node ngoài màn hình thì `page.mouse` không tới. Đã thêm `src.scrollIntoViewIfNeeded()` trước `boundingBox()` (như người dùng thật cuộn tới canvas). Kết quả admin 11/12; E-PB2-06 đỏ chờ backend T7 `ensureHandoff` (không sửa). Lock đã cập nhật.
