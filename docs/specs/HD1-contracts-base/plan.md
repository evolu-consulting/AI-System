# Plan backend · HD1-contracts-base

Dựng trên [N1 plan](../N1-pack-frame/plan.md) (D-04…D-10). Khoá gói **`contracts`** (khớp `PACK_KEY_RE`, không bị cấm) ⇒ schema `contracts`, role `contracts_rw`, feature `contracts-read|write|admin`, route `/pack/contracts`, module `apps/hub-api/src/modules/packs/contracts/`, migration `packages/db/migrations-pack-contracts/` (thêm `PACK_DIRS {key:"contracts", devOnly:false}`). Quyết định: [`spec-decisions.md`](spec-decisions.md) D-03…D-18. Không ADR mới.

## §1 Contract — `packages/contracts/src/pack-contracts/` (export qua index)
`fields.ts`: `CONTRACT_FIELD_KINDS` (23 khoá = `models.py`), `ContractFieldKey`, `CONTRACT_TYPES`, `CONTRACT_STATUSES` (8 + `rejected`, D-04), `HANDLED_OUTCOMES`, `ITEM_KINDS`; `fieldValueSchema(key)`: text `trim().max(2000)`, enum `type`, date `z.iso.date()`, bool, int (`total_value` 0…9e15, `notice_days` 0…3650), float (`vat_rate` 0…100), đều `.nullable()`; `ContractFieldSchema = strictObject({value, quote ≤ 2000, verified, edited})`. `list.ts`, `detail.ts`: DTO dưới. `errors.ts`: `ContractErrorCode` = `PackErrorCode` + mã ở bảng lỗi.

**ListQuery** (mảng = lặp tham số): `q` 2…100 · `status[]` ≤ 9 · `owner[]` uuid ≤ 50 · `category[]` uuid ≤ 50 · `seller[]`, `buyer[]` mỗi giá trị ≤ 300, ≤ 50 · `signer[]` ≤ 300, ≤ 20 · `direction[]` ∈ `sale purchase unknown` · `kind[]` ∈ `contract appendix` · `value_min`, `value_max` int ≥ 0 · `sort` ∈ `updated_at value end_date title` (mặc định `updated_at`) · `dir` ∈ `asc desc` (mặc định `desc`) · `page` 1…1000 (mặc định 1) · `page_size` 1…100 (mặc định 20 = mgmt `table.tsx` SIZES 10/20/50/100). Sai ⇒ 400 `VALIDATION` có sẵn.
**ListRow** (đủ cột S03, D-02): `id, kind, parent_id, title, number, type, direction, status, seller, buyer, seller_signer, buyer_signer, value, end_date, action_deadline, owner_user_id, category_ids (uuid[] ≤ 50), updated_at, version` (null khi trống). **ListResponse** `{items ≤ 100, total, page, page_size}` (D-03).
**Facets** (D-10): `{status, direction, kind: [{v, n}], owner: [{v: uuid, n}], seller, buyer: [{v, n}] ≤ 500, signer: [{v: key, label, n}] ≤ 500, category: [{v: uuid, label, n}] ≤ 200, value: {min, max} | null, truncated: string[]}` — trên **cả tenant** (như `optionsOf(rows)` mgmt, không theo bộ lọc). `category.n` = số HĐ có ≥ 1 item loại đó; `direction` có `unknown` (= null); `signer.label` = `min(raw)` theo khoá.
**Detail**: hàng `contracts` (trừ `source_text`, `search_key`, `signer_keys`) + `fields` đủ 23 khoá + `items[]` ≤ 500 + 50 `events` mới nhất + `file {id, name, mime, size_bytes} | null` + `has_source`.
**PatchFieldsRequest** `strictObject({version: int ≥ 1, fields: strictObject(partial 23 khoá).refine(≥ 1 khoá)})` ⇒ khoá lạ = 422 `FIELD_UNKNOWN` `details:{keys}`, sai kiểu = 422 `FIELD_INVALID` `details:{key}`. **Response** `{id, version, updated_at, fields}`.
**/me (khớp N1):** dùng nguyên `PackMeResponse {pack, enabled, actions}` (N1 §2): `packEnabled = enabled`, `write = actions ∋ "write"`, `owner = actions ∋ "admin"`; frontend-lead sửa chữ plan-frontend N1 §9.

