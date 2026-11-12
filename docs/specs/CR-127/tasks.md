# CR-127 · Tasks (kế hoạch)

Trạng thái: chưa bắt đầu · Spec: `spec.md` (READY — tự duyệt 2026-11-10, Luật 1b/2b; đã áp readiness lần 1–7 #1–#80 + trả lời người dùng) · Nghiệp vụ: `business.md` · Đối chiếu code: `gap-a…d` · `readiness.md`.
**Người dùng chốt 2026-11-10** (spec §1): mẫu §12 chỉ tự gán công ty mới (công ty cũ quản trị nền tảng áp tay) · bên nhận không có quy trình nhận ⇒ người phụ trách HĐ nhận quyết (spec §3 #9b) · prod chưa có người dùng ⇒ không đếm trên bản sao prod, rủi ro dữ liệu khách hạ, deploy một đợt nếu chốt chặn Z1 không RAISE · lưu patch mỗi lát · **xác nhận mốc là việc nhóm** (spec §5.9, lát E10 + X5) · mock ở `mock/*.dc.html` (`mock/README.md`), **business/spec thắng mock khi lệch**.

## 1. Chế độ chạy (người dùng chốt 2026-11-10)
- Làm **TẤT CẢ** trong CR-127. **KHÔNG commit bất kỳ code nào** — người dùng test trực tiếp trên working tree nhánh `staging-improve`.
- Không worktree, không nhánh lát, không `slice:merge`, không `openspec:check` lúc gộp (Delta §7 viết sẵn cho lúc commit sau).
- Các lát chạy **nối tiếp trên cùng working tree**; chỉ song song khi không chung file (§4, §6). Tối đa 4 agent (D1).
- Agent **chỉ sửa file trong cột "File được sửa"** của lát; đỏ typecheck/test ở file ngoài phạm vi ⇒ ghi báo cáo, không sửa.
- File dùng chung (i18n `packages/i18n/locales/**`, `index.ts` re-export): chỉ `Edit` đúng khối, đọc lại ngay trước khi sửa, không viết lại cả file.
- **Lệnh trong chế độ không commit (readiness #22):**
  - Format/lint: **cấm `biome check --changed`** (sẽ đụng file lát khác). Chỉ `bunx biome check --write <file của lát…>`.
  - Cuối lát (trước khi báo xong): `git diff -- <file của lát…> > <SCRATCH>/cr127/<lát>.patch` và `git stash create` (không đổi working tree) — ghi hash trả về vào báo cáo; điều phối chép vào `docs/STATE.md`. `<SCRATCH>` = scratchpad của phiên điều phối (ghi sẵn trong brief). File **mới chưa track** của lát (`git ls-files --others --exclude-standard -- <thư mục của lát>`) không vào patch/stash ⇒ chép nguyên vào `<SCRATCH>/cr127/<lát>/` (giữ đường dẫn tương đối) và liệt kê trong báo cáo (#57). Khôi phục một lát: `git apply -R <lát>.patch` + xoá tay các file mới đã liệt kê; giới hạn: `apply -R` hỏng nếu lát sau đã sửa cùng dòng — khi đó khôi phục theo thứ tự ngược các lát chạm file đó.
  - `bun run db:migrate`: **chỉ điều phối chạy, giữa các đợt** (sau khi mọi lát của đợt có migration báo xong). Agent không tự migrate DB dev; int test dùng DB test clone từ mẫu (`test:int:par` tự dựng).
  - Reset DB local khi migration lỗi giữa chừng (chỉ máy local): `docker compose down -v && docker compose up -d --wait && bun run db:migrate`.
  - Unit: `bun test <file>`. Int: `bun run test:int:par <file…>` (stack local). `tsc` một lần cuối lát, chỉ gói đổi (`bun run --filter <gói> typecheck`). Không chạy e2e trong lát (viết file được).
- **Env / mock cần (readiness #32):** `HUB_PARTNER_MAILBOX=on` (bộ chuyển hộp thư, P1/K8); vai worker cho vòng nền (cùng cách bật của `HP/reminders.mount.ts` — vòng `schedule-sweep`, `claim-release` chỉ chạy ở worker; test gọi `*Once` trực tiếp, không cần bật); nhà cung cấp ký `selfsign` (P1/P2); fixture AI trích phạt + "Điều cần lưu ý" thêm vào `bun run mocks` (K7 viết).
- Lát UI (U*) đối chiếu mock ghi ở cột Mục tiêu (`mock/<Tên>.dc.html`); **business.md/spec.md thắng mock khi lệch** — ghi chỗ lệch vào spec §12.
- e2e + `test:all` MỘT lần cuối (Q1). Review + security MỘT lượt trên `git diff` (R1). Lỗi ⇒ SendMessage agent vùng. Lock test (`tests/**`, `e2e/**`): H1 ghi một lần cuối. Không deploy/push.
- Báo cáo agent ≤ 6 dòng: file đã sửa · test (lệnh → kết quả) · số perf trước/sau (nếu có) · thời gian theo pha · patch + stash ref · việc dở/bẫy.

## 2. Số migration (giao trước)
`when` trong `meta/_journal.json`: `when` mục cuối + 1000 cho mỗi số mới, theo đúng thứ tự số. Số MIGC đánh **theo thứ tự áp của đợt §6** (#75; `migrate-guard.ts:96-101` ném khi số nhỏ áp sau số lớn) — đổi thứ tự đợt thì đánh lại số.
| Thư mục | Số | Lát | Nội dung |
|---|---|---|---|
| `migrations-pack-contracts` | 0091 | K1a | status 4, `extract_state`, `effect`, `effect_outcome*`, `renews_id`, `submit_round`, `submitted_by`, trigger `contracts_status_gate`, k1/k2, chỉ mục, `refresh_effect`, backfill (+ `handled`) |
| | 0092 | K3 | `contract_submissions`; quyền `contracts_job` cho `failedBatch` (GRANT UPDATE cột + policy `contracts_job_fail`, GRANT INSERT `contract_events` + policy — #79; GRANT SELECT cột + policy SELECT — #80) |
| | 0093 | X1 | cột `obligations` mới, kind `penalty`, source `fulfill`, `contracts.exec_hold_*`, `exec_requests` |
| | 0094 | K8 | `partner_inbox.awaiting_decision` (#71) |
| | 0095 | P1 | `sign_session_refs` |
| | 0096 | K6 | gỡ cột/trigger `handled`, `action_deadline` |
| | 0097 | K7 | `penalty_terms`; `obligations.clause_ref/page` |
| | 0098 | P2 | `partner_settings.signer_group_id` |
| | 0099 | Z1 | gỡ `approval_on()` + chốt chặn lượt máy cũ |
| `migrations-hub` | 0131 | E1 | `evidence` + `record_evidence`/`evidence_get`, `task_holder()` (#72), `task_signals` + `task_signal()` (#54), nới `review_tasks_kind_ck` (+`milestone`, cần `subject_ref`) + kind `process_notices` (#53), `review_tasks.need/claimed_*`, `review_task_votes`, `task_assignees.via+on_behalf_of`, `delegations`, `tenant_flow_settings.claim_release_h` |
| | 0132 | P1 | `partner_sign_sessions` + hàm `sign_session_*` |
| | 0133 | Z1 | dự phòng (check ops-watch) |

## 3. Bản đồ file
### 3a. Literal trạng thái cũ — danh sách grep đủ (readiness #3)
Lệnh (2026-11-10): `grep -rlE "needs_review|extract_failed|'extracting'|'expiring'|'terminated'|'renewed'|'rejected'|'expired'|'active'"` (cả nháy kép), bỏ `*.test.ts(x)`, `*.bench.*`. **124 file** (HP 71 · PC 12 · WW 37 · mgmt-import 4). Luật gán (#58, #66): luật/enum gốc ⇒ K1a; INSERT/ghi ⇒ K1b; đọc adapters/application/cks ⇒ K2a-1; đọc domain ⇒ K2a-2; khoá/mở lại ⇒ K4; máy cũ ⇒ K1b (chạy được với enum mới) rồi Z1 gỡ; web ⇒ lát UI. Có thể là literal khác nghĩa (trạng thái lượt `approvals`, `partner.status='active'`…) — agent kiểm từng chỗ, chỉ đổi chỗ là trạng thái HĐ.

**`HP` = `apps/hub-api/src/modules/packs/contracts` (71)**
| Lát | File |
|---|---|
| K1a (luật gốc) | `domain/status.rules.ts`, `domain/deadline.rules.ts` (`statusOn` → `effect.rules`) |
| K1b (ghi/INSERT) | `adapters/approval-engine.repo.ts`, `adapters/approval-sweep.repo.ts`, `adapters/approval.repo.ts`, `adapters/contract-flow.repo.ts`, `adapters/deals.repo.ts`, `adapters/esign.repo.ts`, `adapters/extraction.repo.ts`, `adapters/partner-inbox.repo.ts`, `adapters/reopen.repo.ts`, `adapters/review.repo.ts`, `adapters/upload-contract.repo.ts`, `application/approval-sweep.ts`, `application/create-manual.usecase.ts`, `application/extract-job.usecase.ts`, `application/extraction.ports.ts`, `application/promote-contract.usecase.ts`, `application/request-extract.usecase.ts`, `application/run-extraction.usecase.ts`, `application/upload-contract.ports.ts`, `application/upload-contract.usecase.ts`, `cks/adapters/cks-write.repo.ts`, `cks/application/sale.usecase.ts`, `domain/contract-flow-events.rules.ts`, `domain/doc-types.rules.ts`, `domain/partner-send.rules.ts` |
| K1b → Z1 (máy cũ) | `application/approval.usecase.ts`, `application/approval.ports.ts`, `domain/approval-machine.rules.ts`, `domain/approval-def.rules.ts` |
| K2a-1 (đọc: adapters/application/cks) | `adapters/appendix.repo.ts`, `adapters/companies.repo.ts`, `adapters/deals.routes.ts`, `adapters/extraction.routes.ts`, `adapters/ledger-sql.ts`, `adapters/mywork.repo.ts`, `adapters/partners-data.repo.ts`, `adapters/product-links.repo.ts`, `adapters/todo.repo.ts`, `adapters/transactions-read.sql.ts`, `adapters/test/cr116-bench.harness.ts`, `application/approval-engine-card.usecase.ts`, `application/approval-engine.ports.ts`, `application/approval-flow.ts`, `application/esign.ports.ts`, `application/review.ports.ts`, `application/tax-parties.ts`, `cks/adapters/cks-read.repo.ts`, `cks/application/ports.ts`, `cks/domain/customers.rules.ts` |
| K2a-2 (đọc: domain) | `domain/approval-engine-card.rules.ts`, `domain/approval-engine.rules.ts`, `domain/approval-flow-view.rules.ts`, `domain/approval-step-label.rules.ts`, `domain/deal.rules.ts`, `domain/export.rules.ts`, `domain/goods-prices.rules.ts`, `domain/service-customers.rules.ts`, `domain/sourcing.rules.ts`, `domain/supplier-advice.rules.ts`, `domain/supplier-prices.types.ts`, `domain/supplier-quote.rules.ts` |
| K3 | `application/review.usecase.ts`, `domain/review.rules.ts` (Lưu nháp / Xác nhận & lưu) |
| K4 | `adapters/manage.routes.ts`, `application/manage.usecase.ts`, `application/reopen-contract.usecase.ts` (gỡ), `domain/approval-edit.rules.ts` |

**`PC` = `packages/contracts/src/pack-contracts` (12)**: K1a `fields.ts` (K6 sau đó gỡ `HANDLED_OUTCOMES` — #62) · K2a-1 `approval.ts`, `deals.ts`, `detail.ts`, `list.ts`, `review.ts`, `versions.ts` · K2a-2 `cks.ts`, `doc-types.ts`, `extract.ts`, `service-customers.ts`, `supplier-prices.ts`.

**`apps/admin-api/src/modules/mgmt-import` (4)** — K1b (nhập = `created_done`): `application/reconcile.ts`, `domain/extras-contracts.rules.ts`, `domain/map-cks.rules.ts`, `domain/map-contracts.rules.ts`.

**`apps/workspace-web/src` (37)**
| Lát | File |
|---|---|
| U4 | `features/contract-approval/components/ModuleStepRow.tsx`, `…/components/use-approval-ui.tsx`, `…/lib/approval.ts`, `…/lib/card-status.ts`, `…/lib/flow-view.ts` |
| U5 | `features/contract-deadline/lib/deadline.ts` (gỡ), `features/contract-lock/lib/lock-view.ts`, `features/contract-review/components/{ContractHead,DetailGrid,ManagePanel}.tsx`, `…/hooks/{use-confirm-save,use-info-form}.ts`, `…/lib/{head-rule,manage,review}.ts`, `…/pages/ContractReviewPage.tsx`, `features/frame-panel/components/FramePanel.tsx`, `features/frame-panel/lib/frame-view.ts`, `features/ledger/components/ContractLog.tsx` |
| U6 | `features/contracts-list/lib/{extract-progress,list-model,row-view}.ts`, `features/overview/components/ContractsBlock.tsx`, `features/overview/lib/overview.ts`, `features/product-links/api.ts`, `features/products/lib/customers.ts`, `features/shell/components/Sidebar.tsx` (kiểm), `features/partners/components/AddCompanyDialog.tsx` (kiểm) |
| U6 xác nhận khác nghĩa, mặc định không sửa | `features/auth/hooks/use-session-redirect.ts`, `modules/community/adapters/{mock-profile,mock,seed}.ts`, `modules/community/domain/{filters,flows,visibility}.ts`, `modules/community/ui/PostCard.tsx`, `modules/community/ui/flows/JoinRequests.tsx` |

Ngoài 4 thư mục grep (K2b): `packs/community/{adapters/notify.sweep,domain/notify.rules}.ts`, `packages/contracts/src/pack-community/viewer.ts`, `packages/web-kit/src/app-catalog/portal.ts`, test-kit, i18n nhãn trạng thái/hiệu lực. File test (≈150, gap-a §2.4): lát sửa test không khoá của file mình; test khoá ⇒ Q1.

### 3b. Bản đồ theo vùng
| Vùng | File · hàm | Lát | Gap |
|---|---|---|---|
| Cổng mới (K1a) | `HP/domain/contract-state.rules.ts` (mới), `HP/adapters/contract-state.repo.ts` (mới), `HP/domain/effect.rules.ts` (mới), port `ContractDoneHook` (mới, kit hoặc `HP/application/contract-done.ports.ts`) | K1 | — |
| Gửi / Rút / Gửi lại (readiness #42, #50) | `HP/application/{submit,withdraw,recreate}.usecase.ts` (mới), kit `packs/kit/application/flow-events.ports.ts` (`OutcomeHandler.cancelled?/failed?`), `PR/gates/run-control.service.ts` (`RunControlService.stop`), `PR/application/runs/settle-step.usecase.ts` (nhánh failed), `PR/runs/expire.ts` (`expireBatch`) — spec §12 #74, `PR/triggers/not-launched.ts`, `HP/adapters/submissions.repo.ts` (mới), `HP/application/{flow-submit,approval-flow}.usecase.ts`, `HP/adapters/contract-flow.repo.ts`, `HP/flow-events.mount.ts`, `PR/triggers/flags.ts`, kit `packs/kit/{public.ts,application/flow-events.ports.ts}` (`FlowAvailability`, `FlowRunControl`) | K3 | a BR-02/04 |
| Phiên bản | `HP/adapters/{versions.routes,review.repo,milestones.repo}.ts`, `HP/application/version-diff.usecase.ts`, `PC/versions.ts`, `HP/manage.mount.ts` | K5 | a BR-35/36 |
| Hiệu lực / Sắp hết hạn | `HP/domain/deadline.rules.ts`, `HP/adapters/{reminders.repo,handled.routes,handled.repo}.ts`, `HP/application/{record-handled,remind-due}.usecase.ts`, `HP/reminders.mount.ts`, `PC/handled.ts`, `HP/adapters/expiring-source.repo.ts` (mới) | K6 | d §2, §4 |
| AI trích | `PC/extract.ts`, `HP/domain/{extract-prompt,extraction}.rules.ts`, `HP/adapters/{extraction.repo,extraction-agent}.ts`, adapter `ContractDoneHook` (mới), fixture mocks | K7 | a BR-55/56, c §3.4 |
| Bên nhận / gộp danh sách | `HP/adapters/{partner-inbox,contracts}.repo.ts`, `HP/partner-mailbox.mount.ts`, `HP/domain/partner-send.rules.ts`, `HP/nav.mount.ts`, `HP/partner-routes.mount.ts`, `PC/list.ts` | K8 | d §1–2 |
| Thực hiện lõi | `HP/application/{ledger,delivery}.usecase.ts`, `HP/adapters/{ledger-write.repo,ledger.routes,delivery.repo,milestones.repo}.ts`, `HP/domain/{ledger,milestones}.rules.ts`, `PC/{ledger,milestones,delivery}.ts`, `PC/fulfill.ts` (mới) | X1 | c §1, §3.1–3.2 |
| Giao dịch gắn HĐ | `HP/adapters/{deals.routes,deals.repo,open-milestones.repo}.ts`, `HP/transactions.mount.ts`, `HP/domain/deal.rules.ts`, `HP/application/create-manual.usecase.ts`, `PC/deals.ts` | X2 | c §3.1 |
| Tạm khoá / yêu cầu thay đổi | `HP/application/exec-request.usecase.ts` (mới), `HP/adapters/exec-requests.repo.ts` (mới), `HP/adapters/{milestones.routes,ledger.routes}.ts`, `PC/exec-requests.ts` (mới) | X3 | c §3.6 |
| Phạt / quá hạn / nhắc | `HP/domain/penalty.rules.ts` (mới), `HP/application/{overdue-sweep,penalty.usecase}.ts`, `HP/adapters/overdue*.repo.ts`, `PC/penalty.ts` (mới) | X4 | c §3.4 |
| Contract hub | `CT/chat/{processes-api,processes-entities,evidence}.ts`, `CT/flow/view.ts`, `CT/hub-admin/{processes,process-approve,process-group-refs,process-trigger}.ts`, `CT/app-manifest/{manifest,contracts.manifest,events.rules}.ts`, drizzle `packages/db/src/schema/hub-processes.ts`, `hub-process-library.ts` (`tenantFlowSettings`) | E1 | b §4 |
| Engine task | `PR/domain/tasks/task-access.rules.ts`, `PR/core/{core.repo,task-view}.ts`, `PR/gates/{gates.service,gate.rules,gate-task.repo,parallel-approve}.ts`, `PR/asks/*`, `PR/domain/asks/forward.rules.ts`, `PR/application/notify/*`, `PR/adapters/notify/*`, `PR/processes.mount.ts` | E2–E5 | b §4.A–C |
| Uỷ quyền | `PR/delegations/*` (mới), `PR/domain/tasks/delegation.rules.ts` (mới), kit `DelegationReader`, `ContractAccess` | E3 | b §4.B |
| Lịch | `PR/triggers/{schedule-sweep (mới),dispatcher,match.rules}.ts`, kit `ScheduledSource`, `PR/processes.mount.ts` | E6 | b §4.D |
| Chạy thử | `PR/library/flow-preview.*` (mới), `PR/library/preview.routes.ts` (gỡ), `PR/library/library.routes.ts` | E7 | b §4.E |
| Quyền soạn | `PR/library/{library.routes,company-flows.routes,company-flows.service,library-company.service}.ts` | E8 | b BR-10/11 |
| Node chung | `CT/modules/core/{index,subprocess}.ts`, `CT/modules/index.generated.ts`, `apps/hub-api/src/modules/packs/core/nodes/**` | E9 | b §3 |
| Xác nhận mốc (việc nhóm) | `CT/modules/contracts/milestone-confirm/node.ts` (mới), `packs/contracts/nodes/milestone-confirm/` (mới), kit `FlowTaskSignal` (E10) · `HP/adapters/milestone-due-source.repo.ts` (mới), `HP/application/ledger.usecase.ts`, `HP/flow-events.mount.ts` (X5) | E10, X5 | spec §5.9 |
| Phiên ký chung | `PT/{mailbox-mover.ts,adapters/mailbox-mover.repo.ts,domain/mailbox-events.rules.ts}`, `HP/partner-mailbox.mount.ts`, `HP/application/esign-void.ts`, `HP/adapters/sign-session.repo.ts` (mới), `HP/flow-events.mount.ts` | P1 | d §3 |
| Node ký cùng lúc | `CT/modules/contracts/{partner-send/{config,node},esign/node,sign-together-accept/node}.ts`, `PC/esign-node.ts`, `HP/adapters/partner-send.tool.ts`, `HP/domain/partner-send.rules.ts` | P2 | d §3.6 |
| admin-web | `AW/lib/outline*` (U1) · `AW/pages/**`, `AW/components/**`, `AW/lib/**`, `AW/nodes/registry.ts`, `apps/admin-web/src/features/tenants/flows/**` (U2) · `AW/components/library/PreviewDialog.tsx`, `AW/library-api.ts` (U3) | U1–U3 | b §5 |
| workspace-web | §3a + `WW/contract-shared/**` (mới, U5), `apps/workspace-web/src/platform/flow/ui/**` (U4), `WW/contract-milestones/**`, `WW/contract-versions/**` (U5), `WW/partner-inbox/**`, `WW/contract-new/**`, `WW/products/**`, `WW/contract-esign/**` (U6) | U4–U6 | a, c, d |
| Mẫu / seed | seed mẫu Thư viện (`docs/current/engine/flow-templates.md` chỉ chỗ), onboard | Z0 | — |
| Gỡ cũ / ops | máy cũ (§3a K1b→Z1), `apps/hub-api/src/modules/ops/adapters/checks/*.check.ts` | Z1 | a BR-78/79 |

## 4. Khoá file (nối tiếp theo thứ tự cố định — readiness #6, #7)
| File | Thứ tự |
|---|---|
| `HP/flow-events.mount.ts` | K3 → X2 → P1 → X3 → K6 → X4 → X5 |
| `HP/adapters/milestones.repo.ts` | X1 → K5 → X3 |
| `HP/application/ledger.usecase.ts` | X1 → X2 → X3 → X4 → X5 |
| `PR/domain/tasks/task-access.rules.ts`, `PR/core/core.repo.ts`, `PR/gates/gates.service.ts` | E2 → E3 → E4 → E5 → E10 |
| `PR/processes.mount.ts`, `PR/library/library.routes.ts` | E2 → E3 → E6 → E7 → E10 → E8 |
| `CT/app-manifest/contracts.manifest.ts` | chỉ E1 (mọi sự kiện + facts mới) |
| `PC/list.ts`, `HP/adapters/contracts.repo.ts` | K2a-1 → K8 |
| `HP/partner-mailbox.mount.ts`, `HP/adapters/partner-inbox.repo.ts` | K1b → K8 → P1 |
| `PR/gates/run-control.service.ts`, `PR/application/runs/settle-step.usecase.ts`, `PR/runs/expire.ts` | chỉ K3 (#74) |
| `HP/application/exec-request.usecase.ts`, `HP/adapters/milestones.routes.ts` | X3 → X5 (#73) |
| `HP/extraction.mount.ts` | K1b → K7 |
| `CT/modules/index.generated.ts` | E9 → E10 → P2 |
| kit `packs/kit/public.ts`, `packs/kit/application/*.ports.ts` | K3 → E3 → E6 → E10 (#56) |
| `HP/domain/approval-edit.rules.ts` | K4 (chỉ K4) |
| `HP/domain/deadline.rules.ts`, `PC/fields.ts` | K1a → K6 (#62) |
| `HP/adapters/mywork.repo.ts` | K2a-1 → K8 (#51) |
| `AW/**` | U1 (chỉ `lib/outline*`) → U2 → U3 |
| `WW/contract-shared/**`, `platform/flow/ui/Evidence*` | U4 → U5 → U6 |

## 5. Bảng lát
"Opus low soát" = sau khi Sonnet xong, Opus `effort: low` đọc diff phần dữ liệu khách/RLS/quyền. Mục tiêu ≤ 40 phút (Opus) / ≤ 60 phút. **Test trước** = viết int phần rủi ro trước code (readiness #35).

| Mã | Mục tiêu | BR | File được sửa | Model · effort | Rủi ro | Phụ thuộc | Test của lát | Perf |
|---|---|---|---|---|---|---|---|---|
| **K1a** | 0091 + backfill (+`handled`) + cổng (`contract-state.rules`/`.repo`) + `initialState` + trigger chặn + port `ContractDoneHook` (rỗng) + `effect.rules`/`refresh_effect` + enum `PC/fields.ts` + §3a K1a (#58) | 01, 02, 06, 07, 77 | Cổng mới, §3a K1a, MIGC 0091 | **Opus medium** · test trước | Cao: máy trạng thái (dữ liệu thử — prod chưa có người dùng) | — | unit `contract-state.rules` (mọi dòng §3 spec + cấm + initialState), `effect.rules`; int backfill mọi trạng thái cũ + needs_review có/không `run_id` + `handled`; trigger chặn; `refresh_effect` = `effectOf` | `refresh_effect` 10.000 ≤ 2 s |
| **K1b** | Đổi 31 file ghi/INSERT §3a K1b + máy cũ K1b→Z1 + mgmt-import 4 file sang `applyTransition`/`initialState` (#58) | 02, 77, 78 | §3a K1b, K1b→Z1, mgmt-import | Sonnet high + Opus low soát | Cao: đường ghi trạng thái | K1a | int mỗi đường ghi chính (upload, extraction, deal, promote, cks, mgmt-import ⇒ done, outcome flow) qua cổng; không còn UPDATE status ngoài cổng (trigger chặn bắt) | không |
| **K2a-1** | Chỗ đọc adapters/application/cks §3a K2a-1 + list/detail (`effect`, `extract_state`, `superseded`, `hold`, `waiting`, `can`), lọc `superseded_at IS NULL` (#66) | 05, 09, 11, 78 | §3a K2a-1, PC K2a-1 | Sonnet high + Opus low | Cao vừa | K1b | int list lọc 4 trạng thái + effect + bỏ bản thay thế; `waiting` một câu | **đo trước** perf list/nav; sau giữ |
| **K2a-2** | Chỗ đọc domain §3a K2a-2 + PC K2a-2 (#66) | 78 | §3a K2a-2, PC K2a-2 | Sonnet high + Opus low | Cao vừa | K1b (song song K2a-1) | unit các `*.rules` đổi | không |
| **K2b** | Ngoài gói (community notify, viewer, web-kit, test-kit, i18n) | 78 | §3a "Ngoài 4 thư mục" | Sonnet | Thường | K1b | unit notify.rules | không |
| **K3** | submit / không quy trình ⇒ DONE / withdraw / gửi lại / recreate + 0092 + `FlowAvailability`, `FlowRunControl`; `flow_cancelled/failed/not_launched` qua hook kit `OutcomeHandler.cancelled?/failed?` (CAS theo `run_id`, không ném) + `notLaunched` (#50); `OutcomeHandler.failedBatch?` cho `expireBatch` (một lần/lô, UPDATE + INSERT theo tập — #76); bỏ đọc cờ | 02, 03, 04, 36a | Gửi/Rút/Gửi lại (gồm `PR/gates/run-control.service.ts`, `PR/application/runs/settle-step.usecase.ts`, `PR/runs/expire.ts`, kit `flow-events.ports.ts`, `PR/triggers/not-launched.ts`), §3a K3 | **Opus medium** | Cao: máy trạng thái run | K2a-1, K2a-2 | int submit có/không quy trình (kiểm thẻ), withdraw 3 lý do + claim không chặn, resubmit từ đầu + hồ sơ giữ lượt cũ, recreate chép tệp, FILE_REQUIRED, lượt huỷ/lỗi/không mở được ⇒ draft, hook lượt cũ sau withdraw bỏ qua; `failedBatch` lô nhiều tenant đúng CAS, **chặn chéo tenant** (item tenant A không đổi HĐ tenant B cùng id — #78), **đúng N hàng đổi** + N dòng `contract_events` dưới role `contracts_job` **thật** (`SET LOCAL ROLE`, không dùng role chủ — không 0 hàng im lặng, #79/#80); grep trigger UPDATE trên `contracts.contracts`: trigger ghi bảng khác ⇒ SECURITY DEFINER hoặc `WHEN` chỉ chạy khi đổi cột khác `status` (#80) + **đếm SQL** (handler ≤ 2 câu/lô, `expireBatch` ≤ 3 + 2); chặn chéo tenant `contract_submissions` | dispatcher perf có sẵn; `expireBatch` số câu cố định/lô |
| **K8** | Bên nhận 4 trạng thái, bản sửa cùng HĐ, list `source`, gỡ nav; không có quy trình nhận khớp ⇒ dòng việc `mywork.repo` cho người phụ trách HĐ nhận + `POST /contracts/:id/inbox-decision` (spec §3 #9b, #51) | 57, 58, 59 | Bên nhận/gộp, MIGC 0094 (`awaiting_decision`), handler `notLaunched` ở `HP/adapters/partner-inbox.repo.ts` + đăng ký `HP/partner-mailbox.mount.ts` (#71) | **Opus medium** | Cao: liên công ty | K3 | int 2 tenant nhận → trả lại → bản sửa → done; không quy trình nhận ⇒ việc người phụ trách → Đồng ý ⇒ done; list source | list perf |
| **K4** | Khoá nội dung theo trạng thái; bỏ sửa khi duyệt; gỡ Mở lại BE | 38, 39, 74 | §3a K4 | Sonnet high + Opus low | Quyền | K2a-1, K2a-2 | int PATCH ở processing/done ⇒ 409; reopen 404 | không |
| **X1** | `recordFulfillment` + 0093 (hàng con chép `milestone_items` còn lại, OVER_PLAN) | 43, 45, 46, 50–52, 54 | Thực hiện lõi | **Opus medium** · test trước | Cao: kho/tiền | K2a-1, E1 | int giao thiếu keep/split, tiền thiếu, hold cho thu, đếm câu; chặn chéo tenant `exec_requests` | **đo trước** `settleOne`, `/payments`; ≤ 6 câu |
| **X2** | `open-milestones`; deals `link` (LINK_MIXED, OVER_PLAN, `TASK_CLAIMED` có câu "Mốc đang do {người} xử lý…" — #59); `transaction.saved` | 48–51, 72, 73 | Giao dịch gắn HĐ | Sonnet high + Opus low | Cao vừa | X1, K3 | int link / none / pending → approved / rejected | **đo trước** `/payments` |
| **K5** | Phiên bản: chuyển mốc mở, diff điều khoản, changes-since-last | 35, 36, 36a, 36b | Phiên bản | Sonnet high + Opus low | Cao vừa | X1 | int chuyển mốc; diff; changes-since-last | không |
| **P1** | 0132 + 0095 + hàm `sign_session_*` + mover + chuyển #12–14c hai bên | 63, 64, 65 | Phiên ký chung | **Opus medium** · test trước | Cao: liên công ty | K8, X2 (khoá file) | int 2 tenant: done, từ chối, huỷ phiên, quá hạn ký (Gửi lại/Dừng), fallback, cách ly, hash lệch | ≤ 2 câu/lô |
| **X3** | hold/release + change requests + bọc PATCH/postpone + USE_NEW_VERSION | 41, 42, 52, 53, 75, 76 | Tạm khoá/thay đổi | Sonnet high + Opus low | Quyền | K5, P1 | int hold pending → approved; một yêu cầu/mốc; thiếu bằng chứng 422 | không |
| **K7** | AI notes/risks (danh sách cố định)/penalty_terms + 0097 + adapter `ContractDoneHook` lập mốc (đăng ký ở `HP/extraction.mount.ts`) + fixture mocks | 43, 55, 56 | AI trích | Sonnet | Thường | X3 (readiness #23), K6, K1a | unit schema cũ hợp lệ; int lưu penalty_terms + chặn chéo tenant; vào done ⇒ có mốc AI | không |
| **K6** | Hiệu lực hằng ngày, `contract.expiring` nguồn (đăng ký `flowPortRegistry` ở `flow-events.mount` — #64), outcome gia hạn/chấm dứt, gỡ `handled` (0096) + `HANDLED_OUTCOMES` ở `PC/fields.ts` (#62) | 07, 08, 67–69 | Hiệu lực | Sonnet high + Opus low | Cao vừa | X3, E6 | int nguồn expiring (múi giờ, bỏ bản thay thế), renew ⇒ HĐ draft + cũ "Đã gia hạn" | `refresh_effect` lô |
| **X4** | Phạt, `milestone.overdue`, nhắc 3 ngày **chỉ khi không có** quy trình `milestone.due` (`hasFlowFor` — #61), email đối tác | 47, 56, 70, 71 | Phạt/quá hạn | Sonnet high + Opus low | Tiền | K6, K7, E6 | unit `penalty.rules`; int book đúng chiều, waive, quyết hai lần 409 | overdue lô |
| **X5** | Xác nhận mốc phía HĐ: nguồn `milestone.due`; `recordFulfillment` kiểm quyền §4 spec (#52) + người nhận việc (409 `TASK_CLAIMED`/`TASK_NOT_CLAIMED`, câu #59) + `hub.task_signal` cùng tx (chỉ ghi tín hiệu — #54); nguồn bỏ mốc có task mở (#55); X3 postpone ⇒ tín hiệu `cancelled`; dữ liệu "X đang xử lý" trên mốc | 31, 40, 47 | `HP/application/ledger.usecase.ts`, `HP/adapters/ledger.routes.ts`, `HP/adapters/milestone-due-source.repo.ts` (mới), `HP/flow-events.mount.ts`, `PC/milestones.ts`, `HP/application/exec-request.usecase.ts`, `HP/adapters/milestones.routes.ts` (#73); đọc người giữ qua `FlowTaskSignal.holder` (#72) | Sonnet high + Opus low | Cao vừa: kho/tiền + task | X4, X3, E10, E6 | int mốc tới N ngày ⇒ task nhóm; người khác xác nhận ⇒ 409; giao dịch gắn mốc ⇒ 409 có câu #59 khi người khác giữ, xong ⇒ task đóng; dời hạn ⇒ không trùng task; công ty không quy trình ⇒ đường cũ | `recordFulfillment` ≤ 7 câu (+1 signal) |
| **E1** | 0131 + zod hub + `hub.task_holder` (#72) + `EvidenceInputSchema` + manifest mọi sự kiện/facts (gồm `sign.session.*`, `days`) + drizzle | 23, 25, 27, 32, 67, 70, 72, 75 | Contract hub | Sonnet high + Opus low · test trước | Cao: RLS/DEFINER | — | int chặn chéo tenant `evidence`/`delegations`/`votes`; evidence bất biến; `evidence_get` sai tenant rỗng; `check:app-events` | không |
| **E2** | Nhận việc + vòng tự trả + flow-settings | 27–31, 40 | Engine task | **Opus medium** · test trước | Cao: máy trạng thái task | E1 | int đua hai kết nối, tự trả (đồng hồ giả, không trưởng phòng ⇒ quản trị), lock-order | claim ≤ 3 câu; sweeper lô |
| **E3** | Uỷ quyền (phạm vi R#13, `ContractAccess`, R#15) + forward lý do + chuyển cấp tới người | 21, 32–34 | Uỷ quyền + Engine task | **Opus medium** · test trước | Quyền | E2, K3 (khoá kit #56) | unit `delegation.rules`; int đích danh/head/all sang B "Thay A", one không áp, hết khoảng về A, người gửi duy nhất ⇒ chuyển cấp | không thêm câu/uỷ quyền |
| **E4** | Bằng chứng khi quyết định + BR-26 + approval-record | 22–26 | Engine task (gate.rules, run-redact), `HP/{domain,application}/approval-engine-card.*` | Sonnet high + Opus low | Lộ dữ liệu | E3 | int thiếu bằng chứng 422; người chỉ xem không thấy | không |
| **E5** | "Cần: tất cả" (R#14) | Q12 | Engine task (`parallel-approve`) | **Opus medium** | Cao | E4 | int n/n, một trả lại, n=0, người vô hiệu, quá hạn giữ phiếu | không |
| **E6** | `ScheduledSource` (đăng ký qua `flowPortRegistry` — #64) + `schedule-sweep` + khớp `days` (R#12) + route chỉ dev/test `POST /__test/schedule-sweep {today}` (#63) | 67, 70 | Lịch | **Opus medium** | Cao: idempotency | E3 (processes.mount) | int chạy 2 lần một lượt; hai flow khác N; route test 404 khi production | lô 100 ≤ 50 ms |
| **E7** | Chạy thử BE | 17 | Chạy thử | Sonnet high | Thường | E5, E6 | unit đường đi/người nhận/cảnh báo; int không ghi | không |
| **E8** | Chỉ platform ghi; API tạo quy trình; khớp phòng mẫu (R#37) | 10, 11 | Quyền soạn | Sonnet high + Opus low | Quyền | E7 | int quản trị công ty 403; khớp phòng theo mã/tên | không |
| **E9** | `core.notify`/`core.wait` (schema R#39), form lên business, ẩn Quy trình con/Công cụ | 16, 19 | Node chung | Sonnet | Thường | E1 | unit `moduleIssues`, ánh xạ node cũ; `check:modules` | không |
| **E10** | Node `contracts.milestone-confirm` (khai module + executor tạo `review_tasks kind='milestone'`, `subject_ref`), port kit `FlowTaskSignal.complete` = `hub.task_signal` (gói chỉ ghi tín hiệu) + vòng `task-signal` (lô `SKIP LOCKED`, đăng ký `PR/processes.mount.ts`) khoá run → task rồi `closeTask` ở tx riêng (#54); giao việc: owner nhiều phòng ⇒ phòng đầu tiên theo thứ tự thành viên, không phòng ⇒ đích danh owner (#60); nhận việc/uỷ quyền/chuyển cấp dùng nguyên E2/E3 | 31, 40 | Engine task, `CT/modules/contracts/milestone-confirm/node.ts` (mới), `CT/modules/index.generated.ts`, kit `public.ts`, executor `packs/contracts/nodes/milestone-confirm/` (mới) | **Opus medium** · test trước | Cao: máy trạng thái task | E5, E9, E6, E7 (khoá `processes.mount`) | int task milestone: nhận/trả/uỷ quyền như Duyệt; signal đóng đúng một lần (idempotent); **deadlock hai kết nối** (fulfill ∥ claim) không xảy ra; owner nhiều/không phòng | không |
| **P2** | Node ký cùng lúc + `due_hours` + 0098 | 60–62, 66 | Node ký cùng lúc | Sonnet high + Opus low | Cao vừa | P1, E10 | int đồng ý ⇒ signing; thiếu nhóm ⇒ thường | không |
| **U1** | (mock `Editor`) `outline.ts` round-trip trên mẫu Thư viện + flow **staging/seed** (R#38, không prod) | 12–14 | `AW/lib/outline*` | Sonnet high | Thường | — | unit round-trip, Unsupported có lý do | không |
| **U2** | admin-web M1, M2, M2b, khối Duyệt + khối Xác nhận mốc, M16, Áp dụng, M8 — mock: `Main`, `Editor`, `Components`, `Flows5`, `Remove` | 10–16, 18, 19 | admin-web | Sonnet | Thường | U1, E6–E9 | unit `node-summary`; e2e viết | `check:bundle` |
| **U4** | Thẻ duyệt M5/M15, Việc của tôi (cả việc Xác nhận mốc: Nhận việc / Trả về / Xác nhận mở M11; việc HĐ nhận không quy trình: 3 nút), M14, M6, Cài đặt công ty, `EvidenceInput`, `SignaturePad` — mock: `Approve`, `Compare`, `Done`, `Delegate`, `Roles` | 20–34 | workspace-web duyệt | Sonnet | Thường | E2–E5, E10, X5, K5, K8 (#67) | unit view-model; nhãn nguyên văn spec §8 (#65); e2e viết | không |
| **U5** | Chi tiết M9/M10/M11/M13 (mốc hiện "Chưa ai nhận" / "X đang xử lý"), Điều cần lưu ý/Cần chú ý, phạt, chip, đầu trang HĐ nhận không quy trình (3 nút), gỡ cũ; tách `ContractReviewPage.tsx`; nhãn nguyên văn spec §8 (#65) — mock: `Detail`, `DetailStates`, `Milestone`, `Roles`, `Compare` | 09, 35–47, 52–56 | §3a U5 + `contract-shared`, milestones, versions | Sonnet | Thường | U4, K4–K7, X1–X5 | unit head-rule, chip, trạng thái mốc; e2e viết | không |
| **U3** | Chạy thử FE — mock: `TestRun` | 17 | PreviewDialog | Sonnet | Thường | U2, E7 | unit facts mẫu; e2e viết | không |
| **U6** | M7, M2c, M4, M12, M2d; gỡ `PartnerInboxPage` — mock: `List`, `PartnerInbox`, `Upload`, `Trade`, `CoSign` | 05, 49, 59–65 | §3a U6 + partner-inbox, contract-new, products, contract-esign | Sonnet | Thường | U5, K8, X2, P2 | unit list-model; e2e viết | `check:bundle` |
| **Z0** | Mẫu Thư viện (gồm "Xác nhận mốc") + seed/onboard **chỉ công ty mới** (D7); công ty đang có: không tự gán (quản trị nền tảng áp tay) | §12, 31, 58 | seed/onboard | Sonnet | Thường | E10, P2, X5 | int onboard công ty mới đủ mẫu đang bật; công ty cũ không bị gán | không |
| **Z1** | Gỡ máy cũ + 0099 chốt chặn + ops-watch | 78, 79 | §3a K1b→Z1, ops checks | Sonnet high + Opus low | Cao vừa | toàn BE | int chốt chặn RAISE; check phát hiện lệch | không |
| **Q1** | qc: hoàn thiện `e2e/cr127/j01…j13` + chạy e2e MỘT lần + `test:all`; chạy lại chỉ phần đỏ | D5 | `e2e/**`, `tests/**` | Sonnet | — | Z0, Z1, U2–U6 | e2e xanh | perf trong test:all |
| **R1** | Review + security trên `git diff` | — | chỉ đọc | **Opus medium** | — | Q1 | — | — |
| **H1** | `test:lock:write`, `known-red.json`, dọn server/DB, STATE/CODEMAP | — | `tests/.lock`, docs | Haiku | — | R1 + sửa | `test:lock:verify` | — |
| **H2** | Dọn khoá i18n mồ côi, `check:size`, `biome check --write <file đã đổi trong git diff --name-only>` | — | i18n, file đổi | Haiku | — | H1 | `bun run check` | — |

**Tổng: 40 lát** — Opus medium làm 11 (K1a, K3, K8, X1, E2, E3, E5, E6, E10, P1, R1) · Sonnet 27 (16 có Opus low soát) · Haiku 2.

## 6. Thứ tự áp và đợt song song
| Đợt | Song song | Ghi chú |
|---|---|---|
| W1 | K1a ∥ E1 ∥ U1 | chỉ K1a đụng HĐ; E1/U1 không đụng gói HĐ (#58); cuối đợt `db:migrate` (0091, 0131) |
| W2 | K1b ∥ E2 ∥ E9 | E2/E9 không đụng gói HĐ; int gói HĐ chỉ chạy lại sau K1b |
| W3 | K2a-1 ∥ K2a-2 | hai tập file rời nhau |
| W4 | K3 ∥ K2b ∥ X1 | X1 sau K2a-1; `db:migrate` (0092, 0093) |
| W5 | E3 ∥ K8 ∥ K4 ∥ X2 | E3 sau K3 (khoá kit #56); X2 sau K3 |
| W6 | E4 ∥ E6 ∥ P1 ∥ K5 | E4, E6 sau E3; P1 sau K8 + X2; K5 sau X1; `db:migrate` (0094, 0095, 0132) |
| W7 | E5 ∥ X3 | E5 sau E4; X3 sau K5 + P1 |
| W8 | E7 ∥ K6 | E7 sau E5 + E6; K6 sau X3 + E6; `db:migrate` (0096) |
| W9 | E10 ∥ K7 | E10 sau E7 (khoá `processes.mount`) + E9; K7 sau K6; `db:migrate` (0097) |
| W10 | X4 ∥ E8 ∥ P2 | X4 sau K6 + K7; E8 sau E10; P2 sau P1 + E10; `db:migrate` (0098) |
| W10b | X5 | sau X4 + X3 + E10 |
| W11 (UI một đợt) | U2 ∥ U4 → U5 → U3 ∥ U6 | U2 sau E8; U4 sau E10, X5, K8; xong đợt ⇒ đóng băng UI |
| W12 | Z0 ∥ Z1 → Q1 → R1 → sửa → H1 → H2 | `db:migrate` (0099, 0133) |

**Đường găng:** K1a → K1b → K2a-1 → K3 → X2 → P1 → X3 → K6 → K7 → X4 → X5 → U5 → U6 → Z1 → Q1 → R1 (16 lát nối tiếp — K7 nay sau K6; U5 còn chờ U4). Lát trễ trên đường găng ⇒ điều phối ghi nguyên nhân vào STATE (D8).

Brief mỗi lát: mã + mục spec + dòng §5 + khoá §4 + perf + chế độ §1 (không commit, biome theo file, patch + stash, không migrate) + chờ test tiền cảnh.

## 7. Delta (so với docs/current)
Trạng thái gộp: chưa gộp (không commit; gộp `docs/current` khi người dùng cho commit). Tên file test là dự kiến — lát đổi tên thật thì sửa dòng `[test: …]` trong cùng lát.

### ADDED sht/trang-thai-hop-dong.md
#### Yêu cầu: Hợp đồng có 4 trạng thái, đổi qua một cổng, hiệu lực tách riêng
HĐ chỉ ở DRAFT / PROCESSING / REJECT / DONE; mọi đổi trạng thái qua cổng duy nhất theo bảng chuyển; hiệu lực là trường dẫn xuất chỉ khi DONE; dữ liệu 9 trạng thái cũ chuyển theo BR-77.
- Kịch bản: khi chuyển dữ liệu cũ thì mỗi trạng thái cũ ra đúng trạng thái mới và hiệu lực [test: apps/hub-api/src/modules/packs/contracts/adapters/contract-state.backfill.int.test.ts » backfill 9→4]
- Kịch bản: khi ghi thẳng cột trạng thái ngoài cổng thì DB từ chối [test: apps/hub-api/src/modules/packs/contracts/adapters/contract-state.repo.int.test.ts » ghi thẳng status bị chặn]
- Kịch bản: khi chuyển không có trong bảng thì báo STATE_CONFLICT [test: apps/hub-api/src/modules/packs/contracts/domain/contract-state.rules.test.ts » chuyển cấm]
- Kịch bản: khi tạo giao dịch, nhập dữ liệu hoặc nâng cấp HĐ thì bản ghi ở DONE ngay [test: apps/hub-api/src/modules/packs/contracts/domain/contract-state.rules.test.ts » initialState]
- Kịch bản: khi Xác nhận & lưu mà công ty không có quy trình thì DONE và ghi "chưa có quy trình duyệt" [test: apps/hub-api/src/modules/packs/contracts/application/submit.usecase.int.test.ts » không quy trình ⇒ DONE]
- Kịch bản: khi người gửi Rút về lúc bước hiện tại chưa ai quyết thì về DRAFT, đã có người quyết thì từ chối có lý do [test: apps/hub-api/src/modules/packs/contracts/application/withdraw.usecase.int.test.ts » rút về]
- Kịch bản: khi Gửi lại sau Trả lại thì chạy từ bước đầu và hồ sơ giữ lượt trước [test: apps/hub-api/src/modules/packs/contracts/application/submit.usecase.int.test.ts » gửi lại chạy từ đầu]
- Kịch bản: khi lượt chạy bị huỷ hoặc lỗi thì HĐ về DRAFT kèm lý do [test: apps/hub-api/src/modules/packs/contracts/application/submit.usecase.int.test.ts » lượt huỷ]
- Kịch bản: khi HĐ bị từ chối thì "Tạo hợp đồng mới từ văn bản này" ra HĐ DRAFT có tệp và trường [test: apps/hub-api/src/modules/packs/contracts/application/recreate.usecase.int.test.ts » recreate]
- Kịch bản: khi ngày thay đổi thì hiệu lực tính lại đúng theo múi giờ công ty, bản đã thay thế không tính [test: apps/hub-api/src/modules/packs/contracts/domain/effect.rules.test.ts » bảng hiệu lực]
- Kịch bản: khi HĐ đang PROCESSING hoặc DONE thì sửa trường bị chặn [test: apps/hub-api/src/modules/packs/contracts/application/patch-fields.lock.int.test.ts » khoá nội dung]

### ADDED sht/thuc-hien-hop-dong.md
#### Yêu cầu: Ghi việc đã làm vào mốc là đường duy nhất cho giao/nhận/thu/chi của HĐ
Xác nhận mốc và giao dịch gắn HĐ cùng một thao tác; làm thiếu sinh mốc con; tạm khoá chặn giao nhận nhưng cho thu; thay đổi cam kết cần bằng chứng và có thể chờ duyệt; phạt ước tính, ghi công nợ hoặc miễn.
- Kịch bản: khi giao thiếu và chọn giữ hạn thì mốc gốc xong với số thật và có mốc con phần còn lại cùng hạn [test: apps/hub-api/src/modules/packs/contracts/application/fulfill.usecase.int.test.ts » giao thiếu keep]
- Kịch bản: khi ghi vượt phần còn lại thì OVER_PLAN [test: apps/hub-api/src/modules/packs/contracts/application/fulfill.usecase.int.test.ts » vượt kế hoạch]
- Kịch bản: khi ghi bán gắn HĐ thì không tạo chứng từ giao dịch mà ghi vào mốc [test: apps/hub-api/src/modules/packs/contracts/adapters/deals.link.int.test.ts » link mốc]
- Kịch bản: khi HĐ tạm khoá thì xác nhận giao bị chặn nhưng ghi tiền thu được [test: apps/hub-api/src/modules/packs/contracts/application/fulfill.usecase.int.test.ts » hold]
- Kịch bản: khi giao dịch cần duyệt thì kho/công nợ chưa đổi tới khi duyệt xong [test: apps/hub-api/src/modules/packs/contracts/application/exec-request.usecase.int.test.ts » transaction pending]
- Kịch bản: khi bản mới DONE thì mốc còn mở chuyển sang bản mới [test: apps/hub-api/src/modules/packs/contracts/adapters/versions.carry.int.test.ts » chuyển mốc]
- Kịch bản: khi ghi phạt vào công nợ thì sinh nghĩa vụ phạt đúng chiều bên vi phạm [test: apps/hub-api/src/modules/packs/contracts/application/penalty.usecase.int.test.ts » book]
- Kịch bản: khi HĐ vào DONE thì AI lập mốc có điều khoản gốc [test: apps/hub-api/src/modules/packs/contracts/adapters/contract-done.hook.int.test.ts » lập mốc]

### ADDED sht/ky-cung-luc.md
#### Yêu cầu: Hai công ty trên Evolu ký cùng lúc qua phiên ký chung
Bên nhận đồng ý trước; mỗi bên một phong bì cùng một bản; cả hai ký ⇒ DONE hai bên; từ chối/huỷ/quá hạn xử lý theo bảng chuyển; bên kia chỉ thấy tên công ty + người ký.
- Kịch bản: khi cả hai bên ký thì hai HĐ cùng DONE [test: apps/hub-api/src/modules/partners/sign-session.int.test.ts » done hai bên]
- Kịch bản: khi một bên từ chối ký thì cả hai REJECT và phong bì bị huỷ [test: apps/hub-api/src/modules/partners/sign-session.int.test.ts » một bên từ chối]
- Kịch bản: khi huỷ phiên ký thì hai bên về DRAFT [test: apps/hub-api/src/modules/partners/sign-session.int.test.ts » huỷ phiên]
- Kịch bản: khi quá hạn trả lời thì bên nhận xử lý bình thường và bên gửi được báo [test: apps/hub-api/src/modules/partners/sign-session.int.test.ts » fallback]
- Kịch bản: khi tenant ngoài phiên gọi hàm phiên thì bị từ chối [test: apps/hub-api/src/modules/partners/sign-session.int.test.ts » cách ly]

### ADDED engine/nhan-viec-uy-quyen.md
#### Yêu cầu: Nhận việc nhóm, "Cần: tất cả" và uỷ quyền
- Kịch bản: khi hai người nhận cùng lúc thì một người được, người kia thấy tên người đã nhận [test: apps/hub-api/src/modules/processes/gates/claim.int.test.ts » đua nhận việc]
- Kịch bản: khi nhận mà quá hạn không quyết thì việc tự về nhóm và báo trưởng phòng [test: apps/hub-api/src/modules/processes/application/notify/claim-release.int.test.ts » tự trả]
- Kịch bản: khi bước cần tất cả thì đủ phiếu mới duyệt, một người trả lại thì đóng ngay [test: apps/hub-api/src/modules/processes/gates/vote-all.int.test.ts » n/n]
- Kịch bản: khi A uỷ quyền cho B thì việc đích danh mới của A giao cho B kèm "Thay A" [test: apps/hub-api/src/modules/processes/delegations/delegation.int.test.ts » việc mới sang B]
- Kịch bản: khi B là người gửi hoặc tạo chuỗi uỷ quyền thì không áp [test: apps/hub-api/src/modules/processes/domain/tasks/delegation.rules.test.ts » giới hạn]
- Kịch bản: khi mốc còn N ngày tới hạn thì phòng phụ trách có việc Xác nhận mốc, người khác bị chặn sau khi có người nhận, mốc xong thì việc đóng [test: apps/hub-api/src/modules/packs/contracts/application/milestone-task.int.test.ts » việc xác nhận mốc]

### ADDED engine/bang-chung.md
#### Yêu cầu: Bằng chứng dùng chung, không sửa được
- Kịch bản: khi Duyệt ở bước cần "ý kiến + chữ ký hoặc tệp" mà thiếu thì EVIDENCE_REQUIRED [test: apps/hub-api/src/modules/processes/gates/evidence.int.test.ts » thiếu bằng chứng]
- Kịch bản: khi sửa hoặc xoá bằng chứng thì DB từ chối [test: apps/hub-api/src/modules/processes/gates/evidence.int.test.ts » bất biến]
- Kịch bản: khi người chỉ xem mở lượt chạy thì không thấy ý kiến/tệp [test: apps/hub-api/src/modules/processes/gates/evidence.int.test.ts » ẩn với người chỉ xem]

### ADDED engine/trigger-lich.md
#### Yêu cầu: Kiểu bắt đầu theo lịch có tham số N
- Kịch bản: khi vòng quét chạy hai lần cùng ngày thì chỉ một lượt chạy [test: apps/hub-api/src/modules/processes/triggers/schedule-sweep.int.test.ts » idempotent]
- Kịch bản: khi hai quy trình cùng sự kiện khác N thì mỗi quy trình chỉ chạy với N của mình [test: apps/hub-api/src/modules/processes/triggers/schedule-sweep.int.test.ts » khác N]
- Kịch bản: khi lô 100 thì p95 ≤ 50 ms và số câu SQL cố định [test: apps/hub-api/src/modules/processes/triggers/schedule-sweep.perf.int.test.ts » lô 100]

### ADDED engine/chay-thu.md
#### Yêu cầu: Chạy thử quy trình không tạo dữ liệu thật
- Kịch bản: khi chạy thử với giá trị trên ngưỡng thì đi nhánh Đúng và liệt kê người nhận việc [test: apps/hub-api/src/modules/processes/library/flow-preview.test.ts » nhánh và người nhận]
- Kịch bản: khi chạy thử thì không có hàng mới trong DB [test: apps/hub-api/src/modules/processes/library/flow-preview.int.test.ts » không ghi]

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Chỉ quản trị nền tảng soạn quy trình; màn soạn danh sách dọc; Áp dụng
- Kịch bản: khi quản trị công ty gọi route ghi bản công ty thì 403 [test: apps/hub-api/src/modules/processes/library/company-flows.authz.int.test.ts » chỉ xem]
- Kịch bản: khi mở rồi lưu lại mọi mẫu Thư viện qua danh sách dọc thì stages không đổi [test: apps/admin-web/src/features/processes/lib/outline.test.ts » round-trip]

### MODIFIED engine/node-palette.md
#### Yêu cầu: Menu bước theo nghiệp vụ
- Kịch bản: khi mở menu "+" của quy trình hợp đồng thì chỉ có các nhóm nghiệp vụ [test: apps/admin-web/src/features/processes/lib/node-menu.test.ts » menu nghiệp vụ]

### MODIFIED sht/gui-doi-tac-xac-nhan.md
#### Yêu cầu: Bên nhận theo 4 trạng thái, bản sửa vào cùng HĐ, danh sách chung có bộ lọc Nguồn
- Kịch bản: khi đối tác gửi bản sửa sau Trả lại thì cùng HĐ nhận chạy lại từ đầu [test: apps/hub-api/src/modules/packs/contracts/adapters/partner-inbox.state.int.test.ts » bản sửa cùng HĐ]
- Kịch bản: khi bên nhận không có quy trình nhận thì người phụ trách HĐ nhận có việc Đồng ý / Trả lại / Từ chối [test: apps/hub-api/src/modules/packs/contracts/adapters/partner-inbox.state.int.test.ts » không quy trình nhận]
- Kịch bản: khi lọc Nguồn "Đối tác gửi" thì chỉ ra HĐ nhận [test: apps/hub-api/src/modules/packs/contracts/adapters/contracts.list.int.test.ts » lọc nguồn]

### MODIFIED sht/mot-moc-kho-cong-no.md
#### Yêu cầu: Mốc có hàng con phần còn lại; giao dịch gắn HĐ ghi vào mốc
- Kịch bản: khi thu thiếu thì công nợ = phần còn lại, không đếm đôi [test: apps/hub-api/src/modules/packs/contracts/application/fulfill.usecase.int.test.ts » tiền thiếu]

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Chứng từ giao dịch chỉ tạo khi "Không theo hợp đồng" (kèm lý do)
- Kịch bản: khi đối tác có HĐ DONE chứa sản phẩm mà không chọn HĐ hay lý do thì LINK_REQUIRED [test: apps/hub-api/src/modules/packs/contracts/adapters/deals.link.int.test.ts » bắt buộc chọn]

### MODIFIED sht/phap-ly-va-can-xu-ly.md
#### Yêu cầu: Sắp hết hạn là quy trình; gỡ "Hạn chót hành động + Ghi nhận xử lý"
- Kịch bản: khi quyết Gia hạn thì có HĐ gia hạn DRAFT liên kết và HĐ cũ "Đã gia hạn" khi HĐ mới DONE [test: apps/hub-api/src/modules/packs/contracts/application/expiring-outcome.int.test.ts » gia hạn]

### MODIFIED sht/mo-lai-platform-admin.md
#### Yêu cầu: Bỏ mở lại hợp đồng đã khoá; sửa sau DONE đi qua phiên bản mới
- Kịch bản: khi gọi mở lại HĐ thì không còn route [test: apps/hub-api/src/modules/packs/contracts/adapters/manage.routes.int.test.ts » reopen đã gỡ]

### MODIFIED pack-contracts/esign-node-due.md
#### Yêu cầu: Hạn ký theo giờ
- Kịch bản: khi đặt hạn 4 giờ thì lượt chờ hết hạn sau 4 giờ [test: packages/contracts/src/pack-contracts/esign-node.test.ts » due_hours]

## 8. Việc còn lại / rủi ro
1. **Rủi ro lớn nhất — cổng trạng thái + đổi 124 file**: prod chưa có người dùng (người dùng 2026-11-10) ⇒ rủi ro dữ liệu khách thấp, không đếm trên bản sao prod; backfill vẫn chạy cho staging/seed (điều kiện `c.run_id = a.id`, đếm + RAISE trong migration, ops-watch drift). Rủi ro còn lại là đường ghi sót.
2. Cổng + trigger chặn: đường ghi sót sẽ nổ runtime — §3a đã liệt kê 124 file; K1b int mỗi đường ghi.
3. Không commit + một working tree: khôi phục bằng `<lát>.patch` + stash ref (§1); typecheck lẫn lát khác.
4. Prod chưa có người dùng ⇒ dự kiến deploy một đợt; chốt chặn 0099 vẫn giữ (RAISE ⇒ tách hai đợt).
5. Độ trễ dispatcher với "ghi ngay" giao dịch nhỏ và "Áp dụng" — UI "Đang kiểm duyệt…".
6. `outline.ts` không biểu diễn cạnh tự do ⇒ chỉ xem + sao chép.
7. Ký cùng lúc chỉ selfsign (Q9).
8. ≈150 file test đụng trạng thái cũ: test khoá chỉ Q1 sửa; lát gặp ⇒ "Tranh chấp test".
9. Đã chốt #20, #21, Câu 3–5 (2026-11-10); đã áp readiness lần 2 (#50–#70) và lần 3 (#71–#74 + TB/Thấp): 40 lát, đường găng 16 lát. Chạy readiness lần 4 trước W1.

## 9. Mã lỗi — câu VI (readiness #28)
| Mã | HTTP | Câu hiển thị |
|---|---|---|
| `STATE_CONFLICT` | 409 | Hợp đồng vừa đổi trạng thái (nay: {status}). Tải lại trang rồi thử lại. |
| `STATUS_GATE_ONLY` | 500 | Lỗi hệ thống khi đổi trạng thái. Báo quản trị. |
| `CONTRACT_NOT_DRAFT` | 409 | Chỉ gửi được hợp đồng ở DRAFT. |
| `EXTRACT_NOT_READY` | 409 | AI chưa đọc xong hợp đồng — chờ hoặc bấm Đọc lại. |
| `UNCHANGED_REASON_REQUIRED` | 422 | Bạn chưa đổi gì so với lần trước — ghi lý do gửi lại. |
| `FILE_REQUIRED` | 422 | Tải văn bản hợp đồng lên trước khi gửi. |
| `WITHDRAW_NOT_ALLOWED` | 409 | Không rút về được: {người} đã quyết ở bước {bước} / chỉ người gửi được rút / hợp đồng không còn đang duyệt. |
| `CONTRACT_NOT_REJECTED` | 409 | Chỉ tạo lại từ hợp đồng bị từ chối. |
| `USE_NEW_VERSION` | 409 | Đổi giá trị, đơn giá, các bên hoặc điều khoản cần Tải phiên bản mới. |
| `HOLD_EXISTS` / `NOT_HELD` | 409 | Hợp đồng đang tạm khoá. / Hợp đồng không bị tạm khoá. |
| `HOLD_FORBIDDEN` | 403 | Chỉ người phụ trách, trưởng phòng của họ hoặc quản trị công ty được tạm khoá/mở khoá. |
| `CONTRACT_ON_HOLD` | 409 | Đang tạm khoá bởi {người}: {lý do} — chỉ ghi được tiền thu. |
| `EVIDENCE_REQUIRED` | 422 | Cần ý kiến và chữ ký hoặc ít nhất một tệp. |
| `FEEDBACK_REQUIRED` | 422 | Ghi ý kiến khi Trả lại hoặc Từ chối. |
| `OVER_PLAN` | 422 | Vượt phần còn lại của mốc ({còn lại}). Giảm số hoặc chọn mốc khác. |
| `OBLIGATION_CLOSED` | 409 | Mốc đã xong. |
| `CHANGE_PENDING` / `CHANGE_PENDING_EXISTS` | 409 | Mốc đang có yêu cầu thay đổi chờ duyệt. |
| `LINK_REQUIRED` | 422 | Đối tác có hợp đồng còn hiệu lực chứa sản phẩm này — chọn hợp đồng hoặc "Không theo hợp đồng". |
| `LINK_REASON_REQUIRED` | 422 | Ghi lý do không theo hợp đồng. |
| `LINK_MIXED` | 422 | Một giao dịch chỉ ghi vào một mốc; tách dòng sản phẩm ngoài hợp đồng thành giao dịch khác. |
| `PENALTY_DECIDED` | 409 | Phạt của mốc này đã được quyết. |
| `PARTNER_EMAIL_MISSING` | 422 | Đối tác chưa có email — thêm email ở trang đối tác. |
| `SESSION_NOT_ACTIVE` / `SESSION_FORBIDDEN` / `SESSION_HASH_MISMATCH` | 409 / 403 / 422 | Phiên ký đã kết thúc. / Không thuộc phiên ký này. / Văn bản ký khác bản đã thống nhất — huỷ phiên và gửi lại. |
| `TASK_CLAIMED` | 409 | {người} vừa nhận việc này. |
| `TASK_NOT_CLAIMABLE` / `TASK_CLOSED` | 409 | Việc này không cần nhận. / Việc đã xong. |
| `TASK_NOT_CLAIMED` | 409 | Bấm Nhận việc trước khi xác nhận mốc. |
| `TASK_CLAIMED` (từ giao dịch gắn mốc) | 409 | Mốc đang do {người} xử lý — nhờ họ xác nhận hoặc chọn Không theo hợp đồng. |
| `INBOX_NOT_AWAITING` | 409 | Hợp đồng này không chờ bạn quyết. |
| `INBOX_DECISION_FORBIDDEN` | 403 | Chỉ người phụ trách hợp đồng nhận hoặc quản trị công ty quyết được. |
| `NOT_CLAIMER` / `NOT_GROUP_HEAD` | 403 | Bạn không giữ việc này. / Chỉ trưởng phòng hoặc quản trị công ty giao lại được. |
| `TARGET_NOT_IN_GROUP` | 422 | Người được giao phải thuộc phòng của bước này. |
| `FORWARD_REASON_REQUIRED` | 422 | Ghi lý do chuyển việc. |
| `DELEGATE_SELF` / `DELEGATE_CHAIN` | 422 | Không uỷ quyền cho chính mình. / Người này đang uỷ quyền cho người khác — chọn người khác. |
| `DELEGATE_NOT_SIGNER` | 422 | Uỷ quyền ký số chỉ cho người trong nhóm Người ký HĐ. |
| `DELEGATE_NO_ACCESS` | 422 | Người được uỷ quyền không xem được hợp đồng này. |
| `DELEGATE_FORBIDDEN` | 403 | Chỉ quản trị công ty hoặc trưởng phòng đặt uỷ quyền thay người khác. |
| `FORBIDDEN_TENANT_ADMIN_WRITE` | 403 | Quy trình do quản trị nền tảng soạn; bạn chỉ xem được. |
| `TRIGGER_PARAM_RANGE` / `CLAIM_HOURS_RANGE` | 422 | N phải từ 1 tới 365 ngày. / Số giờ từ 1 tới 168. |
| `ESCALATE_TARGET_REQUIRED` | 422 | Chọn phòng hoặc người nhận khi quá hạn. |

### §9 bổ sung (X3, 2026-11-10)
| Mã | HTTP | Câu VI |
|---|---|---|
| `HOLD_NOT_ALLOWED` | 409 | Chỉ tạm khoá được hợp đồng đã duyệt và còn hiệu lực. |
| `CHANGE_FORBIDDEN` | 403 | Chỉ người phụ trách hoặc quản trị công ty được yêu cầu thay đổi thực hiện của hợp đồng. |
| `CHANGE_INVALID` | 422 | Yêu cầu không áp dụng được cho mốc này (tách chỉ cho mốc tiền còn đủ số; miễn phạt chỉ cho mốc phạt). |
