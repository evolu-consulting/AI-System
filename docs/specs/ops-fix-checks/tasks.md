---
id: ops-fix-checks
lát: ops-fix-checks
cr: CR-104
làn: nhanh
migration: hub 0065
phụ thuộc: ops-checks
---
## Plan (ngắn)
Sửa lỗi review của ops-checks (CR-104): disk stale, chỉ mục + statement_timeout, thứ hạng backup, scrub, deploy_ref.

## Làm
- disk: ngưỡng cũ = max(2×every_min, 65 phút, 2×`host.json.every_min` nếu có — trường tuỳ chọn mới trong schema); `value.deploy_ref`.
- Migration `0065_ops_indexes.sql` (journal `when` 1799000000000): `runs(started_at)`, `runs(finished_at)` từng phần ALL_PROVIDERS_EXHAUSTED, `jobs(finished_at)` từng phần orphaned, `process_runs(expires_at)` từng phần running. CREATE INDEX thường (bảng nhỏ, repo không dùng CONCURRENTLY).
- `systemRead` (check-kit): scope system + `statement_timeout` 5 s cục bộ tx, dùng cho provider/runs_failed/stuck. runs_failed bỏ `OR` (hai nhánh dùng chỉ mục).
- backup: local ok + `offsite_ok=false` ⇒ warn (đã đúng thứ tự; thêm test khoá).
- `scrub`: che khoá=giá trị bí mật, Bearer, `user:pass@`, email, hex/base64 ≥ 16.

## Không làm / Chạm
Không chạm round/rules/repo (agent core), admin-web, deploy/.

## Test tối thiểu
unit `adapters/checks/ops.checks.test.ts`; int `ops.checks.int.test.ts` (EXPLAIN dùng chỉ mục trên 20.000 run).

## Quyết định trong lúc làm
- Test EXPLAIN chỉ ép jobs/process_runs qua tên chỉ mục trong plan; không seed jobs/process_runs lớn (FK nặng) — phần nhỏ, plan chọn index theo predicate từng phần.

## Delta (so với docs/current)
Không thay đổi hành vi (lý do: sửa lỗi review CR-104)
Trạng thái gộp: chưa gộp
