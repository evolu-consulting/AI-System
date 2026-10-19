# HD9 — plan (BE + FE + test, một agent)

## 1. Contract (`packages/contracts/src/pack-contracts/cks.ts`, base `/pack/contracts/cks`)
Tiền `Money = int 0…10¹⁰` (đồng); ngày `IsoDate`; chuỗi `nfcText(n)`; thân strict (khoá lạ ⇒ 400 `VALIDATION`).
| Route | Quyền | Vào | Ra (HTTP) |
|---|---|---|---|
| `GET /overview` | read | — | `{certificates, customers, expiring_30, expired, in_stock}` 200 |
| `GET /customers` | read | `filter?∈expiring\|expired\|elsewhere`, `lot?: uuid`, `ca?: ≤60`, `q? ≤200`, `page ≥1`, `page_size 1–100 =50` | `{items: CksCustomerBrief[], total, page, page_size, cas}` 200 (D9-22) |
| `GET /customers/:id` | read | uuid | `CksCustomer` 200 · 404 |
| `GET /lots` | read | — | `CksLot[]` (theo `bought_at`) |
| `POST /lots` | write | `{ca 1–60, supplier_name?, supplier_tax_id?, qty 1–100000, unit_cost Money, years 1–5 =1, bought_at, label? ≤40, device token\|remote}` | `CksLot` 201 |
| `POST /sales` | write | `{company_name 1–200, company_tax_id?, lot_id, price_each Money, signed_at, valid_to, holders 1–200 [{name 1–200, title?, device, serial? ≤100, keeper?}]}` | `{contract_id, number}` 201 · 404 lô · 409 `CKS_STOCK`/`CKS_SERIAL_TAKEN` · 422 `CKS_DATES` |
| `POST /certificates` | write | `{company_name, company_tax_id?, ca, serial?, valid_to, holder_name ="Chữ ký công ty", device}` | `CksCert` 201 · 409 serial |
| `POST /groups/:saleId/renew` | write | `{price_each?, years 1–5 =1, remind_at? (YYYY-MM-DD[THH:mm])}` | `CksRenewal` 201 · 404 · 409 `CKS_RENEWAL_OPEN` |
| `POST /renewals/:id/complete` | write | `{serials: {certId: ≤100}, valid_to: date\|null}` | `CksRenewal` 200 · 404 · 409 `CKS_RENEWAL_CLOSED`/`CKS_SERIAL_TAKEN` |
| `POST /renewals/:id/lost` | write | `{reason 1–500}` | `CksRenewal` 200 · 404 |
| `POST /customers/:id/followups` | write | `{at YYYY-MM-DDTHH:mm, note? ≤200}` | `{id}` 201 · 404 |
| `GET /signed-docs` | read | `customer_id` uuid, `certificate_id?`, `kind?` | `SignedDoc[]` (`signed_at` giảm) |
| `POST /signed-docs/upload` | write | multipart `files` ≤ 50, mỗi tệp ≤ 20 MB, thân ≤ 64 MB | `{added, skipped, unmatched, unreadable}` 200 · 413 |
| `GET /prices` | read | `filter ∈ all\|1y\|multi\|token\|remote` | `CksPrices` |
| `GET /scans` · `POST /scans` | read · write | `{scope package\|market, ca?, years, device}` | `[]` · 503 `AGENT_UNAVAILABLE` (D9-10) |
Kiểu ra khớp nguyên `mgmt-app/web/src/api/{cks,cksPrices}.ts` (`CksCustomer`, `SaleGroup`, `Cert`, `Lot`, `SignedDoc`, `PackageRow`, `CksPrices`), id là uuid. Mã lỗi mới: `CKS_STOCK 409`, `CKS_SERIAL_TAKEN 409`, `CKS_RENEWAL_OPEN 409`, `CKS_RENEWAL_CLOSED 409`, `CKS_DATES 422`.

## 2. DDL (`packages/db/migrations-pack-contracts/<số kế>_cks.sql`, chỉ thêm)
| Bảng | Cột chính | Ràng buộc / index |
|---|---|---|
| `cks_customers` | `name 1–200`, `tax_id ≤20`, `name_key` sinh `contracts.fold(name)` | uq `(tenant_id, tax_id)` khi có MST; uq `(tenant_id, name_key)` khi không MST |
| `cks_lots` | `label`, `ca`, `qty int`, `unit_cost bigint`, `years smallint`, `device`, `bought_at date`, `purchase_contract_id uuid` | ck tiền/qty; idx `(tenant_id, bought_at)` |
| `cks_certificates` | `customer_id`, `serial`, `serial_key`, `ca`, `device`, `holder_*`, `keeper`, `valid_from/to`, `source ours\|elsewhere`, `lot_id`, `sale_contract_id`, `sale_price bigint`, `status`, `replaces`, `replaced_by` | FK kép customer/lot/replaces; uq `(tenant_id, serial_key)`; idx `(tenant_id, customer_id)`, `(tenant_id, lot_id)`, `(tenant_id, sale_contract_id)`, `(replaces)` |
| `cks_renewals` | `sale_contract_id`, `customer_id`, `certificate_ids uuid[]`, `status open\|done\|lost`, `new_contract_id`, `price_each`, `valid_to`, `lost_reason`, `done_at` | uq từng phần `(tenant_id, sale_contract_id) WHERE status='open'` (BR-8) |
| `cks_followups` | `user_id`, `customer_id?`, `renewal_id?`, `due_at timestamptz`, `note`, `done_at` | đúng một trong customer/renewal; idx `(tenant_id, due_at) WHERE done_at IS NULL` (HD4 quét) |
| `cks_signed_docs` | `customer_id?`, `certificate_id?`, `serial_key`, `kind`, `number`, `title`, `signed_at`, `period`, `source`, `filename`, `sha256`, `unsigned` | uq `(tenant_id, sha256, coalesce(serial_key,''))`; idx `(tenant_id, certificate_id)`, `(tenant_id, customer_id)` |
| `cks_market_prices` | `ca_key`, `ca_name`, `years`, `kind`, `device?`, `seller`, `tier`, `price_ex_vat bigint`, `url`, `verified`, `seen date` | idx `(tenant_id, ca_key, years)` |
| `cks_price_audit` | `entity lot\|sale\|renewal\|certificate`, `entity_id`, `field`, `old_value`, `new_value bigint`, `actor_user_id`, `at` | REVOKE UPDATE, DELETE (BR-2) |
Mọi bảng `packs.secure_table('contracts', …)`; REVOKE DELETE trên mọi `cks_*` (app không xoá). Không FK sang `contracts.contracts` (D9-02).

