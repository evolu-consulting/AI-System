# Tasks · H3b-agent-grants

Khung — backend-lead điền ở PLAN (thứ tự, cột `Đọc`, `Rủi ro`, `Lệnh xong`, task BUILD). Mỗi task: một commit `[FR]`, diff ≈ ≤ 400 dòng. Tick khi lệnh "xong" xanh. `blocked` kèm lý do → báo cáo cuối.
Cột `Rủi ro`: mọi task chạm role/tenant đích, `agent_grants`, audit, `config_meta`/NOTIFY, đọc trace scope `system` là **cao** (`docs/WORKFLOW.md` "Chính sách model"). Không có frontend, không Python (spec §1, §5).

| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| P0 | PLAN BE: `plan.md` (+ `plan-db.md` nếu vượt trần), spec §3–4, cập nhật `spec-decisions` (PL…), điền `tasks.md` | backend-lead | cao | `spec`, `spec-decisions`, `spec-ac` | `docs/specs/H3b-agent-grants/*` | — | `wc -c` ≤ trần | [ ] |
| QW-T | Test-plan theo `spec-ac.md` + `plan` | qc | cao | `spec-ac`, `plan` | `docs/specs/H3b-agent-grants/test-plan*.md` | P0 | — | [ ] |
| R | spec-readiness → Gate (Luật 2b; Q-U1…U4 chưa trả lời ⇒ mặc định) | spec-readiness | — | thư mục spec | `readiness.md`, `docs/specs/H3b-gate.md` | QW-T | READY | [ ] |
| QW | Test (đỏ đúng lý do) + khoá | qc | cao | `test-plan`, `plan` | `tests/acceptance/H3b/**`, `tests/.lock` | R | đỏ đúng lý do · `test:lock:verify` | [ ] |
| … | (BUILD — backend-lead điền: migration `0009`, contract `hub-admin`, grants, effective, trace + audit, CORS) | backend-lead | | | | QW | | |
| I1 | `done:h3b` (gồm `done:h3a`, `test:contract:chat` 41, `test:lock:verify`, `trace --check`) — AC-14 | qc | thường | `test-plan` | — | BUILD | `bun run done:h3b` | [ ] |
| RV | Review ≤ 2 vòng (rubric: tenant/role, audit, khoá) | reviewer | — | diff + spec | — | I1 | APPROVED | [ ] |
| I2 | Kiểm tay Hub dev (Q-K14): `curl` 3 endpoint với JWT dev mỗi role | backend-lead | thường | `spec-ac` | `docs/guides/hub-dev.md` | RV | ghi kết quả | [ ] |
| I3 | Docs: CODEMAP, TRACE, STATE, ROADMAP (M5 phần agent), **CR-impact Admin** (spec §5), sửa câu BA-H §9.1 theo Q-U1, mục PRODUCTION-NOTES (CORS admin-web, audit Hub) | docs-architect | thường | `spec §5`, `spec-decisions` | `docs/**` | I2 | `bun run trace --check` | [ ] |
