# Plan backend · N1-pack-frame

backend-lead, PLAN 2026-10-18. Quyết định D-04…D-13 ở [`spec-decisions.md`](spec-decisions.md). ADR mới: [0024](../../adr/0024-docx-to-markdown.md) (Accepted, D-13). Không đổi contract/RLS lõi đã khoá (Admin M2/M3, Hub, P-d) — chỉ thêm.

## §1 Hiện trạng dùng lại
Có sẵn: JWT kiểm khoá công khai tại chỗ (`hub-api/src/lib/auth.middleware.ts`, 0 SQL khi nóng) · `withMigrateLock` (`packages/db/src/migrate-hub.ts:18-34`) · `createHubUow` thử lại 40P01/40001 (`processes/adapters/hub-uow.ts`, `hub-scope.ts`) · `FileboxClient` với `org` cố định mỗi instance (`attachments/filebox.client.ts`).

## §2 Contract — `packages/contracts/src/packs.ts` (mới, export qua index)
```ts
export const PACK_KEY_RE = /^[a-z][a-z0-9_]{1,20}$/;            // D-05: ≤ 21 ký tự
export const RESERVED_PACK_KEYS = ["public","admin","hub","drizzle","packs","information_schema"] as const; // + cấm tiền tố "pg_"
export const PackKeySchema = z.string().regex(PACK_KEY_RE).refine(k => !k.startsWith("pg_") && !RESERVED_PACK_KEYS.includes(k as never));
export const PACK_ACTIONS = ["read","write","admin"] as const;  export const PackActionSchema = z.enum(PACK_ACTIONS);
export const PACK_ROLES = ["owner","editor","viewer"] as const; export const PackRoleSchema = z.enum(PACK_ROLES);
export const PACK_ROLE_ACTIONS = { viewer:["read"], editor:["read","write"], owner:["read","write","admin"] } as const;
export const packCode = (k, a) => `${k}.${a}`;                          // mã hiển thị: contracts.read
export const packFeatureKey = (k, a) => `${k.replaceAll("_","-")}-${a}`; // admin.features.key: contracts-read
export const packGroupKey = (k, r) => `${k.replaceAll("_","-")}-${r}`;   // admin.groups.key: contracts-owner
export const PackErrorCode = z.enum(["PACK_DISABLED","PACK_FORBIDDEN","PACK_NOT_FOUND","DOCX_UNREADABLE","DOCX_BUSY"]);
export const PackStateSchema = z.object({ key: PackKeySchema, enabled: z.boolean(),
  groups: z.array(z.object({ role: PackRoleSchema, group_id: z.uuid() })).max(3) });
export const PackListResponseSchema = z.object({ items: z.array(PackStateSchema).max(50) });
export const PackMeResponseSchema = z.object({ pack: PackKeySchema, enabled: z.boolean(), actions: z.array(PackActionSchema).max(3) });
export const IndexOutboxRowSchema = z.object({ entity: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  entity_id: z.uuid(), op: z.enum(["upsert","delete"]) });
export const DocxMarkdownSchema = z.object({ markdown: z.string().max(5_000_000), warnings: z.array(z.string().max(200)).max(50) });
```
`packFeatureKey` đơn ánh vì khoá gói không có `-`. Body route gói **không bao giờ** có `tenant_id`/`user_id` (zod mặc định strip ⇒ PK-AC10).

| Mã lỗi | HTTP | Khi |
|---|---|---|
| `PACK_DISABLED` | 403 | tenant chưa có entitlement `<k>-read` còn hiệu lực, hoặc feature `status='off'` (`beta` coi như `on`) |
| `PACK_FORBIDDEN` | 403 | đã bật, user không thuộc Group nào được cấp mã cần |
| `PACK_NOT_FOUND` | 404 | admin bật gói chưa cài (thiếu 3 feature) |
| `DOCX_UNREADABLE` | 422 | hỏng / mã hoá / macro / vượt giới hạn / quá 10 s |
| `DOCX_BUSY` | 503 | hàng đợi worker DOCX đầy (ADR-0024 §3) |
| `NOT_FOUND` (có sẵn) | 404 | file/hàng gói không thấy **hoặc** `org` lệch tenant (không lộ tồn tại) |

