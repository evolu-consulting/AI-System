---
id: P-b2-canvas
title: P-b2 · Canvas quy trình + bước song song + quay lại bước + tối ưu token giữa stage
milestone: P-b2 (CR-063, CR-064)
status: draft            # draft → ready → approved → in-progress → done. Chưa qua spec-readiness/Gate
requirements: [HUB-FR-104, HUB-FR-106, HUB-FR-113, HUB-FR-118, HUB-FR-136, HUB-BR-38, ADM-FR-71, CHAT-AC-59, CHAT-AC-60, AC-PB2-01, AC-PB2-02, AC-PB2-03, AC-PB2-04, AC-PB2-05, AC-PB2-06, AC-PB2-07, AC-PB2-08, AC-PB2-09, AC-PB2-10, AC-PB2-11, AC-PB2-12]
design:
  - docs/CHANGE-REQUESTS.md#CR-063 · #CR-064 (Intake Đầy đủ chốt 2026-10-12; quyết định 15, 16, 17, 19)
  - docs/design/agent-hub/ba-agent-hub.md §6.10 (HUB-FR-104/106/113/118/136), HUB-BR-38, HUB-BR-20/26/27
  - docs/design/admin/ba-admin.md (ADM-FR-71) · docs/design/admin/ui-admin.md §7.17 (khối "Canvas quy trình", "Quay lại bước")
  - docs/design/chat/usecases-chat.md UC-12 (CHAT-AC-59/60)
  - docs/adr/0013-xyflow-process-canvas.md (Proposed — trình Gate cùng mốc)
  - nền: P-process-engine (P-a done) · P-b-sources (P-b done) · docs/ROADMAP.md (P-b2) · docs/TECH-DEBT.md #135, #136
  - canvas: CHƯA có artboard Pencil; nguồn tạm = mockup https://claude.ai/artifact/WN9JVza1m4XA57LKQrtTDY (Part B: B1 canvas admin, B2 run view chat) — xem §5
owner: backend-lead + frontend-lead + qc
---

# P-b2 · Canvas quy trình + bước song song + quay lại + tối ưu token

## 1. Phạm vi

### 1.1 Làm
| Nhóm | Nội dung | Mã |
|---|---|---|
| Mô hình bước | `stages[]` thêm trường `step` (stage cùng bước chạy song song); không có `step` ⇒ mỗi stage một bước (quy trình cũ chạy như cũ) | HUB-FR-104, HUB-BR-38(a,c) |
| Engine | Bước song song: khởi động mọi stage của bước, gate theo **từng stage**, bước sau chờ **mọi** stage Đạt; `real_action` luật mới | HUB-FR-106, HUB-BR-38(a,b) |
| Quay lại | Gate review có "Chưa đạt → quay lại bước X" (đích khai báo trong def), ≤ 3 vòng/run, quá trần ⇒ "Cần người quyết"; lịch sử quay lại | HUB-FR-118, HUB-BR-38(d), HUB-FR-113 |
| Token | `## Bàn giao` ≤ 200 token; bước sau nhận Bàn giao + đường dẫn file; làm lại cùng agent ⇒ resume + prompt delta | HUB-FR-136 (SHOULD), HUB-FR-106 |
| admin-web | Canvas `@xyflow/react` ở `/processes/:id`; form stage ở panel bên (giữ nhãn ARIA "Giai đoạn n: …"); mũi tên quay lại; lỗi ràng buộc inline; bàn phím thay kéo thả | ADM-FR-71, ADR-0013 |
| chat-web | StageStrip vẽ theo bước (CSS thuần), nhãn ×lần, thẻ duyệt thêm "quay lại bước X"; trang Run/`?flow=` theo bước + lịch sử quay lại | CHAT-AC-59/60, HUB-FR-113 |
| Nợ gộp | TECH-DEBT #136 (tách `StageForm`, bắt buộc vì panel); #135 (stage `team` ở stage đầu/bước đầu) | TECH-DEBT |
| Test khoá | qc cập nhật E-P15b / E-PB08 / E-PB09 (thêm bước vào fixture, selector panel) và chạy lại `done:pa`, `done:pb` | CR-063 (17) |

