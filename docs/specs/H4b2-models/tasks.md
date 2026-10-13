# Tasks · H4b2-models

Khung — chờ PLAN (backend-lead, frontend-lead), test-plan (qc), spec-readiness, Gate. Task cụ thể điền sau PLAN. Rủi ro `cao` (Opus): provider/Kiểm tra key (secret), entitlement/thu hồi.

| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| T1 | Contract + migration provider/profile/provider_state (`secret_id` → `hub.secrets`) | backend-lead | cao | `spec §2,§3,§4`, H4b1 `spec §3` | `packages/contracts`, `apps/hub-api/src/modules/studio/models` | — | `bun test apps/hub-api/src/modules/studio/models` | [ ] |
| T2 | API provider + "Kiểm tra key" (mock) | backend-lead | cao | `spec §2`, `plan` | `apps/hub-api/src/modules/studio/models` | T1 | `bun run test:int` | [ ] |
| T3 | API profile (steps, điều kiện chuyển) + dự phòng AC-H04 | backend-lead | thường | `spec §2`, BA AC-H04 | `apps/hub-api/src/modules/studio/models` | T1 | `bun test` | [ ] |
| T4 | API entitlement ghi/thu hồi + audit + `hub_config_version` | backend-lead | cao | `spec §2`, BA HUB-FR-77/78 | `apps/hub-api/src/modules/studio/entitlements` | — | `bun run test:int` | [ ] |
| T5 | Studio Models (Providers, Profiles) | frontend-lead | thường | `spec §5`, UI §8, `Models.dc.html` | `apps/studio-web/src/features/models` | T2, T3 | `bun run typecheck && bunx playwright test h4b2` | [ ] |
| T6 | Studio Quyền agent (ma trận, drawer, thu hồi) | frontend-lead | thường | `spec §5`, UI §9, `Access.dc.html` | `apps/studio-web/src/features/access` | T4 | `bunx playwright test h4b2` | [ ] |
