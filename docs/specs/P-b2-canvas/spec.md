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
File: `packages/contracts/src/hub-admin/processes.ts` (+ `chat/processes-entities.ts` cho run view). Chỉ **thêm** trường tuỳ chọn; `strictObject` cũ không vỡ.

| Thay đổi | Chi tiết | Lỗi (HTTP · code) |
|---|---|---|
| `ProcessStageDef.step?` | int 0…9 (PB2-R01) | 422 `STEP_INCOMPLETE` · `STEP_ORDER` · `STEP_TOO_WIDE` |
| `after.review.back_to_steps?` | int[] mặc định `[]` (PB2-R06) | 422 `BACK_TARGET_INVALID` (đích ≥ bước stage, hoặc không tồn tại) |
| `POST /review-tasks/:id/decision` (hiện có) | request thêm `back_to_step?: int` khi `result='fail'`; thiếu `feedback` ⇒ như cũ | 422 `BACK_TARGET_INVALID` · 409 `REVIEW_TASK_CLOSED` (PB2-R09) |
| `GET /process-runs/:id` | stage thêm `step`, `round`; run thêm `current_step`, `back_rounds`, `back_events[]` (`from_stage`, `to_step`, `round`, `feedback`, `by`, `at`) | — |
| `GET /process-defs/*` | trả `step`/`back_to_steps`; `stage_count` giữ | — |
| Trạng thái run | `decision.reason` thêm `back_limit` (PB2-R08) | — |

Sự kiện: tái dùng `process.updated`; thêm field `step`/`round` trong payload stage (không event mới). NOTIFY không đổi.

## 4. Dữ liệu (backend-lead)
Migration `hub` kế tiếp (sau `0023_x2b2_room_attachments`; số chốt khi PLAN): chỉ thêm cột, an toàn chạy lại.

| Bảng | Cột | Kiểu | Null | Default | Ràng buộc / index | RLS |
|---|---|---|---|---|---|---|
| `process_defs.stages` (jsonb) | `step`, `after.back_to_steps` | trong jsonb | — | — | validate ở biên (zod), không đổi DDL | như cũ |
| `process_runs` | `current_step` | smallint | NOT NULL | 0 | — | T (cũ) |
| `process_runs` | `back_rounds` | smallint | NOT NULL | 0 | CHECK 0…4 | T |
| `stage_runs` | `round` | smallint | NOT NULL | 1 | giữ `UNIQUE(process_run_id, stage_idx)` (một hàng/stage; lịch sử ở `process_back_events`) | T |
| `process_back_events` (mới) | id, tenant_id, process_run_id, from_stage_idx, to_step, round_after, feedback, decided_by, created_at | — | — | — | index `(process_run_id, created_at)`; không UPDATE/DELETE | T (RLS như `stage_runs`) |

Seed: không đổi. Mẫu SDLC `platform_admin` giữ nguyên (mỗi stage một bước); ví dụ song song nằm trong fixture test, không seed (**Q4**).

## 5. UI (frontend-lead)
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
Ngân sách riêng: lazy chunk canvas thêm vào `check:bundle` admin-web (số cụ thể chốt khi cài, ADR-0013 #2); bundle chat-web **không tăng thư viện** (StageStrip CSS thuần). Canvas 10 nút kéo thả ≥ 50 fps — chỉ đo, không chặn (memory "Perf later").

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
| Q1 | Phần Editor còn lại (Nhóm agent ở Forge, tab Usage, luật tự duyệt, Import/Export, KPI) thuộc P-b2? | Không; mốc riêng P-b3 (§1.2) |
| Q2 | "≤ 3 vòng" đếm theo gì; ai quyết khi quá trần? | Tổng mỗi run; dùng "Cần người quyết" sẵn có (người bắt đầu/`tenant_admin`), không thêm trường "người quyết" vào def |
| Q3 | `## Bàn giao` bắt buộc cho def cũ? 200 token đo thế nào? | Chỉ tự thêm khi lưu def; thiếu mục = `template_invalid`; ước lượng ký tự ÷ 4, cắt không từ chối |
| Q4 | Seed mẫu có bước song song? | Không; fixture test + mockup `fixbug-evolu` do tenant tự sửa |
| Q5 | Chờ artboard Pencil hay dùng mockup Part B? | Dùng mockup làm nguồn; frontend-lead dựng, người dùng xem UAT; nếu muốn artboard thì vẽ trước PLAN-FE |
| Q6 | Quay lại có cho `back_to_steps` trỏ tới bước **song song cùng bước**? | Không (đích phải < bước hiện tại) |
| Q7 | Run view chat: thẻ duyệt của stage song song hiện thế nào? | Mỗi stage một thẻ, nhóm dưới tiêu đề bước |
| Q8 | `Alt+mũi tên` có xung đột trình duyệt/OS? | Dùng; kiểm trong UAT, đổi phím nếu vướng |

### Trong lúc làm (agent tự quyết theo Luật 2)
- (trống)

## 10. Tranh chấp test
- (không)
