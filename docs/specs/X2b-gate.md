# Gate X2b-room-agents

Ngày: 2026-10-08 · **Tự duyệt theo Luật 2b.**

- spec-readiness: READY lần 2 (`docs/specs/X2b-room-agents/readiness.md`, `77448d1`); lần 1 NOT READY (1 Chặn, 5 Cao) — mọi lỗ hổng có mặc định từ spec/BA/code, đã sửa (`287a85d`, `50e3102`, `f057943`). Còn Thấp L1–L6 sửa trong BUILD.
- Người dùng 2026-10-08: "Tiếp tục x2b"; Q7 đổi lần 1 (người khác trả lời tiếp được) rồi lần 2 — **thread chung**: mọi thành viên nhắn được trong thread, tin không tag là người↔người, agent chỉ chạy khi tag (hoặc `answer_run_id` của người tag lượt đó), ngữ cảnh cả thread trần 50 + 20 tin timeline; Q9 **tách X2b-2** (đính kèm → 400 ở X2b); chấp nhận mọi mặc định còn lại (Q1–Q15, U1, U3, U4).
- Điều phối tự quyết (Luật 2): tag agent không có quyền → `AGENT_NOT_FOUND` 404 như C1 (không lộ agent tồn tại); nhãn Orchestrator = "Orchestrator".
- Bảo mật (hard stop có thiết kế được chấp nhận): quyền + quota theo người tag từng lượt (HUB-BR-21); ngữ cảnh chỉ trong phòng (lọc 2 lớp); chi tiết `side_effect` chỉ trả cho người tag; huỷ run khi người tag rời/bị bớt/phòng xoá. **Security review riêng bắt buộc** trước `done:x2b` (RV1, `plan.md` §11).
- Không ADR thư viện/dịch vụ mới. Không hard stop mở. Contract `@ai/contracts/chat` chỉ thêm (hằng riêng, không đổi `CHAT_ROOM_ERRORS`/`ME_STREAM_EVENTS` 8 mục của X2a).
- Test: 107 int/rules (101 đỏ đúng lý do, 6 hồi quy xanh) + 11 e2e E-A1…A11 (đỏ ở expect) — `test-plan.md`, `test-plan-e2e.md`.
- Gói: spec · plan · plan-questions · plan-frontend (+ i18n, e2e) · test-plan · test-plan-e2e · tasks · readiness.
