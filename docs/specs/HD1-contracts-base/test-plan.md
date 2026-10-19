# Test plan · HD1-contracts-base

qc WRITE (test trước code, rủi ro cao), 2026-10-19. Spec: [spec.md](spec.md) · [plan.md](plan.md) (commit 06006d6) · [spec-decisions.md](spec-decisions.md) (D-03…D-13). Phạm vi: T4, T5, T7–T11 (cao). T6 (domain), T12, T13 là task thường: không viết trước ở đây — riêng **ca luật thuần T6** vẫn có sẵn (`rules/`) vì chữ ký đã chốt ở plan §4. Q7 đóng (D-03): test theo `page/page_size/total`. Mặc định readiness lần 1 áp ở D-14…D-18.

## 1. Lệnh và hạ tầng
| Việc | Lệnh |
|---|---|
| Luật thuần (không DB) | `bun test tests/acceptance/HD1/rules` |
| Int (DB clone mẫu, Redis, hub-api + admin-api in-process, FileBox giả FB1) | `bun run test:int:par tests/acceptance/HD1` |
| Perf (không thuộc Lệnh xong; `*.perf.int.test.ts` bị `bunfig.int.toml` bỏ qua) | `PERF=1 bun --env-file=.env.local --config=bunfig.perf.toml test --timeout 120000 tests/acceptance/HD1/perf/` |

Dùng lại: `N1/_support/n1.ts` (`startAdminN1`, `bumpConfig`, `countHops`, `untilHubSettles`, `afterReload`, `inPack`, `pgCode`, `percentile`), `N1/_support/{load,zip}.ts` (`noFeature`, `needAdr0024Accepted`, `buildZip`), `P-d/d1/_count.ts` (`hubActivity`, `countQueries`), `FB1/_fbfake.ts`, `X2a` (`setupX2a`, persona). Mới: `HD1/_support/pure.ts` (hằng, nạp động domain/contract — **không** import DB nên `rules/` chạy không cần `.env.local`), `hd1.ts` (hub-api seam `contracts`, `arrange`, `upload` multipart, `captureSql` chụp SQL **đầy đủ + tham số**, `seqScansOf` = EXPLAIN dưới `contracts_rw` + tenant, `redisOps` đếm pipeline/lệnh lẻ, `measure` làm nóng pool+2), `seed.ts` (seed perf theo tập).

Persona acme: `lan` owner · `hoa` editor · `tam` viewer · `cuc` không Group; beta: `an` owner. Id cố định (`c0de…` HĐ, `ca7e…` loại, `17e0…` item). Không `sleep`/poll: chờ = `await`, `untilHubSettles`/`afterReload` (tín hiệu hoạt động SQL của Hub). Đỏ ngay khi thiếu tiền đề (`needContracts`, `noFeature`), không để PostgresError trong fixture.

