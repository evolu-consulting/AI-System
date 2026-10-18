# Quyết định đã chốt · P-d-durable

Nguồn: Intake Đầy đủ GĐ1 platform, người dùng chốt cả 15 mặc định (2026-10-17) · [ADR-0017](../../adr/0017-durable-process-engine.md) (Proposed) · spike `spikes/engine/engine.spike.test.ts` · CR-083…CR-087.

| # | Quyết định | CR |
|---|---|---|
| D1 | Viết spec `draft` ngay; ADR-0017 Accepted là điều kiện Gate GĐ1. | — |
| D2 | Lỗi tạm = TIMEOUT, UPSTREAM_ERROR, lỗi mạng, 429/provider bận, `interrupted` (sập giữa bước). Lỗi nghiệp vụ = template_invalid, quota hết, NOT_CONFIGURED, permission_lost/user_inactive, giới hạn token/team, autofix/apply. | CR-083 |
| D3 | Bộ đếm riêng `retry_count`, tối đa 3 lần, backoff 30 s → 2 phút → 8 phút; hết lượt ⇒ `needs_decision` lý do mới `retry_exhausted` (thêm cuối mảng); `attempt_limit` giữ nghĩa làm lại do góp ý. | CR-083 |
| D4 | Áp thử lại cho mọi def (cả cũ); qc sửa P1-25/26/28, PI-14 thành "hết N lần mới needs_decision". | CR-083 |
| D5 | `process_defs.ttl_days` nullable, chốt vào snapshot; def cũ = 7; null = không hết hạn. | CR-086 |
| D6 | Run ở trạng thái chờ hẹn giờ KHÔNG tính vào trần 5 run/tenant; running/waiting_review vẫn tính. | CR-084 |
| D7 | `wait_until` lấy ngày tuyệt đối từ input hoặc `output.fields.<date>` của bước trước ± offset ngày; múi giờ theo tenant (mặc định Asia/Ho_Chi_Minh). **Đã xác nhận (2026-10-17, readiness câu 2): cột `admin.tenants.timezone` theo tenant ngay ở GĐ1** — không dùng hằng ([spec-tz-tools §1](spec-tz-tools.md)). | CR-084 |
| D8 | Chuyển cấp: thêm Group mới vào task, Group cũ vẫn giữ quyền; luật chuyển tay vẫn chỉ cùng Group; mỗi task chuyển cấp tối đa 1 lần; audit + security review. | CR-085 |
| D9 | Nhắc lặp: không cấu hình ⇒ nhắc 1 lần sau 24 h như cũ (giữ R-N02, P3-04); cấu hình thì N ≥ 4 h, tối đa 10 lần nhắc mỗi task. | CR-085 |
| D10 | Executor tool: chỉ tool trong Hub `/mcp` (workflow catalog + tool của gói đăng ký theo ADR-0018), chạy bằng token người bắt đầu; tool side_effect chỉ sau gate (`real_action`); không tự gọi lại sau khi đã gửi. **Bổ sung 2026-10-17 (readiness câu 3): quyền dùng tool = công tắc riêng theo tenant** (`admin.tenant_workflow_tools`, platform_admin bật/tắt) — thay mặc định #6 ([spec-tz-tools §2](spec-tz-tools.md)). | CR-087 |
| D11 | Output stage tool: `fields` JSON (kiểm theo `output.fields`) + file .md tóm tắt do Hub sinh để giữ P-R03. | CR-087 |
| D12 | Rẽ nhánh: `after.branch` gồm luật trên `output.fields` (= ≠ < ≤ > ≥, không LLM); luật khớp đầu tiên ⇒ nhảy tới bước X > bước hiện tại, bước bị nhảy qua thành `skipped`; không khớp ⇒ bước kế; không quay lui (quay lại vẫn `back_to_steps`). | CR-087 |
| D13 | UI GĐ1: panel stage tối thiểu trong canvas hiện có (không thêm node kiểu mới; canvas đầy đủ ở GĐ3); chat chỉ thêm nhãn trạng thái; cần artboard/mockup trước Gate. | CR-083…087 |
| D14 | `docs/specs/P-d-durable/`, hai lát P-d1 (CR-083…086) và P-d2 (CR-087); bắt đầu sau khi đóng mốc dọn-seed (CR-081). | — |
| D15 | Năm CR theo chủ đề: CR-083…CR-087. | — |