| Mã | HTTP | Khi |
|---|---|---|
| `NOT_FOUND` (sẵn) | 404 | id không có **hoặc** của tenant khác (RLS ⇒ 0 hàng) |
| `CONTRACT_STALE` | 409 | `version` lệch; `details = versionConflictDetailsSchema(z.object({version}))` |
| `FILE_TOO_LARGE` / `FILE_TYPE` | 413 / 415 | > 20 MiB (`bodyLimit` cắt sớm) / magic bytes ∉ PDF, DOCX, JPEG, PNG (D-09) |
| `UPLOAD_QUOTA` | 429 | `details {scope:"tenant"|"global", limit, resets_at}` |
| `UPLOAD_QUOTA_UNAVAILABLE` / `DOCX_BUSY` (N1) | 503 | Redis lỗi (đóng an toàn: trần chi phí) / hàng đợi DOCX đầy; không lưu gì, hoàn quota |
| `PARENT_INVALID` | 422 | `appendix` thiếu/sai `parent_id` (23503 ⇒ map) |

## §2 Route (hub-api, guard N1 `pack-guard`)
| Route | Quyền | Vào → Ra |
|---|---|---|
| `GET /pack/contracts/me` | — (N1) | `PackMeResponse` |
| `GET /pack/contracts/contracts` | read | ListQuery → 200 ListResponse |
| `GET /pack/contracts/contracts/facets` | read | → 200 Facets (client giữ 60 s, làm mới sau tải lên/PATCH) |
| `GET /pack/contracts/contracts/:id` | read | → 200 Detail / 404 |
| `GET /pack/contracts/contracts/:id/source` | read | → 200 `text/markdown` (≤ 5 MB) / 404 (D-13) |
| `GET /pack/contracts/contracts/:id/file` | read | → 302 link FileBox 10' (kit `PackFiles.link`) / 404 |
| `PATCH /pack/contracts/contracts/:id/fields` | write | PatchFieldsRequest → 200 / 404 / 409 / 422 |
| `POST /pack/contracts/contracts` | write | multipart `file` (bắt buộc), `kind` (mặc định `contract`), `parent_id`, `title` ≤ 200 (mặc định tên tệp bỏ đuôi) → 201 `{id, status, version}` |
`/facets` khai trước `/:id` (`z.uuid()`). `owner_user_id` = người tải (đổi = HD5).

## §3 DDL — `migrations-pack-contracts/0001_init.sql`
Đầu file `SELECT packs.install('contracts');`, cuối file `SELECT packs.secure_table('contracts', t)` cho 5 bảng. Mọi FK kép `(x_id, tenant_id)`; không FK sang `admin.*`/`hub.*` (`owner_user_id`, `created_by`, `run_id` là uuid trần).
**Hàm IMMUTABLE** (`sql`, `search_path = pg_catalog`, EXECUTE chỉ `contracts_rw`): `fold(text)` = `lower(translate(x, <chữ có dấu VI hoa+thường, đ/Đ>, <ASCII>))` + gộp khoảng trắng — không dựa `lower()` ngoài ASCII (`postgres:16-alpine`, locale C); `person_key(text)` = `fold` phần trước ` – `/` - `/`,`, rỗng ⇒ null (= `personOf`+`normalize` mgmt); `as_bigint(text)` (regex ⇒ cast, khác ⇒ null); `as_date(text)` (regex ISO và ngày ≤ số ngày của tháng ⇒ `make_date`, ngoài ra `null`, không ném 22008; D-15). Bản TS cùng tên ở domain, test so khớp từng ký tự.

