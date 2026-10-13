# Tasks · H4b1-secrets

Khung — chưa PLAN. Mỗi task: một commit `[FR]`, diff ≈ ≤ 400 dòng. Tick khi lệnh "xong" xanh. `blocked` kèm lý do → báo cáo cuối.
Cột `Đọc`: đúng các mục cần. `Rủi ro`: `docs/WORKFLOW.md` "Chính sách model". Thứ tự mốc: sau X2b-2, trước K1 (người dùng 2026-10-13).

| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| T0 | PLAN BE (`plan.md`: contract, DDL, `useSecret`, RLS, audit) | backend-lead | cao | `spec §2,§3,§4`, ADR-0012 §1 | `docs/specs/H4b1-secrets/plan.md` | — | — | [ ] |
| T1 | PLAN FE (`plan-frontend.md`: Studio /secrets) | frontend-lead | thường | `spec §5`, `ui-agent-studio §11` | `docs/specs/H4b1-secrets/plan-frontend.md` | — | — | [x] |
| T2 | qc: test-plan + test khoá (AC-H4b1-01…08) | qc | cao | `spec §8` | `tests/acceptance/H4b1/**`, `e2e/H4b1/**` | T0, T1 | `bun run test:lock:verify` | [ ] |
| T3 | spec-readiness + Gate (Luật 2b) | spec-readiness | — | spec, readiness.md | `readiness.md` | T2 | — | [ ] |
| T4 | Contract `hub-admin/secrets.ts` + DDL `hub.secrets` + RLS + schema Drizzle + `HUB_SECRETS_KEY` (env, `keys:dev`) | backend-lead | cao | plan §1, §4 | `packages/contracts/src/hub-admin/`, `packages/db/` | T3 | `bun run db:migrate && bun test packages/contracts` | [ ] |
| T5 | Dịch vụ secrets: mã hoá/AAD, ghi/thay/xoá/liệt kê, `used_by`, audit, `hub_config_version`, `useSecret` | backend-lead | cao | plan §2 | `apps/hub-api/src/modules/secrets/**` | T4 | `bun run test:int` | [ ] |
| T6 | Studio `/studio/secrets` (Sheet, SecretValueField, i18n VI/EN, nav link, `ConflictDialog` ẩn diff khi `rows=[]`, `api-error` KNOWN) | frontend-lead | thường | plan-frontend §0–§5, §8 | `apps/studio-web/src/features/secrets/**`, `src/routes/_authed/secrets.tsx`, `src/features/shell/lib/nav.ts`, `src/components/shared/conflict/ConflictDialog.tsx`, `packages/i18n/locales/studio/*.json` | T4 | `bun run typecheck && bun run i18n:check && bunx playwright test e2e/H4b1` | [ ] |
| T7 | `done:h4b1` + review + security review riêng (lộ secret, AAD, RLS tenant) | backend-lead, reviewer | cao | spec §8 | `tools/scripts/src/done-h4b1.ts` | T5, T6 | `bun run done:h4b1` | [ ] |
| T8 | Đồng bộ docs (CODEMAP, TRACE, STATE) | docs-architect | thường | — | `docs/**` | T7 | `bun run trace --check` | [ ] |
