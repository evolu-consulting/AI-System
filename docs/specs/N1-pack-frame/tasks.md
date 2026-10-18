# Tasks · N1-pack-frame

Spec `draft`. Mỗi task: một commit `[PK-FR-xx]`, diff ≈ ≤ 400 dòng. Cột `Đọc`: "plan §…" = mục do `plan.md` cung cấp (backend-lead đặt ở T1; chưa có plan thì chưa chạy task). `Rủi ro`: `docs/WORKFLOW.md` "Chính sách model" (RLS/tenant, quyền, khoá/tx ⇒ cao ⇒ Opus). Task BUILD chi tiết (T7+) do plan tách lại.

| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| T1 | PLAN BE: DDL khuôn (role, schema, policy, FK kép, outbox), migration gói + admin (catalog mã quyền, Q5/Q6), đọc quyền không HTTP (D-03, Q8), DOCX → text (Q3, ADR thư viện), FileBox `org` tenant, module `hub-api/src/modules/<khoá>/` bốn lớp, bảng bước nhảy mỗi route (PK-NFR-05), Thiết kế hiệu năng | backend-lead | cao | `spec §2, §6, §9`, `spec-decisions.md` | `plan.md` (+ ADR thư viện DOCX nếu có) | — | `wc -c plan.md` ≤ 18 KB | [ ] |
| T2 | PLAN FE: chỉ khi Q6 cần sửa màn Group/Grants Admin; không thì ghi "không có FE" | frontend-lead | thường | `spec §5`, `plan §catalog` | `plan-frontend.md` | T1 | — | [ ] |
| T3 | qc test-plan + test trước code (rủi ro cao: RLS/FK kép/role, quyền, outbox cùng tx, `org` FileBox, đếm bước nhảy) — PK-AC01…AC12 | qc | cao | `spec §6, §8`, `plan §DDL, §quyền` | `test-plan.md`, `tests/acceptance/N1/**` | T1 | `bun run test:int:par tests/acceptance/N1` (đỏ đúng chỗ) | [ ] |
| T4 | spec-readiness → Gate (ADR thư viện DOCX ⇒ trình người dùng) | spec-readiness | — | cả thư mục spec | `readiness.md`, `docs/specs/N1-gate.md` | T1–T3 | READY | [ ] |
| T5 | BUILD theo plan (tách T5a DDL+role+migration · T5b quyền gói Admin · T5c FileBox org · T5d DOCX → text · T5e outbox + khuôn module) | backend-lead | cao | `plan §…` từng phần | `packages/db/migrations-*`, `apps/hub-api/src/modules/<khoá>/**`, `apps/admin-api/**` | T4 | test N1 phần đó + `bun run depcruise` + `bun run typecheck` | [ ] |
| T6 | Review + security review (tenant/RLS, role, FileBox org, zip bomb) | reviewer | cao | diff, `spec §2, §6` | `review.md` | T5 | không Blocker/Major | [ ] |
| T7 | UAT (nếu có UI ở T2) / smoke int đầy đủ | qc-uat | thường | `test-plan.md` | `evidence/` | T6 | `bun run test:all` | [ ] |
| T8 | Đóng: TRACE, CODEMAP, STATE, INDEX | docs-architect | thường | bàn giao T5–T7 | `docs/**` | T7 | `bun run trace --check` | [ ] |
