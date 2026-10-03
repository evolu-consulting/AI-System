# Readiness · M4-ops

## Lần 1 · 2026-10-03 · NOT READY
- Kết quả: **5 Chặn, 10 Cao, 11 Trung bình, 13 Thấp** (39 mục). Mọi mục có mặc định đề xuất.
- Người dùng (2026-10-03): chấp nhận toàn bộ mặc định (spec §9 Q0–Q13, plan-cd Q-D1, Q-C2) + 3 câu trả lời: **Q7** khôi phục chỉ command/workflow/feature/group/quota, chỉ `platform_admin`; **Q10** admin tắt 2FA hộ **giữ phiên** (không thu hồi); **D4** mật khẩu đúng chưa qua TOTP không reset bộ đếm. ADR-0005 Accepted.
- Đã áp:
  - backend-lead (spec, plan, plan-contract, plan-rules, plan-cd, tasks): #1, 2, 6, 7, 8, 9, 10 (plan-rules), 11 (phần contract: không thêm trường, TECH-DEBT #30), 14, 15, 16, 17, 18, 20, 21, 23, 25, 26, 27, 28, 30, 33, 34, 35, 39.
  - frontend-lead (`plan-frontend.md`): #11, 12, 13, 19, 22, 24, 29, 31, 37.
  - qc (`test-plan*.md`): #3, 4, 5, 32, 36, 38 + ca theo quyết định backend (#10 R15: `input_schema` chứa `password` **không** ném; #2 PUT no-op; #6 evaluate không await; #14 `run_id` NULL; #20 Enable không tính bộ đếm; #21 import quota null → `SCHEMA`; #23 pct tenant = max).
- Bước kế: chạy lại spec-readiness (lần 2).