### Route admin-api (router `packsRoutes` mount dưới `/admin/tenants` cạnh `tenantsRoutes`, `app.ts:83-84`; quyền như `PUT /admin/features/:id/entitlements/:tenant_id`: chỉ platform admin)
| Route | Vào | Ra |
|---|---|---|
| `GET /admin/tenants/:tenant_id/packs` | — | 200 `PackListResponse` (gói đã cài = có `packs.registry`) |
| `PUT /admin/tenants/:tenant_id/packs/:pack_key` | — (idempotent) | 200 `PackState`; audit `pack.enable` |
| `DELETE …/packs/:pack_key` | — | 204; thu hồi 3 entitlement (`revoked_at=now()`), giữ Group/grant; audit `pack.disable`; đã tắt ⇒ 204 idempotent, không audit |

Lỗi Admin: khoá không qua `PackKeySchema` ⇒ 400 `VALIDATION_ERROR`; tenant không có ⇒ 404 `NOT_FOUND`; gói chưa cài (PUT/DELETE) ⇒ 404 `PACK_NOT_FOUND`; không phải platform admin ⇒ 403 `FORBIDDEN`, không token ⇒ 401.

### Route hub-api cho app web gói (PK-FR-10)
Tiền tố `/pack/<k>` (hub-api không có `/api/v1`). Bearer token do admin-api cấp. `GET /pack/<k>/me` ⇒ 200 `PackMeResponse` **kể cả khi chưa bật/không quyền** (`enabled:false` hoặc `actions:[]`; UI: write = `actions` có `write`, owner = có `admin`), 0 SQL nóng; các route khác trả 403 như bảng lỗi. Cùng origin qua proxy (D-18) ⇒ không CORS. Route nghiệp vụ do từng gói (HD1+).

## §3 DDL (PK-FR-01…04, 06, 08)
**Thư mục:** `packages/db/migrations-packs/` (bộ khung, bảng theo dõi `drizzle.__drizzle_migrations_packs`) + mỗi gói `packages/db/migrations-pack-<k>/` (bảng `__drizzle_migrations_pack_<k>`), đánh số `0001`. Gói kiểm thử `pkdemo` (D-08) chỉ chạy khi `appEnv !== "production"`.

**`migrations-packs/0001_kit.sql`** (idempotent, chạy bằng role chủ migration = `DATABASE_URL`):
- `CREATE SCHEMA IF NOT EXISTS packs; REVOKE ALL ON SCHEMA packs FROM PUBLIC;` bảng `packs.registry (key text PK, installed_at timestamptz DEFAULT now())`.
- `packs.install(p_key text)` (plpgsql, `SECURITY INVOKER`, `REVOKE EXECUTE … FROM PUBLIC`), mọi tên qua `format('%I')`:
  1. kiểm `p_key ~ '^[a-z][a-z0-9_]{1,20}$'`, không thuộc danh sách cấm/`pg_` ⇒ `RAISE`.
  2. Role `<k>_rw`: `CREATE ROLE … NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION` nếu chưa có; luôn `ALTER ROLE` lại các cờ (mẫu 0000_hub_core).
  3. `CREATE SCHEMA IF NOT EXISTS <k>; REVOKE ALL ON SCHEMA <k> FROM PUBLIC; GRANT USAGE ON SCHEMA <k> TO <k>_rw;` — **không** GRANT gì trên `hub`/`admin` ⇒ `SELECT hub.process_runs` = 42501 (PK-AC03).
  4. `GRANT <k>_rw TO hub_api WITH INHERIT FALSE, SET TRUE` (PG16) — chỉ thấy bảng gói trong tx đã `SET ROLE` (D-06).
  5. Bảng khung `<k>.files`, `<k>.index_outbox` (dưới) + `packs.secure_table` cho từng bảng.
  6. `INSERT INTO admin.features (key, name, status) VALUES (<k'>-read|write|admin, {"vi":…,"en":…}, 'on') ON CONFLICT (key) DO NOTHING`; `INSERT INTO packs.registry … ON CONFLICT DO NOTHING`.
