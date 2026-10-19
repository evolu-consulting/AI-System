# Review · N1-pack-frame (T6, review chung + security)

## Kết luận: CHANGES REQUESTED · Security: SAFE · Spec: N1 · Vòng: 1

Không có Blocker, không có lỗi cách ly tenant hay lộ secret. Có 2 Major ở §4 (giới hạn hàm, `bun run check:fn` đỏ vì code N1), nên kết luận là CHANGES REQUESTED. Sửa xong hai mục này thì đạt APPROVED; các Minor chỉ cần ghi lại.

Phạm vi review: `git diff 1cdc17a..HEAD -- apps packages .dependency-cruiser.cjs .env.example`, bỏ phần của HD1 (`packs/contracts/**`, `migrations-pack-contracts/**`, `pack-contracts/**`). Đối chiếu với spec, plan, plan-frontend, tasks ("Quyết định trong lúc làm"), N1-gate, ADR-0023 và ADR-0024. Lúc review, working tree có thay đổi đang staged của một phiên khác (`apps/contracts-web/src/features/shell/**`). Review chấm theo HEAD `38064096`.

## Lệnh đã chạy
- `bun run check:fn` → **đỏ**. Có 3 vi phạm do N1 thêm (M-01, M-02). 2 vi phạm còn lại có từ trước N1: `filebox.client.ts:118 #retry` và `tools/scripts/src/depcruise.test.ts:56`.
- `bun run depcruise` → còn 3 lỗi `no-cross-module-repo`, cả ba có từ trước (kh/processes/studio). Không có lỗi `pack-*`, `ca-*` hay `web-kit-no-apps`.
- `bun test` trên `apps/hub-api/src/modules/packs`, `apps/admin-api/src/modules/packs`, `apps/admin-api/src/lib/web-app.contracts.test.ts`, `packages/web-kit`, `packages/db/src/pack-scope.test.ts`, `config.reloaded.test.ts` → 114 pass / 0 fail.
- `bun test` trong `apps/contracts-web` → 90 pass / 0 fail. Trong `apps/chat-web` → 449 pass / 0 fail (tách web-kit không làm hỏng hành vi đã có test).
- Chưa kiểm được: int, e2e và perf (`tests/acceptance/N1/**`, `*.perf.int.test.ts`). Brief cấm chạy int/e2e. Số đo T5d (POST lô 100 có p95 11,67–14,53 ms ≤ 30; GET có p95 3,68–4,97 ms ≤ 10; trước khi sửa là 17,27/3,23) và T5g (p95 2,8 ms; 19 MB mất 122 ms; bom ≤ 1,4 ms) có ghi trong tasks.md và có test perf tương ứng (`tests/acceptance/N1/perf/{pkdemo,docx,guard}.perf.int.test.ts`). Tôi chưa chạy lại để xác nhận các số này.