**`contracts.contracts`**: `id uuid PK DEFAULT gen_random_uuid()`, `tenant_id uuid NOT NULL`, `kind text NOT NULL DEFAULT 'contract' CHECK (kind IN ('contract','appendix'))`, `parent_id uuid`, `CHECK ((kind='appendix') = (parent_id IS NOT NULL))`, `title text NOT NULL CHECK (char_length BETWEEN 1 AND 200)`, `direction text CHECK (IN ('sale','purchase'))`, `status text NOT NULL DEFAULT 'extracting' CHECK (IN 9 giá trị)`, `error text CHECK (≤ 2000)`, `owner_user_id uuid`, `created_by uuid NOT NULL`, `created_at/updated_at timestamptz NOT NULL DEFAULT now()`, `version int NOT NULL DEFAULT 1`, `confirmed_at timestamptz`, `confirmed_by uuid`, `fields jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof='object')`, `file_id uuid`, `source_text text CHECK (≤ 5000000)`, `clauses/warnings jsonb NOT NULL DEFAULT '[]'`, `action_deadline date`, `handled jsonb CHECK (handled IS NULL OR handled->>'outcome' IN (4 giá trị))`, `run_id uuid`. UNIQUE `(id, tenant_id)`; FK `(parent_id, tenant_id)` → contracts RESTRICT; FK `(file_id, tenant_id)` → `contracts.files` RESTRICT.
**Cột sinh `STORED`** (Q4 ⇒ D-07; nguồn duy nhất vẫn là `fields`): `number`, `seller` (`supplier_name`), `buyer` (`buyer_name`), `seller_signer`, `buyer_signer` (= `nullif(btrim(fields->k->>'value'),'')`), `type` (`CASE … IN CONTRACT_TYPES`), `value bigint` (`as_bigint(total_value)`), `end_date date` (`as_date(end_date)`), `signer_keys text[]` (`array_remove(ARRAY[person_key(sup_rep), person_key(buy_rep)], NULL)`), `search_key text` = `fold(coalesce(title,'') || ' ' || coalesce(fields->'number'->>'value','') || ' ' || …)` cho title, number, supplier_name, buyer_name, supplier_representative, buyer_representative; chỉ toán tử IMMUTABLE, **không `concat_ws`** (STABLE ⇒ lỗi tạo bảng); viết lại biểu thức gốc vì cột sinh không trỏ cột sinh (D-14).
**Index:** `contracts_list_idx (tenant_id, updated_at DESC, id DESC)` · `(tenant_id, owner_user_id)` · `(tenant_id, status)` (HD4 dùng lại) · `(parent_id) WHERE parent_id IS NOT NULL` (FK).

**`contract_items`**: `id uuid PK`, `tenant_id`, `contract_id uuid NOT NULL`, `ord smallint NOT NULL CHECK (0…9999)`, `code ≤ 100`, `name text NOT NULL 1…500`, `spec ≤ 2000`, `unit ≤ 50`, `qty numeric(18,4)`, `unit_price bigint`, `vat_rate numeric(5,2) CHECK (0…100)`, `moq numeric(18,4)`, `lead_time_days int CHECK (0…3650)`, `valid_from/valid_to date`, `category_id uuid`, `quote ≤ 2000`, `verified/edited bool` (ingest.py:67). UNIQUE `(contract_id, ord)`; FK kép contracts CASCADE; FK kép categories `ON DELETE SET NULL (category_id)` (PG16, giữ `tenant_id`). Index `items_category_idx (tenant_id, category_id, contract_id) WHERE category_id IS NOT NULL`.
**`contract_categories`**: `id uuid PK`, `tenant_id`, `name text NOT NULL CHECK (1…40)`, `created_at`; UNIQUE `(id, tenant_id)`; `UNIQUE INDEX (tenant_id, lower(name))`.
**`contract_reminders`**: `id bigint IDENTITY PK`, `tenant_id`, `contract_id`, `deadline date`, `milestone smallint CHECK (-3650…3650)`, `user_id uuid`, `channel text CHECK (~ '^[a-z_]{2,20}$')`, `sent_at timestamptz DEFAULT now()` (đều NOT NULL); **`UNIQUE (contract_id, deadline, milestone, user_id)`** = khoá idempotency + index FK; FK kép CASCADE. HD4 ghi `ON CONFLICT DO NOTHING`.
**`contract_events`**: `id bigint IDENTITY PK`, `tenant_id`, `contract_id`, `type text NOT NULL CHECK (~ '^[a-z_]{2,40}$')` (giá trị ở zod `ContractEventType`, thêm cuối), `actor_user_id uuid` (null = hệ thống), `at timestamptz NOT NULL DEFAULT now()`, `data jsonb NOT NULL DEFAULT '{}'` (≤ 64 KiB); FK kép CASCADE; index `(contract_id, id DESC)`.
**Quyền bớt:** `REVOKE DELETE` trên contracts/items/categories (D-08, HD5 cấp lại); `REVOKE UPDATE, DELETE` trên events/reminders (chỉ thêm).