- `packs.secure_table(p_key, p_table)`: `RAISE` nếu thiếu cột `tenant_id uuid NOT NULL`; `ENABLE` + `FORCE ROW LEVEL SECURITY`; policy `<t>_tenant` (nếu chưa có trong `pg_policies`) `FOR ALL TO <k>_rw USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (cùng biểu thức)`; `GRANT SELECT, INSERT, UPDATE, DELETE` cho `<k>_rw` (gói tự `REVOKE` bớt). Khác Hub: **FORCE**, không nhánh `app.scope='system'` (spec PK-FR-02).

**Bảng khung (mỗi gói):**
```sql
CREATE TABLE IF NOT EXISTS <k>.files (
  id uuid NOT NULL DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  org text NOT NULL, file_id text NOT NULL, version_id text,
  name text NOT NULL, mime text NOT NULL, size_bytes bigint NOT NULL,
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  CONSTRAINT files_pkey PRIMARY KEY (id), CONSTRAINT files_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT files_org_ck CHECK (org = 't_' || tenant_id::text),         
  CONSTRAINT files_ck CHECK (char_length(name) BETWEEN 1 AND 255 AND char_length(mime) <= 128
    AND size_bytes BETWEEN 0 AND 20971520 AND char_length(file_id) <= 128));
CREATE TABLE IF NOT EXISTS <k>.index_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id uuid NOT NULL,
  entity text NOT NULL CHECK (entity ~ '^[a-z][a-z0-9_]{1,40}$'), entity_id uuid NOT NULL,
  op text NOT NULL CHECK (op IN ('upsert','delete')),
  created_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz);
CREATE INDEX IF NOT EXISTS index_outbox_pending_idx ON <k>.index_outbox (id) WHERE processed_at IS NULL; -- cho worker N4
```
Quyền: `files` SELECT/INSERT/UPDATE (xoá = `deleted_at`); `index_outbox` chỉ INSERT (worker N4 có role riêng).
**Bảng nghiệp vụ gói (khuôn HD1 bắt chước):** `tenant_id uuid NOT NULL`, bảng cha `UNIQUE (id, tenant_id)`, FK giữa bảng gói **luôn** `(x_id, tenant_id) REFERENCES cha (id, tenant_id)` (0036:113-116), FK tới `files` cũng kép; xong `SELECT packs.secure_table('<k>','<bảng>')`. Không FK sang `admin.*`/`hub.*` (mẫu P3).
**Gói `pkdemo`** (`migrations-pack-pkdemo/0001_init.sql`): `packs.install('pkdemo')`; `pkdemo.items (id, tenant_id, title text ≤ 200, UNIQUE(id,tenant_id))`, `pkdemo.item_lines (id, tenant_id, item_id, text ≤ 200, FK kép ON DELETE CASCADE)`, index `item_lines (item_id)`; `secure_table` cả hai (PK-AC01/02).

**Runner** `packages/db/src/migrate-packs.ts`: `runPackMigrations({url, appEnv}) → {kit, packs: Record<k, n>}`; trong `withMigrateLock` (khoá cụm vì có `CREATE ROLE`); thứ tự kit → từng gói theo `PACK_DIRS` (mảng hằng `{key, dir, devOnly}`). Gọi **sau** `runHubMigrations` (cần `hub_api`, `admin.features`) ở `migrate.ts` CLI (log `packs +n`) và `test-db-template.ts` (DB mẫu có schema gói). Không đổi `runMigrations`/`runHubMigrations` (test khoá `{main:13,dev:3}` giữ). Lần 2 ⇒ 0 migration mới (PK-AC04).

