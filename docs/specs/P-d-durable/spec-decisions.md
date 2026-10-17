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
| D7 | `wait_until` lấy ngày tuyệt đối từ input hoặc `output.fields.<date>` của bước trước ± offset ngày; múi giờ theo tenant (mặc định Asia/Ho_Chi_Minh). | CR-084 |
| D8 | Chuyển cấp: thêm Group mới vào task, Group cũ vẫn giữ quyền; luật chuyển tay vẫn chỉ cùng Group; mỗi task chuyển cấp tối đa 1 lần; audit + security review. | CR-085 |
| D9 | Nhắc lặp: không cấu hình ⇒ nhắc 1 lần sau 24 h như cũ (giữ R-N02, P3-04); cấu hình thì N ≥ 4 h, tối đa 10 lần nhắc mỗi task. | CR-085 |
| D10 | Executor tool: chỉ tool trong Hub `/mcp` (workflow catalog + tool của gói đăng ký theo ADR-0018), chạy bằng token người bắt đầu; tool side_effect chỉ sau gate (`real_action`); không tự gọi lại sau khi đã gửi. | CR-087 |
| D11 | Output stage tool: `fields` JSON (kiểm theo `output.fields`) + file .md tóm tắt do Hub sinh để giữ P-R03. | CR-087 |
| D12 | Rẽ nhánh: `after.branch` gồm luật trên `output.fields` (= ≠ < ≤ > ≥, không LLM); luật khớp đầu tiên ⇒ nhảy tới bước X > bước hiện tại, bước bị nhảy qua thành `skipped`; không khớp ⇒ bước kế; không quay lui (quay lại vẫn `back_to_steps`). | CR-087 |
| D13 | UI GĐ1: panel stage tối thiểu trong canvas hiện có (không thêm node kiểu mới; canvas đầy đủ ở GĐ3); chat chỉ thêm nhãn trạng thái; cần artboard/mockup trước Gate. | CR-083…087 |
| D14 | `docs/specs/P-d-durable/`, hai lát P-d1 (CR-083…086) và P-d2 (CR-087); bắt đầu sau khi đóng mốc dọn-seed (CR-081). | — |
| D15 | Năm CR theo chủ đề: CR-083…CR-087. | — |

## Cụ thể hoá do docs-architect đặt khi viết spec (chưa được người dùng duyệt — spec-readiness xác nhận)
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

## Câu hỏi mở (mặc định đề xuất do docs-architect đặt — spec-readiness xác nhận)
| # | Câu hỏi | Mặc định | Mức |
|---|---|---|---|
| Q1 | Thử lại stage `team` ở mức nào? | Mức job thành viên, chung `retry_count` stage, không tính `max_calls`/`max_active_s` (PD-R08) | Cao |
| Q2 | `ALL_PROVIDERS_EXHAUSTED` là tạm hay nghiệp vụ? | Theo `provider_state`/lý do job: `busy`/`cooldown`/`provider_busy`/`tenant_slots` = tạm; quota/`logged_out`/`error` = nghiệp vụ; backend-lead chốt bảng ánh xạ | Cao |
| Q3 | Nguồn múi giờ tenant? | Hằng `Asia/Ho_Chi_Minh`; cột theo tenant ở Admin để GĐ sau | Thấp |
| Q4 | Giờ trong ngày của `wait_until`? | `09:00` giờ tenant, cấu hình được theo stage | Thấp |
| Q5 | Rẽ nhánh ở stage thuộc bước song song? | Không cho (spec-d2 PD2-R10) | Cao |
| Q6 | Trần tham số/kết quả tool? | ≤ 20 tham số; kết quả JSON ≤ 64 KB | Thấp |
| Q7 | Run đang chờ backoff thử lại có tính trần 5? | Có (run vẫn `running`); chỉ `wait_until` mới `waiting_timer` | Thấp |

## Quyết định trong lúc làm (Luật 2, sau Gate)
- (chưa có)