## §4 Domain — `modules/packs/contracts/domain/*.rules.ts` (thuần, QC test trước)
```ts
fillFields(raw: unknown): ContractFields                        // thiếu khoá ⇒ {value:null,quote:"",verified:false,edited:false}; bỏ khoá lạ khi ĐỌC
mergeFields(old: ContractFields, next: ContractFields): ContractFields  // old[k].edited ? old[k] : next[k] (ingest.py:63-65)
applyEdits(old: ContractFields, edits: Partial<Record<ContractFieldKey, FieldValue>>):
  { fields: ContractFields; changes: { key; old: FieldValue; new: FieldValue }[] } // {value, quote giữ, verified:true, edited:true} (manual.py:16); giá trị y cũ ⇒ không vào changes
foldVi(s: string): string /* NFC trước */; personKey(s: string | null): string | null; likePattern(q: string): string // fold + thoát % _ \
sniffFileType(head: Uint8Array, zipNames?: readonly string[]): "pdf" | "docx" | "jpeg" | "png" | null
  // %PDF- · PK\x03\x04 + `zipNames` có word/document.xml (thiếu ⇒ null, không đoán từ PK) · FF D8 FF · 89 50 4E 47 0D 0A 1A 0A
asDate(s: string | null): string | null                          // ISO hợp lệ ⇒ s, ngoài ra null (D-15)
uploadDay(now: Date, timeZone: string): string                  // YYYY-MM-DD theo múi tenant (Intl)
quotaVerdict(c, l: { tenant: number; global: number }): "ok" | "tenant" | "global" // c = đếm SAU INCR; > l mới vượt; cả hai ⇒ "tenant"
```
`adapters/zip-names.ts`: `zipNames(bytes): string[]` = `fflate` (ADR-0024) `unzipSync(bytes, {filter: f => (names.push(f.name), false)})`, chỉ đọc central directory; zip hỏng ⇒ `[]` ⇒ 415; chỉ gọi khi 4 byte đầu `PK\x03\x04`; bom zip do `DocxConverter` chặn (D-17). **NFC ở biên** (D-18): zod text và chuỗi ListQuery (`q`, `seller/buyer/signer[]`) `.transform(s => s.normalize("NFC"))`; SQL `fold` giữ nguyên.
`application/`: 7 usecase theo route; ports `ContractsRepo`, `UploadCounter`, `ExtractionStarter` (HD1 no-op). `adapters/`: `contracts.routes.ts`, `contracts.repo.ts` (SQL văn bản hằng), `upload-counter.redis.ts`, `contracts.mapper.ts`; `contracts.mount.ts`. `AppDeps.packs?.contracts?: boolean` (vắng ⇒ `true`; `false` ⇒ không mount, 404); Redis = `deps.redis` qua `packs.mount.ts`; vắng Redis: D-17.