## Cụ thể hoá do docs-architect đặt khi viết spec — **đã chốt 2026-10-17** (người dùng chấp nhận trọn gói, readiness lần 1 câu 1)
| # | Nội dung | Lý do | Chỗ |
|---|---|---|---|
| A1 | Backoff thử lại giữ bằng `process_timers` `kind=retry` (không ngủ trong tiến trình) | bền khi khởi động lại, dùng chung vòng quét | PD-R03, PD-R10 |
| A2 | Mã không rõ / `INTERNAL_ERROR` ⇒ nghiệp vụ (không thử lại) | an toàn: không lặp việc không rõ hậu quả | PD-R02 |
| A3 | Job đã gửi `side_effect` rồi lỗi tạm ⇒ `needs_decision` lý do cũ (không thêm lý do) | D3/D10 "không gọi lại"; tránh thêm enum | PD-R05 |
| A4 | Nhắc lặp + chuyển cấp chạy trong vòng nhắc sẵn có trên `review_tasks` (cột mới), không qua `process_timers` | vòng nhắc đã đạt spike 3a + tải 1.000 task | PD-R19/R20 |
| A5 | Lý do mới `timer_invalid` (ngày thiếu/sai/quá hạn run), `tool_failed` (P-d2) — thêm cuối `DECISION_REASONS` | D3 chỉ nêu `retry_exhausted`; hai tình huống này cần lý do riêng để "Cần người quyết" rõ | PD-R14, PD2-R05 |
| A6 | Kiểu input `date` mới cho process (thêm cuối `INPUT_TYPES`) | D7 "ngày từ input" cần kiểu kiểm được | PD-R13 |
| A7 | Run đang backoff thử lại vẫn `running` (tính trần); chỉ `wait_until` mới `waiting_timer` | backoff ngắn (≤ ~10'), giữ D6 hẹp | PD-R03, Q7 |
| A8 | Dựng lại CHECK để nới enum được coi là "chỉ thêm" | các enum DB là CHECK (tiền lệ 0024) | spec §4 |
| A9 | Tool stage: Hub ép `required_sections = ["Kết quả","Bàn giao"]` | giữ P-R03 + `## Bàn giao` (CR-064) | PD2-R07 |
| A10 | Rẽ nhánh tới bước có `real_action` chỉ khi stage rẽ nhánh là gate review | giữ HUB-BR-20/38(b) khi bước liền trước bị `skipped` | PD2-R12 |
| A11 | Group chuyển cấp không hợp lệ lúc chuyển ⇒ bỏ qua + audit `escalate_skipped`, run không lỗi | không chặn run vì cấu hình người | PD-R20 |
| A12 | Ngưỡng: `escalate.after_h` 4…2160, `remind_every_h` ≤ 168, `ttl_days` ≤ 365, `wait` ≤ 730 ngày, offset ±365 | trần hợp lý, dễ đổi (hằng contract) | spec §3 |

## Câu hỏi (đã chốt 2026-10-17 — không còn câu hỏi mở)
| # | Câu hỏi | Chốt | Mức |
|---|---|---|---|
| Q1 | Thử lại stage `team` ở mức nào? | ✅ Cơ chế readiness #5 (PD-R08): mức thành viên; team-run giữ `running`, dừng tính `active_ms` khi chờ; bắn ⇒ gọi lại thành viên ở `cursor`, không tăng `calls`; khoá idempotency theo `stage_run_id` | Cao |
| Q2 | `ALL_PROVIDERS_EXHAUSTED` là tạm hay nghiệp vụ? | ✅ Bảng readiness #3: hàm thuần `classifyJobError(code, reason)` (PD-R01); không đọc `provider_state` | Cao |
| Q3 | Nguồn múi giờ tenant? | ✅ **Bỏ khỏi câu hỏi mở** — người dùng chọn cột `admin.tenants.timezone` ngay ở GĐ1 (D7, [spec-tz-tools §1](spec-tz-tools.md)) | — |
| Q4 | Giờ trong ngày của `wait_until`? | ✅ `09:00` giờ tenant (đọc lúc lưu hẹn giờ), cấu hình được theo stage | Thấp |
| Q5 | Rẽ nhánh ở stage thuộc bước song song? | ✅ Không cho (PD2-R10) | Cao |
| Q6 | Trần tham số/kết quả tool? | ✅ ≤ 20 tham số; kết quả JSON ≤ 64 KB | Thấp |
| Q7 | Run đang chờ backoff thử lại có tính trần 5? | ✅ Có (run vẫn `running`); chỉ `wait_until` mới `waiting_timer` | Thấp |

## Trả lời readiness lần 1 · 2026-10-17
Người dùng trả lời 4 câu của [`readiness.md`](readiness.md) "Lần 1":

| Câu | Trả lời | Áp vào |
|---|---|---|
| 1 | Chấp nhận trọn gói: A1–A12, Q1 (#5), Q2 (#3), Q4–Q7, mặc định #4, #7–#18, #20–#26 | bảng "Mặc định readiness đã áp" dưới |
| 2 | **Thêm cột múi giờ theo tenant ngay ở GĐ1** (IANA, mặc định `Asia/Ho_Chi_Minh`, kiểm bằng `Intl.supportedValuesOf('timeZone')`, platform_admin sửa ở màn tenant). `wait_until` + giờ 09:00 tính theo múi giờ tenant đọc **lúc lưu hẹn giờ** (chốt vào `due_at` UTC) | D7, Q3 bỏ, ADM-FR-72, AC-A14, [spec-tz-tools §1](spec-tz-tools.md), PD-R13, tasks T6a/T11 |
| 3 | **Quyền gọi tool = công tắc riêng theo tenant** (thay #6) | D10, ADM-FR-73, HUB-FR-146 sửa, AC-A15, AC-H47, [spec-tz-tools §2](spec-tz-tools.md), PD2-R01/R03/R05, tasks T18a/T18/T20 |
| 4 | Mockup: frontend-lead tự dựng trong T2/T14, duyệt ở Gate | tasks D0c |

### Mặc định readiness đã áp (chỗ trong spec)
| # | Nội dung ngắn | Chỗ |
|---|---|---|
| 3 | `classifyJobError(code, reason)` | PD-R01, PD-R02 |
| 4 | Nguồn cờ "đã gửi side_effect" | PD-R05 |
| 5 | Retry stage team mức thành viên | PD-R08 |
| 7 | Trường bắt buộc stage `wait_until`/`tool` | PD-R17, PD2-R07 |
| 8 | `ExecutorRef` executor mới | spec §3 |
| 9 | Hậu tố `:<n>` cho `idempotency_key` | PD-R10 |
| 10 | Thứ tự khoá run → stage → timer | PD-R11 |
| 11 | RLS ENABLE, không FORCE | spec §4 |
| 12 | Nới CHECK audit / thread / `HistoryItem.kind` | spec §3, §4; spec-d2 §5 |
| 13 | Không tồn tại / khác tenant ⇒ `PROCESS_REF_INVALID` | PD-R23, PD2-R01 |
| 14 | `timer_invalid` vào `FORCE_USE_CURRENT`; `tool_failed` cần output | PD-R14, PD2-R05 |
| 15 | "Bước trước" = mọi bước nhỏ hơn | PD-R13, PD2-R02 |
| 16, 30 | Value input `date` + kiểm ngày lịch | PD-R13 |
| 17 | AC-H41 trần 4+1 / 5+1 | spec-ac AC-H41 |
| 18 | Gate P-d1 cần ADR-0017; P-d2 cần ADR-0022 hoặc cách gọi workflow hiện có | spec §7, tasks T4/T16 |
| 20 | Thứ tự ưu tiên trạng thái run | PD-R15 |
| 21 | `remind_count` khi không cấu hình; trễ ≤ 1 chu kỳ | PD-R18 |
| 22 | Test khoá bổ sung | spec-ac §2 |
| 23 | `ttl_days` import/export: không áp (code chưa có, D-PD13); `timezone` tenant vẫn export/import | PD-R24, spec-tz-tools §1 |
| 24 | Regex `time`, câu .md nguyên văn | PD-R13, PD-R15 |
| 25 | Sửa tham chiếu `gates/forward*` | tasks T9 |
| 26 | Ghi `usage_logs`/`runs` cho tool ngoài job | PD2-R09 |
| 27–29 | BA AC-H38 giữ chỗ; frontmatter; AC-H45 đánh số bước | BA §11, spec frontmatter, spec-ac |

### Cụ thể hoá thêm khi áp câu 2–3 (docs-architect đặt — spec-readiness lần 2 xác nhận)
| # | Nội dung | Lý do |
|---|---|---|
| B1 | Bảng công tắc ở schema **`admin`** (`admin.tenant_workflow_tools`), không ở `hub` | catalog `admin.workflows` + quyền ghi (Admin) ở `admin`; mẫu `feature_entitlements` (PK kép, `revoked_at`, RLS `admin_rw` theo tenant, `hub_ro` SELECT) |
| B2 | Màn Admin: **cột `timezone` ở form Thông tin** của chi tiết tenant; **tab mới "Tool quy trình"** trong `TenantDetailPage` (cạnh Features/Agents/Quota) | pattern tab hiện có của `features/tenants`; màn tenant chỉ `platform_admin` |
| B3 | `tenant_admin` **không** vào màn tenant; xem múi giờ chỉ-đọc ở panel "Chờ tới ngày" của editor quy trình và thấy danh sách tool đã bật ở chọn tool | màn tenant hiện chặn tenant_admin (403 trong khung) |
| B4 | Tắt công tắc / workflow `enabled=false` lúc chạy ⇒ `tool_failed`; người bắt đầu mất quyền chạy quy trình / bị khoá ⇒ `permission_lost` / `user_inactive` như cũ | câu 3: "tắt công tắc ⇒ `tool_failed`"; giữ nghĩa cũ của lý do quyền người |
| B5 | Hub đọc công tắc + `enabled` **trực tiếp DB lúc gọi** (không cache) | tránh cửa sổ 5 s của ADM-NFR-02 khi tắt khẩn |
| B6 | Export/import yaml (ADM-FR-54): tenant thêm `timezone`; công tắc tool **không** export ở GĐ1 | giữ phạm vi nhỏ; dễ thêm sau |
| B7 | Đổi `timezone` không tính lại hẹn giờ đã lưu (đã chốt `due_at` UTC) | câu 2 "đọc lúc lưu hẹn giờ" |

## Quyết định từ PLAN + readiness lần 2 (Luật 2b, 2026-10-17)
Nguồn đầy đủ: [plan.md §0](plan.md), [plan-d2.md §1](plan-d2.md), [plan-frontend.md §0](plan-frontend.md). Ghi lại để spec không lệch plan.
| # | Quyết định | Chỗ spec |
|---|---|---|
| D-PD02 | `retry_count` reset ngầm: lưu `retry_attempt/retry_round`; hiệu lực khi khớp `(attempt, round)`, khác ⇒ 0 | PD-R06, spec §4 |
| D-PD04 | `add_attempt` của `retry_exhausted`/`timer_invalid` **giữ `attempt`** (như `ask_limit`); `tool_failed` ⇒ như `agent_failed` (attempt+1) | PD-R04, PD-R14 |
| D-PD07 | `process_timers.timezone` lưu IANA lúc lưu hẹn `wait_until` (hiển thị + câu .md không đọc lại tenant) | spec §4 |
| D-PD09 | Hẹn `due_at ≤ now` vẫn ghi hàng hẹn, bắn ở lượt quét kế (≤ 3 s) | PD-R14 |
| D-PD10 | Thêm vòng nhắc production `startProcessReminder` (300 s) — hiện `remindOnce` không có vòng thật | PD-R18 |
| D-PD11 | Editor đọc múi giờ (P-d2: tool khả dụng) qua `GET /process-editor/context` | spec-tz-tools §1 |
| D-PD13 | Không có export/import def trong code ⇒ bỏ vế đó của PD-R24 | PD-R24 |
| D2-05 | `template_invalid` ở stage `tool` ⇒ `needs_decision` ngay (tự làm lại = gọi tool lần nữa) | PD2-R06 |
| D2-06 | Quy trình **mẫu** (tenant null) không chứa stage `tool` ⇒ 422 `PROCESS_REF_INVALID` `ref:"tool"` | PD2-R01 |
| D2-07 | Tham số workflow kiểu `file` ⇒ 422 `TOOL_INVALID` (GĐ1 không truyền file) | PD2-R02 |
| D2-08 | "Bước liền trước có hiệu lực" = bước gần nhất không toàn `skipped` | PD2-R12 |
| Retry team | `lead_plan` có plan ⇒ chạy tiếp từ `cursor`; chưa có plan ⇒ gọi lại lead, không đếm `calls`. `parallel_merge` ⇒ gọi lại cả lượt, không đếm `calls` (tốn token — báo ở Gate) | PD-R08 |
| FD1–FD11 | UI giữ pattern cũ, không thư viện/component shadcn mới; panel `wait_until` theo mẫu `apply` (`StageWait.tsx`); validate live bằng `processDefStageIssues` (contract); `waiting_timer` = "Đang chờ hẹn", chấm vòng rỗng + icon (không chỉ màu); ngày hẹn theo `wait.timezone` lúc lưu; nhãn nút quyết theo lý do (`retry_exhausted` "Thử lại ngay", `timer_invalid` "Tính lại ngày hẹn"/"Bỏ chờ, đi tiếp"); domain web hai bản admin/chat có test khớp contract; quy trình mẫu dùng được "Chờ tới ngày", ẩn "Gọi tool" | spec §6 |
| VALIDATION_ERROR | **400** (contract `common.ts:210`) thay 422 cho input `date` sai, `timezone` sai, ngưỡng `escalate`/`remind_every_h` sai | PD-R13/R23, TZ-R02, AC-H41, AC-A14 |
| Audit công tắc | `entity:"workflow"`, `action:"grant"/"revoke"`, `tenant_id`, before/after `{on}` (không thêm enum audit) | TT-R03, AC-A15 |

**Báo người dùng ở Gate (không hỏi):** vòng nhắc production bật lần đầu nhắc ngay các task cũ quá hạn; retry `parallel_merge` gọi lại cả lượt nên tốn token.

## Quyết định trong lúc làm (Luật 2, sau Gate)
- (chưa có)

## Trả lời readiness lần 2 · 2026-10-17
- **ADR-0017 (điều kiện Gate P-d1):** người dùng chọn **chờ staging** — Accepted chỉ sau spike trên Redis thật + bài tải 10.000 run trên staging. Dựng staging/deploy là việc ra ngoài, hỏi người dùng trước. Câu hỏi mở về ADR-0017 ở spec §9 coi như đã trả lời.
- **ADR-0017 Accepted (2026-10-17, người dùng chốt sau staging N=10.000, Redis thật):** phương án (a); điều kiện sửa TECH-DEBT #190 (nhắc trùng nhiều Hub) ở T9 kèm int test hai Hub. ADR đã sửa câu `attempt_limit` theo D3. Điều kiện Gate D0a đóng.
- **Mockup (D13):** người dùng **duyệt** mockup/01–04 ngày 2026-10-17 (điều kiện Gate số 2 đạt).
- **CR-093 (2026-10-17, người dùng chốt):** vòng nền nhắc/hết hạn xử lý theo tập; NFR lô 100 p95 ≤ 50 ms, 10.000 nhắc ≤ 6 s, 20.000 hết hạn ≤ 12 s ⇒ `plan-addendum` A10, `test-plan-addendum` §2 (PD-P10…P15), T9/T10.

## Trả lời readiness lần 5 (Luật 2b, 2026-10-17)
Không hỏi người dùng: mọi mục có mặc định (CR-093 người dùng chốt, mới hơn spec-ca). Đã áp:
- **#81 (Cao):** port `UnitOfWork.systemBatch(fn)` chỉ cho vòng nền theo tập; repo lô mang `tenant_id` (`claimDueReminders`, `markRemindedMany`, `claimDueEscalations`, `NoticeWriter.insertMany`, `RunRepo.claimExpired`, `Notifier.runsFinished(ids)` không `Tx`); K3 lô; test 2 tenant qua use case thật (AC-H46); T6c review cả `systemBatch` ⇒ plan-addendum A11, A10, spec-ca CA-R06/§4/§7, tasks T6b/T6c.
- **#82 (Cao):** NFR đo cả lời gọi `remindOnce`/`sweepOnce` (gồm Redis, các phần quét khác); 10.000/20.000 = tổng lời gọi liên tiếp tới khi xả hết ⇒ plan-addendum A10, test-plan-addendum §2.
- **#83:** CR-093 đưa lệnh perf P-d `PERF=1 bun --env-file=.env.local --config=bunfig.perf.toml test tests/acceptance/P-d/perf/` vào **Lệnh xong T9/T10** — ngoại lệ của câu CLAUDE.md "`test:perf` không thuộc Lệnh xong" (CLAUDE.md không sửa) ⇒ tasks T9/T10, A10.
- **#84** index `unread` dùng `process_notices_unread_idx` (0019), không DDL ⇒ A10, plan-db §5 · **#85** cột Đọc T9/T10 thêm A9–A11 · **#86** ADR-0017 "T7" ⇒ "T10" · **#87** `remindOnce` = một lượt xả nhiều lô, trả tổng ⇒ A9 · **#88** chuyển cấp theo tập; lịch nhắc tính bằng luật lớp 1 rồi `update … from unnest` ⇒ A10 · **#89** T6 thêm `process_timers` vào `packages/db/src/hub-rls.int.test.ts` (cột File) · #74 sửa A8.
- **TC1–TC18:** mặc định ghi ở test-plan-addendum §3; test-plan-int sửa TC1, TC2 (fixture), TC3, TC4, TC7, TC14. Không sửa `tests/**`.
- **Trả lời readiness lần 6 (Luật 2b, 2026-10-18):** #90 notice `run_finished` chèn trong tx `systemBatch` (một câu `insert … select` + `unread`), Redis sau COMMIT (A10/A11); #94 thứ tự nạp người nhận → luật lớp 1 → áp (A10); #92 Lệnh xong T9/T10 = `bun run test:perf:pd` (script thêm ở T9, chạy được trên PowerShell); #91 `tenant({tenantId, userId}, fn)` theo plan §3 + PD-I73; #93 T12 đọc thêm A11.
- **Review T12 #5 (2026-10-18):** nhắc lặp sau khi Hub ngừng lâu sẽ đuổi kịp (mỗi lượt +1 lần) — đúng PD-R19 (`remind_at += N`, dừng ở REMIND_MAX = 10) nên giữ; không đổi sang max(remindAt+N, now+N).
