# Tasks · P-b2-canvas

Khung — PLAN (backend-lead ∥ frontend-lead) điền chi tiết sau; chưa chạy spec-readiness. Mỗi task: một commit `[FR]`, diff ≈ ≤ 400 dòng. Cột `Đọc`: đúng các mục cần. `Rủi ro`: xem `docs/WORKFLOW.md` "Chính sách model".

| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| T0 | PLAN BE (`plan.md`: máy trạng thái bước, khoá, migration) | backend-lead | cao | `spec §2,§3,§4` | `docs/specs/P-b2-canvas/plan.md` | — | — | [ ] |
| T1 | PLAN FE (`plan-frontend.md`: canvas, StageStrip, i18n) | frontend-lead | thường | `spec §2 R16–R17,§5`, ADR-0013 | `docs/specs/P-b2-canvas/plan-frontend.md` (+ `plan-frontend-i18n.md`, `tasks-frontend.md` — T8–T10 chia thành FB-1…FB-8) | — | — | [x] |
| T2 | qc: test-plan + test khoá (cập nhật E-P15b/E-PB08/E-PB09, thêm AC-PB2-01…12) | qc | cao | `spec §8` | `tests/acceptance/P-b2/**`, `e2e/P-b2/**` | T0, T1 | `bun run test:lock:verify` | [ ] |
| T3 | spec-readiness + Gate (trình ADR-0013; Luật 2b) | spec-readiness | — | spec, readiness.md | `readiness.md` | T2 | — | [ ] |
| T4 | Contract + DDL (`step`, `back_to_steps`, cột run/stage, `process_back_events`) | backend-lead | cao | `spec §3,§4` | `packages/contracts`, `packages/db` | T3 | `bun test packages/contracts` | [ ] |
| T5 | Engine: bước song song + chờ mọi stage + `real_action` + #135 | backend-lead | cao | `spec §2 R01–R05,R14,R18` | `apps/hub-api/src/modules/processes/{core,runs,defs}` | T4 | `bun run test:int` | [ ] |
| T6 | Engine: quay lại bước + trần + đồng thời | backend-lead | cao | `spec §2 R06–R09` | `.../gates`, `.../core` | T5 | `bun run test:int` | [ ] |
| T7 | `## Bàn giao` + priorFiles theo bước + resume/delta | backend-lead | thường | `spec §2 R10–R12` | `.../runs/launcher*.ts` | T5 | `bun run test:int` | [ ] |
| T8 | admin-web: tách StageForm (#136) + cột "Chạy ở bước"/"Nếu bị trượt" | frontend-lead | thường | `spec §2 R17` | `apps/admin-web/src/features/processes/components/editor` | T4 | `bun test` + typecheck | [ ] |
| T9 | admin-web: canvas xyflow (lazy) + bàn phím + `check:bundle` | frontend-lead | thường | `spec §2 R16`, ADR-0013 | `apps/admin-web/src/features/processes/components/canvas` | T8 | `bunx playwright test e2e/P-b2/admin` | [ ] |
| T10 | chat-web: StageStrip theo bước + ×lần + thẻ duyệt quay lại + trang Run | frontend-lead | thường | `spec §2 R13`, §5 A3–A5 | `apps/chat-web/src/features/processes` | T6 | `bunx playwright test e2e/P-b2/chat` | [ ] |
| T11 | Review + chạy lại `done:pa`, `done:pb`, `done:pb2`; UAT | reviewer, qc-uat | — | spec §8 | — | T5–T10 | `bun run done:pb2` | [ ] |
| T12 | Đồng bộ docs (CODEMAP, TRACE, STATE, ADR-0013 → Accepted) | docs-architect | thường | — | `docs/**` | T11 | `bun run trace --check` | [ ] |