## §5 Luồng ghi
**PATCH** (1 tx `PackUow.tenant`): ① `set_config` ② `SELECT version, fields … FOR UPDATE` (0 hàng ⇒ 404; lệch ⇒ 409) ③ `applyEdits` trong RAM; `changes` rỗng ⇒ trả bản hiện tại, không tăng version ④ một CTE: `UPDATE … SET fields=$2::jsonb (sql.json), version=version+1, updated_at=now() WHERE id=$1 AND version=$3 RETURNING …` + `INSERT INTO contract_events (…,'field_edited', data={changes})` ⑤ outbox `{entity:"contract", op:"upsert"}`. = **4 câu** cố định.
**Upload**: kiểm `Content-Length`/`bodyLimit` (413) → đọc ≤ 20 MiB → `sniffFileType` (415) → **1 pipeline Redis** `INCR q:contracts:t:<tid>:<uploadDay(tz)>`, `INCR q:contracts:g:<UTC day>`, `EXPIRE` ×2 (172800) → vượt ⇒ pipeline `DECR` ×2 + 429 (D-06) → DOCX: `DocxConverter` (N1 §7; `DOCX_BUSY` ⇒ hoàn quota + 503; `DOCX_UNREADABLE` ⇒ tiếp, `status=extract_failed`, `error="DOCX_UNREADABLE"`) → `PackFiles.put` (org `t_<tid>`) → tx: ① `set_config` ② một CTE `INSERT files … RETURNING id` → `INSERT contracts (…, fields = 23 khoá rỗng, source_text)` → `INSERT contract_events ('uploaded', data {name, mime, size})` ③ outbox = **3 câu** → sau commit `ExtractionStarter.start(id)`. Lỗi sau INCR ⇒ `DECR` + `PackFiles.remove` nếu đã put. Env: `CONTRACTS_MAX_MB=20`, `CONTRACTS_UPLOADS_TENANT_DAY=30`, `CONTRACTS_UPLOADS_GLOBAL_DAY=300`.

## §6 Thiết kế hiệu năng (Luật 4c, HD-NFR-01…04)
**Câu danh sách** (một văn bản cố định, mọi tham số luôn gửi, `NULL` = không lọc):
```sql
with f as materialized (
  select c.id, c.updated_at, c.value, c.end_date, c.title from contracts.contracts c
  where c.tenant_id = $1
    and ($2::text[] is null or c.status = any($2))      and ($3::uuid[] is null or c.owner_user_id = any($3))
    and ($4::text[] is null or c.seller = any($4))      and ($5::text[] is null or c.buyer = any($5))
    and ($6::text[] is null or c.signer_keys && $6)     and ($7::text[] is null or coalesce(c.direction,'unknown') = any($7))
    and ($8::text[] is null or c.kind = any($8))        and ($9::bigint is null or c.value >= $9) and ($10::bigint is null or c.value <= $10)
    and ($11::text is null or c.search_key like $11)
    and ($12::uuid[] is null or exists (select 1 from contracts.contract_items i
         where i.tenant_id = $1 and i.category_id = any($12) and i.contract_id = c.id))),
p as (select id from f order by <8 nhánh CASE theo $13 sort/$14 dir, mỗi nhánh 1 kiểu>, id desc limit $15 offset $16)
select (select count(*) from f) as total,
       coalesce((select json_agg(r order by r.ord) from (select <cột ListRow>, p.ord,
         array(select distinct i.category_id from contracts.contract_items i
               where i.contract_id = c.id and i.category_id is not null limit 50) as category_ids
         from (select id, row_number() over () as ord from p) p join contracts.contracts c on c.id = p.id) r), '[]') as items
```
| Route | SQL (gồm `set_config`) | Redis | HTTP nội bộ | Ngưỡng p95 (10.000 HĐ/tenant) |
|---|---|---|---|---|
| Danh sách | **2** (`set_config` + câu trên; `total` + trang cùng câu) | 0 | 0 | ≤ 50 ms mọi tổ hợp, gồm trang cuối `page=500, page_size=20` |
| Facets | **2** (1 câu: `GROUPING SETS` 6 cột một lượt quét + `LATERAL (VALUES …)` người ký + items⋈categories + min/max) | 0 | 0 | ≤ 50 ms |
| Chi tiết | **2** (1 câu: hàng + `jsonb_agg` items + events `ORDER BY id DESC LIMIT 50` + file) | 0 | 0 | ≤ 30 ms |
| Source / File | 2 | 0 | 0 (+1 FileBox ngoài ở File) | ≤ 30 ms (source 40 KB) |
| PATCH | **4**, 1 tx | 0 | 0 | ≤ 30 ms |
| Upload (trừ FileBox, DOCX) | **3**, 1 tx | 1 pipeline (+1 khi hoàn) | 0 | ≤ 30 ms phần DB |