**Guard (PK-NFR-04, int test của qc):** mọi schema trong `packs.registry`: bảng ENABLE+FORCE RLS, ≥ 1 policy, `tenant_id NOT NULL`; FK nội schema kép; `<k>_rw` `rolbypassrls=false`, `rolinherit=false`, không USAGE `hub`/`admin`.

## §4 Truy cập DB từ hub-api (PK-FR-03, 09) — D-06
`packages/db/src/pack-scope.ts` (`@ai/db/pack-scope`): `withPackScope(db, {packKey, tenantId, userId|null}, fn)` = transaction trên **pool `hub_api` sẵn có** (không pool mới), câu đầu **một** lệnh:
`select set_config('role', $1, true), set_config('app.tenant_id', $2, true), set_config('app.user_id', $3, true)` ($1 = `<k>_rw`, hằng). Hết tx ⇒ role trở lại. Thử lại 40P01/40001 như `withHubScope`. Tenant không phải UUID ⇒ `DomainError("TENANT_INVALID")` trước khi mở tx.
Port (kit `application/ports.ts`): `PackUow.tenant(who, fn)`; `PackSystemUow.system(tenantId, fn)` (vòng nền đặt `app.tenant_id` từng tenant — PK-FR-03). Quét chéo tenant (HD4) **không** ở N1 ⇒ D-12.

## §5 Quyền gói (PK-FR-05, Q5/Q6/Q8) — D-05
- **Catalog:** 3 hàng `admin.features` mỗi gói (`<k'>-read|write|admin`, do `packs.install`); gán qua `feature_grants` cho Group — màn Group/Grants Admin sẵn có hiện chúng (không màn mới).
- **Bật gói** (`PUT …/packs/:k`, admin-api, một tx `withScope` platform, số câu cố định 8): khoá 3 feature `= any($keys)` `FOR KEY SHARE` (theo thứ tự khoá L3 `lib/lock-order`) · upsert 3 entitlement (`ON CONFLICT … DO UPDATE SET revoked_at = NULL`) · `INSERT` 3 Group `ON CONFLICT (tenant_id,key) DO NOTHING` · `INSERT … SELECT` 6 grant theo `PACK_ROLE_ACTIONS` (join groups theo key) `ON CONFLICT DO NOTHING` · đọc lại group id · audit 1 hàng · tăng `config_version` + `pg_notify('config_changed', …)`. Tên Group: `{"vi": "<k> · Chủ sở hữu|Biên tập|Xem"}`.
- **Kiểm ở hub-api** (`kit/domain/pack-access.rules.ts`, thuần):
```ts
export type PackAccessInput = { entitled: boolean; featureOff: boolean; userGroupIds: ReadonlySet<string>; grantedGroupIds: readonly string[] };
export function checkPackAccess(i: PackAccessInput): "ok" | "PACK_DISABLED" | "PACK_FORBIDDEN";
// !entitled(read) || featureOff ⇒ PACK_DISABLED; grantedGroupIds(action) ∩ userGroupIds = ∅ ⇒ PACK_FORBIDDEN; còn lại ok
export function packActionsFor(i: { entitled: boolean; featureOff: boolean; userGroupIds: ReadonlySet<string>;
  grantedByAction: Readonly<Record<PackAction, readonly string[]>> }): PackAction[]; // /me: !entitled||featureOff ⇒ []; còn lại: action có giao Group ≠ ∅
```
  Adapter `pack-guard.middleware.ts` lấy đầu vào từ `ConfigCache.catalog()` (`entitled`, `grantGroups`, `features`) + `user(sub).groupIds`; chỉ mục `featureKey → id` dựng **một lần mỗi snapshot** (`WeakMap<CatalogSnapshot, …>`). Grant user lẻ (`grantUsers`) **bỏ qua** với mã gói (Q9). Hiệu lực ≤ 5 s qua NOTIFY `config_changed` ⇒ `reloadAdmin` (đã có). T5b thêm `ConfigCache.reloaded(minAdminVersion?: number): Promise<number>` (resolve khi `#loadAdmin` xong với version ≥ tham số; không đổi hành vi nạp lại) để test `await` thay vì chờ gián tiếp. Tenant đã tự tạo Group trùng key `<k'>-owner…` ⇒ `ON CONFLICT DO NOTHING` dùng lại và cấp mã gói (chấp nhận: tenant_admin vốn quản thành viên Group).

