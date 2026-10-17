# P-d-durable · Tiêu chí nghiệm thu + test khoá bị ảnh hưởng

Phần §8 của [`spec.md`](spec.md). AC gốc: BA [`ba-agent-hub.md`](../../design/agent-hub/ba-agent-hub.md) §11 AC-H39…H46 (AC-H38 đã được X2b2 spec Q14 đề xuất giữ chỗ ⇒ bắt đầu từ AC-H39). Ca chi tiết do qc viết ở `test-plan.md` khi PLAN.

## 1. AC
| AC | Lát | Given / When / Then | Test |
|---|---|---|---|
| AC-H39 | P-d1 | Job stage `UPSTREAM_ERROR` ×3 rồi thành công ⇒ chạy lại sau 30 s / 2' / 8' (đồng hồ giả), `retry_count` 1→3, `attempt` = 1, stage đi tiếp. Lỗi lần 4 ⇒ `needs_decision` `retry_exhausted`; `add_attempt` ⇒ `retry_count` 0, chạy ngay. Hub sập giữa bước (`interrupted`) ⇒ thử lại, không `needs_decision` ngay. Cùng ca với stage `team` (Q1) | int engine |
| AC-H40 | P-d1 | `NOT_CONFIGURED` / `template_invalid` / quota hết / mất quyền ⇒ `needs_decision` ngay, `retry_count` 0. Stage `real_action` đã gửi tool `side_effect` rồi `TIMEOUT` ⇒ không thử lại, tool gọi đúng 1 lần. Mã lạ ⇒ không thử lại | int |
| AC-H41 | P-d1 | Stage `wait_until` = `fields.ngay_het_han` (stage trước) − 3 ngày, 09:00 `Asia/Ho_Chi_Minh` ⇒ `due_at` đúng; run `waiting_timer`, không tính trần (tenant có 5 run `running` vẫn bắt đầu được run thứ 6 khi 1 run đang `waiting_timer`); khởi động lại app giữa chừng; tới hạn ⇒ stage `done` + output .md, bước kế chạy **một lần** (2 instance `sweepOnce` song song). Thiếu ngày / quá `expires_at` ⇒ `timer_invalid`. Lưu def `wait_until` với `after=review` ⇒ 422 `WAIT_INVALID` | int + rules |
| AC-H42 | P-d1 | `remind_every_h=4`, `escalate={after_h:24, group_id:G2}` ⇒ nhắc lúc 4, 8, … giờ (≤ 10), tại 24 giờ G2 được thêm `via=escalated`, notice `escalated`, audit; G1 vẫn quyết được; chuyển cấp 1 lần; không tự Đạt. Không cấu hình ⇒ đúng 1 lần nhắc sau 24 h (R-N02, P3-04 không đổi). Người G2 ngoài phòng: chỉ phần task (HUB-BR-25). Forward từ người G2 sang người G1 ⇒ `FORWARD_OUT_OF_GROUP`. `escalate.group_id` = Group duyệt hoặc tenant khác ⇒ 422 | int + e2e |
| AC-H43 | P-d1 | Def `ttl_days=null` ⇒ run chờ duyệt 8 ngày không `expired`; def cũ (cột = 7) ⇒ `expired` sau 7 ngày (như P-a); PATCH `ttl_days` không đổi `expires_at` run đang chạy | int |
| AC-H44 | P-d2 | Stage `tool` gọi workflow catalog (mock Dify) với tham số từ input + field ⇒ gọi bằng người bắt đầu, `fields` lưu, file .md có `## Kết quả` + `## Bàn giao`; `fields` sai kiểu ⇒ `template_invalid`; tool `side_effect` ở stage không `real_action` ⇒ 422 `TOOL_SIDE_EFFECT`; tool `side_effect` lỗi sau khi gửi ⇒ `tool_failed`, không gọi lại; tool tenant không được bật ⇒ 422 `TOOL_INVALID` | int + contract |
| AC-H45 | P-d2 | Bước 2 luật `tong_tien gt 20000000 ⇒ goto_step 3` (UI "bước 4"): `25000000` ⇒ stage bước 3 (UI) `skipped`, bước 4 chạy, tin thread + audit `branch`; `1000` ⇒ chạy tuần tự. Quay lại bước 2 ⇒ stage `skipped` về `pending`. `goto_step` ≤ bước hiện tại / stage trong bước song song ⇒ 422 `BRANCH_INVALID` | int + rules |
| AC-H46 | cả hai | Hẹn giờ + chuyển cấp của tenant A và B tới hạn cùng lượt ⇒ mỗi hàng chỉ đổi dữ liệu đúng tenant; `hub_rw` tenant B `SELECT process_timers` ⇒ 0 hàng của A; FK kép từ chối `stage_run_id` tenant khác. Cùng khuôn với regression `scanDue` P-c2 | int (RLS) |
| — | cả hai | e2e: panel stage (executor "Chờ tới ngày", "Gọi tool", nhắc/chuyển cấp, rẽ nhánh, thời hạn) lưu + tải lại; StageStrip nhãn mới | Playwright |

## 2. Test khoá bị ảnh hưởng (việc của **qc**; agent khác không sửa — `tests/.lock`)
Theo Intake (D4: thử lại áp cho mọi def ⇒ các test kỳ vọng "lỗi ⇒ `needs_decision` ngay" phải đổi thành "hết N lần thử mới `needs_decision`").

| Test | Vì sao | Hướng sửa (qc quyết) |
|---|---|---|
| P1-25, P1-26, P1-28 · `tests/acceptance/P-a/pf1/stage.int.test.ts` | job lỗi/timeout/`interrupted` ⇒ `needs_decision` ngay | lỗi tạm: hết 3 lần thử (đồng hồ giả) mới `needs_decision` `retry_exhausted` |
| PI-14 · `tests/acceptance/P-b2/par/parallel.int.test.ts:285` | stage song song lỗi ⇒ `needs_decision` | như trên |
| R-S18 · `tests/acceptance/P-a/step0/rules/process-state.test.ts:239` | luật thuần `interrupted` ⇒ needs_decision | thêm nhánh thử lại theo `retry_count` |
| TM-06, TM-08 · `tests/acceptance/P-b/pfs4/**` | lỗi thành viên nhóm ⇒ `agent_failed` | TM-08 (`not_configured`) giữ (nghiệp vụ); TM-06 theo Q1 |
| `P-a/step0/rules/contracts-pa.test.ts:153, 163` | so khớp nguyên mảng enum | thêm giá trị cuối mảng |
| `P-c2/rules/contracts-pc2.test.ts:119, 122, 245` | ″ | ″ |
| `P-b2/rules/contracts-pb2.test.ts:135, 149, 173` | ″ (`DECISION_REASONS`, `PROCESS_DEF_RULES`) | ″ |
| `P-c/rules/contracts-pc.test.ts:81` | ″ | ″ |
| R-N02 (`pf3/rules/notify`), P3-04 (`pf3/reminder`) | **giữ nguyên** nhờ mặc định "không cấu hình ⇒ nhắc 1 lần" (D9) | không sửa; chạy lại để xác nhận |

Sau khi sửa: `bun run test:lock:verify` + relock; chạy lại `done:pa`, `done:pb`, `done:pb2`, `done:pc`, `done:pc2`.
