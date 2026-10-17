# Tasks · P-d-durable

Spec `draft`. Chưa PLAN, chưa Gate. Thứ tự: điều kiện trước (D0) → **P-d1** (T1–T12) → **P-d2** (T13–T20). Mỗi task: một commit `[HUB-FR-xxx]`, diff ≈ ≤ 400 dòng. Cột `Đọc`: đúng các mục cần. `Rủi ro`: `docs/WORKFLOW.md` "Chính sách model" (RLS/tenant, quyền, khoá/transaction, audit ⇒ cao ⇒ Opus).

## Điều kiện trước
| # | Việc | Ai | Trạng thái |
|---|---|---|---|
| D0a | ADR-0017 Accepted (spike Redis thật + tải 10.000 run staging) | người dùng / GĐ0 0.3, 0.10 | [ ] |
| D0b | Đóng mốc dọn-seed (CR-081) | điều phối | [ ] |
| D0c | Mockup/artboard panel stage + nhãn chat (D13) | người dùng / frontend-lead | [ ] |

## Lát P-d1 (CR-083…086)
| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| T1 | PLAN BE P-d1: bảng ánh xạ mã lỗi (Q1, Q2), máy trạng thái `waiting_timer`/`retry`, DDL 0036, khoá/tx vòng quét, contract chi tiết | backend-lead | cao | `spec §2–§5`, `spec-decisions.md` | `docs/specs/P-d-durable/plan.md` | D0b | — | [ ] |
| T2 | PLAN FE P-d1: panel stage (Chờ tới ngày, nhắc/chuyển cấp, thời hạn), input `date`, nhãn chat, i18n | frontend-lead | thường | `spec §6`, mockup D0c | `docs/specs/P-d-durable/plan-frontend.md` | T1, D0c | — | [ ] |
| T3 | qc: test-plan + sửa test khoá ([spec-ac §2](spec-ac.md)) + test mới AC-H39…H43, H46 | qc | cao | `spec-ac.md`, plan §… | `tests/acceptance/P-d/**`, test khoá P-a/P-b/P-b2/P-c/P-c2 | T1, T2 | `bun run test:lock:verify` | [ ] |
| T4 | spec-readiness → Gate GĐ1 (ADR-0017 Accepted) | spec-readiness | — | spec, plan, readiness | `readiness.md`, `docs/specs/P-d-gate.md` | T3, D0a | — | [ ] |
| T5 | Contract P-d1: enum thêm cuối, hằng, schema `wait_until`/`after.review`/`ttl_days`/input `date`, view | backend-lead | cao | plan §contract | `packages/contracts/src/{chat,hub-admin}/**` | T4 | `bun test packages/contracts` | [ ] |
| T6 | DDL `0036_pd1_durable.sql` + `schema/hub-processes.ts` (`process_timers` RLS + FK kép, cột mới, nới CHECK, DROP NOT NULL) | backend-lead | cao | plan §DB, `spec §4` | `packages/db/{migrations-hub,src/schema}` | T5 | `bun run db:migrate && bun run test:int` | [ ] |
| T7 | Thử lại: phân loại lỗi + `retry_count` + hẹn giờ `retry` + `retry_exhausted` + chặn `side_effect` (stage-driver, team-member, sweeps `interrupted`) | backend-lead | cao | `spec §2.1`, plan | `apps/hub-api/src/modules/processes/runs/{stage-driver,team-member,team-exec,sweeps}.ts`, `core/process-state.rules.ts` | T6 | `bun run test:int` | [ ] |
| T8 | Hẹn giờ: vòng `fireTimers` trong `sweepOnce` (scope system, lọc tenant tường minh) + executor `wait_until` + `waiting_timer` + trần không đếm + huỷ hẹn khi huỷ/quay lại | backend-lead | cao | `spec §2.2, §5` | `runs/{sweeps,launcher,start-inputs,timers.*}.ts`, `gates/back.effects.ts` | T7 | `bun run test:int` | [ ] |
| T9 | Nhắc lặp + chuyển cấp (vòng nhắc, assignee `escalated`, notice, audit, forward theo Group) | backend-lead | cao | `spec §2.3, §5` | `notify/{reminder,inbox.repo}.ts`, `gates/forward*` | T6 | `bun run test:int` | [ ] |
| T10 | `ttl_days` (def CRUD + snapshot + `expireRuns` bỏ qua null) | backend-lead | thường | `spec §2.4` | `defs/**`, `runs/{start-inputs,sweeps}.ts` | T6 | `bun run test:int` | [ ] |
| T11 | FE P-d1: admin-web panel stage + form quy trình; chat-web nhãn + input `date` | frontend-lead | thường | `plan-frontend` | `apps/admin-web/src/features/processes`, `apps/chat-web/src/features/processes` | T5 | `bunx playwright test e2e/P-d` | [ ] |
| T12 | `done:pd1` + review + security review (chuyển cấp, vòng hẹn giờ, regression `scanDue`) + UAT + hồi quy `done:pa/pb/pb2/pc/pc2` | backend-lead, reviewer, qc-uat | cao | `spec-ac.md` | `tools/scripts/src/done-pd1.ts` | T7–T11 | `bun run done:pd1` | [ ] |