## §6 FileBox `org` theo tenant (PK-FR-06, Q4) — D-07
Kit adapter `pack-files.filebox.ts` cài port `PackFiles { put, link, remove }`: mỗi lời gọi dựng `FileboxClient({...cfg, org: orgForTenant(tid)})` (`orgForTenant = "t_" + tid`, thuần). `link(rowId)`: đọc hàng `<k>.files` trong `PackUow.tenant` (RLS) ⇒ không có ⇒ `NOT_FOUND`; `row.org !== orgForTenant(tid)` ⇒ `NOT_FOUND` + log `pack-file-org-mismatch` (không URL); gọi `/files/{file_id}/link` ⇒ route trả **302** (như attachments), TTL 10'. Log chỉ `{pack, row_id}` — không `file_id`, không URL `/d/`. API gói chỉ trả `id` hàng.

## §7 DOCX → Markdown (PK-FR-07, Q3, Q7) — ADR-0024
Port `DocxConverter.toMarkdown(bytes): Promise<{ok:true, markdown, warnings} | {ok:false, code:"DOCX_UNREADABLE"|"DOCX_BUSY"}>` (không ném). Luật thuần `kit/domain/docx.rules.ts`: `checkZipEntries(entries: {name, originalSize}[]): "ok" | "TOO_MANY_PARTS" | "TOO_LARGE" | "MACRO"`, hằng `DOCX_MAX_PARTS=2000`, `DOCX_MAX_UNZIP=100 MiB`, `DOCX_MAX_MD=5 MB`. Adapter `adapters/docx/` (worker Bun, `fflate`+`saxes`) xuất ở `index.ts`: `createDocxConverter(opts?: { maxPending?: number /*2*/; timeoutMs?: number /*10_000*/ }): DocxConverter & { close(): Promise<void> }`; `packs.mount.ts` gọi `close()` khi `signal` abort. Không chạm attachments/library Hub (D-08).

## §8 Outbox chỉ mục (PK-FR-08) — ADR-0016 §2
Port `IndexOutbox.enqueue(rows: readonly IndexOutboxRow[])` có trong `TxRepos` của `PackUow` (cùng tx). Rỗng ⇒ 0 câu. Một câu cố định mỗi gói:
`insert into <k>.index_outbox (tenant_id, entity, entity_id, op) select $1::uuid, x.entity, x.entity_id, x.op from jsonb_to_recordset($2::jsonb) as x(entity text, entity_id uuid, op text)`. Tx rollback ⇒ không còn hàng (PK-AC09). Không NOTIFY/Redis ở N1.

## §9 Khuôn module gói trong hub-api (PK-FR-09) — D-09
```
apps/hub-api/src/modules/packs/
  packs.mount.ts            # lớp 4: dựng PackUow/PackFiles/DocxConverter, guard, mount /pack/<k>
  kit/   domain/ (pack-access.rules.ts, docx.rules.ts, errors.ts) · application/ports.ts
         adapters/ (pack-uow.ts, index-outbox.repo.ts, pack-files.filebox.ts, pack-guard.middleware.ts, packs.mapper.ts, docx/)
  pkdemo/ domain/ · application/ (create-item.usecase.ts, get-item.usecase.ts) · adapters/ (pkdemo.routes.ts, items.repo.ts, pkdemo.mapper.ts) · pkdemo.mount.ts
```
`createApp(cfg, deps)`: `AppDeps.packs?: { pkdemo?: boolean; filebox?: { url: string; token: string } }`; vắng ⇒ `pkdemo = APP_ENV !== "production"`, filebox từ env FB1; `packs.mount.ts` đọc `deps.packs`. `packs.mount.ts` là chỗ duy nhất import `modules/config` và `modules/attachments/filebox.client` (lớp 4).
**depcruise thêm** (`.dependency-cruiser.cjs`, PK-AC11 dùng luật `ca-*` sẵn có + 3 luật):
| Luật | from | to (cấm) |
|---|---|---|
| `pack-no-cross-pack` | `modules/packs/([^/]+)/` | `modules/packs/[^/]+/`, `pathNot: modules/packs/($1|kit)/` |
| `pack-no-hub-modules` | `modules/packs/[^/]+/(domain|application|adapters)/` | `apps/hub-api/src/modules/`, `pathNot: modules/packs/` |
| `pack-no-hub-schema` | `modules/packs/` | `@ai/db/schema/hub*`, `packages/db/src/schema/hub` |

