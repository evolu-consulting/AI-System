# Tasks · X2a-rooms

Mỗi task: một commit `[FR]`, diff ≈ ≤ 400 dòng. Tick khi lệnh "xong" xanh. `blocked` kèm lý do → báo cáo cuối. **Khung do docs-architect**; backend-lead/frontend-lead chốt task chi tiết, file, lệnh xong ở PLAN (`plan.md`, `plan-frontend.md`). Cột `Đọc` cập nhật sau PLAN. Hard stop bảo mật (HUB-BR-22): mọi task chạm RLS/stream là rủi ro **cao** (Opus).

| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| P1 | PLAN BE: contract `chat/{rooms,directory,me-stream}.ts` + `CHAT_ROOM_ERRORS` (chỉ thêm), migration `0011_x2a_rooms` (bảng, RLS, `is_room_member`, luồng tạo phòng, thứ tự khoá `seq`), stream `ustream:<user_id>`, xác nhận Q1 (không migration Admin) → `plan.md` | backend-lead | cao | `spec §2, §3, §4, §9`; `spec-isolation.md`; BA §6.9, §8, §9 | `docs/specs/X2a-rooms/plan.md` | — | `wc -c plan.md` ≤ 30 KB | [ ] |
| P2 | PLAN FE: sidebar "Tin nhắn & Nhóm"/"Hỏi AI", màn phòng, tạo nhóm, thành viên, rời/ẩn/xoá, "Đã xem", client `/me/stream`, khung chuẩn bị X2b (§5.3), câu chữ VI/EN, role/nhãn e2e → `plan-frontend.md` | frontend-lead | thường | `spec §5, §8`; `canvas-x2/README.md` + artboard; `spec-isolation.md` §1 | `docs/specs/X2a-rooms/plan-frontend.md` | — (song song P1; contract theo P1) | `wc -c` ≤ 25 KB | [ ] |
| Q1 | test-plan: AC-H23–H25, CHAT-AC-37…45, X2a-AC01…AC16; ma trận cách ly DB + API; int 2 instance Hub; `done:x2a` | qc | cao | `spec §8`; `spec-isolation.md` §2; `plan.md`; `plan-frontend.md` | `docs/specs/X2a-rooms/test-plan.md` | P1, P2 | `wc -c` ≤ 30 KB | [ ] |
| R1 | spec-readiness → READY (ghi `readiness.md`) | spec-readiness | - | toàn thư mục spec | `docs/specs/X2a-rooms/readiness.md` | Q1 | READY | [ ] |
| G | Gate (tự duyệt Luật 2b nếu câu hỏi mở dùng mặc định; trình người dùng nếu có câu hỏi mới) | điều phối | - | `readiness.md` | `docs/specs/X2a-gate.md` | R1 | gate ghi | [ ] |
| QC1 | Viết test khoá (int RLS `packages/db`, int hub-api gồm 2 instance, contract chat, e2e chat) — đỏ đúng lý do; `test:lock:write` | qc | cao | `test-plan` | `tests/acceptance/X2a/**`, `tests/contract/chat/x2a-*`, `e2e/chat/x2a-*`, `tests/.lock` | G | đỏ đúng lý do + `test:lock:verify` | [ ] |
| B1 | Migration `0011_x2a_rooms` + Drizzle + RLS + `is_room_member` [HUB-FR-96, HUB-BR-22] | backend-lead | cao | `plan §…` | `packages/db/migrations-hub/0011_*`, `packages/db/src/schema/*` | QC1 | (plan) | [ ] |
| B2 | Contract `@ai/contracts/chat` rooms/directory/me-stream + lỗi (chỉ thêm) [HUB-FR-96…100, 102] | backend-lead | thường | `plan §…` | `packages/contracts/src/chat/*` | QC1 | (plan) | [ ] |
| B3 | `GET /directory` [HUB-FR-102] | backend-lead | cao | `plan §…` | `apps/hub-api/src/modules/rooms/*` (plan chốt) | B1, B2 | (plan) | [ ] |
| B4 | API phòng: tạo DM/nhóm, chi tiết, đổi tên, xoá, thành viên, rời, chuyển chủ, ẩn [HUB-FR-96…98] | backend-lead | cao | `plan §…` | (plan) | B3 | (plan) | [ ] |
| B5 | Tin phòng + `seq` + `client_msg_id` + đã đọc/chưa đọc [HUB-FR-96, 100] | backend-lead | cao | `plan §…` | (plan) | B4 | (plan) | [ ] |
| B6 | `GET /me/stream` (Redis Streams, `Last-Event-ID`, `stream.reset`, fan-out sau commit, nhiều instance) [HUB-FR-99] | backend-lead | cao | `plan §…` | (plan) | B5 | (plan) | [ ] |
| F1 | Sidebar 2 mục + route `/rooms/:id` + danh bạ/tin nhắn mới [UC-09] | frontend-lead | thường | `plan-frontend §…` | `apps/chat-web/src/features/{shell,rooms,…}` (plan chốt) | QC1, B2 | (plan) | [ ] |
| F2 | Màn phòng: dòng thời gian, composer, client `/me/stream`, chưa đọc, "Đã xem", banner kết nối lại, khung X2b (§5.3) [UC-09, UC-10] | frontend-lead | thường | `plan-frontend §…` | (plan) | F1 | (plan) | [ ] |
| F3 | Tạo nhóm + quản lý thành viên + rời/ẩn/xoá + chuyển chủ [UC-10] | frontend-lead | thường | `plan-frontend §…` | (plan) | F2 | (plan) | [ ] |
| I1 | `done-x2a.ts` + `bun run done:x2a` | qc | thường | `test-plan §…`; mẫu `done-x1.ts` | `tools/scripts/src/done-x2a.ts`, `package.json` | B*, F* | `done:x2a` xanh | [ ] |
| RV | Review ≤ 2 vòng: BE + FE, **kèm security review RLS/stream riêng** (Opus; ma trận `spec-isolation.md` §2, policy, hàm `SECURITY DEFINER`, fan-out) | reviewer | cao | diff mốc | - | I1 | APPROVED + security review đạt | [ ] |
| D1 | Docs: INDEX, CODEMAP, TRACE, STATE, README module, CR-047 → "Đã áp", TECH-DEBT (Q1, Q6) | docs-architect | thường | `spec §10` | `docs/**` | RV | `bun run trace --check` | [ ] |
| I2 | Kiểm tay 2 user (2 trình duyệt) — DM, nhóm, realtime, chưa đọc — do **người dùng** | điều phối + người dùng | thường | `spec §5`, guide (D1) | - | D1 | ghi `spec-decisions.md` | [ ] |
