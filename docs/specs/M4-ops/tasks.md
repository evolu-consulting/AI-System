# Tasks · M4-ops

Khung do docs-architect tạo (2026-10-03). `backend-lead` / `frontend-lead` điền chi tiết (file, lệnh xong) ở P1/P2 và thêm/tách task. Mỗi task: một commit `[FR]`, diff ≈ ≤ 400 dòng. Tick khi lệnh "xong" xanh. `blocked` kèm lý do → báo cáo cuối.
Cột `Đọc`: đúng các mục tài liệu task cần. Cột `Rủi ro` (`cao` / `thường`): quyết định model, định nghĩa ở `docs/WORKFLOW.md` "Chính sách model". Khối A/B/C/D theo spec §1; có thể cắt M4a = A+B, M4b = C+D (spec §9 Q0).
Lệnh xong mọi task: kèm `bun run depcruise --all && bun run check:fn --all`. "chung" (BE khối A+B, plan §10) = `bun run typecheck && bun test <file> && bun run check:fn --files <file đổi> && bun run depcruise --all && bun run test:lock:verify` (FE thêm `check:size`). Đo hiệu năng **không** nằm trong lệnh xong.

## Chuẩn bị (trước Gate)

| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| P1 | Plan BE (≤ 30 KB): contract, migration, audit hook, evaluator, mail, import, TOTP | backend-lead | cao | `spec §2–4, §9 Q0–Q13`; `ba-admin §5.6–5.7, §7–8`; `missing-screens §14` | `docs/specs/M4-ops/plan.md` (A+B, + `plan-rules.md`), `plan-cd.md` (C+D) | — | `wc -c plan.md` ≤ 30720 | [ ] |
| P2 | Plan FE (≤ 25 KB): màn, trạng thái, câu chữ VI/EN, nhãn e2e | frontend-lead | thường | `spec §5`; `missing-screens §1, 7, 8, 10, 12`; canvas (trỏ) | `docs/specs/M4-ops/plan-frontend.md` | P1 (contract) | `wc -c` ≤ 25600 | [ ] |
| P3 | ADR-0004 thư viện mới (`nodemailer`, `qrcode`, `recharts`) | backend-lead | thường | `spec §9 Q3`; `adr/0001-stack.md` | `docs/adr/0004-*.md` | P1 | — | [ ] |
| Q1 | Test-plan (≤ 30 KB): AC → test, dữ liệu, kỳ vọng | qc | cao | `spec §2, §8`; `plan §3–4` | `docs/specs/M4-ops/test-plan.md` | P1, P2 | `wc -c` ≤ 30720 | [ ] |
| G1 | spec-readiness + Gate M4 (tự duyệt Luật 2b nếu đủ điều kiện) | spec-readiness | cao | toàn bộ `spec`, `plan*`, `test-plan`, `tasks` | `readiness.md`, `docs/specs/M4-gate.md` | P1–P3, Q1 | READY | [ ] |
| Q2 | Viết test khoá (đỏ đúng lý do) | qc | cao | `test-plan` | `tests/acceptance/M4/**`, `e2e/**` | G1 | `bun test` đỏ đúng lý do | [ ] |
| Q3 | Khoá test | qc | thường | `WORKFLOW` khoá test | `tests/.lock` | Q2 | `bun run test:lock:verify` | [ ] |

## BUILD backend (số task và tách nhỏ do P1 chốt)

| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| T0 | Nền DB: schema `ops.ts` + `0007_m4_ops` (3 bảng, `updated_by`, RLS nối tay, append-only, `hub_ro`), `client.listen`, `insertAuditRows` | backend-lead | cao | `plan §3`, `§4.1` hàng withConfigWrite, `§8` hàng ops-rls | `packages/db/**` | Q3 | `bun run db:migrate && bun run test:int packages/db` + chung | [ ] |
| T0b | Contracts A+B: `quotas`, `usage`, `overview`, `audit`; mã lỗi mới; `quota` vào `CONFIG_ENTITIES`; `updated_by` Tenant/User | backend-lead | thường | `plan §2` | `packages/contracts/src/**` | T0 | `bun test packages/contracts` + chung | [ ] |
| T0m | `mock:quota` (+ `--seed`) và index stub `usage_logs (at)` | backend-lead | thường | `plan §7` | `tools/mocks/src/quota.ts`, `packages/db/migrations-dev/0002_*`, `package.json` | T0 | `bun run mock:quota -- --tenant acme --seed` + chung | [ ] |
| T1 | B · Lõi audit: `ch.audit` trong `withConfigWrite` (sau bump), `ConfigCall.actor`, `lib/audit/audit.rules`, `recordAudit` | backend-lead | cao | `plan §4.1`, `§6` hàng 15, `plan-rules §A1` | `apps/admin-api/src/lib/{audit,config}`, `packages/db/src/config-meta.ts` | T0, T0b | `bun run test:int config-write` + chung | [ ] |
| T1b | B · Audit M1 (tenants, users, reset) + `updated_by` users/tenants (CR-016, TD #7, #9) | backend-lead | cao | `plan §4.2` hàng tenants/users, `§2.5` | `modules/{tenants,users}/*` | T1 | `bun run test:int tenants users` + M4-AC04/05 (user) + chung | [ ] |
| T1c | B · Audit M2/M3 (workflows, commands, features, entitlements, secrets, groups, members, grants, batch) + bật bất biến event⇔audit (TD #20) | backend-lead | cao | `plan §4.1` bất biến, `§4.2` | `modules/{workflows,commands,features,secrets,groups,grants}/*` | T1b | `bun run test:int` + M4-AC04–AC06 + chung | [ ] |
| T2 | B · Đọc audit: list/detail, filter, cursor, RLS | backend-lead | cao | `plan §2.4`, `§4.3`, `plan-rules §A2` | `modules/audit/{routes,service,repo,rules}.ts` | T1c | M4-AC07 (đọc), AC-A09 (audit) + chung | [ ] |
| T3 | A · Quota `GET/PUT /admin/tenants/:id/quotas` (version tenant) + audit | backend-lead | cao | `plan §2.1`, `§3.1`, `§6` Quota PUT, `plan-rules §A4` (normalize, duplicate, pct) | `modules/quotas/{routes,service,repo,rules}.ts` | T1c | quota int + ca lock-order Quota PUT ∥ Feature DELETE + chung | [ ] |
| T2b | B · Khôi phục + adapter command/workflow/feature/group/quota | backend-lead | cao | `plan §4.4`, `§6` Restore, `plan-rules §A3` | `modules/audit/audit.restore.ts`, `modules/*/<m>.restore.ts` | T2, T3 | M4-AC07 (403), AC08 + chung | [ ] |
| T4 | A · Evaluator + `quota_alerts` + mail (mailer của TM) + LISTEN `quota_threshold` + `GET /admin/quota-banner` | backend-lead | cao | `plan §5.1–5.3`, `§6` Evaluator, `plan-rules §A4` | `modules/quotas/{evaluator,alerts,listener}.ts`, `server.ts` | T3, TM | M4-AC01, AC02, AC-A12 + chung | [ ] |
| T5 | A · `GET /admin/usage` + `usage.csv` (cost chỉ platform) | backend-lead | cao | `plan §2.2`, `§5.4`, `plan-rules §A5` | `modules/usage/*` | T3, T0m | M4-AC03, AC-A09 (usage) + chung | [ ] |
| T6 | A · `GET /admin/overview` (2 role) | backend-lead | thường | `plan §2.3`, `§5.5` | `modules/overview/*` | T4, T5 | M4-AC13 (API) + chung | [ ] |
| T7 | C · Export yaml (`ConfigFileSchema`, key, không giá trị secret) | backend-lead | cao | `spec §2 R14`, AC-A06 | `modules/transfer` | T1 | M4-AC09 (export) | [ ] |
| T8 | C · Import dry-run + áp dụng (1 transaction, `secrets{}`, audit `import`, NOTIFY) | backend-lead | cao | `spec §2 R14, R15`, `§9 Q11` | `modules/transfer` | T7 | M4-AC09, AC10 | [ ] |
| T9 | D · 2FA BE: setup/enable/disable/verify/backup, login `totp_required`, tắt hộ | backend-lead | cao | `spec §2 R16`, `§9 Q10`; `missing-screens §10, §14.1` | `modules/auth` | T1 | M4-AC11, AC12 | [ ] |

## BUILD frontend (tách nhỏ theo plan-frontend)

| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| FE0 | Chung: QuotaBar, DiffViewer, DateRangePicker, InputOTP, biểu đồ, banner quota, modal 409 có `{user}` + "Lịch sử" | frontend-lead | thường | `plan-frontend §…`; `missing-screens §7.2, §12.5` | `apps/admin-web/src/components/shared`, `features/shell` | Q3 | `bun run typecheck && bun test` + `depcruise --all` | [ ] |
| FE1 | A · Tenant › tab Quota | frontend-lead | thường | `plan-frontend §…`; canvas `TenantQuota` | `features/tenants` | T3, FE0 | `bunx playwright test M4` (Quota) | [ ] |
| FE2 | A · Chi phí & quota + CSV | frontend-lead | thường | canvas `Usage`; `ui-admin 7.16` | `features/usage` | T5, FE0 | e2e Usage | [ ] |
| FE3 | A · Tổng quan (2 role) + banner | frontend-lead | thường | canvas `Main`, `TenantOverview` | `features/overview`, `features/shell` | T4, T6, FE0 | e2e Overview | [ ] |
| FE4 | B · Nhật ký + chi tiết + Khôi phục | frontend-lead | thường | canvas `Audit`, `States`; `missing-screens §7` | `features/audit` | T2, FE0 | e2e Audit | [ ] |
| FE5 | C · Import/Export | frontend-lead | thường | canvas `ImportPreview`; `missing-screens §8` | `features/transfer` | T8, FE0 | e2e Transfer | [ ] |
| FE6 | D · 2FA (trang bật/tắt, bước đăng nhập, tắt hộ ở Users) | frontend-lead | cao | canvas `Enable2FA`; `missing-screens §10` | `features/auth`, `features/users` | T9, FE0 | e2e 2FA | [ ] |

## Nghiệm thu & đóng mốc

| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| TN | Lệnh xong M4 (Lệnh xong M0 + AC M4; **không** `test:perf`) | điều phối | thường | `CLAUDE.md` "Lệnh xong M0"; `spec §8` | — | T0–T9, FE0–FE6 | toàn bộ xanh | [ ] |
| R1 | Review (≤ 2 vòng) | reviewer | cao | `git diff`, `spec §2` | — | TN | APPROVED | [ ] |
| D1 | Đồng bộ docs: CODEMAP, TRACE, README module, STATE, ROADMAP, PRODUCTION-NOTES; đóng TD #7, #9, #20 | docs-architect | thường | `WORKFLOW` Việc 2 | `docs/**` | R1 | `bun run trace --check` | [ ] |
| H1 | Bật service + hướng dẫn người dùng test toàn bộ admin app | điều phối | thường | `STATE` | — | D1 | — | [ ] |
