# Kết luận lát N1 Khung gói (2026-10-19)

Quyết định: **đóng N1** theo khuôn P-d2 (CR-094 đợt 1). Số perf dưới đây là số đo Windows dev; đo staging Linux còn chờ (§6). Không làm tròn ngưỡng.

## 1. Phạm vi đã giao

Contract `packs.ts` + `migrations-packs/0001_kit.sql` (`packs.install`, `secure_table`, registry) + runner `migrate-packs.ts` · gói mẫu `pkdemo` (DB mẫu test) · quyền gói: admin-api `packsRoutes` (`/admin/tenants/:id/packs`), hub `pack-access` + `pack-guard`, `/pack/<k>/me` · `withPackScope` (`@ai/db/pack-scope`) + `PackUow` + khuôn `modules/packs/` · đếm bước nhảy · outbox chỉ mục cùng tx · FileBox `org` theo tenant · DOCX → Markdown (ADR-0024: fflate + saxes, worker, chặn zip bomb) · FE khuôn `apps/contracts-web` + `packages/web-kit` (tách từ chat-web) + Shell + `features/table`.

## 2. Kết quả

| Hạng mục | Kết quả |
|---|---|
| `done:n1` (2026-10-19) | **14/16** xanh. Bước int đỏ 10 ca timeout 30–60 s khi chạy cả bộ (migrate gói/template, nợ #208); chạy riêng 5 file ⇒ **30/30** xanh. Bước e2e chat đỏ 2 ca có từ trước (#205) |
| Review chung (`review.md`) | Vòng 1 CHANGES REQUESTED (M-01 `createDocxConverter` 66 dòng; M-02 `useTable` 81 dòng và `theme-parity` 62 dòng, làm `check:fn` đỏ) → sửa 46c23652, 914db3b4, 19816e10 → vòng 2 **APPROVED** (`74a128ca`) |
| Security | **SAFE**: không lỗi cách ly tenant, không lộ secret. Minor m-01…m-09 ghi nợ; vòng 2 thêm m-10…m-12 (không chặn) |

## 3. Perf (Luật 4c, số đo thật từ `tasks.md`)

| Ca | Số đo | Ngưỡng | Kết |
|---|---|---|---|
| PK-NFR-01 guard (T5b) | `/me` nguội 1 câu, nóng 0; guard p95 +0,08 ms (n=10.000) | — | Đạt |
| PK-NFR-05 POST lô 100 pkdemo (T5d) | p50 6,4–9,7 ms · p95 11,7–14,5 ms (3 lượt, nền 10.000 + 100.000 hàng, n=1.000) | ≤ 30 ms | Đạt |
| PK-NFR-05 GET pkdemo (T5d) | p95 3,7–5,0 ms | ≤ 10 ms | Đạt |
| PK-NFR-02 DOCX (T5g) | p95 2,8 ms (mẫu); 19 MB 122 ms; bom ≤ 1,4 ms | theo spec | Đạt |

Đếm bước nhảy: GET 2 câu, POST lô 100 3 câu, 0 Redis, 0 HTTP nội bộ; outbox không thêm câu. DB mẫu test 1971 → 2169 ms (+198 ms gói).

## 4. Quyết định chính

ADR-0024 Accepted (`2f98a5c`). Người dùng chốt ở Gate: Q9 (hub-api bỏ qua grant gói cho user lẻ, D-11), Q10 (role `<k>_job`, D-12), font Roboto vào ADR-0001 (D-14). Backend gói là module trong hub-api; không HTTP nội bộ trên đường nóng (D-01…D-03). Chi tiết `spec-decisions.md`.

## 5. Nợ mới liên quan (TECH-DEBT.md)

| # | Nội dung |
|---|---|
| 205 | e2e chat đỏ 2 ca có từ trước TF3 |
| 207 | `web-kit/src/http` kéo zod vào bundle đầu |
| 208 | `test:int:par` lượt đầu sau đổi migration: timeout 30/60 s (10 ca) |
| 209 | `web-kit` `refresh-lock` ngủ 100 ms khi `REFRESH_SUPERSEDED` |
| 210 | `pack-files.filebox` `remove`: xoá mềm rồi gọi FileBox ngoài tx, lỗi ⇒ file mồ côi |
| 211 | `config.service` `adminSettled()` chờ cả vòng `coalesce` |
| 213 | `PackFiles.put` mở tx riêng (HD1 T10 đã bỏ dùng; còn trong kit) |

Minor m-10…m-12 vòng 2 và các m còn lại ghi trong `review.md`, chưa có số TECH-DEBT.

## 6. Việc còn lại

| Việc | Ai | Khi |
|---|---|---|
| Chạy `deploy/staging/run-spike.ps1 -LoadN 10000`, báo p95 của perf pkdemo trên Linux | Người dùng | Trước Gate release |
| Sửa #208 (dựng template một lần trước khi chia worker) | qc / backend-lead | Trước khi chạy cả bộ int làm cổng |
| #205 e2e chat; #210, #211, #213 | qc / backend-lead | Khi chạm file liên quan |
| T7 UAT/smoke: không có `evidence/` cho N1; cổng `done:n1` 14/16 chưa phải smoke đầy đủ | qc-uat | Trước khi coi N1 hoàn tất hẳn |
