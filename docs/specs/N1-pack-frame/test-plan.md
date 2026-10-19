# Test plan · N1-pack-frame

qc WRITE (test trước code, rủi ro cao), 2026-10-19. Spec: [spec.md](spec.md) · [plan.md](plan.md) · [plan-frontend.md](plan-frontend.md) · [spec-decisions.md](spec-decisions.md). Task T5a…T5g, TF4 rủi ro cao ⇒ test có trước code; TF5 `thường` (Shell không chạm auth/quyền, tasks.md), e2e Shell vẫn viết sẵn. Mã trong tên test = mã FR/AC/NFR.

## 1. Lệnh và hạ tầng
| Việc | Lệnh |
|---|---|
| Luật thuần + depcruise | `bun test tests/acceptance/N1/rules` |
| Int (DB clone mẫu, `test:int:par`) | `bun run test:int:par tests/acceptance/N1` |
| Perf (không thuộc Lệnh xong) | `PERF=1 bun --env-file=.env.local --config=bunfig.perf.toml test --timeout 120000 tests/acceptance/N1/perf/` |
| e2e khung | `bunx playwright test -c e2e/N1/playwright.config.ts` |

Dùng lại: `setupX2a` (DB sạch + persona), `startFbFake` (FileBox giả FB1), `countQueries`/`hubActivity` (`P-d/d1/_count.ts`), `captureLogs`. Mới: `_support/n1.ts` (hub-api + admin-api in-process trên CÙNG DB, `countHops` đếm SQL/Redis/HTTP, `untilHubSettles`/`afterReload` chờ theo tín hiệu hoạt động DB của Hub), `_support/load.ts` (nạp động module chưa có, đỏ ngay "chưa có tính năng"), `_support/zip.ts` (dựng zip/DOCX/zip bomb bằng tay).

Persona acme: `lan`=owner · `hoa`=editor · `tam`=viewer · `cuc`=không Group · `nghi` inactive · `khoa` bị tenant khoá; beta: `an`; platform: `padmin`; `tadmin` = tenant_admin. Id cố định dải `a5e1…`. Không `sleep`/poll/`waitForTimeout`; chờ = promise tín hiệu (hoạt động SQL của Hub, NOTIFY, route e2e); `setTimeout` chỉ là lưới an toàn.

