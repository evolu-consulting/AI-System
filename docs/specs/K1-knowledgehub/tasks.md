# Tasks · K1-knowledgehub

Khung — chỉ các task PLAN/Gate; task BUILD do backend-lead thêm sau PLAN. Mỗi task: một commit `[FR]`, diff ≈ ≤ 400 dòng. Tick khi lệnh "xong" xanh. `blocked` kèm lý do → báo cáo cuối.
Cột `Đọc`: đúng các mục cần. `Rủi ro`: `docs/WORKFLOW.md` "Chính sách model". Thứ tự: sau H4b-1 Secrets (CR-067: cần `kh_api_key` theo tenant + `useSecret`).

| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| T0 | PLAN BE (`plan.md`: contract, DDL, client KH + token cache, `kh_query`, ghi worklog, hạ cấp, mock KH, seed mẫu, task BUILD) | backend-lead | cao | `spec §2,§3,§4`, ADR-0012, BA HUB-FR-131…134,137 | `docs/specs/K1-knowledgehub/plan.md`, spec §3–4 | H4b-1 xong | — | [ ] |
| T1 | PLAN FE (`plan-frontend.md`: Studio Cài đặt KH, mục Tri thức, chọn project ở admin-web/Evolu Control) | frontend-lead | thường | `spec §5`, `ui-agent-studio` Cài đặt/Tri thức | `docs/specs/K1-knowledgehub/plan-frontend.md` | T0 | — | [x] (chờ đối chiếu contract BE) |
| T2 | qc: test-plan + test khoá (K1-AC01…08) | qc | cao | `spec §8` | `test-plan.md`, `tests/acceptance/K1/**` | T0, T1 | `bun run test:lock:verify` | [ ] |
| T3 | spec-readiness + Gate (Luật 2b; ADR-0012 Proposed ⇒ trình Gate) | spec-readiness | — | spec, readiness.md | `readiness.md` | T2 | — | [ ] |
| F1 | FE BUILD: studio-web `/settings` → KnowledgeHub (URL, kiểm tra kết nối, bảng tenant ↔ ns, Sheet credentials) + nav `settings` + i18n | frontend-lead | thường | `plan-frontend §0–5,7`, H4b-1 plan-frontend D3–D9 | `apps/studio-web/src/features/settings/knowledgehub/**`, `routes/_authed/settings.tsx`, `packages/i18n` | T2, contract BE (§3) | `bun run typecheck && bun run i18n:check && e2e K1 (Studio)` | [ ] |
| F2 | FE BUILD: studio-web mục "Tri thức" trong editor agent | frontend-lead | thường | `plan-frontend §2,4`, `ui-agent-studio` Tri thức | `apps/studio-web/src/features/agents/components/AgentKnowledgeSection.tsx` | F1 | như F1 | [ ] |
| F3 | FE BUILD: admin-web chọn project KH (quy trình + stage) + Dialog "Tri thức" của tenant_admin | frontend-lead | thường | `plan-frontend §2,4,7`, P-b2 `DefInfoCard`/`StageForm` | `apps/admin-web/src/features/processes/**` | F1 | như F1 (Admin) | [ ] |
| F4 | FE BUILD: `DegradedAlert` cảnh báo hạ cấp KH trong output (admin OutputDialog + chat run-block/run-page) | frontend-lead | thường | `plan-frontend §2,4` mục Output | `packages/ui`, `apps/admin-web/.../run/OutputDialog.tsx`, `apps/chat-web/src/features/processes/**` | F3 | như F1 (Chat) | [ ] |
