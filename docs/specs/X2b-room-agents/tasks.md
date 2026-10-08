# Tasks · X2b-room-agents

Mỗi task: một commit `[FR]`, diff ≈ ≤ 400 dòng. Tick khi lệnh "xong" xanh. `blocked` kèm lý do → báo cáo cuối. **Khung do docs-architect**; backend-lead/frontend-lead chốt task chi tiết ở PLAN và điền cột `Đọc`.

| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| P1 | PLAN BE: contract chat (chỉ thêm), migration `runs.room_id`, đường gọi agent từ tin phòng (R01–R12, R16–R19) | backend-lead | cao | | `docs/specs/X2b-room-agents/plan.md` | spec | plan ≤ 30 KB | [ ] |
| P2 | PLAN FE: menu `@`, nhánh agent/`FlowBlock`, trạng thái chờ, `?flow=`, đính kèm (Q9), câu chữ VI/EN | frontend-lead | thường | | `docs/specs/X2b-room-agents/plan-frontend.md` | spec | plan-frontend ≤ 25 KB | [ ] |
| Q1 | test-plan: AC-H26/H27, CHAT-AC-46…50, X2b-AC01…AC16; ma trận quyền + rò ngữ cảnh; `done:x2b` | qc | cao | | `docs/specs/X2b-room-agents/test-plan.md` | P1, P2 | review test-plan | [ ] |
| R1 | spec-readiness → READY | spec-readiness | - | | `docs/specs/X2b-room-agents/readiness.md` | Q1 | READY | [ ] |
| G | Gate (Luật 2b nếu Q dùng mặc định) | điều phối | - | | `docs/specs/X2b-gate.md` | R1 | gate ghi | [ ] |
| QC1 | Test khoá (int quyền/ngữ cảnh/realtime, e2e chat); `test:lock:write` | qc | cao | | `tests/acceptance/X2b/**` | G | đỏ đúng lý do | [ ] |
| B1 | BE: migration + tạo run từ tin phòng (quyền, quota, ngữ cảnh 20, ≤ 1 run) | backend-lead | cao | | | QC1 | | [ ] |
| B2 | BE: need_input/side_effect chỉ người gọi, sự kiện `/me/stream`, huỷ khi rời | backend-lead | cao | | | B1 | | [ ] |
| F1 | FE: menu `@` phòng (`menus="agents"`, placeholder), gửi trả `SubmitResult` + `{message, run?}`, tô `@key` | frontend-lead | thường | plan-frontend §0 D2–D5, §5, §9; i18n §1; e2e §1 Composer | `apps/chat-web/src/features/{composer,rooms}/**` | B1 | `bun test` composer+rooms · e2e X2a xanh | [ ] |
| F2 | FE: khối agent (`AgentBlock`, `PendingAgentBlock`, stream người gọi, Dừng), sự kiện run, pill/đã đọc | frontend-lead | cao | plan-frontend §0 D6–D9, §3, §4; i18n §2 | `features/rooms/components/agent/**`, `features/realtime/event-router.ts` | F1, B2 | `bun test` rooms+realtime | [ ] |
| F3 | FE: chờ `need_input`/`side_effect` (AskCard người gọi, `WaitingNote` người khác), `NOT_RUN_CALLER`, huỷ Q2 | frontend-lead | cao | plan-frontend §4 (chờ), §10 #3; i18n §2 | `features/answer/components/AskCard.tsx`, `features/rooms/components/agent/WaitingNote.tsx` | F2 | `bun test` rooms+answer | [ ] |
| F4 | FE: khung flow phòng (`FlowFrame` tách từ C1, `RoomFlowPane` lazy, chỉ-đọc người khác, sheet) | frontend-lead | cao | plan-frontend §0 D10, §2, §12; i18n §3 | `features/flow-panel/components/**`, `features/rooms/components/flow/**` | F2 | `bun test` flow-panel+rooms · `bun run e2e:chat` (C1/AC-H07) | [ ] |
| F5 | FE (cắt được → X2b-2): đính kèm trong phòng | frontend-lead | thường | plan-frontend §0 D11, §10 #7 | `features/rooms/components/RoomComposer.tsx`, `timeline/MessageItem.tsx` | F1, B đính kèm | `bun test` rooms+attachments | [ ] |
| F6 | FE: đóng — README, TECH-DEBT, a11y, `check:bundle`, e2e X2b | frontend-lead | thường | plan-frontend §7, §9 | README features, `docs/TECH-DEBT.md` | F1–F4 (+F5) | `bunx playwright test X2b` · `bun run e2e:chat` | [ ] |
| RV1 | Review vòng 1 + security review (quyền agent, rò ngữ cảnh) | reviewer + security | cao | | | B2, F1 | | [ ] |
| RV2 | Review vòng 2 (nếu cần), I2, `done:x2b` | reviewer + qc | cao | | | RV1 | `done:x2b` | [ ] |
