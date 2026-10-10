# Readiness · P-process-engine

Mỗi lần chạy spec-readiness thêm một dòng (mới nhất ở trên). Báo cáo đầy đủ dán bên dưới dòng đó hoặc lưu file riêng. Chạy cho **P-a** sau khi có plan + test-plan (tasks P1, P2, Q1); M1–M6 (spec §9) cần xác nhận ở lần chạy đầu.

| Ngày | Kết quả | Chặn | Cao | Thấp | Ghi chú |
|---|---|---|---|---|---|
| 2026-10-10 (lần 3, `8c2b12d9`) | NOT READY | 0 | 3 | 4 | R2-1…R2-9, #22–#24 đóng hết. Mới: 3 Cao đội tự sửa, đều quanh view ngoài phòng của người bắt đầu đã rời (U5): quyền `GET output`, FE không hiện `outputs`/`can_cancel` ở `access:task`, thiếu test luật. Không còn câu hỏi người dùng |
| 2026-10-10 (lần 2, `1ee41c60`) | NOT READY | 0 | 5 | 7 | 24 lỗ hổng lần 1: 21 đóng, 3 Thấp mang sang. Mới: 1 câu hỏi người dùng (T10 lệch X2b-R17), 4 Cao đội tự sửa (nhãn e2e thread, ràng composer, ai gửi trả lời ở composer thread, `forward.task_kind`) |
| 2026-10-10 (lần 1, `db3e7021`) | NOT READY | 1 | 7 | 9 | + 7 Trung bình. Chặn = ai mở task hỏi lại (PF1 hay PF2). 4 mục cần người dùng quyết (U1–U4), còn lại đội tự sửa theo Luật 2 |
| (chưa chạy) | — | — | — | — | Spec draft 2026-10-09 (CR-056…058) |

---

## Lần 3 · 2026-10-10 · commit `8c2b12d9` (diff `1ee41c60..HEAD`)

## Kết luận: NOT READY
Phạm vi đã kiểm: `git diff 1ee41c60..HEAD -- docs/specs/P-process-engine docs/design` (14 file đổi, trừ readiness.md) + mục được trỏ: plan-contract.md:40–45, :57, :115–131; plan.md:8–18, :68; plan-frontend.md:16–21, :73–74; test-plan.md:123–130; test-plan-int.md:166–177 · mã yêu cầu: U5, Q-F5, T6, T10, P-R10, HUB-FR-105/113/115, HUB-BR-25, ADM-FR-65, CHAT-AC-52/57, AC-H29

Lỗ hổng lần 2: **đóng** R2-1 (U5 ở spec.md:178, plan-thread.md:17 T10, BA HUB-FR-113, usecases-chat:193, P1-75/P1-85, E-P20) · R2-2 (E-P18 thống nhất số qc; E-P19/E-P20 có ở cả test-plan-e2e.md:33–34 và plan-frontend-e2e.md:69–71; E-P8/E-P13/E-P16 sửa) · R2-3 (T6 plan-thread.md:13 + spec.md:179 Q-F5) · R2-4 (plan-frontend-thread §2 `begin({…, submit})`, footer gọi `binding.submit`) · R2-5 (plan-contract.md:41 `forward.task_kind`, i18n-thread chọn khoá theo loại, E-P9) · R2-6 (plan-step0.md:28 `run_end` + persona `lan-left`) · R2-7 (N10 đóng, test-plan.md) · R2-8 (test-plan-e2e.md:3 không `exact` cho `article`, i18n "Đã trả lời") · R2-9 (BA HUB-FR-105 "5 (`PROCESS_RUNS_PER_TENANT`)", HUB-FR-115 "7 ngày (`PROCESS_RUN_TTL_DAYS`)", ADM-FR-65 "run gần nhất — P-b"). #22 ⇒ việc kiểm trong RV1 (tasks.md:62) — đóng ở mức spec. #23 ⇒ tasks.md:12 (tiêu đề mục = cột Feature/nhánh) — đóng. #24 ⇒ thành luật (phụ lục) — đóng; trần xem dưới.

**Đối chiếu `access` của A' (người bắt đầu đã rời, U5) — ma trận test-plan-int.md:170 ↔ plan-contract:**

| Ô A' | QC ghi | Contract | Kết luận |
|---|---|---|---|
| GET run | "ngoài³" (không giá trị cụ thể); R-A08 "giá trị theo plan-contract U5" | :116 `runAccess` ⇒ `task`; :40 `task` + `my_tasks` rỗng được + `outputs?` + `can_cancel?`, không `thread` | Khớp nghĩa, chưa ghim giá trị ⇒ R3-3 |
| output đang kiểm / stage khác | Đ / Đ | :57 `GET …/outputs/:oid` "task: chỉ `output_id` của task mình" (chưa có ngoại lệ U5) ⇒ A' không task ⇒ 404 | **Mâu thuẫn** ⇒ R3-1 |
| usage | s | :45 `summary` cho người xem `task` | Khớp |
| decision / answer / forward | 4 / 409 closed / Đ¹ | theo assignee, không đổi do U5 | Khớp |
| decide | 409 state (R1 không `needs_decision`) | :119 `canDecide` người bắt đầu đã rời vẫn quyết; :131 `decisionAssignees` gồm `startedBy` ⇒ việc quyết vào `my_tasks` | Khớp |
| cancel | Đ | :118 `canCancel` kể cả đã rời; :40 `can_cancel?` | Khớp |
| tin R / hội thoại nền | 4 / 4 | :117 `canReadThread` false | Khớp |
| `/runs/:stage` events (H1) | Đ | plan.md:8 D1 run stage là `hub.runs` của người bắt đầu (`user_id = started_by`) | Khớp |

