# Gate X2b-2 — Đính kèm file trong phòng

Ngày: 2026-10-12 · **Tự duyệt theo Luật 2b.**

- spec-readiness lần 3 READY (`readiness.md`); mọi lỗ hổng Chặn/Cao lần 1–2 đã có mặc định được điều phối chấp nhận và ghi vào `spec-decisions.md` (#1–#19).
- Không ADR mới, không thư viện/dịch vụ/env mới. Migration 0023 (`attachments.room_id/room_message_id`, RLS `is_room_member`) — security review riêng sau BUILD (plan §11 S1–S8, S3b).
- Thông tin (không phải câu hỏi): Q16 = D12 — agent Dify qua `@` trong phòng KHÔNG nhận file (khớp phạm vi H2c đã duyệt, T11). File phòng KHÔNG dùng làm input quy trình (S8, `ownsUpload and room_id is null`).
- Test khoá cũ thay có chủ đích (Tranh chấp test ghi ở spec §12): X2b `context.int` "X2b-AC11 attachment_ids ⇒ 400", `contracts-x2b` K5.
- Kế tiếp: qc Q1 WRITE + LOCK (đỏ đúng lý do) → BUILD B1 → B2…B7 ∥ F1–F3 → `done:x2b2` → reviewer + security review → qc-uat.
