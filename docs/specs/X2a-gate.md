# Gate X2a-rooms

Ngày: 2026-10-07 · **Tự duyệt theo Luật 2b.**

- spec-readiness: READY lần 3 (`docs/specs/X2a-rooms/readiness.md`); R1, R2 NOT READY — mọi lỗ hổng Chặn/Cao đã có mặc định, điều phối chốt theo Luật 2 (spec §10, commit `21a4443`, `04ab356`). Còn 2 Thấp giao frontend-lead (F2) và qc (QC1).
- Người dùng 2026-10-07: ưu tiên chat user↔user + nhóm + agent trong phòng trước H4b (CR-047/048); đồng ý mọi mặc định Intake; UI duyệt theo canvas X2 (`docs/design/chat-app/canvas-x2/`): không panel agent — agent qua menu `@`, giữ mô hình flow C1; "ok được rồi, làm tiếp đi".
- Bảo mật: RLS theo thành viên + `hub.create_room` kiểm `is_tenant_user` (hard stop đã có thiết kế được chấp nhận); review X2a bắt buộc có **security review riêng** RLS + `/me/stream` (`plan.md` §12).
- Không ADR thư viện/dịch vụ mới. Không hard stop mở. Bảng màu UI-1 (CR-049) không ảnh hưởng X2a.
- Gói: spec · spec-isolation · plan · plan-db · plan-frontend (+ i18n, e2e) · test-plan · tasks · readiness.