## Lỗ hổng
| # | Mức | Mục | Vị trí (file:dòng hoặc mã) | Vấn đề | Mặc định đề xuất |
|---|-----|-----|----------------------------|--------|------------------|
| R3-1 | Cao | B, I (bảo mật) — đội | plan-contract.md:57 ↔ :40 (`outputs?` chỉ cho người bắt đầu đã rời) ↔ test-plan-int.md:170 (A' output Đ/Đ) ↔ spec.md:178 (U5 "output") | `GET /process-runs/:id/outputs/:oid` cho `access:task` chỉ mở output của task mình ⇒ A' (không task) bị 404 với mọi output, trái ma trận + U5. Hai cách code | backend-lead sửa :57: "task: output của task mình; người bắt đầu đã rời (U5): mọi output của run (= `outputs`), audit `view` mỗi lần". Ghi rõ `outputs` vẫn trả khi run đã kết thúc (M4 chỉ làm rỗng `stages`). `lan-left` (plan-step0.md:28) trả `outputs` ≥1 + `can_cancel:true` |
| R3-2 | Cao | E — đội | plan-frontend.md:73 (`access:task`: chỉ `TaskAccessBanner` + `StageStrip`; `CancelRunButton`, output chỉ ở `full`) ↔ plan-frontend-thread.md:62 ("nút `Huỷ lượt chạy` theo `can_cancel`") ↔ plan-contract.md:40 (`outputs?`, `can_cancel?`) | `RunPage` dạng `task` không có chỗ hiện `outputs` của A' và không có `CancelRunButton`; câu banner "Bạn chỉ xem được phần cần xử lý…" sai nghĩa với A' (không có việc). E-P20 không kiểm nút Huỷ / output | frontend-lead sửa plan-frontend.md:73 (ghi vào phụ lục nếu chạm trần): `access:task` + `outputs` ⇒ danh sách "Kết quả" (`OutputView` theo `OutputRef`); `can_cancel` ⇒ `CancelRunButton`; banner riêng khi `my_tasks=[]` dùng i18n-thread `left` ("Bạn không còn ở phòng này. Xem lượt chạy ở trang riêng."). qc thêm vào E-P20: A' thấy `button "Huỷ lượt chạy"` + ≥1 output |
| R3-3 | Cao | F, H2 — đội | test-plan.md:123–130; test-plan-int.md:170, chú thích ³ | Luật mới `canReadThread` (plan-contract.md:117) không có ca R-A*; R-A08 và ô A' GET run không ghi giá trị (FR MUST cần kỳ vọng đo được); R-A05/R-A06 chưa có ca "người bắt đầu đã rời" | qc: R-A08 kỳ vọng `task`; thêm R-A09 `canReadThread` (thành viên ⇒ true; người bắt đầu `outside` ⇒ false; assignee ngoài phòng ⇒ false; admin ⇒ theo RLS phòng = false nếu không là thành viên); R-A05/06 thêm `originRoom:"outside"` ⇒ true. Ô A' GET run = `task` (`my_tasks=[]`, `outputs` ≥1, `can_cancel=true`, không `thread`) |
| R3-4 | Thấp | I | plan-contract.md:41 (`task_kind` với ba giá trị nối bằng dấu gạch đứng trần) | `|` không thoát trong ô bảng ⇒ vỡ bảng khi render (các chỗ khác dùng `\|`) | backend-lead thay bằng `\|` |
| R3-5 | Thấp | I | spec.md:195 | Còn "chờ chạy lại lần 2" | docs-architect: "lần 3 NOT READY (R3-1…3), chờ lần 4" |
| R3-6 | Thấp | I | test-plan-int.md:170 chú thích ³ "lệch ⇒ qc theo contract ở QC1" | Câu dự phòng thành thừa sau R3-3 | qc xoá khi ghi giá trị |
| R3-7 | Thấp | I (trần, #24) | plan.md 30 572 B (còn 148 B tới 30 KB); plan-frontend.md 25 399 B (còn 201 B tới 25 KB) | Sửa R3-2 có thể vượt trần plan-frontend.md | Mọi bổ sung vào phụ lục (`plan-frontend-thread.md` §5 hoặc `plan-frontend-usage.md`), plan-frontend.md chỉ trỏ |

## Mâu thuẫn giữa tài liệu
- plan-contract.md:57 (output cho `task` chỉ của task mình) ↔ plan-contract.md:40 `outputs?` + test-plan-int.md:170 A' Đ/Đ + spec.md:178 U5 → giữ U5: người bắt đầu đã rời đọc mọi output (R3-1).
- plan-frontend.md:73 (`task` không có Huỷ/output) ↔ plan-frontend-thread.md:62 (Huỷ theo `can_cancel`) → giữ plan-frontend-thread + contract (R3-2).

## Câu hỏi cho người dùng (chỉ những gì KHÔNG có mặc định an toàn)
Không có. U5 đã trả lời và đủ để chọn mặc định cho R3-1…R3-3 (spec.md:178 "tiến độ, output, task của mình"). Đội tự đóng (Luật 2): R3-1 backend-lead · R3-2 frontend-lead (+ qc E-P20) · R3-3 qc · R3-4 backend-lead · R3-5 docs-architect · R3-6 qc · R3-7 frontend-lead.

## Checklist
| Mục | Kết quả | Bằng chứng (file:dòng / mã) |
|-----|---------|-----------------------------|
| A Phạm vi | Đạt | spec.md:178–179 U5/Q-F5; ADM-FR-65 "run gần nhất — P-b" |
| B Hợp đồng | Mâu thuẫn | plan-contract.md:40–41, :115–119 có U5; :57 chưa (R3-1) |
| C Dữ liệu | Đạt | không đổi từ lần 2; `RunFacts.originRoom` (:115) |
| D Nghiệp vụ | Đạt | plan-thread.md:13 (T6), :17 (T10 U5); P-R10 không xung đột (U5 ghi rõ chạy tiếp) |
| E UI | Thiếu | plan-frontend-thread.md:20, :36–62; plan-frontend.md:73 thiếu view A' (R3-2) |
| F Kiểm chứng | Thiếu | P1-75, P1-85, E-P19, E-P20, E-P9; thiếu `canReadThread`, giá trị A' (R3-3) |
| G Phụ thuộc & môi trường | Đạt | plan-step0.md:28 (`run_end`, `lan-left`); `lan-left` cần `outputs`/`can_cancel` (trong R3-1) |
| H Task | Đạt | tasks.md:12 (#23), :62 RV1 (#22, U5) |
| H2 Vai trò | Thiếu | `canReadThread` khai báo plan-contract.md:117 nhưng chưa có test (R3-3) |
| I Nhất quán | Thiếu | R3-4, R3-5 |
| J Độ chính xác | Đạt | i18n-thread `left`, `forward.line`/`ask.fwd.line`, `result.answered` nguyên văn VI/EN |

**Trần kích thước** (`wc -c`, WORKFLOW Kỷ luật token #5, 1 KB = 1024 B): spec.md 23 212 / 25 600 · plan.md 30 572 / 30 720 · plan-frontend.md 25 399 / 25 600 · test-plan.md 28 604 / 30 720 — **đều dưới trần**; plan.md, plan-frontend.md sát trần (R3-7). Phụ lục không có trần.

## Quét từ mơ hồ
Chỉ quét phần đổi: "(tuỳ chọn)" (nhãn trường E-P9) — vô hại; "…" trong nhãn e2e/i18n là chuỗi rút gọn có bản đầy đủ — vô hại; "`outputs?`"/"`can_cancel?`" (plan-contract.md:40) là trường tuỳ chọn của schema, điều kiện có ghi ("chỉ người bắt đầu đã rời") — vô hại. Không còn "~" ở BA đã sửa.

## Chưa kiểm
- Không đọc lại phần không đổi. Không đối chiếu từng khoá vi/en ngoài các khoá đổi (`left`, `forward.line`, `ask.fwd.line`, `result.answered`).
- Symbol chat-web ở plan-frontend-thread.md:63–75 vẫn chưa Grep xác minh (như lần 2).

---

## Lần 2 · 2026-10-10 · commit `1ee41c60` (diff `db3e7021..HEAD`)

## Kết luận: NOT READY
Phạm vi đã kiểm: `git diff db3e7021..HEAD -- docs/specs/P-process-engine docs/design` (19 file) · đọc hết file mới: plan-thread, plan-step0, plan-frontend-thread, plan-frontend-i18n-thread, plan-frontend-usage; diff của spec, plan, plan-contract, tasks; plan-frontend §9–§11; test-plan-e2e §2; plan-frontend-e2e §1, §3; Grep test-plan/-int theo T6/T10/N9/N10/`postThreadOnce`/`answer_run_id`; BA: HUB-BR-23, HUB-FR-104/113/114, AC-H35, CHAT-AC-52/58, ADM-FR-65; X2b spec R17 · mã yêu cầu: như lần 1 + T1–T11 (plan-thread)

Trần kích thước (1 KB = 1024 B): spec 22 669 / 25 600 · plan 30 572 / 30 720 (còn 148 B) · plan-frontend 25 399 / 25 600 · test-plan 28 257 / 30 720 → **đạt**. Phụ lục (plan-contract 27 558, test-plan-int 32 850, plan-frontend-i18n 27 112) không có trần.

Lỗ hổng lần 1: **đóng** #1–#19, #21 (plan-step0 §1–§4, plan-contract §2/§7/§7.1, tasks B0–B8, test-plan:18 cổng merge, E-P14b, P1-36/M-C2, BA HUB-BR-23 C2, spec §9 U1–U4); #20 đóng ở plan-frontend-admin.md:51 (BA chưa gắn nhãn → #R2-9). Còn: #22, #23, #24 (Thấp).

## Lỗ hổng
| # | Mức | Mục | Vị trí (file:dòng hoặc mã) | Vấn đề | Mặc định đề xuất |
|---|-----|-----|----------------------------|--------|------------------|
| R2-1 | Cao | D, I (bảo mật) — **người dùng** | plan-thread.md:17 (T10), test-plan-int.md:101 (P1-75 "vẫn full"), :113 (P1-85) ↔ X2b spec.md:54 (X2b-R17, hard-stop bảo mật X2b §154: người gọi rời/phòng xoá ⇒ huỷ run, không ghi tin) | Người bắt đầu rời phòng: run chạy tiếp, tin vẫn đăng, A vẫn xem `full` (gồm góp ý/trả lời thành viên phòng viết **sau** khi A rời). Lệch một quyết định người dùng (Q8 X2b), chưa hỏi | Hỏi U5. Mặc định: giữ T10 (run là đối tượng riêng P-R01, chạy bằng quyền A, góp ý là việc của chính run); phòng xoá ⇒ `skipped` như T10. Sau khi người dùng trả lời: docs-architect ghi spec §9; reviewer đưa vào RV1 |
| R2-2 | Cao | F, I | test-plan-e2e.md:29 (E-P18 = pf3 T ngoài phòng Đạt ⇒ B thấy `task_result`) ↔ plan-frontend-e2e.md:69 (E-P18 = PF1 X không-assignee, rời phòng ⇒ thread 404 bỏ `?flow`, < 640 px `dialog`), :70 (E-P19 chưa đọc/FlowRecent "Chưa xem"/preview sidebar — không có trong test-plan-e2e) | Cùng mã, khác ca (N9 chưa đóng); hành vi "rời phòng ⇒ bỏ `?flow`", "< 640 px dialog", "Chưa xem" không có test khoá | qc giữ E-P18 hiện tại; thêm **E-P19** (pf1: X không-assignee + rời phòng 404 + < 640 dialog) và **E-P20** (pf1: chưa đọc FlowRecent + preview "<tên quy trình>: …"); frontend-lead đổi số ở plan-frontend-e2e §3 cho khớp. Cùng lượt: plan-frontend-e2e:64 E-P13 trỏ E-P14b (bỏ "tab Token bản summary"), :67 E-P16 `/processes` → `/process-inbox`, E-P8 persona không-assignee = X (như test-plan-e2e:26) |
| R2-3 | Cao | D, I | plan-thread.md:13 (T6 "composer flow khi người xem có task mở `can_act` — ask ⇒ `POST …/answer`") ↔ plan-frontend.md:22 (FD13), :126 (Q-F5 "chủ động"), plan-frontend-thread.md:13, :57 | Hai cách hiểu: mọi chữ của assignee tự thành câu trả lời, hay chỉ sau khi bấm `Trả lời bằng văn bản`/`Chưa đạt`. test-plan-e2e E-P8/E-P4 theo FE | Giữ **chủ động** (FE + QC đã khớp; UX, không cần người dùng). backend-lead sửa T6: "composer chỉ ràng task sau khi assignee bấm `Chưa đạt` / `Trả lời bằng văn bản`; còn lại = tin người↔người"; docs-architect ghi Q-F5 vào spec §9 (Luật 2) |
| R2-4 | Cao | H (CR-059) | plan-frontend-thread.md:20 (`ThreadBinding.begin({kind, taskId, agent})` — không có hàm gửi), :28 (`ProcessThreadFooter` PF1), :57 (chế độ Trả lời gọi `POST /review-tasks/:id/answer`), plan-frontend.md:118 (`use-ask-actions.ts` PF2; không có trong stub §9 #1) | Footer PF1 phải gọi API trả lời của PF2 ⇒ hoặc PF1 viết lại logic answer (lệch xử lý `REVIEW_TASK_CLOSED`/toast `ask.toast.answered`), hoặc import hook PF2 chưa có stub | Bước 0 thêm `submit: (text) => Promise<void>` vào `begin(...)`: thẻ gọi `begin` (AskTaskCard PF2 / ReviewTaskCard PF1) truyền hàm gửi của mình; footer chỉ gọi `binding.submit`. Sửa: frontend-lead (plan-frontend-thread §2, §5) |
| R2-5 | Cao | B, E | plan-contract.md:43 (`forward {stage_idx, task_id, from, to, depth}` không `task_kind`) ↔ plan-frontend-i18n-thread.md:44 (`thread.forward.line` "đã chuyển việc cho") và :63 (`ask.fwd.line` "đã nhờ … trả lời") ↔ plan-frontend-e2e.md:60 (E-P9 "↪ A đã nhờ H trả lời (chuyển 1/3)") ↔ plan-frontend-thread.md:40, :86 (#3 dùng câu trung tính) | Hai khoá, hai câu cho cùng tin; e2e FE dùng câu không dựng được từ contract | backend-lead thêm `task_kind: "review"\|"ask"` vào nhánh `forward` (B2, chỉ thêm); FE: ask ⇒ `ask.fwd.line`, review ⇒ `thread.forward.line`; qc E-P9 kiểm chữ "đã nhờ QC Người 01 trả lời (chuyển 1/3)" |
| R2-6 | Thấp | G | plan-step0.md:74 (tin thread mỗi run: "khối + output + ask/decision + task_result + forward") ↔ plan-frontend-thread.md:84 (#1 đủ 7 loại) | `run_end` không ghi trong fixture (run `done`, `cancelled`) | backend-lead thêm "`run_end` cho run `done`/`cancelled` (actor A)" vào plan-step0 §3; `open_tasks` + `thread` theo persona (A/B assignee, X không) |
| R2-7 | Thấp | F | test-plan.md:210 (N10 `postThreadOnce` chỉ trả số) | Có mặc định (đếm `outcome` bằng SQL) | Giữ mặc định; backend-lead không đổi chữ ký |
| R2-8 | Thấp | I | plan-frontend-i18n-thread.md:41 (`result.answered` "đã trả lời") ↔ test-plan-e2e.md:26 (`article "Bạn · Đã trả lời · …"`) | Hoa/thường lệch (Playwright `name` mặc định không phân biệt — vô hại nếu không `exact`) | qc không dùng `exact` cho tên `task_result`, hoặc frontend-lead viết hoa đầu `result.*` |
| R2-9 | Thấp | I | ba-agent-hub HUB-FR-105 ("≤ ~5 run"), HUB-FR-115 ("~7 ngày"); ba-admin ADM-FR-65 ("run gần nhất" chưa gắn P-b; plan-frontend-admin.md:51 đã ghi P-b) | BA còn số mơ hồ / thiếu nhãn P-b | docs-architect: "5 (`PROCESS_RUNS_PER_TENANT`)", "7 ngày", "run gần nhất — P-b" |
| #22 | Thấp | C | plan.md:39 | (mang sang) | như lần 1 |
| #23 | Thấp | H | tasks.md | (mang sang) | như lần 1 |
| #24 | Thấp | I | plan.md 30 572 B (còn 148 B) | (mang sang) | mọi bổ sung vào phụ lục (plan-thread/plan-step0) |

## Mâu thuẫn giữa tài liệu
- plan-thread T10 (rời phòng ⇒ run tiếp, vẫn đăng, starter xem full) ↔ X2b-R17 (huỷ run, không ghi tin; hard-stop bảo mật) → người dùng quyết (U5); mặc định giữ T10.
- plan-thread T6 (tự ràng khi `can_act`) ↔ plan-frontend FD13/Q-F5 (chủ động) → giữ chủ động (R2-3).
- test-plan-e2e E-P18 ↔ plan-frontend-e2e E-P18/E-P19 → giữ số của qc, thêm E-P19/E-P20 (R2-2).
- i18n-thread `forward.line` ↔ `ask.fwd.line` ↔ contract `forward` thiếu `task_kind` → thêm `task_kind` (R2-5).

## Câu hỏi cho người dùng (chỉ những gì KHÔNG có mặc định an toàn)
1. **U5 · Người bắt đầu rời phòng giữa run** (plan-thread T10, khác X2b-R17 bạn đã chốt cho agent trong phòng: huỷ run). Mặc định: **run chạy tiếp**, tin vẫn đăng vào thread cho thành viên còn lại, người bắt đầu vẫn xem trang `/runs/:id` đầy đủ (gồm góp ý thành viên viết sau khi họ rời) nhưng không đọc được thread phòng. Lựa chọn khác: huỷ run như X2b-R17. Phòng bị xoá ⇒ run chạy tiếp, chỉ xem ở `/runs/:id` (không cần hỏi).

Đội tự đóng (Luật 2): R2-2…R2-9 như cột "Mặc định đề xuất". Yêu cầu FE đã đáp ứng: mock 7 loại tin + persona + `POST /__mock/process` phát `room.message` (plan-step0 §3, thiếu `run_end` → R2-6), `open_tasks.assignees/group` (plan-contract:42), `X-Flow-Id` (P1-01), `answer_run_id` trong thread ⇒ 404 (S0-14), `?flow_id=` theo `seq` (S0-15, S0-18, P1-80), test khoá X2b cờ off (test-plan:18, :200). Giữ mặc định FE: `OutputRef` không tên tệp, `last_run` → P-b. Không còn ca test nào dùng `?run=`/`RunPane` (Grep test-plan*: 0).

## Checklist
| Mục | Kết quả | Bằng chứng (file:dòng / mã) |
|-----|---------|-----------------------------|
| A Phạm vi | Đạt | spec.md:38–42 (U2 Import/Export → P-b), ba-admin ADM-FR-65, plan-step0.md:82 |
| B Hợp đồng | Thiếu | plan-contract §2 `RoomProcessPart`, `open_tasks`, `thread`, `TaskDetail.options/has_output`, §3 `X-Flow-Id`/422, §4 mã mới; thiếu `forward.task_kind` (R2-5) |
| C Dữ liệu | Đạt | plan-thread.md:35–40 (cột, CHECK, uq, `process_thread_events` RLS system, 3 definer, thứ tự khoá); plan.md:49, :51 |
| D Nghiệp vụ | Mâu thuẫn | T10 ↔ X2b-R17 (R2-1); T6 ↔ FD13 (R2-3); số mơ hồ spec/plan đã sửa (spec.md:74–75) |
| E UI | Thiếu | plan-frontend-thread §1–§7 (7 loại tin, trạng thái tải/lỗi/404, composer 3 chế độ), i18n-thread VI/EN; câu `forward` hai nghĩa (R2-5) |
| F Kiểm chứng | Thiếu | test-plan-int S0-14…19, P1-80…85, P2-16, P3-10/11, M-C2; e2e E-P3/4/8/17/18; lệch số E-P18/19 (R2-2) |
| G Phụ thuộc & môi trường | Đạt | plan-step0.md:71–79 (mock B2, `PA_FIX`, `/__mock/process`, Dify đếm `ghi-so`); `run_end` Thấp (R2-6) |
| H2 Vai trò | Đạt | plan-contract §7 (`canAct`, `decisionAssignees`, `toTaskDetail`, `threadContent`, `validateProcessDef`), §7.1 seam; test-plan §3 |
| H Task | Thiếu | tasks.md B0–B8, F1–F5 có file/phụ thuộc/Rủi ro (B2 `cao`); ranh giới PF1↔PF2 ở composer thread FE (R2-4) |
| I Nhất quán | Mâu thuẫn | xem "Mâu thuẫn giữa tài liệu" |
| J Độ chính xác | Đạt | điểm `sender_type` chat-web có file:dòng (plan-frontend-thread.md:63–75); nhãn nguyên văn i18n-thread; seam N3/N4 plan-contract §7.1 |

## Quét từ mơ hồ
Chỉ quét phần đổi: "~" còn ở plan-thread.md:18 ("≤ ~2 + 2×lần làm lại tin/stage" — mô tả lý do, vô hại), BA HUB-FR-105/115 (R2-9); "…" trong nhãn e2e/i18n là chuỗi rút gọn có bản đầy đủ ở i18n — vô hại; "(tuỳ chọn)" là nhãn trường — vô hại.

## Chưa kiểm
- Không đọc lại phần không đổi (theo WORKFLOW Bước 4 lần 2). plan-frontend-i18n.md, test-plan-int.md chỉ Grep theo mã liên quan; không đối chiếu từng khoá vi/en của i18n-thread.
- Symbol chat-web ở plan-frontend-thread.md:63–75 (file:dòng) chưa Grep xác minh dòng.

---

## Lần 1 · 2026-10-10 · commit `db3e7021`

## Kết luận: NOT READY
Phạm vi đã kiểm: `docs/specs/P-process-engine/` · 13 file (spec, plan, plan-contract, plan-seed, plan-frontend, -admin, -i18n, -e2e, test-plan, -int, -e2e, tasks, spike) + CLAUDE.md, WORKFLOW.md (Kỷ luật token #5, "Làm song song nhiều session" CR-059), BA-H §6.10/§8/§11, usecases-chat UC-12, ba-admin §5.8, CR-056 · mã yêu cầu: HUB-FR-104…117 (vế P-a), HUB-BR-23…28, AC-H28…H34, CHAT-AC-51…58, ADM-FR-65…67

Trần kích thước (`wc -c`, 1 KB = 1024 B): spec 21 077 / 25 600 · plan 30 480 / 30 720 (còn 240 B) · plan-frontend 25 468 / 25 600 · test-plan 23 360 / 30 720 → **đạt**. Phụ lục không có trần.

## Lỗ hổng
| # | Mức | Mục | Vị trí (file:dòng hoặc mã) | Vấn đề | Mặc định đề xuất |
|---|-----|-----|----------------------------|--------|------------------|
| 1 | Chặn | H, I (CR-059) | plan.md:93 (§4 "Hỏi lại ≤ 3 … `runs/stage-driver.ts`"), :74 (§3.2), plan-contract.md:108 (`Effect "open_ask"`), :132 (`mergeQuestions` ở `runs/team.rules.ts` PF1), :141 (`askExcerpt` ở `asks/ask.rules.ts` PF2) ↔ tasks.md:40 (B6b "need_input → task ask, gộp câu hỏi nhóm" ở `asks/**` PF2) ↔ test-plan.md:184 (N2 "stage-driver gọi port asks" — port này không có trong plan.md:137) | Hai cách hiểu ai mở task `ask`; theo B6b thì PF1 cần file PF2 (`askExcerpt`) hoặc một port không tồn tại | **PF1 mở task ask**: `stage-driver`/`team-runner` thực thi hiệu ứng `open_ask` bằng `core.insertTask` (Bước 0) + gọi `ProcessNotifier`; chuyển `askExcerpt` sang `core/` (Bước 0, test R-AK04 sang `step0/rules`); `mergeQuestions` giữ PF1. B6b chỉ còn trả lời + chuyển + `kick`. Sửa: backend-lead (plan §9, tasks B4/B5/B6b), qc (R-AK04, P2-01/10/11 ghi ⇢PF1 hoặc chuyển sang pf1) |
| 2 | Cao | B, D | plan.md:84 (§3.4 task `decision` — không ghi assignee), plan-contract.md:37–38 (`TaskDetail` không có `options`/output; view `task` không có `decision`), test-plan.md:196 (Q2), test-plan-int.md:71 (P1-44 T `decide` = 200), test-plan.md:124 (R-K04) | Không biết ai là assignee của task `decision` (ảnh hưởng "Chờ tôi kiểm", notice `decision_requested`, quyền xem). T ngoài phòng được quyết (Q2) nhưng view `task` không có dữ liệu cho `DecisionCard` (plan-frontend.md:50 đọc `decision.options`) | Assignee task `decision` = người bắt đầu (hàng user) + Group duyệt **chỉ khi** lý do `redo_limit`; `tenant_admin` không là assignee (thấy qua Evolu Control). `TaskDetail` kind `decision` thêm `options: DECISION_OPTION[]`, `has_output: bool`; `DecisionCard` dựng từ `TaskDetail` khi `access:task`. Sửa: backend-lead (plan §3.4, plan-contract §2), frontend-lead (plan-frontend §3), qc (R-K04 giữ, thêm ca view `task` có decision task) |
| 3 | Cao | H (CR-059) | plan.md:122, :131 (core Bước 0 chỉ có `lockRun`, `loadRunHead`, `insertTask`, `closeTask`) ↔ plan-contract.md:53, :59–61, :58 (PF1 view, PF2 answer/forward, PF3 `/me/review-tasks` đều trả `TaskDetail` + `can_act`) | Bộ dựng `TaskDetail` + luật `can_act` dùng bởi 3 PF nhưng không nằm ở Bước 0 ⇒ mỗi PF tự viết, dễ lệch quyền | Thêm `core/task-view.ts` (`toTaskDetail`, `canAct`) vào Bước 0 (B0) + test luật ở `step0/rules`. Sửa: backend-lead (plan §8–§9, tasks B0), qc |
| 4 | Cao | H (CR-059) | plan-frontend.md:71 (`RunPage` PF3 dùng `CancelRunButton`, `DecisionCard`), :104 (danh sách stub Bước 0 thiếu `CancelRunButton`), :120 (`CancelRunButton` thuộc PF1) | PF3 cần file của PF1 chưa có stub; nhánh PF3 tạo từ `main` sau Bước 0 sẽ không biên dịch | Thêm `CancelRunButton` vào stub Bước 0 (§9 #1) hoặc chuyển vào `shared/`. Sửa: frontend-lead |
| 5 | Cao | F (CR-059 cổng merge) | test-plan.md:15–16 ("Cổng merge: toàn bộ `P-a/**`"), :13 (scenario "từ cổng merge PF2"), test-plan-e2e.md:29 (E-P13 kiểm tab Token bản summary — PF4), :35–36 (E-S1/E-S2 Token khớp, "tab Token 8 hàng" — PF4), test-plan-int.md:151 (SC-1 usage) | Với thứ tự merge PF1 → PF3 → PF2 → PF4, cổng merge PF1/PF3/PF2 không thể xanh (thư mục pf2–pf4 + scenario cần PF4) — mâu thuẫn WORKFLOW "Cổng merge" bước 2 | Cổng merge nhánh k = `step0` + pf của các nhánh đã merge + pf của nhánh k; `scenario/` chỉ chạy từ cổng merge PF4 + `done:pa`. Chuyển phần Token của E-P13 sang pf4 (E-P14b: T thấy `summary`). Sửa: qc (test-plan §1, test-plan-e2e) |
| 6 | Cao | F, J | test-plan.md:185–186 (N3, N4) ↔ plan.md §9 (không có) | Test viết trước cần symbol thật: `sweepOnce`, `remindOnce`, deps `createApp` (`processEngine`, `processRunsPerTenant`, `stageLauncher`, `now`), payload job stage (`process_run_id`, `stage_run_id`, `team_run_id`, `step_id`, `files`, `timeoutS`), `run_steps` cho lần gọi nhóm | Ghi đúng mặc định N3/N4 của qc thành chữ ký ở plan-contract §7 (plan.md chỉ còn 240 B) + stub B0. Sửa: backend-lead |
| 7 | Cao | F, I (bảo mật) | spec.md:163 (C2 đã chấp nhận), plan.md:10 (D3) ↔ BA-H HUB-BR-23 ("`agent_grants` của người bắt đầu" cho **mọi** lần gọi); test-plan-int §2 (không có ca C2), plan-contract.md:153 (ma trận security không có C2) | Quyết định bảo mật đã duyệt nhưng không có test và BA vẫn ghi ngược lại | qc thêm P1-36: stage nhóm, A không có grant agent thành viên ⇒ vẫn chạy; nhóm bị thu entitlement / thành viên tắt lúc `kick` ⇒ needs_decision `permission_lost`; thêm dòng C2 vào ma trận RV1. docs-architect ghi ngoại lệ C2 vào HUB-BR-23 |
| 8 | Cao | A | ba-admin ADM-FR-65, BA-H HUB-FR-104 ("Export/Import JSON qua Import/Export sẵn có", MUST P-a), spec.md:134 ↔ plan/plan-contract/tasks/test-plan (không có) | Yêu cầu MUST P-a không có contract, task, test | **Người dùng quyết (U2)** — mặc định: dời sang P-b, ghi vào spec §1 "Không làm ở P-a" + tag BA |
| 9 | Trung bình | I | tasks.md:26 (B3 "nhóm `ba-team` + 4 agent BA"), plan.md:124 (`agents.yaml` (+4 agent)) ↔ plan-seed.md:19–20, :32 (8 agent vai + `plan-team`/`dev-team`/`test-team`) | Seed lệch giữa task và D18 | Sửa B3 + plan §8 hàng 0c: "8 agent vai + 3 nhóm + giữ `ba-team` (xem plan-seed)". Sửa: backend-lead |
| 10 | Trung bình | H (CR-059) | tasks.md:52 (B8 "+ seed usage dev", File chỉ `processes/usage/**`) | Seed thuộc file Bước 0 (B3) | Bỏ seed usage khỏi B8 (test dùng fixture SQL) hoặc đưa vào B3. Sửa: backend-lead |
| 11 | Trung bình | H | plan-frontend.md:113 (`tools/scripts/src/i18n-check.ts` "ngoài phạm vi frontend-lead") ↔ tasks.md:25 (B0 File không có) | Việc không có chủ | Thêm `tools/scripts/src/i18n-check.ts` vào cột File của B0. Sửa: điều phối (tasks.md) |
| 12 | Trung bình | H | tasks.md:24 (B2 = 0a phụ thuộc B1) ↔ tasks.md:14, plan.md:120, WORKFLOW "0a contract + mock (FE bắt đầu ngay)" | Thứ tự 0a/0b ngược | B2 phụ thuộc QC1; B1 phụ thuộc QC1 (song song B2); B0 phụ thuộc B1+B2. Sửa: điều phối |
| 13 | Trung bình | G | plan.md:120 (mock "cho cả 4 PF"), test-plan.md:187 (N5), plan-frontend.md:133 (#3) | Nội dung mock B2 (persona, id cố định, cổng điều khiển) chưa chốt | Ghi danh sách N5 (6 trạng thái run, 3 notice, usage full/summary, persona A/B/T/H/Adm, `POST /__mock/control`) vào tasks B2. Sửa: backend-lead |
| 14 | Trung bình | I | spec.md:122 (Q4 người dùng chốt "Trưởng nhóm lập kế hoạch"), BA-H HUB-FR-114, AC-H35 ↔ spec.md:153, plan.md:14 (D7 mặc định `sequential` theo spike) | Spike đổi một quyết định người dùng đã chốt | **Người dùng xác nhận (U3)** — mặc định `sequential`, `lead_plan` vẫn chọn được; docs-architect cập nhật Q4/HUB-FR-114/AC-H35 |
| 15 | Trung bình | H | tasks.md:24 (B2 Rủi ro `thường`) | B2 định nghĩa schema `ProcessRunView` access `task` strict (chốt chống rò, R-K04) — chạm quyền | Đổi B2 sang `cao`. Sửa: điều phối |
| 16 | Thấp | F | test-plan-e2e.md:28 (E-P12 bấm Đạt trong DM dùng `ReviewTaskCard` PF1) | Không đánh dấu ⇢PF1 | Ghi ⇢PF1. Sửa: qc |
| 17 | Thấp | D, J | spec.md:74–75, :177; plan.md:91, :98 ("~7 ngày", "~5") | Từ mơ hồ (giá trị thật ở plan-contract.md:9–10) | Ghi "7 ngày (`PROCESS_RUN_TTL_DAYS`)", "5 (`PROCESS_RUNS_PER_TENANT`)". Sửa: docs-architect / backend-lead |
| 18 | Thấp | I | spec.md:43 ("X2b-2 → spike P → P-a") ↔ spec.md:126 (Q8 2026-10-10: P-a trước X2b-2) | Thứ tự mốc lệch | Sửa dòng 43 theo Q8. Sửa: docs-architect |
| 19 | Thấp | I | BA-H §8 `review_tasks` (`assignee_user_id`, `forward_chain` jsonb, kind review\|ask) ↔ plan.md:37–38 (`review_task_assignees`, kind + `decision`) | Mô hình BA cũ | docs-architect ghi "chốt ở plan P-a §2". |
| 20 | Thấp | E | ba-admin ADM-FR-65 (cột "Group được chạy", "run gần nhất") ↔ plan-frontend-admin.md:10, :45 | "run gần nhất" không có, không ghi trong bảng lệch | Thêm vào plan-frontend-admin §3 (P-b). Sửa: frontend-lead |
| 21 | Thấp | I | usecases-chat CHAT-AC-58 ("người duyệt" thấy token theo lần gọi) ↔ spec.md:166 (C5 đã chấp nhận: ngoài phòng chỉ tổng) | AC chưa ghi C5 | docs-architect ghi chú C5 vào CHAT-AC-58 (cùng lượt sửa F4) |
| 22 | Thấp | C (bảo mật) | plan.md:39 (`process_notices` INSERT theo tenant) | Mọi user cùng tenant ghi được notice cho người khác ở tầng RLS (chỉ code app chặn) | Giữ; RV1 kiểm không có route nào cho user tự chèn notice. Sửa: reviewer |
| 23 | Thấp | H | tasks.md (không có cột "Feature/nhánh"; dùng tiêu đề mục) | WORKFLOW CR-059 yêu cầu cột | Chấp nhận tiêu đề mục làm cột; hoặc thêm cột. Điều phối |
| 24 | Thấp | I | plan.md 30 480 B | Còn 240 B tới trần | Mọi bổ sung (#1–#3, #6) ghi vào plan-contract.md hoặc phụ lục mới `plan-pf.md` |

## Mâu thuẫn giữa tài liệu
- plan §4/§3.2 + contract §7 (PF1 mở ask) ↔ tasks B6b (PF2) ↔ test-plan N2 (port không tồn tại) → giữ **PF1** (#1).
- UC-12 CHAT-AC-52 "thread hiện từng stage" + BA-H HUB-FR-113 "(trong thread)" + mockup ④ ↔ plan D13 / plan-frontend FD5 (thẻ + pane, không thread) → giữ plan; người dùng xác nhận F4 (U1), docs-architect sửa AC-52 + FR-113.
- BA-H HUB-BR-23 (grant mọi lần gọi) ↔ spec C2 (đã chấp nhận) → giữ C2, ghi ngoại lệ vào BA (#7).
- spec Q4 / BA HUB-FR-114 / AC-H35 (lead_plan mặc định) ↔ plan D7 (sequential) → xác nhận U3 (#14).
- plan-seed D18 (sdlc 8 giai đoạn, 8 agent vai, 3 nhóm) ↔ tasks B3 + plan §8 "+4 agent BA" → giữ D18 (#9). "5 stage" không còn ở spec/plan/test-plan (đã kiểm), CR-056/ROADMAP không ghi số giai đoạn.
- spec §1 thứ tự mốc ↔ Q8 → giữ Q8 (#18).
- BA §8 `review_tasks` ↔ plan §2 → giữ plan (#19).

## Câu hỏi cho người dùng (chỉ những gì KHÔNG có mặc định an toàn)
1. **U1 · F1–F4** (plan-frontend §11): F1 khởi chạy chưa nhận tệp đính kèm ở P-a (hoá đơn mẫu dùng văn bản) · F2 "Chờ tôi kiểm" luôn hiện khi bật · F3 KPI + chuỗi giai đoạn danh sách admin dời P-b · F4 bỏ thread, dùng thẻ run + pane (sửa CHAT-AC-52, HUB-FR-113, lệch mockup ④). Mặc định: **chấp nhận cả 4**.
2. **U2 · Import/Export JSON quy trình** (ADM-FR-65, HUB-FR-104 MUST P-a; chưa có trong plan/task/test). Mặc định: **dời P-b** (giống F3).
3. **U3 · Chế độ nhóm mặc định** — spike đổi Q4 từ "Trưởng nhóm lập kế hoạch" sang `sequential`. Mặc định: **`sequential`**, `lead_plan` vẫn chọn được.
4. **U4 · Xác nhận M1–M6** (Luật 2 ở spec §9, chưa được người dùng duyệt), hai điểm bảo mật: M4 — người ngoài phòng xem lại phần task của mình **không hết hạn** sau khi run kết thúc; M5/Q2 — thành viên Group duyệt ngoài phòng được "Cần người quyết" khi lý do `redo_limit` (chạy tiếp bằng quota người bắt đầu). Mặc định: **chấp nhận như spec**.

Đội tự đóng theo Luật 2 (ghi vào spec §9 / test-plan): QC Q1, Q3–Q7 (khớp contract §3, BA-BR-24, HUB-FR-104); N1, N6, N7; yêu cầu backend của plan-frontend #1 `process_key`, #2 `open_count`, #4 `StageView.sections` (đều giữ mặc định: lọc client, "50+", P-b).

## Checklist
| Mục | Kết quả | Bằng chứng (file:dòng / mã) |
|-----|---------|-----------------------------|
| A Phạm vi | Thiếu | spec.md:35–45 (làm/không làm, mã); thiếu Import/Export ADM-FR-65 (#8) |
| B Hợp đồng | Thiếu | plan-contract.md §3–§6 đủ method/path/quyền/schema/mã lỗi/phân trang/409; thiếu assignee + dữ liệu task `decision` (#2) |
| C Dữ liệu | Đạt | plan.md:26–51 (bảng, cột, null/default, index, FK, RLS T, GRANT, CHECK audit), migration 0019; seed plan-seed.md |
| D Nghiệp vụ | Thiếu | plan.md §3 máy trạng thái, §4 giới hạn, §10 khoá; mơ hồ "~" (#17); ai quyết task decision (#2) |
| E UI | Đạt | plan-frontend.md §2–§8 (trạng thái tải/rỗng/lỗi/404), plan-frontend-i18n.md (VI/EN nguyên văn), plan-frontend-admin.md §3 lệch mockup; cần U1 cho F1–F4 |
| F Kiểm chứng | Thiếu | test-plan.md §3 phủ mọi mã P-a; thiếu ca C2 (#7), phạm vi cổng merge (#5), seam test (#6) |
| G Phụ thuộc & môi trường | Thiếu | spec.md:90–96 (fake-cli, mock Dify H2a), cờ `HUB_PROCESS_ENGINE` plan.md:22; nội dung mock B2 chưa chốt (#13) |
| H2 Vai trò | Đạt | spec §3–§5 trỏ plan/plan-frontend (không còn ô trống); chữ ký luật thuần plan-contract.md:94–150; test-plan có mọi FR MUST |
| H Task | Thiếu | tasks.md có File/Phụ thuộc/Lệnh xong/Rủi ro; lỗi #1, #9–#12, #15 |
| I Nhất quán | Mâu thuẫn | xem "Mâu thuẫn giữa tài liệu" |
| J Độ chính xác | Thiếu | symbol có sẵn đã Grep: `RunService.launch(…, {driver})` runs.service.ts:267, `createRunTx` create-run.ts:127, `withConfigWrite` studio-write.ts:32, `PROTECTED_PREFIXES` app.ts:90, `parseFields`, `routeRoomMessage`, `directOnSnapshot`, `runJob` job-agent-runner.ts:278, `done-x2b.ts`, FE `SuggestMenu`/`FlowFrame`/`PersonPicker`/`AskCard`/`NotFoundState`/`EditorSaveBar`/`ConflictEntity` — có thật; thiếu chữ ký seam (#6) |

## Quét từ mơ hồ
≈ 70 kết quả; phần lớn là "…" trong chuỗi UI rút gọn (nguyên văn đủ ở plan-frontend-i18n.md, ví dụ :73, :146, :175) hoặc tên dải mã ("CR-056…058") — vô hại. Ghi thành lỗ hổng: "~7 ngày", "~5" (#17). "tuỳ chọn" (spec.md:162, nhãn "(tuỳ chọn)") = trường không bắt buộc, vô hại.

## Chưa kiểm
- spike.md chỉ đọc phần Khuyến nghị (đầu vào plan D7–D9, không phải yêu cầu P-a).
- plan-frontend-i18n.md đọc chọn lọc (Grep các chuỗi được trỏ); không đối chiếu từng khoá vi/en.
- ui-admin §7.17, ui-agent-studio §15 và mockup canvas không mở (plan-frontend-admin §3 đã liệt kê lệch; studio là P-b).
