# Gate P-a (Process Engine lõi)

Ngày: 2026-10-10 · **Tự duyệt theo Luật 2b** (READY, không câu hỏi mới, không ADR thư viện mới, không hard stop mở).

- spec-readiness: **READY lần 5** (`docs/specs/P-process-engine/readiness.md`). Lần 1 NOT READY (1 Chặn, 7 Cao) → lần 2 (5 Cao) → lần 3 (3 Cao) → lần 4 (2 Cao) → lần 5 sạch. Sửa ở `4a39e8b1` `8c82b5f5` `1ee41c60` `8c2b12d9` `daa86207` `85042330`.
- Người dùng chốt (2026-10-09/10): Intake 13 câu + điều chỉnh (`!` cho quy trình, người kiểm/trả lời ngoài phòng, `/runs/:id`, hỏi lại + nhờ người khác, xem token); C1–C5 mặc định; **U1** lượt chạy trong phòng giữ **thread** như mockup ④ (F1–F3 chấp nhận); **U2** Import/Export JSON → P-b; **U3** nhóm mặc định tuần tự (spike S1); **U4** M4/M5 xác nhận; **U5** người khởi chạy rời phòng ⇒ lượt chạy tiếp, mất quyền đọc thread, giữ góc nhìn ngoài phòng; mẫu SDLC seed theo vòng mốc WORKFLOW (D18). Thứ tự: P-a trước X2b-2.
- Spike S1 (`spike.md`): tuần tự 3 lượt/27k token; trưởng nhóm lập kế hoạch 1 lần không kiểm cuối; làm lại chọn lọc −35% token; bỏ MCP lai (CR-023 vẫn Hoãn).
- Bảo mật (hard stop có thiết kế được chấp nhận): quyền + quota theo người khởi chạy (HUB-BR-21); người ngoài phòng xem qua grant gắn một việc (`review_task_assignees`), mọi lần xem ghi audit; C2 (stage nhóm không kiểm grant từng thành viên — người dùng chấp nhận); người dùng không chèn được tin `process` (42501). **Security review riêng bắt buộc ở RV1** (gồm readiness #22 `process_notices`).
- Contract: `@ai/contracts/chat` **chỉ thêm** (`processes`, `processes-errors`, `me-stream-process`, `room-process`, `ROOM_SENDER_TYPES` + `"process"`); `hub-admin/processes`. Migration `0019_pa_process_engine` (11 bảng + outbox thread, RLS). Cờ `HUB_PROCESS_ENGINE` mặc định tắt.
- Không ADR mới. Không thư viện mới.
- UI: canvas https://claude.ai/artifact/JHGS9iTLVyytdYwXJJ6eLW (board ①②④–⑧; ③⑨ thuộc P-b); khác mockup ghi ở `plan-frontend-admin.md` §3.
- Làm song song theo CR-059: **Bước 0** (0a contract + mock; 0b DB + khung + điểm nóng; 0c defs + seed) merge `main` trước → **PF1** chạy + cổng kiểm/thread · **PF2** hỏi lại + nhờ người khác · **PF3** ngoài phòng (inbox, `/runs/:id`) · **PF4** token + Evolu Control; merge PF1 → PF3 → PF2 → PF4; cổng merge theo `test-plan.md` §1.
- Test (chưa viết — QC1 sau Gate): ≈ 92 Bước 0 · 95 PF1 · 20 PF2 · 18 PF3 · 16 PF4 · ma trận cách ly 140 ô · 4 kịch bản (`sdlc` 8 giai đoạn, `hoa-don`).
- Gói: spec · plan (+ contract, thread, step0, seed) · plan-frontend (+ admin, thread, usage, i18n, i18n-thread, e2e) · test-plan (+ int, e2e) · tasks · spike · readiness.