## 2. Truy vết FR/BR/AC/NFR → ca
| Mã | Loại | File (tests/acceptance/N1/ · e2e/N1/) | Dữ liệu · kỳ vọng |
|---|---|---|---|
| PK-FR-01 | unit | `rules/pack-contract.test.ts` | `PACK_KEY_RE` nhận 2–21 ký tự, loại `a`/22 ký tự/hoa/`-`; `PackKeySchema` cấm `public admin hub drizzle packs information_schema pg_*`; khai một chỗ (xuất qua index) |
| PK-FR-01 | int | `migrate.int.test.ts`, `admin-packs.int.test.ts`, `api.int.test.ts` | `packs.install` RAISE 12 khoá sai; admin PUT khoá cấm ⇒ 400; `withPackScope` từ chối packKey cấm |
| PK-FR-02 | int | `rls.int.test.ts` | mọi bảng gói ENABLE+FORCE RLS, ≥ 1 policy `FOR ALL TO <k>_rw`, biểu thức `NULLIF(current_setting('app.tenant_id', true), '')::uuid` cả USING/WITH CHECK, `tenant_id uuid NOT NULL`, mọi FK nội schema chứa `tenant_id` hai đầu |
| PK-FR-03 | int | `rls.int.test.ts`, `api.int.test.ts` | cờ role (NOBYPASSRLS, NOINHERIT, NOLOGIN…); `hub_api` `SET TRUE`/`INHERIT FALSE`; không USAGE `hub`/`admin`; `withPackScope`: `TENANT_INVALID` trước tx, role trở lại `hub_api` sau tx |
| PK-FR-04 | int | `migrate.int.test.ts` | thư mục `migrations-packs`, `migrations-pack-pkdemo` từ `0001`; chạy 2 lần ⇒ 0 migration mới, schema không đổi; hai runner song song áp đúng 1 lần; dùng `withMigrateLock`; production không cài `pkdemo`; DB mẫu có gói |
| PK-FR-05 | unit | `rules/pack-access.rules.test.ts`, `rules/pack-contract.test.ts` | `checkPackAccess` 8 ca (DISABLED thắng FORBIDDEN, hợp Group); `PACK_ROLE_ACTIONS`, `packFeatureKey`/`packGroupKey` khớp `^[a-z0-9-]{2,32}$` |
| PK-FR-05 | int | `admin-packs.int.test.ts`, `access.int.test.ts` | PUT/GET/DELETE `/admin/tenants/:id/packs[/:k]` (§4): 3 Group + 6 grant + 3 entitlement, idempotent, audit `pack.enable/disable`, NOTIFY `config_changed`, chỉ platform admin (403/401); `/me`: viewer=[read], editor=[read,write], owner=cả ba, chưa bật ⇒ `enabled:false`; thêm/gỡ Group có hiệu lực ≤ 5 s; inactive/khoá ⇒ không quyền; grant user lẻ bị bỏ qua (Q9) |
| PK-FR-06 | int | `files.int.test.ts`, `rls.int.test.ts` | `org=t_<tenant>` (CHECK ở DB ⇒ 23514 khi lệch); tenant khác ⇒ 404 và FileBox KHÔNG bị gọi; 404 lạ ≡ 404 tenant khác; log không có `/d/…` hay `file_id`; 302 cùng origin FileBox; FileBox 5xx ⇒ fail-closed |
| PK-FR-07 | unit · int · perf | `rules/docx.rules.test.ts`, `docx.int.test.ts`, `perf/docx.perf.int.test.ts` | **phụ thuộc ADR-0024 Accepted** (xem §5). `checkZipEntries` (2000/2001 phần, 100 MiB, macro); mẫu thật ⇒ "Điều 1…4" + ≥ 2 bảng GFM; hỏng/mã hoá/macro/PDF/ảnh/zip bomb/XXE ⇒ `DOCX_UNREADABLE`, không ném |
| PK-FR-08 | unit · int | `rules/pack-contract.test.ts`, `api.int.test.ts` | `IndexOutboxRowSchema`; POST ⇒ ≥ 1 hàng outbox (entity `item`, `upsert`, đúng tenant); rollback (constraint trigger hoãn ở COMMIT, chỉ tạo trong test bằng SQL owner, không vào migration `pkdemo`) ⇒ 0 hàng; không có item thiếu outbox |
| PK-FR-09 | int · unit | `api.int.test.ts`, `access.int.test.ts`, `rules/layers.test.ts`, `hops.int.test.ts` | body/query/header giả `tenant_id` bị bỏ qua; JWT sai ⇒ 401; depcruise: `domain/` import `adapters/`/driver ⇒ `ca-domain-builtin-only`; luật `pack-no-cross-pack`, `pack-no-hub-modules`, `pack-no-hub-schema`; `packs.mount.ts` được import `modules/config`; mã gói không `fetch`/ADMIN_API |
| PK-FR-10 | e2e | `e2e/N1/login.n1.ts`, `shell.n1.ts`, `states.n1.ts` | xem §3 |
| PK-BR-01 | int | `hops.int.test.ts` | 0 HTTP nội bộ, 0 Redis mỗi request; quyền từ ConfigCache |
| PK-AC01 | int | `rls.int.test.ts` | tenant B: SELECT/UPDATE/DELETE hàng của A = 0 (cha, con); không đặt / đặt `''` ⇒ 0; WITH CHECK ⇒ 42501; đối chứng tenant đúng thấy hàng |
| PK-AC02 | int | `rls.int.test.ts` | con(B)→cha(A) ⇒ 23503 qua role gói VÀ qua owner; `UNIQUE(id,tenant_id)`; CASCADE |
| PK-AC03 | int | `rls.int.test.ts` | `rolbypassrls=false`; `SELECT hub.process_runs`/`admin.users` ⇒ 42501; `hub_api` thường ⇒ 42501 trên `pkdemo`; `CREATE TABLE` ⇒ 42501 |
| PK-AC04 | int | `migrate.int.test.ts` | `runPackMigrations` ×2 trên DB nháp: lần 2 `kit=0`, `packs.*=0` |
| PK-AC05 | int | `admin-packs`, `access` | bật gói ⇒ 3 Group + mã mặc định; viewer ghi ⇒ 403 `PACK_FORBIDDEN`; thêm vào editor ⇒ ≤ 5 s ghi được |
| PK-AC06 | int | `access.int.test.ts` | chưa bật/entitlement thu hồi/feature `off` ⇒ 403 `PACK_DISABLED` đọc và ghi; DELETE admin ⇒ Hub thấy ≤ 5 s |
| PK-AC07 | int | `files.int.test.ts` | như PK-FR-06 |
| PK-AC08 | int | `docx.int.test.ts` | như PK-FR-07 |
| PK-AC09 | int | `api.int.test.ts` | như PK-FR-08 |
| PK-AC10 | int | `api.int.test.ts` | body `tenant_id`=beta (editor acme) ⇒ 201, hàng ghi tenant acme; `?tenant_id=`/`x-tenant-id` beta ⇒ 404; phản hồi không chứa `tenant_id` |
| PK-AC11 | unit | `rules/layers.test.ts` | dựng cây tạm đúng đường dẫn rồi chạy `.dependency-cruiser.cjs` thật |
| PK-AC12 | int | `hops.int.test.ts` | /me + GET + POST: HTTP nội bộ 0, Redis 0, SQL 0+2+3 |
| PK-NFR-01 | int · perf | `hops.int.test.ts`, `perf/guard.perf.int.test.ts` | /me nóng = 0 câu (status 200); nguội ≤ 1; p95 thêm ≤ 2 ms (10.000 lượt, trừ nền `/health`) |
| PK-NFR-02 | perf | `perf/docx.perf.int.test.ts` | mẫu p95 ≤ 300 ms; 20 MB ≤ 5 s, RSS +≤ 256 MB (đo sau, không đỉnh); bom ≤ 1 s. Phụ thuộc ADR |
| PK-NFR-03 | int | `api.int.test.ts` | POST 1 con và 100 con: đúng 1 câu `INSERT … index_outbox`, tổng 3 câu; GET không outbox |
| PK-NFR-04 | int | `rls.int.test.ts` | guard mọi schema trong `packs.registry`; 2 tenant × `items/item_lines/files/index_outbox`; role gói 42501 trên `hub.*`/`admin.*` |
| PK-NFR-05 | int · perf | `hops.int.test.ts`, `perf/pkdemo.perf.int.test.ts` | bảng plan §10: /me 0/1 · GET 2/+1 · POST 3/+1 · files 2 + 1 FileBox; không đổi theo số con; POST lô 100 p95 ≤ 30 ms, GET p95 ≤ 10 ms (1.000 lượt, 10.000 hàng nền) |