## 3. Tầng code (ADR-0023)
`apps/hub-api/src/modules/packs/contracts/cks/`: `domain/` (luật thuần: `serial.rules` norm/DER, `signed.rules` đọc XML/PDF, `customers.rules` gom khách, `prices.rules` gói + half-even, `sale.rules` số HĐ/hạn/trường HĐ) · `application/` (use case + cổng `CksUow`) · `adapters/` (`cks.repo.ts` SQL, `cks.routes.ts`, `signed.routes.ts`) · `cks.mount.ts`. `packs.mount.ts` thêm 1 dòng gắn. FE: `apps/contracts-web/src/features/cks/**` (S10, S11, hộp thoại), `features/cks-prices/**` (S08), route `/cks/`, `/cks/$id`, `/prices`; chuỗi `packages/i18n/locales/contracts/cks.{vi,en}.json` gộp vào loader.

## 4. Transaction + khoá
Ghi: `PackUow.tenant` ⇒ câu 1 `pg_advisory_xact_lock(hashtextextended('cks:'‖tenant,0))` (D9-06) ⇒ câu 2 đọc kiểm (CTE: lô + số đã xuất + serial trùng + khách + số HĐ lớn nhất) ⇒ câu 3 ghi (CTE: khách upsert, HĐ, dòng hàng, event, chữ ký lô JSON, audit). Lỗi luật ⇒ ném trước câu 3 (tx hoàn tác). Tải văn bản: đọc tệp ngoài tx, tx = khoá + 1 INSERT … ON CONFLICT DO NOTHING (khớp serial bằng join). Không khoá hàng khác ⇒ không có thứ tự khoá thứ hai.

## 5. Thiết kế hiệu năng (K)
| Đường | SQL / request | Index | Ngưỡng (PERF=1, 2.000 chữ ký/400 khách/20 lô/2.000 văn bản) |
|---|---|---|---|
| `customers` (trang) | 2 (chọn id trang: gộp theo khách + lọc/tìm/sắp; chữ ký của đúng các khách đó + đếm văn bản theo chuỗi `replaces`) → gom ở domain | `(tenant_id, customer_id)`, `(certificate_id, tenant_id)` | p95 ≤ 50 ms |
| `customers/:id` | 1 | như trên | p95 ≤ 50 ms |
| `overview`, `lots`, `prices` | 1 mỗi route (tổng hợp `count`/`sum` + lateral theo lô) | `(tenant_id, lot_id)` | p95 ≤ 50 ms |
| `sales` (50 người giữ) | 3 cố định (khoá, kiểm, ghi lô JSON) | serial uq | p95 ≤ 50 ms; đếm câu = 3 với 1 và 50 người giữ |
| `signed-docs/upload` | 2 cố định / lần (khoá, chèn lô JSON) | uq sha256 | đọc DER thuần ≤ 5 ms / tệp 1 MB |
Không truy vấn trong vòng lặp; dữ liệu lô qua một tham số JSON; câu SQL văn bản cố định.

## 6. Test (viết TRƯỚC code cho tiền/quyền/tenant)
| Mã | File | Kỳ vọng |
|---|---|---|
| T1 | `tests/acceptance/HD9/price.int.test.ts` | AC01–AC04, AC06: số tiền, tồn, audit, half-even, gia hạn — đỏ trước khi có route (404) |
| T2 | `tests/acceptance/HD9/access.int.test.ts` | AC07: viewer GET 200/POST 403, không Group 403, beta 404/rỗng, thân `tenant_id` ⇒ 400 |
| T3 | `packages/test-kit/src/rls-packs.int.test.ts` (thêm 8 bảng) | AC08 |
| T4 | `apps/hub-api/.../cks/domain/*.test.ts` | luật thuần: norm serial, DER, XML/PDF, gom khách, gói giá, hạn gia hạn |
| T5 | `tests/acceptance/HD9/signed.int.test.ts` | AC05 |
| T6 | `tests/acceptance/HD9/perf/cks.perf.int.test.ts` | AC09 (đếm câu SQL luôn chạy; p95 dưới `PERF=1`) |
| T7 | `e2e/contracts-web/cks.cw.ts` + `apps/contracts-web/src/features/cks/**/*.test.ts` | AC10 so màn hình 3 lớp + hành vi hộp thoại |
