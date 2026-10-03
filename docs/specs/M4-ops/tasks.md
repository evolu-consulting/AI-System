# Tasks · M4-ops

Khung do docs-architect tạo (2026-10-03). `backend-lead` / `frontend-lead` điền chi tiết (file, lệnh xong) ở P1/P2 và thêm/tách task. Mỗi task: một commit `[FR]`, diff ≈ ≤ 400 dòng. Tick khi lệnh "xong" xanh. `blocked` kèm lý do → báo cáo cuối.
Cột `Đọc`: đúng các mục tài liệu task cần. Cột `Rủi ro` (`cao` / `thường`): quyết định model, định nghĩa ở `docs/WORKFLOW.md` "Chính sách model". Khối A/B/C/D theo spec §1; có thể cắt M4a = A+B, M4b = C+D (spec §9 Q0).
Lệnh xong mọi task: kèm `bun run depcruise --all && bun run check:fn --all` (FE thêm `check:size`). Đo hiệu năng **không** nằm trong lệnh xong.

## Chuẩn bị (trước Gate)

| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| P1 | Plan BE (≤ 30 KB): contract, migration, audit hook, evaluator, mail, import, TOTP | backend-lead | cao | `spec §2–4, §9 Q0–Q13`; `ba-admin §5.6–5.7, §7–8`; `missing-screens §14` | `docs/specs/M4-ops/plan.md` | — | `wc -c plan.md` ≤ 30720 | [ ] |
| P2 | Plan FE (≤ 25 KB): màn, trạng thái, câu chữ VI/EN, nhãn e2e | frontend-lead | thường | `spec §5`; `missing-screens §1, 7, 8, 10, 12`; canvas (trỏ) | `docs/specs/M4-ops/plan-frontend.md` | P1 (contract) | `wc -c` ≤ 25600 | [ ] |
| P3 | ADR-0004 thư viện mới (`nodemailer`, `qrcode`, `recharts`) | backend-lead | thường | `spec §9 Q3`; `adr/0001-stack.md` | `docs/adr/0004-*.md` | P1 | — | [ ] |
| Q1 | Test-plan (≤ 30 KB): AC → test, dữ liệu, kỳ vọng | qc | cao | `spec §2, §8`; `plan §3–4` | `docs/specs/M4-ops/test-plan.md` | P1, P2 | `wc -c` ≤ 30720 | [ ] |
| G1 | spec-readiness + Gate M4 (tự duyệt Luật 2b nếu đủ điều kiện) | spec-readiness | cao | toàn bộ `spec`, `plan*`, `test-plan`, `tasks` | `readiness.md`, `docs/specs/M4-gate.md` | P1–P3, Q1 | READY | [ ] |
| Q2 | Viết test khoá (đỏ đúng lý do) | qc | cao | `test-plan` | `tests/acceptance/M4/**`, `e2e/**` | G1 | `bun test` đỏ đúng lý do | [ ] |
| Q3 | Khoá test | qc | thường | `WORKFLOW` khoá test | `tests/.lock` | Q2 | `bun run test:lock:verify` | [ ] |

## BUILD backend (số task và tách nhỏ do P1 chốt)

| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| T0 | Nền: migration `audit_log`, `tenant_quotas`, `quota_alerts`, cột TOTP, `updated_by`; RLS; contracts; mocks `mock:quota` + seed usage | backend-lead | cao | `plan §…`, `spec §4 R02, R10, R11, R16`; `ba-admin §7` | `packages/db`, `packages/contracts`, `tools/mocks` | Q3 | `bun run db:migrate && bun test packages/db` | [ ] |
| T1 | B · Ghi audit trong `configWrite` + thao tác user/tenant (allowlist, secret "đã đổi"), `updated_by` users/tenants | backend-lead | cao | `spec §2 R10, R11, R17`; `plan §…` | `apps/admin-api/src/lib/config`, `modules/*` | T0 | `bun test:int` phần audit, M4-AC04–AC06 | [ ] |
| T2 | B · Đọc audit (lọc, con trỏ, RLS) + Khôi phục | backend-lead | cao | `spec §2 R12, R13`, `§9 Q7–Q8` | `modules/audit` | T1 | M4-AC07, AC08 | [ ] |
| T3 | A · Quota: `GET/PUT /admin/tenants/:id/quotas` + audit | backend-lead | cao | `spec §2 R02, R03`, `§9 Q9` | `modules/quotas` | T1 | quota int | [ ] |
| T4 | A · Evaluator ngưỡng + `quota_alerts` + mail (Mailpit) + banner API | backend-lead | cao | `spec §2 R04–R06`, `§9 Q2b` | `modules/quotas`, `lib/mailer` | T3, P3 | M4-AC01, AC02, AC-A12 | [ ] |
| T5 | A · `GET /admin/usage` + CSV (cost_usd chỉ platform) | backend-lead | cao | `spec §2 R03, R07–R09` | `modules/usage` | T0 | M4-AC03, AC-A09 | [ ] |
| T6 | A · `GET /admin/overview` (2 role) | backend-lead | thường | `spec §2 R09`, `§9 Q5`; `missing-screens §1` | `modules/overview` | T4, T5 | M4-AC13 (API) | [ ] |
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
