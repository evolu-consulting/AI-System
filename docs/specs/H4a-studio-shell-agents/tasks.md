# Tasks · H4a-studio-shell-agents

Mỗi task: một commit `[FR]`, diff ≈ ≤ 400 dòng. Tick khi lệnh "xong" xanh. `blocked` kèm lý do → báo cáo cuối.
Cột `Đọc`: đúng các mục tài liệu task cần. Cột `Rủi ro` (`cao` / `thường`) — `docs/WORKFLOW.md` "Chính sách model". Khung do docs-architect; backend-lead/frontend-lead chốt chi tiết ở PLAN (`plan.md`, `plan-frontend.md`).

| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| T0 | PLAN BE ∥ FE, test-plan, readiness, Gate (tự duyệt, Luật 2b) | backend-lead, frontend-lead, qc | — | `spec §2, §9` | `docs/specs/H4a-studio-shell-agents/*` | — | readiness READY | [ ] |
| B1 | Contract `@ai/contracts/studio` + guard `platform_admin` + `/studio/api/me` + CORS 3200 + serve tĩnh `/studio` | backend-lead | cao | `spec R01, R02, §7` | `packages/contracts/src/studio/`, `apps/hub-api/src/modules/studio/` | T0 | `bun test apps/hub-api/src/modules/studio` | [ ] |
| B2 | Agents CRUD + `agent_workflows` + R03–R06, R13 + đọc `agent-types/profiles/providers/workflows/tenants` | backend-lead | cao | `spec R03–R06, R13` | `apps/hub-api/src/modules/studio/` | B1 | `bun run test:int` (studio) | [ ] |
| B3 | Orchestrator mặc định + theo tenant (R07) | backend-lead | cao | `spec R07, ba §6.3 FR-62` | `apps/hub-api/src/modules/studio/` | B1 | idem | [ ] |
| B4 | Ghi an toàn: `version`, audit, `hub_config_version`, NOTIFY (R09, R10) — dùng chung B2/B3 | backend-lead | cao | `spec R09, R10`, mẫu H3b | `apps/hub-api/src/modules/studio/` | B2, B3 | idem + AC-03, 09 | [ ] |
| F1 | Scaffold `apps/studio-web` (Rsbuild, router, Query, i18n namespace `studio`, token, primitive), khung + menu "Sắp có" | frontend-lead | thường | `spec §1, §5, Q1, Q10`; ui §2–3 | `apps/studio-web/` | T0 | `bun run typecheck` (studio-web) | [ ] |
| F2 | Đăng nhập + guard role + trang không quyền (R01, R14) | frontend-lead | cao | `spec R01, R14, Q2, Q3` | `apps/studio-web/src/features/auth` | F1, B1 | `bun test` studio-web | [ ] |
| F3 | Agents: danh sách + editor (5 bước), picker workflow, Bash ack | frontend-lead | thường | `spec R03–R06, R11, R12`; ui §5; canvas Main/AgentEditor | `apps/studio-web/src/features/agents` | F2, B2 | idem | [ ] |
| F4 | Orchestrator: mặc định + theo tenant, modal xung đột | frontend-lead | thường | `spec R07–R09`; ui §6; canvas Orchestrator | `apps/studio-web/src/features/orchestrator` | F2, B3 | idem | [ ] |
| Q1 | qc: `spec-ac.md`, test-plan, khoá test (đỏ đúng lý do), e2e `studio` | qc | cao | `spec §8` | `tests/`, `e2e/` | T0 | `bunx playwright test studio` | [ ] |
| I1 | `done:h4a` + `check:bundle` + `trace --check` | qc | thường | `spec §8` | — | B*, F*, Q1 | `done:h4a` xanh | [ ] |
| RV | Review 2 vòng (reviewer) | reviewer | — | diff mốc | — | I1 | APPROVED | [ ] |
| I2 | Kiểm tay: dev stack (`HUB_STUDIO_DIST` hoặc rsbuild 3200), đăng nhập `platform_admin`, sửa agent/Orchestrator | điều phối | thường | `spec §7` | — | RV | ghi vào spec-decisions | [ ] |
| I3 | Đóng mốc: CODEMAP, TRACE, STATE, README module, CR-impact | docs-architect | thường | — | `docs/**` | I2 | `bun run trace --check` | [ ] |