## Lỗi
| # | Mức | Nhóm | file:dòng | Vấn đề | Cách sửa đề xuất | Giao cho |
|---|---|---|---|---|---|---|
| M-01 | Major | 7 Chuẩn code | `apps/hub-api/src/modules/packs/kit/adapters/docx/index.ts:14` | `createDocxConverter` dài 66 dòng, vượt 50 (§4), làm `check:fn` đỏ. | Tách `pump`/`finish`/`spawn` ra thành một lớp nhỏ hoặc các hàm cấp module nhận một `state` object. Hành vi giữ nguyên, test `convert.test.ts` và AC08 vẫn phải xanh. | backend-lead |
| M-02 | Major | 7 Chuẩn code | `apps/contracts-web/src/features/table/use-table.ts:25`; `apps/contracts-web/src/styles/theme-parity.test.ts:77` | `useTable` dài 81 dòng; `describe("theme-parity admin-web ↔ contracts-web")` dài 62 dòng. Cả hai vượt 50, làm `check:fn` đỏ. | Tách `useTable` thành các hook con (lọc / sắp xếp / phân trang, hoặc `useServerPaging`). Chia `describe` thành 2 khối (sáng/tối) hoặc đưa dữ liệu ca thử vào `it.each`. | frontend-lead |
| m-01 | Minor | 3 Bảo mật | `packages/db/migrations-packs/0001_kit.sql:96` | `GRANT <k>_rw TO hub_api WITH INHERIT FALSE, SET TRUE`: mọi code của hub-api đều có thể `set_config('role', '<k>_rw')` cho bất kỳ gói nào, kèm bất kỳ `app.tenant_id` nào. Hiện đang cách ly đúng vì chỉ `withPackScope` đặt role/tenant (lấy từ token), nhưng chưa có gì bắt buộc điều này. | Thêm luật kiểm tĩnh (grep test hoặc depcruise): `set_config('role'` và `app.tenant_id` chỉ được xuất hiện trong `packages/db/src/{pack-scope,scope,hub-scope}.ts`. | backend-lead |
| m-02 | Minor | 4 Dữ liệu | `packages/db/migrations-packs/0001_kit.sql:98-101` | `packs.install` chèn feature `<k'>-read/write/admin` với `ON CONFLICT DO NOTHING`. Nếu khoá gói trùng một feature không thuộc gói đã có (ví dụ sau này có `kh-read`), gói sẽ lặng lẽ "nhận" feature đó, và entitlement của feature cũ sẽ bật luôn gói. Hiện chưa có feature nào trùng. | Trong `install`: feature đã tồn tại mà `packs.registry` chưa có khoá ⇒ `RAISE`. Hoặc thêm cột/đánh dấu nguồn `pack` cho feature. | backend-lead |
| m-03 | Minor | 3 Bảo mật (DoS) | `apps/hub-api/src/modules/packs/kit/adapters/docx/index.ts:61` | `toMarkdown` không chặn kích thước đầu vào mà dựa hoàn toàn vào nơi gọi. Hàng đợi `maxPending=2` dùng chung toàn tiến trình: một tenant gửi liên tục có thể làm mọi tenant khác nhận `DOCX_BUSY`. ADR-0024 §3 đã chấp nhận điều này; hiện chưa có route nào dùng converter. | Thêm `bytes.byteLength > 20 MiB ⇒ TOO_LARGE/UNREADABLE` ngay tại cổng (khớp `files_ck`). Khi gắn route ở HD, thêm rate limit theo tenant. | backend-lead (HD) |
| m-04 | Minor | 3 Bảo mật | `apps/hub-api/src/modules/packs/packs.mount.ts:34` | `pkdemo` mặc định là `!== "production"`, tức là mở khi `APP_ENV` vắng hoặc sai. Vẫn đóng ở tầng dưới vì guard thiếu feature ⇒ `PACK_DISABLED`, và migration `devOnly` không chạy ở prod. | Đổi điều kiện thành `appEnv === "development" \|\| appEnv === "test"` (như `isDevEnv` của seed). | backend-lead |
| m-05 | Minor | 4 Dữ liệu | `apps/hub-api/src/modules/packs/kit/adapters/pack-files.filebox.ts:96-98` | `remove` xoá mềm hàng trước (đã commit), rồi mới gọi FileBox `deleteFile` ngoài tx. Nếu FileBox lỗi thì file mồ côi còn lại ở FileBox, không có thử lại. | Ghi vào TECH-DEBT, hoặc thêm việc dọn định kỳ (hàng `deleted_at` + `file_id`). | backend-lead |
| m-06 | Minor | 5 Hiệu năng | `apps/hub-api/src/modules/config/config.service.ts:110` | `adminSettled()` chờ cả vòng `coalesce`, kể cả các lần chạy lại do `again`. Nếu NOTIFY dồn dập, request gói có thể chờ qua nhiều lần nạp. | Chỉ chờ lần nạp đang chạy lúc gọi (lưu promise của từng lượt), hoặc ghi rõ giới hạn này trong plan §5. | backend-lead |
| m-07 | Minor | 5 Luật 4c | `packages/web-kit/src/auth/refresh-lock.ts` (`SUPERSEDED_RETRY_DELAY_MS`, `deps.sleep`) | Gặp `REFRESH_SUPERSEDED` thì ngủ 100 ms rồi thử lại. Đây là code chuyển nguyên từ chat-web/admin-web (TF3 không đổi hành vi), không phải lỗi mới. | Ghi vào `docs/TECH-DEBT.md`. Có thể thay bằng chờ thông điệp `token` trên BroadcastChannel. | frontend-lead |
| m-08 | Minor | 9 Truy vết | `apps/contracts-web/src/features/auth/lib/session.ts:7` | Comment đã lỗi thời ("admin-api chưa có `contracts`…"). Commit a95ba100 đã thêm `contracts` vào `WEB_APPS` ⇒ cookie đúng là `ai_rt_contracts`. | Sửa lại comment. | frontend-lead |
| m-09 | Minor | 3 Bảo mật | `apps/hub-api/src/modules/packs/kit/adapters/docx/convert.ts:35` | Zip có 2 mục trùng tên (ví dụ hai `word/document.xml`) thì `Map` lấy mục cuối, mà công cụ khác có thể đọc mục đầu ⇒ nội dung hiển thị có thể khác nhau. | Tên trùng ⇒ `DOCX_UNREADABLE`. | backend-lead |

