# Tasks · X2b2-room-attachments

Mỗi task: một commit `[FR]`, diff ≈ ≤ 400 dòng. Tick khi lệnh "xong" xanh. `blocked` kèm lý do → báo cáo cuối.
Cột `Đọc`: đúng các mục tài liệu task cần. Cột `Rủi ro` (`cao` / `thường`) quyết định model khi BUILD — `docs/WORKFLOW.md` "Chính sách model".

Trạng thái: PLAN BE (`plan.md`) + FE (`plan-frontend.md`) xong 2026-10-12; chưa test-plan, chưa readiness. Thứ tự BE: B1 → B2 → B3 → B4 → B5; B6 sau B2. F1 chờ contract B2.

| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| B1 | Migration 0023 (cột, FK kép, CHECK, index, siết `attachments_hub_rw`, `attachments_room_member_select`, definer `attach_claim_deleted_rooms`) + `_journal` idx 23 + drizzle 2 cột + int DB (CHECK/FK 23503/RLS ma trận §4.2/definer 42501/chạy lại 2 lần) | backend-lead | cao | `plan §1 D1–D6`, `§4` | `packages/db/migrations-hub/0023_x2b2_room_attachments.sql`, `meta/_journal.json`, `packages/db/src/schema/hub.ts`, `packages/db/src/hub-x2b2.int.test.ts` | — | `bun run db:migrate && bun run test:int` (db + H2c A131–A134 + X2a db-rls xanh) | [ ] |
| B2 | Contract (`attachment_ids?`, `attachments?`) + `room-files.rules.ts` + "chưa gắn" 2 cột ở `attachments.repo`/`sweepUnbound` + đọc thành viên (`findReadableAttachment`, `#owned`) | backend-lead | cao | `plan §2`, `§5`, `§6.4`, `§8` (room-files.rules) | `packages/contracts/src/chat/rooms.ts`, `apps/hub-api/src/modules/attachments/{room-files.rules.ts,attachments.repo.ts,attachments.service.ts,sweeper.ts}` | B1 | `bun run typecheck && bun test && bun run test:int` (H2c + `tests/acceptance/X2b2` đọc/AC02/AC13) | [ ] |
| B3 | Gửi tin phòng/thread có file: `roomFilesAllowed`, kiểm trước (dup → sendable), gắn trong tx, refs ở trang/dup/`room.message`, `toRoomMessage` | backend-lead | cao | `plan §3`, `§6.1`, `§7` (4 hàng đầu), `§8` (`roomFilesAllowed`) | `apps/hub-api/src/modules/attachments/{room-files.repo.ts,room-files.ts}`, `rooms/{messages/messages.service.ts,rooms.map.ts,rooms.rules.ts}` | B2 | int AC01, AC03–AC05, AC14 + X2a/X2b/P-a xanh | [ ] |
| B4 | Run phòng nhận file: cửa sổ (`RoomCtxRow.id`), `roomRunFiles` + `runs.attachment_ids`, `launch(p, files)`, `createRunTx` bỏ chọn file khi `p.room` | backend-lead | cao | `plan §1 D9 D10 D12`, `§6.2`, `§7` (2 hàng `roomRunFileRows`, `setRunAttachmentIds`) | `rooms/agents/{room-run.service.ts,room-context.repo.ts,room-agent.rules.ts}`, `attachments/room-files*.ts`, `runs/create-run.ts` | B3 | int + acceptance AC06–AC09, AC12, AC16 | [ ] |
| B5 | `out/` lên phòng: `SseWriter` bỏ gắn khi run phòng, poster gắn khi `finished ∧ posted`, refs vào 2 bản tin agent | backend-lead | cao | `plan §1 D11`, `§6.3`, `§8` (`shouldBindRoomOutputs`) | `runs/sse/sse-writer.ts`, `rooms/agents/{room-post.ts,room-post.repo.ts,room-agent.rules.ts}`, `attachments/room-files*.ts` | B4 | int + acceptance AC10 + H2c outputs xanh | [ ] |
| B6 | Sweeper (b2) phòng xoá qua definer (gộp vào `purged`) + README `attachments`, `rooms/agents` | backend-lead | cao | `plan §6.5`, `§9` (README) | `attachments/sweeper.ts`, `attachments/README.md`, `rooms/agents/README.md` | B1, B2 | `sweepOnce` int AC11 + `done:h2c` | [ ] |
| F1 | Gửi: `RoomComposer`/thread bật đính kèm, `use-send-room-text`/`useFlowSend` nhận `ids`, khoá idempotent, `AttachNote` + i18n | frontend-lead | thường | `plan-frontend §0 D2 D3 D6 D7`, `§3`, `§4` | `apps/chat-web/src/features/{rooms,composer}`, `packages/i18n/locales/chat` | B2 (contract C-1, C-2) | `bun run typecheck && bun test && bun run i18n:check` | [ ] |
| F2 | Hiển thị: `AttachmentList` trong `MessageItem` + `AgentBlock` (`out/`), realtime test, README | frontend-lead | thường | `plan-frontend §0 D4 D5 D8 D10`, `§2` | `apps/chat-web/src/features/rooms/components`, `event-router.test.ts` | F1 | `bun run typecheck && bun test` | [ ] |
| F3 | Chạy e2e AC15 của qc, sửa lỗi UI (không sửa test) | frontend-lead | thường | `plan-frontend §5`, `spec §8 AC15` | `apps/chat-web/**` | F2, Q1 | `bunx playwright test X2b2` | [ ] |
| Q1 | qc: test-plan + khoá test (thay X2b-AC11 có chủ đích) | qc | cao | `spec §8`, `plan §8` (chữ ký luật), `§11`, `§12` (test khoá thay) | `tests/acceptance/X2b2/**`, `e2e/**` | PLAN | đỏ đúng lý do | [ ] |
| Q0 | qc: test-plan (`test-plan.md`, 53 int + 10 rules + 5 contract-rules + 2 contract + 8 e2e) | qc | cao | `spec §2 §8`, `plan §8 §11 §12`, `plan-frontend §5` | `docs/specs/X2b2-room-attachments/test-plan.md` | PLAN | — | [x] |
| R1 | Review ≤ 2 vòng + security review riêng + `done:x2b2` + I2 | reviewer / qc | cao | `spec §2 §8 §11` | — | tất cả | `done:x2b2` | [ ] |

