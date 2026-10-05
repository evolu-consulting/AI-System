# Tasks · H3a-subscription

Khung — backend-lead điền ở PLAN (thứ tự, cột `Đọc`, `Rủi ro`, `Lệnh xong`). Mỗi task: một commit `[FR]`, diff ≈ ≤ 400 dòng. Tick khi lệnh "xong" xanh. `blocked` kèm lý do → báo cáo cuối.
Cột `Rủi ro`: mọi task chạm `provider_state`/khoá claim/transaction Kết thúc là **cao** (`docs/WORKFLOW.md` "Chính sách model").

| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| S1 | Spike cách probe (spec §7 S1) → ghi `spec-decisions` "Spike S1" | backend-lead | thường | `spec §2.3, §7` | `docs/specs/H3a-subscription/spec-decisions.md` | — | kết quả ghi | [ ] |
| P0 | PLAN BE (Python + TS câu lỗi, migration `0008`) | backend-lead | cao | `spec` | `plan*.md`, `tasks.md` | S1 (hoặc mặc định (b)) | — | [ ] |
| QW | Test-plan + test (đỏ đúng lý do) theo `spec-ac.md` | qc | cao | `spec-ac`, `plan` | `tests/**`, `test-plan.md` | P0 | — | [ ] |
| R | spec-readiness → Gate (Luật 2b) | spec-readiness | — | thư mục spec | `readiness.md`, `H3a-gate.md` | QW | READY | [ ] |
| … | (BUILD — backend-lead điền) | | | | | | | |
| I1 | `done:h3a` | qc | thường | `test-plan` | — | BUILD | `bun run done:h3a` | [ ] |
| I2 | Smoke `HUB_LIVE=1` (AC-12) | backend-lead | thường | `spec-ac` AC-12 | `tests/smoke/h3a-live.test.ts` | I1 | smoke | [ ] |
| I3 | Docs: CODEMAP, TRACE, STATE, CR lệch BA-W §3 (Q4), PRODUCTION-NOTES (K5, env) | docs-architect | thường | `spec-decisions` | `docs/**` | I2 | `bun run trace --check` | [ ] |