### 1.2 Không làm
| Hạng mục | Lý do / khi nào |
|---|---|
| KnowledgeHub, `## Tóm tắt` ghi KH | K1 (CR-062) |
| Sửa code / nhánh `ai/<run>/<step>` / `apply_mode` | P-c (CR-061/065) |
| Nạp nguồn vào KH | K2 (CR-066) |
| Lưu toạ độ nút, dagre/elk, canvas ở chat-web/studio-web, chỉnh canvas trong trang Run | ADR-0013 #3, #5 |
| Stage lồng/rẽ nhánh theo điều kiện, vòng lặp tự do ngoài "quay lại bước" | ngoài CR-063 |
| Editor ①②③ còn lại: Nhóm agent ở Agent Forge, tab Usage, luật tự duyệt HUB-FR-108, Import/Export JSON, KPI danh sách (P-b-sources §1.2 từng ghi "P-b2") | **Q1**: ROADMAP P-b2 và CR-063 không liệt kê ⇒ mặc định KHÔNG làm; xếp mốc riêng (P-b3) |
| Hub trích chữ/PDF | K1 |

## 2. Nghiệp vụ cụ thể hoá (PB2-R)
BA là nguồn sự thật (HUB-BR-38, HUB-FR-118/136); chỉ ghi phần BA chưa nói. Con số mặc định theo code `apps/hub-api/src/modules/processes` hiện có.

| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| PB2-R01 | **Bước** = số nguyên `step` (0…9) gắn mỗi stage; `step` tuỳ chọn. Thiếu ở mọi stage ⇒ `step = chỉ số stage` (cũ). Có ở một stage thì phải có ở mọi stage (422 `STEP_INCOMPLETE`). Mảng `stages[]` phải **không giảm theo `step`** và các bước **liên tục** 0,1,2… (422 `STEP_ORDER`). Layout canvas suy ra từ `step` + thứ tự mảng, **không lưu toạ độ** | HUB-FR-104, UI §7.17 |
| PB2-R02 | ≤ 3 stage/bước, tổng ≤ 10 stage (hằng `PROCESS_STAGES_MAX` đã có = 10); vi phạm ⇒ 422 `STEP_TOO_WIDE` | HUB-BR-38(c) |
| PB2-R03 | `real_action` hợp lệ khi **mọi** stage của bước liền trước có `after.kind='review'`; bước 0 ⇒ không hợp lệ. Thay luật cũ "stage i-1 là review" (`processDefStagePaths`); với quy trình cũ (mỗi stage một bước) kết quả y hệt | HUB-BR-38(b), HUB-BR-20 |
| PB2-R04 | **Chạy bước:** vào bước k ⇒ tạo `stage_runs` + job cho mọi stage của bước (≤ 3 job đồng thời). Mỗi stage đi máy trạng thái hiện có độc lập (template, hỏi lại, gate, attempt ≤ 4). Stage Đạt/`auto` xong **chờ** các stage còn lại; bước k+1 khởi động khi **mọi** stage bước k `done`. Run `done` khi bước cuối xong. Một stage `needs_decision` ⇒ run `needs_decision` (stage kia chạy nốt, không khởi động bước mới) | HUB-BR-38(a), HUB-BR-26 |
| PB2-R05 | Stage cùng bước **không thấy output nhau** (không phụ thuộc). Stage bước k nhận output (bản mới nhất) của **mọi stage bước < k** — `priorFiles` tính **theo bước**, không theo chỉ số | CR-063 |
| PB2-R06 | **Quay lại:** `after.review` thêm `back_to_steps: int[]` (mặc định `[]`; mỗi phần tử < `step` của stage; chỉ bước có thật). Chỉ stage có `back_to_steps` không rỗng mới thấy lựa chọn. Người duyệt chọn "Chưa đạt → làm lại stage này" (như cũ) **hoặc** "→ quay lại bước X" (X ∈ `back_to_steps`), kèm **góp ý bắt buộc** (HUB-FR-107) | HUB-FR-118(a,b) |
| PB2-R07 | **Thực hiện quay lại** (1 tx, khoá `process_runs` rồi `stage_runs` theo thứ tự §10 plan P-a): mọi `stage_runs` bước ≥ X → `queued` (stage bước X, các stage đang chạy/chờ duyệt ở bước sau bị huỷ job), `attempt=1`, `round = round+1`; ghi `process_back_events`; `process_runs.current_step = X`, `back_rounds + 1`. Output cũ **giữ** làm phiên bản (attachments có phiên bản) và xem được ở lịch sử; `## Bàn giao` mới thay bản cũ cho bước sau. Góp ý cho stage nguồn đưa vào prompt delta của **mọi stage bước X** | HUB-FR-118(c), HUB-FR-136(c) |
| PB2-R08 | **Trần:** `back_rounds` ≤ 3 **mỗi run** (tổng, mọi luật). Lần thứ 4 chọn quay lại ⇒ không thực hiện; run `needs_decision` lý do `back_limit`; thẻ "Cần người quyết" dùng 3 lựa chọn sẵn (thêm lượt = +1 vòng · dùng bản hiện có · huỷ). **Q2** | HUB-FR-118(d), HUB-BR-26 |
| PB2-R09 | **Hai người duyệt hai stage cùng bước** cùng chọn quay lại (khác đích) ⇒ cái đến **trước** thắng (khoá hàng run); cái sau nhận 409 `REVIEW_TASK_CLOSED`. Quay lại huỷ `review_task` còn mở của bước ≥ X (lý do `superseded`) | HUB-BR-38, HUB-FR-107 |
| PB2-R10 | **Bàn giao (SHOULD):** Hub **tự thêm** `## Bàn giao` vào `required_sections` của stage khi **lưu** def ở P-b2 (def cũ chưa lưu lại: không đổi, run cũ không ảnh hưởng). Chỉ kiểm **có mục**; dài > 200 token (ước lượng = ký tự ÷ 4 ≈ 800 ký tự) ⇒ **cắt** khi đưa vào prompt + cảnh báo trong output, không từ chối. **Q3** | HUB-FR-136(a) |
| PB2-R11 | **Đưa input:** stage sau nhận (1) `## Bàn giao` của mỗi stage bước trước + (2) đường dẫn file output (Read khi cần), **không** nhúng nguyên file. Stage trước **không có** mục Bàn giao (def cũ) ⇒ hành vi cũ (nguyên file). Người dùng/ghi chú đầu vào run như cũ | HUB-FR-136(b), HUB-FR-106 |
| PB2-R12 | **Resume (SHOULD):** làm lại cùng stage + **cùng agent** + provider có session (WRK-FR-14 `hub.cli_sessions`) còn hạn ⇒ resume session, prompt chỉ có **góp ý** (delta). Khác agent / không có session / hết hạn ⇒ chạy mới đủ input. Không áp cho stage `team`. Quay lại bước (PB2-R07) cũng thử resume cho từng stage bước đích | HUB-FR-136(c) |
| PB2-R13 | **Nhãn ×lần:** `round` > 1 ⇒ hiện "×round" cạnh bước (chat) và cạnh stage (trang Run). `attempt` (làm lại do góp ý trong cùng round) KHÔNG đổi nhãn này | CHAT-AC-59 |
| PB2-R14 | **Tương thích ngược:** snapshot run đang chạy/đã xong không có `step` ⇒ đọc như mỗi-stage-một-bước; `current_stage_idx` giữ, `current_step` mặc định = `current_stage_idx` khi thiếu. Không migrate phá dữ liệu (chỉ thêm cột nullable/default) | CR-063 (15) |
| PB2-R15 | **Quota/đồng thời:** bước song song dùng quota + concurrency của **người bắt đầu** (HUB-BR-24); `TOO_MANY_PROCESS_RUNS` đếm run, không đếm stage. Runtime nhận ≤ 3 job/bước, thực chạy đồng thời hay xếp hàng tuỳ slot Runtime | HUB-BR-24 |
| PB2-R16 | **Canvas (admin-web):** cột = bước; kéo stage sang cột khác = đổi `step` (tạo/xoá cột trống tự động); bước 3 stage ⇒ cột đầy, từ chối thả (lỗi inline). Mũi tên quay lại từ stage nguồn → cột đích vẽ từ `back_to_steps`. **Bàn phím:** chọn stage + `Alt+←/→` đổi bước, `Alt+↑/↓` đổi thứ tự trong cột. Click/Enter mở panel bên. Thư viện chỉ ở lazy chunk (ADR-0013) | ADM-FR-71, ADR-0013 |
| PB2-R17 | **Panel bên** = `StageForm` hiện có (tách theo #136: `StageGeneral`, `StageActions`, giữ `StageSourcesField`/`StageMustKnow`), giữ NGUYÊN nhãn ARIA `Giai đoạn n: …`; thêm ô **"Chạy ở bước"** (số) và khối **"Nếu bị trượt"** (chọn bước đích từ `back_to_steps`, chỉ hiện khi gate = duyệt) | CR-063 (17), UI §7.17 |
| PB2-R18 | **Bước 0 với `team`** (TECH-DEBT #135): stage `team` ở bước đầu phải chạy được (`persistDraft` khi chưa có job ⇒ trả danh sách rỗng, không ném) | #135 |

## 3. Contract (backend-lead)
Chỉ **thêm**; trường mới trong meta thread/jsonb cũ (`OutputRef`, part `task_result`, `process.updated`) là **optional**. Zod từng trường + hàm thuần dùng chung FE/BE: [plan.md](plan.md) §1–§2.

**Hằng** (`chat/processes.ts`, re-export ở `hub-admin`): `ProcessStepSchema` int 0…`PROCESS_STEP_MAX`(9) · `PROCESS_STEP_STAGES_MAX=3` · `PROCESS_BACK_ROUNDS_MAX=3` · `BACK_EVENTS_MAX=20` · `HANDOFF_SECTION="Bàn giao"` · `HANDOFF_TOKENS_MAX=200` · `HANDOFF_CHARS_PER_TOKEN=4` · `DECISION_REASONS`+`back_limit` (16) · `CHAT_PROCESS_ERRORS`+`BACK_TARGET_INVALID: 422` (13).

| Chỗ | Thay đổi | Lỗi |
|---|---|---|
| `ProcessStageDefSchema.step` | `ProcessStepSchema.optional()` (R01/R02) | 422 `PROCESS_DEF_INVALID` |
| `after` biến thể `review` | + `back_to_steps: ProcessStep[] ≤9, default []` — duy nhất, < bước của stage, là bước có thật (R06, Q6) | 422 `PROCESS_DEF_INVALID` |
| `ProcessDefPathsDetailsSchema` | + `rules?: ProcessDefRule[]` ≤20, **cùng chỉ số** với `paths`. `PROCESS_DEF_RULES` = `KEY_DUP`·`REAL_ACTION`·`STEP_INCOMPLETE`·`STEP_ORDER`·`STEP_TOO_WIDE`·`BACK_TARGET_INVALID`; path `stages.<i>.{key\|step\|real_action}` / `stages.<i>.after.back_to_steps.<j>` (luật path: plan §1.2) | mã HTTP không đổi |
| Lưu def (create/update/copy) | `ensureHandoff` (R10): thiếu `"Bàn giao"` ⇒ thêm cuối `required_sections` + `

## Bàn giao
` cuối `template` (khi < 20 mục và ≤ 20 000 ký tự); response trả bản đã thêm | — |
| `POST /review-tasks/:id/decision` | + `back_to_step?: ProcessStep`. Kiểm theo thứ tự: `FEEDBACK_REQUIRED` → `BACK_TARGET_INVALID` (kèm `pass`, hoặc ∉ `back_to_steps`) → khoá run → task đóng ⇒ 409 `REVIEW_TASK_CLOSED` → stage ≠ `waiting_review` ⇒ 409 `PROCESS_RUN_STATE` | 422 · 409 |
| `POST /process-runs/:id/decide` | + `stage_idx?` (vắng ⇒ decision mở cũ nhất; stage không có decision mở ⇒ 409 `PROCESS_RUN_STATE`). `back_limit`: `add_attempt` = thực hiện quay lại đang chờ (`back_limit+1`), `use_current` = coi Đạt, `cancel` = huỷ (không thêm option) | 409 |
| `ProcessRunSummary` | + `current_step` · `step_count` (1…10) | — |
| `StageView` | + `step` · `round` (≥1) · `back_to_steps` (snapshot; `[]` khi `auto`). Lịch sử bản: `outputs[]` sẵn có + `OutputRef.round` | — |
| Stage của task view | + `step` · `round` | — |
| `ProcessRunFullView` | + `back_rounds` · `back_limit` · `back_events: BackEvent[] ≤20` (cũ→mới); `decision` = decision mở cũ nhất, + `back_to_step?` khi `back_limit`. Task view **không** có (HUB-BR-25) | — |
| `BackEventSchema` (mới) | strict `{at, task_id: uuid\|null, from_stage_idx, from_step, to_step, round: ≥2, feedback 1…4000, by: UserRef}` | — |
| `TaskDetail` (review mở, stage có `back_to_steps`) | + `back_steps?` · `back_rounds_left?` | — |
| `HistoryItem` · part `task_result` | + `to_step?` | — |
| `OutputRef` | + `round?` · `handoff_truncated?` (tính lúc đọc từ `process_outputs.sections`) | — |

Sự kiện: `process.updated` + `step?` (bước hiện tại); không event mới. NOTIFY: chỉ `job_cancel` sẵn có (quay lại huỷ job bước ≥ X). Trả lời đề xuất FE B1–B6: plan §1.4.

## 4. Dữ liệu (backend-lead)
Migration **`0024_pb2_steps.sql`** (viết tay, idempotent như 0021). Drizzle: chỉ `schema/hub-processes.ts`. DDL: [plan.md](plan.md) §5.

| Bảng | Cột · kiểu | Ràng buộc |
|---|---|---|
| `process_defs.stages` (jsonb) | `step`, `after.back_to_steps` | zod ở biên; không DDL |
| `process_runs` | `current_step` smallint NN 0 (backfill `= current_stage_idx` chỉ khi vừa thêm cột) | CHECK 0…9 |
| `process_runs` | `back_rounds` smallint NN 0 · `back_limit` smallint NN 3 | CHECK `0 ≤ back_rounds ≤ back_limit ≤ 100` |
| `stage_runs` | `round` smallint NN 1 · `back_to_step` smallint NULL (quay lại chờ quyết `back_limit`) | CHECK `round ≥ 1`, `back_to_step` 0…9; giữ `UNIQUE(process_run_id, stage_idx)` |
| `process_outputs` | `round` smallint NN 1 | — |
| `review_tasks` | dựng lại `review_tasks_reason_ck` + `back_limit` | — |
| `process_back_events` (mới) | `id` · `tenant_id` · `process_run_id` · `task_id` NULL · `from_stage_idx` · `from_step` · `to_step` · `round_after` · `feedback` NN · `decided_by` NN · `created_at` | CHECK `to_step < from_step`, `round_after ≥ 2`, feedback 1…4000; FK run CASCADE, `task_id` SET NULL; index `(process_run_id, created_at)` |

RLS `process_back_events`: policy T `process_back_events_hub_rw` như `stage_runs`; GRANT **SELECT, INSERT** `hub_rw` (append-only). Seed: không đổi (**Q4**).

## 5. UI (frontend-lead)
Chi tiết PLAN FE: [`plan-frontend.md`](plan-frontend.md) · [`plan-frontend-i18n.md`](plan-frontend-i18n.md) · [`tasks-frontend.md`](tasks-frontend.md). Role/nhãn e2e đầy đủ: plan-frontend §7 (bảng dưới là tóm tắt).

**Artboard:** CHƯA có artboard Pencil. Nguồn tạm = mockup Part B (B1, B2) đã người dùng xem. Cần vẽ trước BUILD FE (hoặc người dùng chấp nhận mockup làm nguồn — **Q5**):

| # | Artboard cần | Nội dung bắt buộc | Mockup nguồn |
|---|---|---|---|
| A1 | admin-web `/processes/:id` canvas | cột bước, nút stage (tên, executor, biểu tượng gate), bước song song 2–3 stage, cột "join", mũi tên quay lại, thanh công cụ (thêm stage/bước, zoom, vừa khung), panel bên 3 phần: StageForm cũ + "Chạy ở bước" + "Nếu bị trượt"; lỗi inline (bước đầy, `real_action`) | B1 (fixbug-evolu, bước 4 `[Rà soát code ‖ Test hồi quy]`) |
| A2 | admin-web canvas — rỗng/lỗi/chỉ-xem (mẫu platform) | trạng thái tải, mẫu chỉ xem, ConflictDialog (đã có) | B1 |
| A3 | chat-web StageStrip theo bước | cột bước, stage song song xếp dọc, trạng thái từng stage, nhãn ×lần, mũi tên/vệt quay lại | B2 |
| A4 | chat-web thẻ duyệt + "Chưa đạt" | radio "Làm lại stage này / Quay lại bước X", góp ý bắt buộc, cảnh báo "còn n vòng" | B2 |
| A5 | chat-web trang Run `/runs/:id` theo bước | nhóm theo bước, ×lần, timeline quay lại, outputs nhiều phiên bản | B2 |
| A6 | thẻ "Cần người quyết" `back_limit` | dùng mẫu sẵn có, thêm câu chữ | — (theo mẫu `redo_limit`) |

| Màn / thành phần | Trạng thái | Câu chữ VI / EN | Role + nhãn e2e |
|---|---|---|---|
| Canvas (A1/A2) | tải · lỗi · chỉ-xem · không quyền | chốt ở PLAN-FE (i18n `plan-frontend-i18n`) | `application` "Canvas quy trình"; nút stage `button` "Giai đoạn n: <tên>"; panel `complementary` |
| StageStrip (A3) | rỗng · đang chạy · xong · lỗi | "Bước n" · "×2 lần" | `list` "Tiến độ quy trình", mỗi bước `listitem` |
| Thẻ duyệt (A4) | như cũ + lựa chọn quay lại | "Chưa đạt → quay lại bước X" | `radio` "Quay lại bước X" |

Validate: lỗi inline tại stage (VI/EN nguyên văn chốt ở PLAN-FE): bước đầy (≤ 3 stage), vượt 10 stage, `real_action` sai bước, đích quay lại không hợp lệ. Cắt/ẩn đường kéo ở bước đầy bằng `aria-disabled`, không chỉ màu.

## 6. Hiệu năng
Ngân sách riêng: lazy chunk canvas thêm vào `check:bundle` admin-web (số cụ thể chốt khi cài, ADR-0013 #2); bundle chat-web **không tăng thư viện** (StageStrip CSS thuần). Canvas 10 nút kéo thả ≥ 50 fps — chỉ đo, không chặn (memory "Perf later"). Backend: query mới dùng index sẵn có + `process_back_events (process_run_id, created_at)` (plan §6).

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập |
|---|---|
| `@xyflow/react` (MIT, kiểm khi cài; ADR-0013 Proposed) | chỉ admin-web, lazy; test đơn vị layout thuần (không DOM) |
| Runtime song song | `fake-cli` (directive `#fake:`) chạy 3 job cùng bước; thêm directive trễ nếu cần để kiểm "chờ mọi stage" |
| Session resume (WRK-FR-14) | `fake-cli` giả `session_id`; Claude thật chỉ ở UAT |
| Env mới | không (hằng 3 vòng / 3 stage / 10 stage / 200 token là code, không phải env) |

## 8. Tiêu chí nghiệm thu (qc)
| AC | Given / When / Then | Test |
|---|---|---|
| AC-PB2-01 | Given def cũ không có `step` (sdlc 8 stage) / When chạy / Then chạy tuần tự như P-a, `current_step = current_stage_idx`, StageStrip như cũ (CHAT-AC-59 vế cuối) | `done:pa` chạy lại + int |
| AC-PB2-02 | Given bước 1 gồm A, B (`fake-cli`) / When start / Then cả hai `queued` cùng lúc; A Đạt, B chưa ⇒ bước 2 chưa chạy; B Đạt ⇒ bước 2 chạy | int engine |
| AC-PB2-03 | Given A gate trượt, B Đạt / Then chỉ A làm lại (attempt 2), B giữ nguyên, bước sau chờ | int |
| AC-PB2-04 | Lưu def: 4 stage cùng bước ⇒ 422 `STEP_TOO_WIDE`; 11 stage ⇒ lỗi cũ; `step` thiếu ở 1 stage ⇒ `STEP_INCOMPLETE`; bước không liên tục ⇒ `STEP_ORDER` | contract/rules |
| AC-PB2-05 | `real_action` ở stage bước 2 mà một stage bước 1 là `auto` ⇒ 422; cả hai là review ⇒ lưu được | rules |
| AC-PB2-06 | Given stage review có `back_to_steps=[1]` ở bước 3 / When người duyệt chọn quay lại bước 1 + góp ý / Then stage bước 1–3 `queued`, `round=2`, `back_rounds=1`, event ghi, góp ý có trong prompt bước 1; thiếu góp ý ⇒ 422 | int |
| AC-PB2-07 | Given đã quay lại 3 lần / When lần 4 / Then run `needs_decision` `back_limit`, không chạy lại; "thêm lượt" nới +1 | int |
| AC-PB2-08 | Hai người duyệt cùng bước cùng chọn quay lại ⇒ một thắng, một 409 `REVIEW_TASK_CLOSED`; task còn mở bị `superseded` | int (đồng thời) |
| AC-PB2-09 | Stage có `## Bàn giao`: prompt stage sau chứa Bàn giao + đường dẫn file, KHÔNG chứa nguyên file; thiếu mục ⇒ `template_invalid` như cũ | int |
| AC-PB2-10 | Làm lại cùng stage cùng agent ⇒ job dùng `resume` + prompt chỉ góp ý; đổi agent ⇒ không resume | int (fake-cli) |
| AC-PB2-11 | RLS: `process_back_events` tenant khác ⇒ 0 hàng; xem run người ngoài phòng (HUB-BR-25) không lộ `back_events` ngoài task của họ | int + rules |
| AC-PB2-12 | e2e admin: canvas (E-P15b/E-PB08/E-PB09 cập nhật) kéo stage sang cột (hoặc `Alt+→`) ⇒ bước đổi, bước đầy báo lỗi, đặt "Nếu bị trượt", Lưu ⇒ tải lại còn nguyên; e2e chat: StageStrip theo bước, ×2 sau quay lại, thẻ duyệt có "quay lại bước X" (CHAT-AC-59/60) | Playwright |

Lệnh xong: `bun run typecheck && bun test && bun run test:int && bunx playwright test e2e/P-b2 e2e/P-a e2e/P-b && bun run --filter @ai/admin-web check:bundle && bun run test:lock:verify` (thêm `done:pb2`; chạy lại `done:pa`, `done:pb`).

## 9. Quyết định
### Trước Gate (đã chốt với người dùng — CR-063/064, 2026-10-12)
- (15) gate theo stage, ≤ 3 stage/bước, tổng ≤ 10, mặc định mỗi stage một bước · (16) quay lại ≤ 3 vòng, chạy lại bước đích + sau, quá trần ⇒ Cần người quyết · (17) giữ nhãn ARIA "Giai đoạn n: …" · (19) `## Bàn giao` + resume (SHOULD) · `@xyflow/react` chỉ admin-web, lazy, `check:bundle`, StageStrip CSS thuần.

### Câu hỏi mở — mặc định đề xuất (người dùng chấp nhận khi duyệt Gate; không chặn PLAN)
| # | Câu hỏi | Mặc định |
|---|---|---|
| Q1 | Phần Editor còn lại (Nhóm agent ở Forge, tab Usage, luật tự duyệt, Import/Export, KPI) thuộc P-b2? | Không; mốc riêng P-b3 (§1.2). **BE chốt** |
| Q2 | "≤ 3 vòng" đếm theo gì; ai quyết khi quá trần? | Tổng mỗi run; dùng "Cần người quyết" sẵn có (người bắt đầu/`tenant_admin`), không thêm trường "người quyết" vào def. **BE chốt:** người quyết như `redo_limit`; `back_limit` cột run, `add_attempt` +1 (plan §3.6) |
| Q3 | `## Bàn giao` bắt buộc cho def cũ? 200 token đo thế nào? | Chỉ tự thêm khi lưu def; thiếu mục = `template_invalid`; ước lượng ký tự ÷ 4, cắt không từ chối. **BE chốt** + thêm heading vào `template` (plan §4) |
| Q4 | Seed mẫu có bước song song? | Không; fixture test + mockup `fixbug-evolu` do tenant tự sửa. **FE chốt:** UI không có mẫu/seed song song |
| Q5 | Chờ artboard Pencil hay dùng mockup Part B? | **FE chốt:** dùng mockup làm nguồn, A1–A6 vẽ sau (plan-fe §8) không chặn BUILD;  frontend-lead dựng, người dùng xem UAT; nếu muốn artboard thì vẽ trước PLAN-FE |
| Q6 | Quay lại có cho `back_to_steps` trỏ tới bước **song song cùng bước**? | Không (đích phải < bước hiện tại). **BE chốt** |
| Q7 | Run view chat: thẻ duyệt của stage song song hiện thế nào? | Mỗi stage một thẻ, nhóm dưới tiêu đề bước. **FE chốt** (plan-fe §4); **BE:** task review riêng mỗi stage_run (sẵn có) |
| Q8 | `Alt+mũi tên` có xung đột trình duyệt/OS? | Dùng; kiểm trong UAT, đổi phím nếu vướng. **FE chốt:** dùng + `preventDefault` + nút thay thế bắt buộc ở panel/StepList (plan-fe FB8) |

### Trong lúc làm (agent tự quyết theo Luật 2)
- FE PLAN (2026-10-12): FB1–FB11 ở `plan-frontend.md` §0 — `@xyflow/react` 12.11.6, chunk `canvas` ngân sách 80 KB gz, StepList làm fallback + đường a11y, chọn sẵn stage 1 (giữ E-P15b/E-PB08/E-PB09). Đề xuất backend: plan-fe §9 (B1–B6).
- BE PLAN (2026-10-12): D1–D12 ở `plan.md` §0 (gồm làm rõ PB2-R07: bước X `queued`, bước > X `pending`, `round+1` chỉ stage đã chạy).

## 10. Tranh chấp test
- (không)
