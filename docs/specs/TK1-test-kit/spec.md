---
id: TK1-test-kit
title: Bộ test dùng chung (@ai/test-kit)
status: in-progress
requirements: [ADM-NFR-06, PK-NFR-04, CR-094]
owner: agent TK1 (làn nhanh, Luật 1b)
---

# TK1 · `packages/test-kit`

## 1. Vấn đề
`tests/acceptance` không có kit chung: 5 `_fixtures.ts` (H1, M1–M4), 5 `_stack.ts` (H1–H3a), 8 `_local.ts` (P-a, P-b),
9 `_modules.ts`, hàm `inPack`/`pgCode`/`percentile`/`captureSql` chép 3–4 nơi (N1, N3, HD1, X2a). Mỗi lát mới
(HD3–HD10, N4, N6, N7) sẽ chép tiếp. TECH-DEBT #208: dựng stack chậm/chập chờn khi tải cao.

## 2. Phạm vi
**Làm** (gói `@ai/test-kit`, lá của đồ thị phụ thuộc: chỉ phụ thuộc `@ai/db`, `postgres`, `bun:test`; KHÔNG import `apps/**`):
| Mô-đun | Nội dung |
|---|---|
| `env` | URL DB test (owner/admin_api/hub_api), `withCreds`, `uuid(n)` tất định |
| `db` | `cloneDb` (DB từ template đã migrate, bọc `@ai/db/test-db`), `inPack`/`inHub`/`asRole` (đúng đường chạy thật), `pgCode`, `Rollback` |
| `stack` | `bootStack`: DB từ template -> migrate -> (tuỳ chọn) fixture -> app in-process (`Bun.serve` cổng 0) -> `close()` idempotent |
| `builders` | dựng dữ liệu THEO TẬP (1 câu SQL mỗi bảng, `generate_series`/`unnest`): tenant, user, role/group + thành viên, bật gói, hợp đồng mẫu |
| `clock` | `FakeClock` (now/advance/set) + `FakeTimers` (setTimeout/interval điều khiển được) |
| `fakes` | `FakeAgent` (Claude, kịch bản/lỗi), `FakeBatchTransport` (SMTP, web push), `FakeTaxRegistry` |
| `perf` | `percentile`, `latencyStats`, `measure` (làm nóng + n lượt), `countStatements` (tap `postgres.js debug`), `seqScansOf`/`assertNoSeqScan` (EXPLAIN) |
| `rls-suite` | `defineRlsSuite(spec)`: pack khai bảng -> sinh bộ test cách ly tenant (xem §3) |

**Không làm**: sửa assertion của test đã khoá; đổi code sản phẩm; thay `@ai/db/test-db` (kit chỉ bọc).

## 3. Bộ RLS theo hợp đồng (`defineRlsSuite`)
Pack khai: `schema`, `role` (`<k>_rw`), `tables[]` (`name`, `tenantColumn`, `seed(sql, tenantId)` trả PK một hàng, `insert` hợp lệ
cho tenant, cột `update`), `tenants {a,b}`. Kit sinh các ca (mỗi ca một `it`):
1. Đọc chéo: tenant B thấy 0 hàng của A; không đặt `app.tenant_id` / `''` -> 0 hàng.
2. Ghi chéo: B `UPDATE`/`DELETE` hàng của A -> 0 hàng bị tác động; `INSERT` mang tenant A -> SQLSTATE `42501`.
3. Thăm dò tồn tại: `SELECT … WHERE id = <id của A>` dưới B giống hệt id không tồn tại (0 hàng, không lỗi); `INSERT` trùng PK của A dưới B không lộ
   khác biệt (lỗi 42501 trước kiểm khoá).
4. Role: `NOBYPASSRLS`, `NOSUPERUSER`, `NOCREATEROLE`, `NOCREATEDB`, `NOINHERIT`.
5. `FORCE ROW LEVEL SECURITY` + `ENABLE` bật trên MỌI bảng khai; mọi bảng của schema có policy (phát hiện bảng quên khai: `undeclared`).
Áp dụng: gói `contracts` (7 bảng) và `pkdemo` (4 bảng) trong `packages/test-kit/src/rls-packs.int.test.ts`.

## 4. Quy tắc di cư test đã khoá
Chỉ đổi import/setup; assertion giữ nguyên; số test pass trước = sau; relock chỉ file đổi; danh sách ghi ở `tasks.md`.
Cần đổi assertion = Tranh chấp test -> dừng, báo.

## 5. Hiệu năng (Luật 4c)
Builder là set-based (số câu SQL cố định, không phụ thuộc n) — có test đếm câu. Stack dùng template (không migrate lại).
Harness perf có test đo p95 dựng 10.000 hàng bằng builder < ngưỡng ghi trong `*.perf.int.test.ts`.