## 2. Truy vết → ca
| Mã | Loại | File (`tests/acceptance/HD1/`) | Kỳ vọng chính |
|---|---|---|---|
| HD-FR-01 | int · unit | `rls.int` (CHECK, mặc định, PACK_DIRS, không FK chéo schema), `rules/contract` | kind/parent_id CHECK kép; title 1…200; `fields` là object; direction; mặc định `extracting`, version 1; `PACK_DIRS` có `contracts` `devOnly:false` |
| HD-FR-02 | unit · int | `rules/contract`, `rules/fields`, `patch.int` (đủ 23 khoá), `detail.int` | 23 khoá `FIELD_KINDS` đúng kiểu; `fieldValueSchema` (int 0…9e15, `notice_days` 0…3650, `vat_rate` 0…100, date ISO, bool, enum, text ≤ 2000); khoá thiếu ⇒ `{null,"",false,false}` |
| HD-FR-03 | unit · int | `rules/contract`, `rls.int` | `CONTRACT_STATUSES` = 8 + `rejected` cuối; `handled.outcome` 4 giá trị; CHECK DB 9 status, 23514 giá trị lạ |
| HD-FR-04 | int | `rls.int` | item: FK kép contracts/categories, UNIQUE `(contract_id, ord)`, CHECK; categories name ≤ 40, UNIQUE `(tenant_id, lower(name))`; xoá loại ⇒ `category_id` NULL giữ `tenant_id`; CASCADE |
| HD-FR-05 | int | `rls.int` | UNIQUE `(contract_id, deadline, milestone, user_id)`; channel/milestone CHECK; `ON CONFLICT DO NOTHING` |
| HD-FR-06 | int | `patch.int`, `rls.int` | event `field_edited` cùng tx + outbox; type regex, data ≤ 64 KiB, actor null; trigger ném ⇒ không ghi gì |
| HD-FR-07 | int | `list.int`, `detail.int`, `patch.int` | lọc/sắp/phân trang/facets/chi tiết/source/file 302/PATCH (xem §3) |
| HD-FR-08 | unit · int | `rules/upload`, `upload.int` | magic bytes, 413, 415, quota, FileBox `org`, DOCX → `source_text`, `PARENT_INVALID` |
| HD-BR-01 | unit | `rules/fields` | `mergeFields`: `old.edited ? old : new`, 23 khoá, thuần |
| HD-BR-02 | int | `list.int`, `detail.int` | viewer thấy mọi HĐ tenant (không theo chuỗi quản lý) |
| HD-BR-03 | unit · int | `rules/fold`, `list.int`, `columns.int`, `hops.int` | lọc/sắp/phân trang ở SQL; `likePattern` thoát `% _ \`; số câu cố định |
| HD-AC01 | int | `rls.int`, `list.int`, `detail.int`, `patch.int` | B ≠ A ⇒ 404 giống id lạ / 0 hàng / facets không lộ |
| HD-AC02 | int | `rls.int`, `upload.int` | item/event/reminder/phụ lục/file chéo tenant ⇒ 23503 (qua role VÀ qua owner); upload phụ lục cha tenant khác ⇒ 422 |
| HD-AC03 | int | `list.int` | `category`, `status[]+owner+category` giao điều kiện |
| HD-AC04 | unit · int | `rules/fold`, `list.int`, `columns.int` | `signer=" nguyễn văn  a "` khớp; plan: bỏ dấu, cắt chức danh |
| HD-AC05 | int | `list.int` | 120 HĐ, `page_size=50` ⇒ 50/50/20, `total=120`, trang 4 rỗng, không trùng/sót (Q7/D-03) |
| HD-AC06 | int · unit | `patch.int`, `rules/fields` | `edited=true`, event cũ/mới, 1 outbox, `version` cũ ⇒ 409 `CONTRACT_STALE`, 8 PATCH đồng thời ⇒ 1×200 + 7×409, FOR UPDATE |
| HD-AC07 | int · unit | `patch.int`, `rules/contract` | khoá lạ ⇒ 422 `FIELD_UNKNOWN` (`details.keys`); sai kiểu ⇒ 422 `FIELD_INVALID` (`details.key`); không ghi |
| HD-AC08 | unit | `rules/fields` | old `{number:{edited,"A"}}` + new `"B"` ⇒ "A"; không edited ⇒ new |
| HD-AC09 | int | `patch.int`, `upload.int`, `list.int` | viewer/không Group ⇒ 403 `PACK_FORBIDDEN` (kiểm quyền trước validate); editor/owner được |
| HD-AC10 | int · unit | `upload.int`, `rules/upload` | 21 MiB ⇒ 413; `.pdf` nội dung EXE ⇒ 415; tệp thứ 31 ⇒ 429; tenant khác vẫn tải |
| HD-AC11 | int | `upload.int` | DOCX mẫu ⇒ `extracting` + `source_text` "Điều 1" + event + `org=t_<tid>`; DOCX hỏng ⇒ `extract_failed` + `DOCX_UNREADABLE` (phụ thuộc ADR-0024 Accepted) |
| HD-AC12 | unit · int | `rules/fields`, `detail.int`, `columns.int` | thiếu khoá ⇒ rỗng, không lỗi; khoá lạ bị bỏ khi đọc |
| HD-AC13 | int | `rls.int` | trùng khoá ⇒ 23505, khác hạn/mốc/user ⇒ được |
| HD-AC14 / NFR-01,02 | perf | `perf/list`, `perf/rw` | §4 |
| HD-NFR-03 | int · perf | `hops.int`, `upload.int`, `perf/rw` | tải lên 3 câu SQL, 1 pipeline Redis (4 lệnh), 0 lệnh lẻ; 415/429/403 chặn trước I/O; lỗi giữa chừng ⇒ hoàn quota + gỡ tệp |
| HD-NFR-04 | int | `rls.int`, `hops.int` | 7 bảng ENABLE+FORCE RLS + policy; 0 HTTP nội bộ mọi route |
| D-04…D-13 | int · unit | tương ứng | `rejected` (D-04); D-06 quota Redis (nguyên tử 40 tải đồng thời ⇒ 30+10); D-07 cột sinh + 4 hàm IMMUTABLE parity TS↔SQL; D-08 REVOKE; D-09 JPEG/PNG; D-10 facets; D-13 không `source_text` trong chi tiết |

## 3. Ca chính theo route (chi tiết trong file)
- **Danh sách** (`list.int`, 38): lọc `category/status[]/owner/signer/seller/buyer/direction/kind/value_min,max/q`; `sort` `updated_at|value|end_date|title` × `asc|desc` (so theo số/ngày, không theo chuỗi); 400 cho `page 0/1001`, `page_size 0/101`, sort/dir/q 1 ký tự/owner không uuid; ListRow đúng 19 khoá; `q='100%'` chỉ khớp tiêu đề có `100%`.
- **Facets** (D-10): đếm `status/direction/kind/owner/seller/buyer/signer/category/value`, **không theo bộ lọc**; `category.n` = số **HĐ** (không phải số item); cắt 500 ⇒ `truncated:["seller"]`.
- **Chi tiết/source/file**: 23 khoá; items theo `ord`; đúng 50 event mới nhất; không `source_text/search_key/signer_keys`; `/file` 302 cùng origin FileBox, FileBox 5xx ⇒ 5xx; tenant khác ⇒ 404, FileBox không bị gọi.
- **PATCH**: §2 HD-AC06/07/09; thêm: giá trị y cũ ⇒ 200 không tăng version/event/outbox; xoá bằng `null`; `version` tương lai ⇒ 409; trigger ném ở `contract_events` ⇒ rollback sạch; đổi cột sinh (`buyer`, `value`) thấy ngay ở danh sách.
- **Tải lên**: PDF/DOCX/JPEG/PNG; không tin đuôi/mime; zip không có `word/document.xml` ⇒ 415; GIF/WebP/HEIC/HTML/rỗng ⇒ 400/415; 19 MiB ⇒ 201; `title` ≤ 200; phụ lục (cha hợp lệ / khác tenant / không có / `kind=contract` mà có `parent_id` / `kind` lạ); quota 30 + 40 đồng thời + 300 toàn cục (đặt bộ đếm 299 qua Redis) + khoá ngày theo múi tenant (mặc định `Asia/Ho_Chi_Minh`) / UTC + `EXPIRE ≤ 172800`; FileBox 5xx ⇒ 5xx + hoàn; DB lỗi sau `put` ⇒ tệp gỡ, quota hoàn.

## 4. Hiệu năng (Luật 4c, HD-AC14)
Dữ liệu `seed.ts`: 3 tenant (acme, beta, gamma) × 10.000 HĐ (5 item, 20 event, 50 loại, ~200 bên bán, ~300 người ký, 1/20 là phụ lục) + tenant nền 70.000 HĐ trơn (mỗi tenant đo ≈ 10 % bảng). Mỗi bảng × tenant **một** câu `INSERT … SELECT generate_series`; `autovacuum_enabled=false` và xoá `pg_statistic` cũ để pha 1 thật sự **chưa có thống kê** (ca tiền đề kiểm `pg_stats` rỗng). Thời gian dựng in ra mỗi lần chạy (`HD1 seed perf: … trong X s`).
| Mã | Ca | Ngưỡng |
|---|---|---|
| NFR-01 | `perf/list`: 19 tổ hợp (không lọc, từng lọc đơn, `status+owner+category`, `q` 3 ký tự và chọn lọc, trang cuối `page=500`, `page_size=100`, 3 kiểu sort) + facets + tenant beta, **mỗi pha** | p95 ≤ 50 ms; đúng 2 câu SQL; 0 Redis; 0 HTTP nội bộ; có kết quả (chống đo rỗng) |
| NFR-01 | EXPLAIN (sau ANALYZE): 6 tổ hợp danh sách, facets, chi tiết — bằng SQL **thật** chụp qua `options.debug` (tham số thế bằng hằng) dưới `contracts_rw` + tenant | không `Seq Scan` trên `contracts`/`contract_items` |
| NFR-02 | `perf/rw`: chi tiết (id đổi mỗi lượt) | p95 ≤ 30 ms; 2 câu |
| NFR-02 | PATCH (mỗi lượt một HĐ khác, version 1) | p95 ≤ 30 ms; 4 câu |
| NFR-03 | tải lên PDF nhỏ (đặt lại bộ đếm quota ngoài đồng hồ) | p95 ≤ 30 ms (FileBox giả cùng máy); 3 câu; 1 pipeline Redis |
Hai pha: ngay sau seed (chưa `ANALYZE`) rồi sau `ANALYZE` — cả hai phải đạt. Làm nóng ≥ pool + 2 (D2-48; đọc `options.max` của pool thật), n = 200 (`HD1_PERF_N`; tải lên ≤ 100), tuần tự, token ký sẵn. Báo p50/p95/max thật qua `console.log`. Số "trước" của mốc chưa có (chưa có code); T7 đo và ghi vào `review.md`/STATE.

## 5. Kết quả đỏ đúng lý do (trước code)
`tsc -p tsconfig.tests.json` sạch. Chạy ngày 2026-10-19 trên nhánh `platform/gd0` (chưa có `contracts`, T4, T6):
| Bộ | Đỏ/Tổng | Lý do |
|---|---|---|
| `rules/` (4 file, 60 ca) | 60/60 | `chưa có tính năng: domain luật thuần hợp đồng (T6)` ×46 · `contract zod gói hợp đồng (T4)` ×14 — ném ngay, không chờ |
| int (7 file, 156 ca) | 156/156 | 155 ca đỏ ở `expect({hd1_migrations_pack_contracts:false})` (thiếu schema `contracts`/role `contracts_rw`; hub-api, admin-api, FileBox giả, Redis dựng được — `beforeAll` xanh); 1 ca `chưa có tính năng: runPackMigrations (N1 T5a)`. Không PostgresError/TypeError trong fixture |
| perf (2 file, 53 ca) | 53/53 | cùng `hd1_migrations_pack_contracts` ở `prepare()` (chưa dựng dữ liệu) |
Tổng **269/269 đỏ đúng lý do**. Seed perf đo thử trên DB nháp với DDL **giản lược** (bảng + FK kép + 3 cột sinh, không RLS/outbox/index khác): 100.000 HĐ + 150.000 item + 600.000 event + 150 loại trong **17,6–18,8 s**; con số thật đo ở T7 (DDL đầy đủ chậm hơn). Hai lỗi fixture đã bắt qua bản thử này và sửa: tham số `jsonb` của postgres.js bị mã hoá hai lần (dùng `::text::jsonb`), `concat_ws` không IMMUTABLE (nhắc T5: cột `search_key` không dùng được `concat_ws` trực tiếp — cần `||`/`coalesce`, hoặc bọc hàm `sql IMMUTABLE`).

## 6. Diễn giải đã chọn / Cần bổ sung
| # | Việc | Agent |
|---|---|---|
| 1 | Seam hub-api: `createApp(cfg, deps)` nhận `deps.packs = { contracts: true, filebox: {url, token} }` (D-17: `contracts` vắng ⇒ `true`, `false` ⇒ 404; Redis thiếu ⇒ upload 503) | backend-lead (T7) |
| 2 | Tên hằng route: ListQuery dùng `owner`, `category`, `seller`, `buyer`, `signer`, `direction`, `kind`, `value_min/max`, `sort`, `dir`, `page`, `page_size` (plan §1, tham số mảng = lặp) — khác tên cột spec (`owner_user_id`, `category_id`) | — (plan thắng) |
| 3 | `quotaVerdict` nhận bộ đếm **sau** `INCR` (30 còn được, 31 ⇒ `tenant`; vượt cả hai ⇒ `tenant`) | backend-lead xác nhận (T6) |
| 4 | `sniffFileType(head)` của zip không kèm `zipNames` ⇒ `null` (không đoán DOCX từ "PK") | backend-lead xác nhận (T6) |
| 5 | Tên file domain tự do (`M/domain/*.rules.ts` — test hợp mọi export); tên export theo plan §4 (`fillFields mergeFields applyEdits foldVi personKey likePattern sniffFileType uploadDay quotaVerdict`) và contract §1 (`CONTRACT_FIELD_KINDS CONTRACT_TYPES CONTRACT_STATUSES HANDLED_OUTCOMES ITEM_KINDS fieldValueSchema ContractFieldSchema`) từ `packages/contracts/src/pack-contracts/index.ts` | backend-lead (T4, T6) |
| 6 | Ca "đổi múi giờ tenant ⇒ khoá ngày đổi" (Kiritimati): HD1 làm thật `TenantState.timezone` (D-16), không còn hằng tạm | backend-lead (T10) |
| 7 | NFC ở biên + `foldVi` gọi `normalize("NFC")` (D-18) ⇒ qc thêm ca NFD ở `rules/fold` + `list.int`; thêm ca `as_date` `2027-02-30`⇒null, `2028-02-29` (D-15) | qc (relock) |
| 8 | `facets.category.n` = số HĐ có ≥ 1 item loại đó (không phải số item); `facets.direction` có khoá `unknown` (khớp `ListQuery`) | backend-lead xác nhận (T7) |
| 9 | `search_key` viết bằng `coalesce(...) \|\| ' ' \|\|` 5 trường + title, không `concat_ws` (D-14) | backend-lead (T5) |