## Lát P-d2 (CR-087)
| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| T13 | PLAN BE P-d2: gọi tool nội bộ qua bộ điều phối `/mcp` bằng danh tính người bắt đầu, catalog tool cho editor, nhánh trong join bước, DDL 0037 | backend-lead | cao | `spec-d2.md`, ADR-0018/0022 | `plan.md` (mục P-d2) | T12 | — | [ ] |
| T14 | PLAN FE P-d2: "Gọi tool", map tham số, "Rẽ nhánh", mũi tên nét đứt, nhãn "Bỏ qua" | frontend-lead | thường | `spec-d2 §6` | `plan-frontend.md` (mục P-d2) | T13 | — | [ ] |
| T15 | qc: test AC-H44, H45 (+ enum contracts) | qc | cao | `spec-ac.md` | `tests/acceptance/P-d/**` | T13, T14 | `bun run test:lock:verify` | [ ] |
| T16 | spec-readiness P-d2 (spec đổi sau lần READY) | spec-readiness | — | `spec-d2.md` | `readiness.md` | T15 | — | [ ] |
| T17 | Contract + DDL 0037 (enum `tool`/`skipped`/`tool_failed`, luật def, `after.branch`) | backend-lead | cao | plan P-d2 | `packages/contracts/**`, `packages/db/**` | T16 | `bun test packages/contracts && bun run db:migrate` | [ ] |
| T18 | Executor `tool` + output `fields`/.md + audit + chặn gọi lại `side_effect` | backend-lead | cao | `spec-d2 §2, §5` | `runs/tool-exec.ts` (mới), `defs/def.rules.ts`, `mcp/**` (gọi nội bộ) | T17 | `bun run test:int` | [ ] |
| T19 | Rẽ nhánh trong join bước + `skipped` + thread/audit + quay lại qua bước `skipped` | backend-lead | cao | `spec-d2 §3` | `runs/step-persist.ts`, `core/step.rules.ts`, `gates/back.effects.ts` | T17 | `bun run test:int` | [ ] |
| T20 | FE P-d2 + `done:pd2` + review + security review (tool) + UAT + hồi quy | frontend-lead, backend-lead, reviewer, qc-uat | cao | `spec-ac.md` | `apps/{admin,chat}-web/src/features/processes`, `tools/scripts/src/done-pd2.ts` | T18, T19 | `bun run done:pd2` | [ ] |

## Docs
| # | Task | Agent | Trạng thái |
|---|---|---|---|
| T21 | Sau mỗi lát: CODEMAP, TRACE (`bun run trace --check`), STATE, INDEX; kết luận lát vào `spec.md` | docs-architect | [ ] |

## Quyết định trong lúc làm
- (chưa có)
