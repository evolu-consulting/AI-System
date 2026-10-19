# Plan · N5-identity (ngắn)

## Module `apps/admin-api/src/modules/identity-import/` (ADR-0023 bốn lớp)
| Lớp | File | Nội dung |
|---|---|---|
| domain | `domain/import.ts`, `domain/import.rules.ts` | kiểu; `classifyHash`, `usernameFor`, `fallbackUsername`, `tenantKeyFor`, `adminRoleOf`, `planOrgs`, `planUsers`, `chunk`, `emptyReport` — thuần |
| application | `application/ports.ts`, `application/import.usecase.ts` | port `ImportStore` (đọc/ghi lô), `runImport(input, deps)` — dry-run/apply, lô, báo cáo |
| adapters | `adapters/import.mapper.ts`, `adapters/import.repo.ts` | zod file → domain; SQL theo tập (jsonb_to_recordset), `withScope`/`configWrite` platform |
| khung | `identity-import.cli.ts` | đọc args/env `ADMIN_API_DATABASE_URL`, hash không dùng được (một lần), in báo cáo |

## Lô org (một tx, tất cả org trong file; số org nhỏ — vẫn chia lô 500)
1. đọc tenant theo `settings->>'mgmt_org_id' = any($ids) or key = any($keys)` (1 câu)
2. apply: chèn tenant mới `on conflict (key) do nothing` (1) · đọc lại (1) · entitlement 3 feature × N tenant (1) · Group vai 3 × N (1) · grant 6 × N (1) · đọc Group id (1) · bump + audit (2) · NOTIFY sau commit.

## Lô user (≤ 500, mỗi lô một tx `configWrite`)
| # | Câu | Index |
|---|---|---|
| 0 | `set_config` scope | — |
| 1 | `select … from admin.users where tenant_id = any($t) and username = any($u)` (chỉ phép bằng leakproof — spec §7 B1) | `users_tenant_username_uq` |
| 2 | `insert into admin.users select … from jsonb_to_recordset($1) on conflict do nothing returning id, tenant_id, lower(email)` | — |
| 3 | `insert into admin.group_members select … from jsonb_to_recordset($1) on conflict do nothing` (id có sẵn, không join users) | pkey |
| 4–5 | bump `config_meta` + một INSERT audit nhiều hàng | — |
Dry-run: chỉ câu 0–1. Số câu không phụ thuộc số hàng ⇒ test đếm câu (`*.perf.int.test.ts`).

## Hiệu năng (N5-NFR-01)
Ngưỡng: 10.000 user / 1 org, lô 500 ⇒ 20 lô, ≤ 30 s tổng, mỗi lô ≤ 6 câu. **Đo (máy dev, 2026-10-19)**: apply 5.196 ms (lọc `lower(email)` dưới RLS ⇒ seq scan) → **2.195 ms** sau B1; chạy lại 6.815 → **248 ms**; dry-run 263 ms; lô user 6 câu cố định, lô org 9, dry-run ≤ 1. Hash không dùng được: 1 lần argon2 mỗi lần chạy (~50 ms), không hash theo hàng.

## Test (viết trước code phần tenant/quyền/mật khẩu)
- `domain/import.rules.test.ts` — unit luật thuần.
- `tests/acceptance/N5/import.int.test.ts` — cách ly tenant, idempotent, dry-run không ghi, mật khẩu (nhập/đặt lại, đăng nhập thật), không lộ hash, actor không phải platform admin ⇒ từ chối.
- `tests/acceptance/N5/perf/import.perf.int.test.ts` — 10.000 user, đếm câu mỗi lô.
