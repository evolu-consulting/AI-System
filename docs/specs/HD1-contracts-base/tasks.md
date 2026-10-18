# Tasks · HD1-contracts-base

Spec `draft`. Phụ thuộc N1 (khuôn schema/role/quyền/FileBox/DOCX/outbox) — task BUILD HD1 chạy sau N1 T5 tương ứng. Không có UI (HD5, D-02) ⇒ không plan FE. Mỗi task: một commit `[HD-FR-xx]`, diff ≈ ≤ 400 dòng. "plan §…" = mục do `plan.md` cung cấp (T1). `Rủi ro`: `docs/WORKFLOW.md` "Chính sách model".

| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| T1 | PLAN BE: contract (route, DTO, cursor, mã lỗi), DDL 5 bảng theo khuôn N1 + index từng bộ lọc (Q4), khoá lạc quan + tx PATCH/tải lên, quota ngày theo múi giờ tenant, Thiết kế hiệu năng (số câu SQL mỗi route, `EXPLAIN`), module bốn lớp | backend-lead | cao | `spec §2, §6, §9`, N1 `plan §DDL, §quyền` | `plan.md` | N1 T1 | `wc -c plan.md` ≤ 18 KB | [ ] |
| T2 | qc test-plan + test trước code (RLS/FK kép, quyền, 409, quota, perf 10.000 HĐ + đếm câu) — HD-AC01…AC14 | qc | cao | `spec §6, §8`, `plan §contract, §DDL` | `test-plan.md`, `tests/acceptance/HD1/**` | T1 | `bun run test:int:par tests/acceptance/HD1` (đỏ đúng chỗ) | [ ] |
| T3 | spec-readiness → Gate | spec-readiness | — | cả thư mục spec | `readiness.md`, `docs/specs/HD1-gate.md` | T1, T2 | READY | [ ] |
| T4 | Contract + DDL + migration `contracts` | backend-lead | cao | `plan §contract, §DDL` | `packages/contracts/src/contracts/**`, `packages/db/migrations-contracts/**` | T3, N1 T5a | `bun run typecheck` + test RLS HD1 | [ ] |
| T5 | Domain: `mergeFields`, kiểm kiểu 23 trường, enum | backend-lead | thường | `spec HD-FR-02, HD-BR-01`, `plan §domain` | `apps/hub-api/src/modules/contracts/domain/**` | T4 | `bun test …/contracts/domain` + `bun run depcruise` | [ ] |
| T6 | API danh sách/chi tiết (keyset, lọc) + perf | backend-lead | cao | `plan §list, §perf` | `…/contracts/{application,adapters}/**` | T4, T5 | test HD1 list + `bun run test:perf` HD1 | [ ] |
| T7 | API PATCH trường + tải lên + file (FileBox org, DOCX, quota, event, outbox) | backend-lead | cao | `plan §patch, §upload` | như T6 | T6, N1 T5c–T5e | test HD1 phần đó | [ ] |
| T8 | Review + security review (tenant, quyền, upload: magic bytes, quota, zip bomb) | reviewer | cao | diff, `spec §2, §6` | `review.md` | T7 | không Blocker/Major | [ ] |
| T9 | Smoke API (không UI): `bun run test:all` | qc-uat | thường | `test-plan.md` | `evidence/` | T8 | `bun run test:all` | [ ] |
| T10 | Đóng: TRACE, CODEMAP, STATE, INDEX | docs-architect | thường | bàn giao T4–T9 | `docs/**` | T9 | `bun run trace --check` | [ ] |
