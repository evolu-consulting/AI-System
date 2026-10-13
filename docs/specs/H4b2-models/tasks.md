# Tasks · H4b2-models

Khung — chờ PLAN (backend-lead, frontend-lead), test-plan (qc), spec-readiness, Gate. Task cụ thể điền sau PLAN. Rủi ro `cao` (Opus): provider/Kiểm tra key (secret), entitlement/thu hồi.

| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| T1 | Contract + migration provider/profile/provider_state (`secret_id` → `hub.secrets`) | backend-lead | cao | `spec §2,§3,§4`, H4b1 `spec §3` | `packages/contracts`, `apps/hub-api/src/modules/studio/models` | — | `bun test apps/hub-api/src/modules/studio/models` | [ ] |
| T2 | API provider + "Kiểm tra key" (mock) | backend-lead | cao | `spec §2`, `plan` | `apps/hub-api/src/modules/studio/models` | T1 | `bun run test:int` | [ ] |
| T3 | API profile (steps, điều kiện chuyển) + dự phòng AC-H04 | backend-lead | thường | `spec §2`, BA AC-H04 | `apps/hub-api/src/modules/studio/models` | T1 | `bun test` | [ ] |
| T4 | API entitlement ghi/thu hồi + audit + `hub_config_version` | backend-lead | cao | `spec §2`, BA HUB-FR-77/78 | `apps/hub-api/src/modules/studio/entitlements` | — | `bun run test:int` | [ ] |
| T5 | FE: Models › Providers (bảng, Sheet, SecretField select, xoá/InUse) + route + nav | frontend-lead | thường | `plan-frontend §0–5`, `Models.dc.html`, mockup Provider-Sheet/States | `apps/studio-web/src/features/models`, `routes/_authed/models.tsx`, `packages/i18n` | T2 | `bun run typecheck && bunx playwright test h4b2` | [ ] |
| T5b | FE: Kiểm tra key/lại (CheckDialog) + Runbook Sheet | frontend-lead | cao (secret: không hiện/giữ key) | `plan-frontend §0 D3,D6`, mockup Check/Runbook | `apps/studio-web/src/features/models/components` | T5 | `bunx playwright test h4b2` | [ ] |
| T5c | FE: Models › Profiles (StepsEditor Lên/Xuống, LiveSummary, cảnh báo toàn subscription) | frontend-lead | thường | `plan-frontend §0 D7`, `Models.dc.html` | `apps/studio-web/src/features/models` | T3, T5 | `bunx playwright test h4b2` | [ ] |
| T6 | FE: Quyền agent (ma trận switch, drawer, thu hồi) + route + nav | frontend-lead | cao (quyền, thu hồi) | `plan-frontend §0 D9–D11`, `Access.dc.html` | `apps/studio-web/src/features/access`, `routes/_authed/access.tsx` | T4 | `bunx playwright test h4b2` | [ ] |