## §10 Thiết kế hiệu năng (Luật 4c) — bước nhảy mỗi request (PK-BR-01, PK-NFR-05)
Đếm: câu SQL qua hook `options.debug` của pool (khuôn PD2-P03, không tính BEGIN/COMMIT), lệnh Redis qua bộ đếm client, HTTP qua `fetch` giả: tới app nội bộ phải = 0.
| Route (pkdemo, khuôn cho HD1) | SQL nóng / nguội | Redis | HTTP nội bộ | HTTP ngoài |
|---|---|---|---|---|
| `GET /pack/pkdemo/me` | 0 / 1 (`loadUsers`) | 0 | 0 | 0 |
| `GET /pack/pkdemo/items/:id` (cha + con) | 2 (`set_config`; 1 SELECT cha + `json_agg` con) / +1 | 0 | 0 | 0 |
| `POST /pack/pkdemo/items` (cha + n ≤ 100 con) | 3 (`set_config`; 1 CTE INSERT cha + con từ một tham số JSON; outbox) / +1 | 0 | 0 | 0 |
| `GET /pack/pkdemo/files/:id/content` | 2 / +1 | 0 | 0 | 1 (FileBox `/link`) |

| Mã | Chốt | Căn cứ |
|---|---|---|
| PK-NFR-01 | 0 câu nóng, ≤ 1 nguội; guard thêm p95 ≤ 2 ms (10.000 lượt, cache nóng) | Guard tra `Map`/`Set` trong RAM; SQL theo `ConfigCache.user()`. 2 ms là **trần**; T5d ghi số thật |
| PK-NFR-02 | mẫu 38,5 KB p95 ≤ 300 ms; 20 MB ≤ 5 s, RSS tăng ≤ 256 MB; zip bomb (42.zip/ khai báo > 100 MB / > 2.000 phần) bị chặn ≤ 1 s | Chặn bom theo central directory **trước** giải nén (O(số phần)); chỉ giải nén 3 phần XML; T5g đo số thật |
| PK-NFR-03 | +1 câu outbox mỗi lệnh ghi (lô 100 vẫn 1), 0 khi lô rỗng | §8 |
| PK-NFR-04 | 0 hàng chéo; FK kép 23503; 42501 trên `hub.*`/`admin.*` | §3 guard |
| PK-NFR-05 | đúng bảng trên; perf `pkdemo.perf.int.test.ts`: `POST` lô 100 con p95 ≤ 30 ms, `GET` p95 ≤ 10 ms (1.000 lượt, 10.000 hàng nền) | 2–3 câu qua PK/`item_lines(item_id)`; T5d đo, vượt ⇒ báo, không nới |

Body `pkdemo` (schema ở `pkdemo/adapters/pkdemo.routes.ts`, không vào `@ai/contracts`): `POST /pack/pkdemo/items` `{title: string 1–200, lines: {text: string 1–200}[] ≤ 100}` ⇒ 201 `{id, title, lines:[{id,text}]}`; `GET …/items/:id` ⇒ 200 cùng hình / 404 `NOT_FOUND`; sai ⇒ 400 `VALIDATION_ERROR`. Quyền: GET `read`, POST `write`.

Lọc PK/`= any($arr)`; lô qua **một** tham số `jsonb`, không join `unnest`; SQL văn bản hằng. Không khoá hàng; không sleep/poll.
