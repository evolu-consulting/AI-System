# Tasks · X2b2-room-attachments

Mỗi task: một commit `[FR]`, diff ≈ ≤ 400 dòng. Tick khi lệnh "xong" xanh. `blocked` kèm lý do → báo cáo cuối.
Cột `Đọc`: đúng các mục tài liệu task cần. Cột `Rủi ro` (`cao` / `thường`) quyết định model khi BUILD — `docs/WORKFLOW.md` "Chính sách model".

Khung (PLAN BE ∥ FE chốt lại; chưa phải kế hoạch cuối). Trạng thái: spec `draft`, chưa PLAN, chưa test-plan, chưa readiness.

| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| B1 | Migration 0023 + policy đọc theo thành viên | backend-lead | cao | `spec §2 R05–R06`, `§4`, `§9 Q2 Q4` | `packages/db/migrations-hub/0023_*` | — | `bun run test:int` (RLS) | [ ] |
| B2 | Gắn file vào tin phòng + đọc cho thành viên | backend-lead | cao | `spec §2 R01–R05`, `§3` | `apps/hub-api/src/modules/{rooms,attachments}` | B1 | int rooms/attachments | [ ] |
| B3 | File-set run phòng + `out/` lên tin agent | backend-lead | cao | `spec §2 R07–R12`, `§9 Q5 Q6 Q7` | `apps/hub-api/src/modules/rooms/agents` | B2 | int + acceptance | [ ] |
| B4 | Sweeper phòng (xoá phòng, rời) | backend-lead | thường | `spec §2 R13–R14` | `apps/hub-api/src/modules/attachments/sweeper*` | B1 | `sweepOnce` int | [ ] |
| F1 | Gửi: `RoomComposer`/thread bật đính kèm, `use-send-room-text`/`useFlowSend` nhận `ids`, khoá idempotent, `AttachNote` + i18n | frontend-lead | thường | `plan-frontend §0 D2 D3 D6 D7`, `§3`, `§4` | `apps/chat-web/src/features/{rooms,composer}`, `packages/i18n/locales/chat` | B2 (contract C-1, C-2) | `bun run typecheck && bun test && bun run i18n:check` | [ ] |
| F2 | Hiển thị: `AttachmentList` trong `MessageItem` + `AgentBlock` (`out/`), realtime test, README | frontend-lead | thường | `plan-frontend §0 D4 D5 D8 D10`, `§2` | `apps/chat-web/src/features/rooms/components`, `event-router.test.ts` | F1 | `bun run typecheck && bun test` | [ ] |
| F3 | Chạy e2e AC15 của qc, sửa lỗi UI (không sửa test) | frontend-lead | thường | `plan-frontend §5`, `spec §8 AC15` | `apps/chat-web/**` | F2, Q1 | `bunx playwright test X2b2` | [ ] |
| Q1 | qc: test-plan + khoá test (thay X2b-AC11 có chủ đích) | qc | cao | `spec §8` | `tests/acceptance/X2b2/**`, `e2e/**` | PLAN | đỏ đúng lý do | [ ] |
| R1 | Review ≤ 2 vòng + security review riêng + `done:x2b2` + I2 | reviewer / qc | cao | `spec §2 §8 §11` | — | tất cả | `done:x2b2` | [ ] |
