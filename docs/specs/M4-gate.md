# Gate M4 — Chi phí & vận hành (Quota, Usage, Tổng quan, Audit + khôi phục, Import/Export, 2FA)

Ngày: 2026-10-03 · Trạng thái: **ĐÃ DUYỆT 2026-10-03** · Readiness: READY (`M4-ops/readiness.md`, 4 lần)

**Tự duyệt theo Luật 2b**: spec-readiness lần 4 READY (không Chặn, không Cao; còn 1 Thấp: spec.md gần trần). ADR-0005 (nodemailer, qrcode, yaml; TOTP tự viết; bỏ recharts) được người dùng duyệt trực tiếp 2026-10-03. Người dùng chấp nhận toàn bộ mặc định spec §9 (Q0–Q13, Q-D1, Q-C2) và trả lời Q7 (khôi phục chỉ command/workflow/feature/group/quota, chỉ platform_admin), Q10 (admin tắt 2FA hộ **giữ phiên**), D4, Q-FE1 (tab Feature tenant để sau, TECH-DEBT #29). Hiệu năng không chặn mốc (TECH-DEBT #27). Không secret thật; không hard stop.

## 1. Phạm vi
A: Quota + cảnh báo email (Mailpit) / banner, Chi phí & quota, Tổng quan (FR-40, 41, 42). B: Audit (ghi trong `configWrite`, chỉ thêm), khôi phục, `updated_by` user/tenant (FR-51, 52, CR-016). C: Import (xem trước → áp dụng, một tx) / Export (FR-54). D: 2FA TOTP tuỳ chọn, đăng nhập 2 bước, mã dự phòng, admin tắt hộ (FR-08). BR-04, BR-09. AC: A06, A09, A12 (phía Admin), M4-AC01…18.

## 2. Áp trong BUILD (Thấp readiness lần 4)
(1) Lần sửa spec tới: chuyển §9 sang `spec-decisions.md` trước khi thêm nội dung (spec.md 25 486/25 600 B).

## 3. Thứ tự BUILD
Q2 (qc viết test, đỏ đúng lý do trên DB riêng) → Q3 (khoá) → T0…T9d, TM ∥ FE0a…FE6c theo `tasks.md` (một task/lần gọi, model theo cột Rủi ro) → TN Lệnh xong M4 (không `test:perf`) → reviewer (≤ 2 vòng, vòng 2 chỉ diff sửa) → D1 → bật service, hướng dẫn người dùng test toàn bộ admin app. Trên `main`, không push.
