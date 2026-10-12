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
| F1 | Composer phòng đính kèm + chip + gợi ý chia sẻ | frontend-lead | thường | `spec §5`, `§2 R04 R16` | `apps/chat-web/src/features/rooms` | B2 (contract) | `bun test` + e2e | [ ] |
| Q1 | qc: test-plan + khoá test (thay X2b-AC11 có chủ đích) | qc | cao | `spec §8` | `tests/acceptance/X2b2/**`, `e2e/**` | PLAN | đỏ đúng lý do | [ ] |
| R1 | Review ≤ 2 vòng + security review riêng + `done:x2b2` + I2 | reviewer / qc | cao | `spec §2 §8 §11` | — | tất cả | `done:x2b2` | [ ] |