**Offset + `count` cùng câu:** xem D-03; `f` vật chất hoá một lần (~400 KB), trang sâu ≈ trang đầu.
**Cột sinh, không lọc jsonb (Q4):** `fields` ≈ 3–6 KB/hàng ⇒ TOAST; lọc/sắp trên `fields->…` giải nén cả lát (~40 MB/lượt) ⇒ vượt 50 ms. Cột sinh hẹp nằm trong heap; danh sách không chạm `fields`/`source_text`. Giá: tính lại cột khi ghi `fields`.
**Index ↔ bộ lọc:** truy cập qua `tenant_id` (`contracts_list_idx`); `owner[]`, `status[]` có index riêng; `seller/buyer/signer/direction/kind/value/q` là điều kiện dư trên lát đã chặn (index riêng không đổi bậc vì vẫn đếm hết); `category[]` = semi-join qua `items_category_idx`. Không `pg_trgm`/`unaccent`; vượt ngưỡng ở T7 mới đề xuất ADR trgm.
**Không phụ thuộc thống kê:** một văn bản SQL cho mọi tổ hợp (chuẩn bị một lần/kết nối); `= any($arr)`/`&&`, không join `unnest`. Lựa chọn duy nhất của planner là cách đọc lát `tenant_id` — mọi phương án O(lát). Perf đo trước và sau `ANALYZE`; cả hai đạt.
**Dữ liệu đo** (`generate_series`): 3 tenant × 10.000 HĐ (5 items, 20 events, 50 loại, ~200 bên bán, ~300 người ký) + tenant nền 70.000 HĐ. `EXPLAIN` sau `ANALYZE`: không `Seq Scan` trên `contracts`/`contract_items`. Đếm câu bằng `options.debug` (N1 §10). Test ở `tests/acceptance/HD1/perf/`: 200 lượt/tổ hợp, báo p50/p95 thật.
**Ước lượng** (chưa có số "trước"): danh sách 8–15 ms, facets 15–25 ms, chi tiết/PATCH 2–5 ms. T7 đo; vượt ⇒ báo, không nới. Khoá duy nhất: `FOR UPDATE` một hàng ở PATCH.

## §7 Cần N1 (không tự sửa N1 — đề xuất)
| # | Cần | Lý do | Tạm thời |
|---|---|---|---|
| N1-a | `TenantState.timezone` trong `ConfigCache` | `contracts_rw` không đọc `admin.*`; quota ngày theo múi tenant | HD1 làm thật ở T10 (D-16): `TenantState.timezone?` (`config.rules.ts`), `loadTenants` chọn thêm `tenants.timezone` (`hub_ro`), kiểm một lần khi nạp bằng `Intl.DateTimeFormat`; vắng/sai ⇒ `Asia/Ho_Chi_Minh`; 0 SQL thêm mỗi request |
| N1-b | plan-frontend §9: `/me` = `PackMeResponse` (§1) | lệch chữ BE/FE N1 | suy 3 cờ từ `actions` |
| N1-c | Danh bạ `GET /pack/<k>/members` → `{id, name}` | DTO chỉ có `owner_user_id` | HD5 làm, code ở `packs/kit` (Q8 đóng) |

Q7 đóng (D-03), Q8 đóng (HD5). HD4: cấp EXECUTE 4 hàm §3 cho `contracts_job` khi tạo role.
