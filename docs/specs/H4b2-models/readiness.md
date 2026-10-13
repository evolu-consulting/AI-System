# Readiness — H4b-2 Models + Quyền agent

## Lần 1 — 2026-10-13 · NOT READY
spec-readiness đọc spec, plan, plan-frontend, tasks, test-plan, test khoá (6e9a1769). 32 lỗ hổng: 2 Chặn, 14 Cao, 16 Thường. Mọi lỗ hổng có mặc định đề xuất, áp dụng nguyên văn trừ #1.

- **#1 (Chặn) — người dùng trả lời 2026-10-13: "Không dự phòng".** Agent có model riêng (`agent.model`, CR-054) thì **không** chuyển bước: `pickStep` chỉ xét bước 0; bước 0 không dùng được ⇒ hành vi như hiện nay khi provider bị chặn (job chờ/báo lỗi theo `blockedReason`). Agent không có model riêng ⇒ dự phòng như Q4.
- #2 (Chặn): qc mở khoá M05, câu "Bắt đầu bằng chữ thường; chỉ chữ thường, số và - (2–48 ký tự)"; FE validate bằng `ProviderKeySchema`.
- #3–#32: áp mặc định của báo cáo (probe xoá cả `last_ok_at`; `ProfileStepSchema` cho item; bảng câu chữ kết quả kiểm tra; nhãn ma trận theo key; `AGENT_IS_DEFAULT` toast riêng; ô `only_tenant_id` "—"; plan-frontend theo contract `KEY_TAKEN`/`active_step`/`GET /providers/:id`; model 1–100; nhãn hãng; chỉ nút Lên/Xuống, kéo-thả → TECH-DEBT; lệnh e2e có `-c`; B5 rủi ro cao/Opus; cột Test §8; chép mockup vào `docs/design/agent-hub/canvas/`; kiểu `subscriptionOutcome`; timeout/network theo `e.name`; log `job.fallback`; hạn 10 s theo đồng hồ; `latency_ms`; `KeyTakenDetailsSchema`; 400 uuid; `AppDeps.fetch/sleep`; `done:h4b2` + alias; file thiếu ở tasks; câu chữ Q5/runbook; hàng = agent; `{time}` HH:mm:ss, `{key}`; vendor `fake` cho tạo `dev_only`; status/tick T2; xoá luôn hỏi xác nhận, Sheet đóng sau lưu).

Việc tiếp: backend-lead sửa spec/plan/tasks, frontend-lead sửa plan-frontend + chép mockup, qc sửa M05 + thêm ca `pickStep` cho agent có model riêng → chạy lại readiness.