## 3. e2e khung contracts-web (TF4, TF5) — `e2e/N1/`
Config riêng `playwright.config.ts` (đuôi `.n1.ts`, `test:all` tự nhận). Backend giả bằng `page.route` (`_support.ts`: `/auth/refresh|login|logout`, `/pack/contracts/me`; hình theo `TokenGrant` và `PackMeResponse`). Nhãn nguyên văn plan-frontend §7.
- `login.n1.ts` (8): guard `/login?next=`; đăng nhập đúng (next, Bearer ở `/me`, body `tenant_key/username/password`); sai mật khẩu; ô "Mã công ty" chỉ khi chưa biết tenant; Hiện/Ẩn mật khẩu; đã có phiên; hết phiên 401; bản EN.
- `shell.n1.ts` (12): 4 mục menu + href; `aria-current`; `/` và `*` → `/contracts`; 6 route khung; "Sổ Hợp Tác"; panel trợ lý (mở/đóng/nhớ sau reload, kéo); chunk `assistant` lazy; "Góp ý về app"; chuông rỗng; "Giao diện" sáng/tối; mobile 390: thanh dưới 4 mục, sidebar ẩn, không cuộn ngang.
- `states.n1.ts` (9): `PACK_FORBIDDEN`/`PACK_DISABLED` (VI + EN); viewer/editor/owner vào shell; `status "Đang tải…"` (giữ `/me` bằng cổng); lỗi mạng ⇒ `alert` + "Thử lại"; màn rỗng.
Ngoài phạm vi N1: nút nghiệp vụ theo vai ("+ Thêm hợp đồng", "Xoá …") thuộc màn HD5; so ảnh với mgmt-app thuộc TF7 (`e2e/contracts-web`).

