# Gate H4b-2 Models + Quyền agent — 2026-10-13

**Tự duyệt theo Luật 2b.**
- spec-readiness lần 3: READY (`specs/H4b2-models/readiness.md`); lỗ hổng còn lại đều mức Thấp, có mặc định.
- Mọi câu hỏi đã được người dùng chấp nhận: mockup + Q1–Q8 (2026-10-13), readiness #1 "Không dự phòng" cho agent có model riêng.
- Không có ADR mới, không thư viện/dịch vụ mới, không hard stop.
- Test đã khoá: 189 ca (`tests/acceptance/H4b2/**`, `e2e/studio/h4b2-*`). Ca int chưa chứng minh đỏ đúng lý do vì Docker hỏng — làm ở B1 (tasks.md).

BUILD: B1 → B2 → B3/B5/B7 → B4 → B6 → B8; FE T5/T5b/T5c/T6 sau contract tương ứng.
