# Test plan · M4-ops · phụ lục §7 "Đỏ đúng lý do" — int khối A + B (Q2b)

Lệnh: `bun --env-file=.env.test-qcb.local --config=bunfig.int.toml test --timeout 30000 tests/acceptance/M4/<file>` trên DB `ai_system_qcb_test` (`bun run db:test:create qcb`, đã drop sau khi chạy). HEAD = `01e957b` (chưa có T0: không `0007_m4_ops`, không route M4).

| File (`M4/…int.test.ts`) | Ca | Kết quả | Lý do đỏ |
|---|---|---|---|
| `db-schema` (D1–D4) | 5 | 0/5 | `expect`: SQLSTATE `42P01` ≠ `23505`/`23514`; D4 không có FK `updated_by`; dựng feature cascade → `PostgresError` relation `admin.tenant_quotas` (bảng M4) |
| `db-rls` (D5–D9) | 5 | 0/5 (beforeAll) | `PostgresError` relation `admin.tenant_quotas` khi chèn dữ liệu bảng M4 trong `beforeAll` |
| `quotas` (Q1–Q10) | 10 | 0/10 | `expect`: 404 (route chưa có) ≠ 200/400/409; ca dựng bằng `setQuota`/`auditMark` → relation bảng M4 |
| `quota-alerts` (AL1–AL9, AL11) | 11 | 0/11 | `expect`: PUT/GET 404; AL11 `setQuota` → relation `tenant_quotas` |
| `quota-alerts-proc` (AL10) | 1 | 0/1 (beforeAll) | relation `admin.audit_log` (mốc tên chạy); server chưa có LISTEN `quota_threshold` |
| `usage` (U1–U9) | 9 | 0/9 | `expect`: 404 ≠ 200/400; U2/U9 `setQuota` → relation `tenant_quotas` |
| `usage-csv` (C1–C3) | 3 | 0/3 | `expect`: 404 ≠ 200 |
| `overview` (O1–O6) | 6 | 0/6 | `expect`: 404 ≠ 200/403 (route cũ là trang chào?); O2/O5 `setQuota` → relation |
| `audit-write` (AW1–AW5) · `audit-write-catalog` (AW6–AW12) | 5 · 9 | 0/5 · 0/9 | relation `admin.audit_log` ở `auditMark` đầu ca (bảng M4) |
| `audit-secrets` (AS1–AS2) · `audit-read` (AR1–AR7) · `restore` (RS1–RS10) | 2 · 7 · 10 | 0/2 · 0/7 · 0/10 | relation `admin.audit_log` (mốc / seed audit / `beforeEach` restore) |
| `updated-by` (UB1–UB4) | 4 | 0/4 | `expect`: `updated_by` undefined (chưa có trong DTO), `"updated_by" in json` false |
| `notify` (N1–N3) | 3 | 0/3 | N1/N2 relation `audit_log`; N3 `expect` PUT 404 |
| `forbidden` (F1–F3) | 3 | 0/3 | `expect`: 404 ≠ 403/401 (route chưa có) |

Không ca nào đỏ vì `TypeError` fixture hay `PostgresError` của bảng M1–M3/`hub.usage_logs` (đã kiểm `hub.usage_logs.run_id` cho phép NULL, không unique — U9 và "run 3 có 2 hàng" dựng được). Lời gọi API M1–M3 trong AW/RS chép từ `M3/notify-writes` (đang xanh); chưa chạy được tới sau `auditMark` nên phần body (reset-password không body, `input_map` khoá `password/value/iv`) sẽ lộ ở T1 nếu sai → qc sửa theo Tranh chấp.

Typecheck: `bun run typecheck` không lỗi ở `tests/acceptance/M4/**` (schema M4 tra qua namespace lỏng `parse4`, mã lỗi mới qua `expectErr4`). Biome sạch các file Q2b.