## 4. Chốt chữ ký (readiness lần 1 #1–#7, 2026-10-19; trước đây "Tranh chấp/Cần bổ sung")
| # | Việc | Chốt (plan) |
|---|---|---|
| T1 | Tiền tố route Admin | `/admin/tenants/:tenant_id/packs[/:pack_key]` (plan §2); qc đổi `ADMIN_PACKS_BASE` + relock |
| 1 | Seam `createApp(cfg, deps)` | `AppDeps.packs?: { pkdemo?: boolean; filebox?: { url: string; token: string } }`; vắng ⇒ `pkdemo = APP_ENV !== "production"`, filebox từ env FB1 (plan §9) |
| 2 | Body pkdemo | `POST /pack/pkdemo/items` `{title 1–200, lines:[{text 1–200}] ≤ 100}` ⇒ 201 `{id,title,lines:[{id,text}]}`; GET cùng hình / 404 `NOT_FOUND`; sai ⇒ 400 `VALIDATION_ERROR`; GET cần `read`, POST `write` (plan §10) |
| 3 | `packActionsFor` | `(i: { entitled; featureOff; userGroupIds; grantedByAction }): PackAction[]` (plan §5); kiểm unit được, không chỉ qua `/me` |
| 4 | Adapter DOCX | `kit/adapters/docx/index.ts` xuất `createDocxConverter(opts?: { maxPending?; timeoutMs? })` ⇒ `DocxConverter & { close() }` (plan §7) |
| 5 | Route file | `GET /pack/pkdemo/files/:rowId/content` ⇒ 302 `Location` (plan §6); không route upload ⇒ test chèn hàng `pkdemo.files` bằng SQL owner + `fb.put`; route upload/xoá do HD1+ (readiness #20) |
| 6 | Tín hiệu nạp lại | `ConfigCache.reloaded(minAdminVersion?): Promise<number>` (T5b); test `await` nó, không chờ gián tiếp bằng `hubActivity` |
| 7 | Migrate/audit/lỗi | `runPackMigrations({url, appEnv}) → {kit, packs}`; `test-db-template.ts` gọi nó (T5a ghi thời gian dựng mẫu trước/sau); audit `pack.enable`/`pack.disable`; lỗi route Admin theo plan §2: khoá sai 400, tenant không có 404, gói chưa cài 404 `PACK_NOT_FOUND`, không phải platform admin 403, không token 401, DELETE đã tắt 204 không audit |
| 8 | TTL link 10' | do FileBox (FB1) quyết — N1 không có ca TTL |

## 5. Ca phụ thuộc quyết định người dùng
ADR-0024 **Accepted** (D-13, 2f98a5c): 22 ca DOCX (6 unit + 13 int + 3 perf) hết "PHỤ THUỘC", chuyển sang đỏ vì thiếu module (T5g); `needAdr0024Accepted` (đọc `docs/adr/0024-docx-to-markdown.md`) qua. Số liệu §6 là lần chạy trước khi ADR Accepted (19 ca "PHỤ THUỘC" khi đó).

## 6. Kết quả chạy trước code (đỏ đúng lý do)
| Bộ | Tổng | Đỏ | Xanh sẵn | Đỏ đúng lý do |
|---|---|---|---|---|
| unit `rules/` | 33 | 30 | 3 (đối chứng depcruise: `ca-*` sẵn có ×2, `packs.mount.ts` không bị cấm) | 30/30 (21 thiếu module + 3 thiếu luật `pack-*` + 6 PHỤ THUỘC ADR) |
| int `test:int:par` | 101 | 101 | 0 | 101/101 (mọi ca đỏ ở `needPackKit` = thiếu schema/role gói, `runPackMigrations`, `withPackScope`, hoặc route vắng ⇒ 404; 13 ca DOCX là "PHỤ THUỘC") |
| perf `perf/` | 5 | chưa chạy | — | thiếu `needPackKit`/ADR ngay ở đầu ca (không chờ) |
| e2e `e2e/N1` | 29 | chưa chạy được | — | webServer `bun run --filter @ai/contracts-web build` thoát lỗi sau ≈ 1 s ("No workspace packages matched"); `playwright --list` trên máy này lỗi AggregateError ở cả `e2e/chat` ⇒ môi trường (chạy lại sau TF1; còn lỗi ⇒ ghi `docs/TECH-DEBT.md`) |

Chi tiết unit: 13 `pack-contract` + 8 `pack-access` + 6 `docx.rules` + 3 `layers` đỏ ⇒ 30; trong đó 6 `docx.rules` là "PHỤ THUỘC". Đỏ đúng lý do tính năng (trừ phụ thuộc ADR): unit 24/24, int 88/88 (101 − 13 DOCX), tổng **112/112**; phụ thuộc ADR: 19 (6 + 13) ca đã chạy.

Thời gian chạy trước code: unit ≈ 4–14 s (depcruise ×6), int ≈ 2.5–3 s (6 file, hub + admin dựng 1 lần/file). Con số sau code ghi lại ở bước VERIFY.

## 7. Độ phủ FR MUST
FR-01…FR-10, BR-01: 11/11 có ≥ 1 ca; AC01…AC12: 12/12; NFR-01…05: 5/5. Giả định chữ ký chưa có trong plan nằm ở §4 (qc không đoán thêm).