## Security (S-xx)
| # | Hạng mục | Kết quả | Căn cứ |
|---|---|---|---|
| S-01 | Role gói `<k>_rw` NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER…; được `ALTER` lại mỗi lần install | Đạt | `0001_kit.sql:88-91` |
| S-02 | Schema gói `REVOKE ALL FROM PUBLIC`, chỉ `<k>_rw` có USAGE (không có CREATE). `hub_api` chỉ vào được qua SET ROLE (`INHERIT FALSE`) | Đạt | `0001_kit.sql:92-96`. Có test ở `rls.int.test.ts:163-198` (42501 với hub/admin, DDL, kết nối thường) |
| S-03 | ENABLE + FORCE RLS; policy `FOR ALL TO <k>_rw USING/WITH CHECK tenant_id = NULLIF(current_setting('app.tenant_id'),'')::uuid`. Rỗng/thiếu ⇒ NULL ⇒ 0 hàng. Không có nhánh system | Đạt | `0001_kit.sql:31,42-47`. Bảng chưa gọi `secure_table` thì không được GRANT ⇒ đóng mặc định |
| S-04 | FK kép `(item_id, tenant_id) → (id, tenant_id)`: RI bỏ qua RLS nhưng cột tenant bị `WITH CHECK` ép ⇒ không tham chiếu chéo tenant được | Đạt | `migrations-pack-pkdemo/0001_init.sql:23-24` |
| S-05 | `withPackScope`: kiểm khoá/uuid trước khi mở tx; mọi giá trị đi qua tham số; một câu `set_config(...,true)` (tx-local, không rò sang request sau); tenant/user lấy từ token | Đạt | `packages/db/src/pack-scope.ts:31-58`, `pack-uow.ts:27-32` (`packTenantOnly` chặn `system` ở HTTP). Rủi ro còn lại xem m-01 |
| S-06 | SQL injection qua khoá gói: `check_key` (regex + danh sách cấm + `pg_`) chạy trước mọi `format`; `%I`/regclass `%s`; phía TS có `PackKeySchema` trước `sql.raw`/`sql.identifier`; `migrate-packs` ghép tên bảng từ hằng | Đạt | `0001_kit.sql:17-24,33-34`; `index-outbox.repo.ts:21`; `migrate-packs.ts:16-35` |
| S-07 | Hàm `packs.*` là SECURITY INVOKER, `search_path` cố định, `REVOKE ALL … FROM PUBLIC`; không có SECURITY DEFINER | Đạt | `0001_kit.sql:18,27,53,82,105-111` |
| S-08 | `index_outbox` chỉ cho INSERT, `files` không cho DELETE (xoá mềm) | Đạt | `0001_kit.sql:77-78` |
| S-09 | Quyền gói: guard fail-closed (gói chưa cài / feature `off` / mất entitlement ⇒ không có quyền); Group lấy theo `tenantId` của token, user khác tenant ⇒ rỗng; D-11 bỏ grant user lẻ; 403 trước 400 | Đạt | `pack-guard.middleware.ts:51-89`, `pack-access.rules.ts:27-36`, `pkdemo.routes.ts:34-43` |
| S-10 | Cache quyền `adminSettled()` chỉ chờ, 0 SQL, nuốt lỗi nạp (giữ cache cũ); `loadUsers` lọc Group cùng tenant với user | Đạt | `config.service.ts:110-113`, `config.repo.ts:187-189`. Độ trễ xem m-06 |
| S-11 | Admin bật/tắt: `requireAuth` + `platform_admin`; khoá zod ⇒ 400 trước khi chạm DB; tenant lạ ⇒ 404; một tx `configWrite`; audit `grant/revoke` + `summary.op` chỉ ghi khi có đổi; NOTIFY sau commit | Đạt | `packs.routes.ts:12-21`, `packs.service.ts:25-93`. Tranh chấp test đã xử đúng (không đổi contract M4) |
| S-12 | FileBox `org=t_<tenant>`: tenant lấy từ token; CHECK `files_org_ck` ở DB, kiểm lại ở code; không thấy / tenant khác / đã xoá / id sai dạng ⇒ cùng một 404, không gọi FileBox; log chỉ `{pack,row_id}`; lỗi client không có URL/file_id | Đạt | `pack-files.filebox.ts:59-99`, `pack-files.routes.ts:16-21`, `0001_kit.sql:63`, `filebox.client.ts` (message không có URL) |
| S-13 | DOCX: chặn zip bomb (central directory đọc trước, giới hạn số phần / tổng / tỉ lệ, đếm byte thật, dừng ở mảnh vượt), zip64/mã hoá/method lạ ⇒ từ chối, mỗi phần XML ≤ 50 MiB, độ sâu ≤ 256; saxes không mở entity DTD ⇒ không có XXE / billion laughs; không đọc quan hệ ngoài; worker riêng, timeout 10 s ⇒ `terminate`; hàng đợi giới hạn ⇒ `DOCX_BUSY` | Đạt | `zip-reader.ts:39-95`, `convert.ts:25-55`, `docx.rules.ts:7-46`, `index.ts:14-79`. Phần còn lại xem m-03, m-09 |
| S-14 | contracts-web auth: `X-App: contracts` ⇒ cookie riêng `ai_rt_contracts` (Path=/auth, httpOnly như CR-053); token chỉ giữ trong bộ nhớ; kênh/khoá có tên riêng; `onEnd` xoá cache Query | Đạt | `packages/contracts/src/auth.ts:23`, `contracts-web/src/features/auth/lib/session.ts:12-17`, `auth.contracts-app.int.test.ts` |
| S-15 | `safeNext`: chỉ nhận `/…`, chặn `//`, `/\`, ký tự điều khiển, `/login`; điều hướng bằng `router.history.replace` (cùng origin) ⇒ không open redirect | Đạt | `contracts-web/src/features/auth/lib/next.ts:12-21`, `LoginPage.tsx:52-54` |
| S-16 | Tách web-kit không đổi hành vi chat-web: session/refresh-lock/auth-channel/http chuyển nguyên, chat-web giữ tên kênh/khoá/`X-App: chat` và `onEnd` xoá nháp | Đạt | diff `apps/chat-web/src/lib/auth/session.ts`; chat-web unit 449/449. e2e chưa kiểm được (bị cấm chạy) |
| S-17 | Lộ secret: diff không có secret thật; `.env.example` chỉ thêm origin CORS | Đạt | `.env.example:16-17` |

## Quyết định tự làm (tasks.md) — đánh giá
- T5a (`check_key`/`create_kit_tables`, CHECK độ dài): đúng, chỉ bổ sung thêm.
- T5b (1) dùng audit enum M4 + `summary.op`: đúng, vì đổi contract là hard stop. (2) `loadUsers` gộp lại còn 1 câu: đúng, vẫn lọc Group cùng tenant. (3) `adminSettled`: đúng, xem m-06. (5) gói chưa cài ⇒ coi như chưa bật: đúng (fail-closed). (6)/(7)/(8): đúng.
- T5c (1)–(7): đúng. Riêng `packTenantOnly` là lớp chặn tốt cho phía HTTP.
- T5d chuyển outbox vào bộ khung, có số đo trước → sau: đúng Luật 4c.
- T5e/T5f: đúng (FileBox gọi ngoài tx; không mount route file khi thiếu env).
- T5g thêm các giới hạn ngoài plan (50 MiB/phần, độ sâu 256, tỉ lệ 500:1): đúng, chặt hơn plan.
- TF4 nạp guard động để giữ ngân sách bundle: đúng, nợ đã ghi lại. TF6 không thêm TanStack Table / virtualize: đúng (page_size ≤ 100).
- Fix X-App: đúng. Comment cũ xem m-08.

## Rubric
1 ✓ · 2 ✓ · 3 ✓ (SAFE; Minor m-01/m-03/m-04/m-09) · 4 ✓ (m-02/m-05) · 5 ✓ (số đo đã ghi; chưa chạy lại) · 6 ✓ (unit xanh; int/e2e chưa kiểm) · 7 ✗ (M-01, M-02: `check:fn` đỏ) · 8 ✓ (locale VI/EN cùng 144 dòng, có test `contracts-locales.test.ts`; đủ trạng thái tải/lỗi/không quyền) · 9 ✓ (m-08)