## Lệnh mốc `done:x2b2` (đề xuất qc — `tools/scripts/src/done-x2b2.ts`, mẫu `done-x2b.ts`; người viết script: backend-lead ở R1, qc duyệt)
Dừng ở bước đỏ đầu; bước DB/cổng chạy **tuần tự**; DB test tag riêng (`bun run db:test:create <tag>` rồi `--env-file=.env.test-<tag>.local`). `--skip=int,e2e` cho phép như `done:x2b` (không tính là done đủ).
| # | Chặng | Lệnh |
|---|---|---|
| 1 | Tĩnh | `bun run typecheck` · `bunx biome ci --changed --no-errors-on-unmatched` |
| 2 | Unit + rules | `bun test apps/hub-api apps/chat-web packages/contracts packages/db tests/acceptance/X2b2/rules tests/acceptance/X2b/rules` |
| 3 | DB (BE) | `bun --config=bunfig.int.toml test packages/db/src/hub-x2b2.int.test.ts` (+ `bun run db:migrate` hai lần — idempotent 0023) |
| 4 | Int X2b2 | `bun --config=bunfig.int.toml test --timeout 40000 tests/acceptance/X2b2/` |
| 5 | Hồi quy int | `… test tests/acceptance/H2c/ tests/acceptance/X2b/ tests/acceptance/X2a/ tests/acceptance/P-a/ tests/acceptance/H1/ tests/acceptance/C1/` (tuần tự sau bước 4; sweeper H2c không chạy song song với X2b2) |
| 6 | E2E | `bunx playwright test -c e2e/chat/playwright.x2b2.config.ts` (script mới `e2e:chat:x2b2`) · `bun run e2e:chat:x2b` · `bun run e2e:chat:x2a` · `bunx playwright test -c e2e/chat/playwright.config.ts x1-attachments` |
| 7 | Cấu trúc | `bunx depcruise apps/hub-api apps/chat-web/src packages/contracts/src` · `bun run check:fn --files <phạm vi X2b2 từ commit Gate>` · `bun run check:size --all` |
| 8 | Khoá + i18n + trace | `bun run test:lock:verify` · `bun run i18n:check` · `bun run trace --check` |
| 9 | Contract chat (hub-dev, cuối) | `bun run test:contract:chat` (gồm `x2b2-additive.contract.test.ts`) |
| 10 | Hồi quy mốc | `bun run done:h2c` · `bun run done:pa` (ngoài script, ghi kết quả ở review R1) |
