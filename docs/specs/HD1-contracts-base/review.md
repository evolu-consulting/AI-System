# Review · HD1-contracts-base (T11)

## Kết luận: CHANGES REQUESTED · SAFE · Spec: HD1-contracts-base · Vòng: 1

Reviewer độc lập, 2026-10-19, nhánh `platform/gd0`. Phạm vi: các commit HD1 trong `78bdab1..HEAD` (T4 2439b70f, T5 eb0c6fb9, T6 ab757c19, T7 f31ce281 + 94f63ffe, T8 2d5619ec, T9 3123e30e, T10 019224e8, test 4c5a21ed), gồm `modules/packs/contracts/**`, `migrations-pack-contracts/**`, `contracts/src/pack-contracts/**`, `migrate-packs.ts`, `packs.mount.ts`, `modules/config/**` (múi giờ). Không có Blocker và không thấy lỗi cách ly tenant hay lộ dữ liệu, nên kết luận là **SAFE**. Còn 1 Major, thuộc Luật 4c: thiếu số đo thật của T8 và T10.

## Lệnh đã chạy
- `bun test apps/hub-api/src/modules/packs/contracts packages/contracts/src/pack-contracts apps/hub-api/src/modules/config`: 83 pass / 0 fail (14 file).
- `bun run check:fn`: đỏ ở **một** chỗ, `attachments/filebox.client.ts:118` `#retry` (5 tham số). Lỗi này có từ trước HD1 và đã ghi ở nợ #212. File HD1 không có lỗi.
- `bun run depcruise`: 3 vi phạm, đều ở `kh/` và `processes/` (có từ trước, ngoài HD1). Phần HD1 sạch: `application/` và `domain/` không import adapters/drizzle/hono/ioredis.
- `bun run check:size`: chỉ báo file trong `reference/` (ngoài HD1).
- `bun run test:lock:verify`: OK (938 file).
- `tsc -p apps/hub-api/tsconfig.json --noEmit`: sạch.
- `biome check` trên 55 file HD1: sạch.
- Chưa chạy: int, e2e, perf (theo brief). Các nhận định về RLS, khoá và số câu SQL dưới đây đến từ đọc code và test khoá, chưa chạy lại.

## Lỗi
| # | Mức | Nhóm | file:dòng | Vấn đề | Cách sửa đề xuất | Giao cho |
|---|---|---|---|---|---|---|
| M-01 | Major | 5 Hiệu năng / 9 Truy vết | `spec-decisions.md:35` (T8), `:34` (T10); `tests/acceptance/HD1/perf/rw.perf.int.test.ts:65,114` | HD-AC14 và Luật 4c yêu cầu "báo số thật". T7 có số (D-22: danh sách ≤ 26 ms, facets 42–46 ms) và T9 có số (PATCH p95 3,47/3,60 · 4,02/4,13 ms). T8 (chi tiết, source, file) và T10 (tải lên, phần DB) không ghi p95 ở spec, plan, STATE hay commit. Plan §6 mới chỉ "ước 2–5 ms". | Chạy `bun run test:perf tests/acceptance/HD1/perf/rw.perf.int.test.ts` một lần. Ghi p50/p95 trước và sau ANALYZE của chi tiết, source và tải lên vào `spec-decisions.md` (dòng T8, T10) và plan §6. | backend-lead |
| m-01 | Minor | 9 Truy vết | commit 2d5619ec, 3123e30e | Thông điệp commit còn để mã giữ chỗ `[HD-FR-0x]`, chưa ghi mã FR thật. | Từ nay ghi mã thật (T8: `HD-FR-07`; T9: `HD-FR-02/06/07`). Ghi bù vào TRACE ở T13. | backend-lead |
| m-02 | Minor | 3 Bảo mật | `contracts.routes.ts:94-96` | PATCH không có `bodyLimit`. `readJson` đọc toàn bộ thân, chỉ bị chặn bởi trần 32 MiB của server. Thân hợp lệ tối đa khoảng 23 × 2.000 ký tự (dưới 200 KiB). | Thêm `bodyLimit({maxSize: 256 KiB})` trước `readJson`, vượt thì trả 413. | backend-lead |
| m-03 | Minor | 2 Nghiệp vụ | `application/upload-contract.usecase.ts:143` | `docx.toMarkdown(bytes)` không truyền `{tenantId}`, nên luật "tenant đã có việc chờ ⇒ BUSY" (N1 review m-03) không áp cho gói contracts. Với `maxPending=2` hiện tại thì hậu quả nhỏ. | Truyền `{ tenantId: i.who.tenantId }` vào `toText`. | backend-lead |
| m-04 | Minor | 6 Test | `adapters/category-ids.int.test.ts:151-157` | Ca "hai tx đồng thời" không bảo đảm tx `b` đang chờ khoá khi `a` commit. `b` có thể chạy sau commit, nên ca này có thể xanh mà không đi qua nhánh tranh chấp. | Đợi tín hiệu `b` bị chặn trước khi commit `a` (một lần `pg_blocking_pids` sau tín hiệu `debug` của câu INSERT của `b`, không poll). Hoặc đổi tên ca cho đúng điều nó thực sự kiểm. | qc |
| m-05 | Minor | 4 Dữ liệu | `0002_category_ids.sql:69-73` | Câu backfill ghi "qua RLS". Bảng có FORCE RLS và policy chỉ cho `contracts_rw`, nên nếu role chủ migration không phải superuser và không BYPASSRLS thì backfill âm thầm cập nhật 0 hàng. Hiện vô hại vì chưa có dữ liệu thật. | Sửa chú thích (backfill cần role chủ có BYPASSRLS), hoặc chạy backfill với `SET LOCAL row_security = off` dưới role chủ. | backend-lead |
| m-06 | Minor | 3 Bảo mật | `contracts.routes.ts:85` | `/source` trả `text/markdown` lấy từ DOCX người dùng tải lên nhưng không có `X-Content-Type-Options: nosniff` và `Cache-Control: no-store`. Các route nội dung khác đã có (`attachment-content.ts:92`). | Thêm hai header này. | backend-lead |
| m-07 | Minor | 3 Bảo mật (zod ở biên) | `packages/contracts/src/pack-contracts/fields.ts:95`, `list.ts:31` | Chuỗi chứa `\u0000` (trường PATCH hoặc `seller/buyer/signer/q`) lọt qua zod. Postgres từ chối (`22P05`/`22021`) nên ra 5xx thay vì 400/422. | Từ chối `\u0000` trong `nfcText` và trong các mục chuỗi của ListQuery. | backend-lead |
| m-08 | Minor | 2 Nghiệp vụ | `application/upload-contract.usecase.ts:75` | Nếu `starter.start` ném **đồng bộ** (hàm không async, có thể xảy ra từ HD2), lỗi rơi vào `catch`: hoàn quota và **xoá tệp FileBox của một HĐ đã commit**. Bản no-op hiện tại là async nên chưa xảy ra. | Gọi `Promise.resolve().then(() => d.starter.start(...)).catch(...)`, hoặc đưa lời gọi ra ngoài `try`. | backend-lead (HD2) |
| m-09 | Minor | 4 Dữ liệu | `adapters/upload-counter.redis.ts:25-32` | Pipeline có thể lỗi một phần: `INCR` thành công nhưng `EXPIRE` lỗi thì khoá ngày không có TTL, và lượt đó bị trừ quota mà không hoàn (503). Lệch theo hướng đóng an toàn, không vượt trần. | Dùng `multi()` (nguyên tử), hoặc hoàn `DECR` khi `counts()` ném sau `INCR`. | backend-lead |
| m-10 | Minor | 3 Bảo mật | `adapters/upload.routes.ts:69-80` | `cleanFileName` chỉ bỏ C0 và DEL. Vẫn giữ C1 (U+0080–009F) và ký tự bidi (U+202E, giả đuôi tệp trên UI). `slice(0,255)`/`slice(0,200)` có thể cắt đôi cặp surrogate. | Lọc thêm `\p{Cc}` và `U+200E-200F, U+202A-202E, U+2066-2069`. Cắt theo điểm mã như `edit-event.rules.ts`. | backend-lead |
| m-11 | Minor | 7 Chuẩn code | `application/upload-contract.usecase.ts:21-26` | `UPLOAD_MIME` chép lại `CONTRACT_FILE_MIME` (`packages/contracts/.../detail.ts:89`). | Dùng chung hằng của contract. | backend-lead |
| m-12 | Minor | 9 Truy vết | `spec.md:97` | §11 vẫn ghi "CHƯA XỬ" cho tranh chấp FileBox 200/201, nhưng test đã đổi sang kiểm 2xx (`upload.int.test.ts:91-94`, 4c5a21ed). | Đánh dấu "ĐÃ XỬ (qc 4c5a21ed)". | docs-architect |
| m-13 | Minor | 6 Test | `tests/acceptance/HD1/hops.int.test.ts:56-100`; `config/config.service.ts:160-167` | Bộ đếm thỉnh thoảng ra 3 câu thay vì 2 ở T7. **Không phải câu thừa của route.** Route đọc gửi đúng 2 câu văn bản cố định: `set_config` (`pack-scope.ts`) và câu danh sách/facets. Câu thứ 3 là `loadUsers` của guard khi user còn "nguội" (N1 PK-NFR-01 cho phép ≤ 1). Nó xảy ra khi một lượt nạp Admin (NOTIFY sau `arrange`) chồng lên lượt làm nóng: `user()` thấy `#adminGen` đổi nên không cache, và lượt đo phải đọc lại. Bộ đếm lại đếm theo cả pool (`P-d/d1/_count.ts`). | qc: trong `hops`, đợi `c.hub.config.reloaded()` hoặc `adminSettled()` sau `arrange` và trước lượt làm nóng, hoặc loại câu `from "admin"."users"` khỏi phép đếm của route. Khi lệch thì in `h.queries`. | qc |
| m-14 | Minor | 4 Dữ liệu | `upload.mount.ts:70`; `packages/db/migrations-packs/0001_kit.sql:65` | Đặt env `CONTRACTS_MAX_MB` > 20 sẽ xung đột với CHECK `files.size_bytes ≤ 20971520` và `DOCX_MAX_INPUT` 20 MiB: tệp 21–N MiB qua route rồi 5xx ở DB (sau khi đã ghi FileBox, sau đó dọn). | Kẹp `min(envInt(...), 20)`, hoặc bỏ env này. | backend-lead |
| m-15 | Minor | 4 Dữ liệu | `0002_category_ids.sql:18-22` | Trigger ghi `category_ids` nhưng không tăng `updated_at` và không đẩy outbox. Chỉ mục ngoài (N4/OpenSearch) sẽ lệch khi HD2/HD5 ghi item. HD1 chưa ghi item. | Ghi vào "Cần" của HD2/HD5: lệnh ghi item enqueue outbox `contract upsert` cho tập HĐ bị chạm (cùng tx, theo tập). | backend-lead (HD2) |

### Trạng thái sửa (backend-lead, sau vòng 1)
| # | Trạng thái |
|---|---|
| M-01 | ĐÃ SỬA — số p95 T8/T9/T10 ghi ở `spec-decisions.md` (T8, T9, T10) + plan §6. `/source`, `/file` chưa có ca perf ⇒ TECH-DEBT #217 (qc). |
| m-01 | ĐÃ GHI — mã FR đúng ở `spec-decisions.md` (T8: HD-FR-07; T9: HD-FR-02/06/07); không amend. TRACE ở T13. |
| m-02 | ĐÃ SỬA — `bodyLimit` 256 KiB ⇒ 413 `PAYLOAD_TOO_LARGE` (`adapters/hd1-review-fixes.test.ts`). |
| m-03 | ĐÃ SỬA — `toMarkdown(bytes, {tenantId})` (`application/upload-review-fixes.test.ts`). |
| m-04 | qc (song song). |
| m-05 | TECH-DEBT #214 (không sửa migration đã áp). |
| m-06 | ĐÃ SỬA — `nosniff` + `no-store` ở `/source`. |
| m-07 | ĐÃ SỬA — `nfcText` cấm `\u0000` (PATCH 422, ListQuery/tiêu đề 400). |
| m-08 | ĐÃ SỬA — `starter.start` ngoài khối hoàn/gỡ; lỗi (cả đồng bộ) chỉ log, giữ tệp + quota. |
| m-09 | TECH-DEBT #215 (`multi()` đổi số đếm Redis của test khoá ⇒ cần qc). |
| m-10 | ĐÃ SỬA — bỏ `\p{Cc}` + bidi, cắt theo điểm mã. |
| m-11 | ĐÃ XỬ — giữ bản sao ở application (ADR-0023, không import `@ai/contracts`), test khớp `CONTRACT_FILE_MIME`. |
| m-12 | ĐÃ SỬA — `spec.md` §11 ghi hash d8098aa0. |
| m-13 | qc (song song). |
| m-14 | ĐÃ SỬA — `CONTRACTS_MAX_MB` kẹp ≤ 20 (`contractsMaxBytes`). |
| m-15 | TECH-DEBT #216 (HD2/HD5). |
| #212 | ĐÃ SỬA — `filebox.client.ts` `#retry(req, first)`; `check:fn` sạch. |

## Security (S-xx)
| # | Kiểm | Kết quả | Căn cứ |
|---|---|---|---|
| S-01 | RLS ENABLE + FORCE, policy tenant cho cả 5 bảng + `files`/`index_outbox` | Đạt | `0001_init.sql:206-214` → `packs.secure_table` (`0001_kit.sql:42-46`, `FOR ALL TO contracts_rw USING/WITH CHECK tenant_id = app.tenant_id`). Role `contracts_rw` NOBYPASSRLS. Mọi câu repo còn lọc `tenant_id` tường minh. |
| S-02 | FK kép `(x_id, tenant_id)` | Đạt | parent, file, items→contracts/categories, reminders, events (`0001_init.sql:118-121,160-163,185-186,200-201`). Không FK sang `admin.*`/`hub.*`. |
| S-03 | UNIQUE có tenant, chống dò HĐ chéo tenant (D-19) | Đạt | `contract_items_ord_uq (contract_id, tenant_id, ord)` và `contract_reminders_once_uq (contract_id, tenant_id, …)`: chéo tenant gặp FK 23503, không gặp 23505. Mọi id do server sinh (`Bun.randomUUIDv7`), nên client không dò được qua PK. |
| S-04 | Trigger `sync_category_ids`: INVOKER, `search_path`, tenant | Đạt | `SECURITY INVOKER SET search_path = pg_catalog`, mọi bảng ghi đủ schema, lọc `tenant_id = ANY(p_tids)` và RLS vẫn áp. Gọi trực tiếp hàm cũng chỉ tính lại dữ liệu dẫn xuất trong tenant của mình. |
| S-05 | Trigger: đồng thời, deadlock, mất cập nhật | Đạt (theo phân tích; ca int còn yếu, xem m-04) | Thứ tự khoá: FK `KEY SHARE` (RI row-trigger, trước statement trigger) → `FOR NO KEY UPDATE` theo `ORDER BY id` (không xung đột KEY SHARE). Ở READ COMMITTED, câu UPDATE trong plpgsql VOLATILE lấy snapshot mới sau khi chờ khoá nên thấy item tx kia đã commit, không mất cập nhật. Ở RR thì gặp 40001 và `withPackScope` thử lại. PATCH `FOR UPDATE` một hàng không giữ khoá khác nên không tạo chu trình. Deadlock chỉ có thể do lệnh ghi item nhiều câu theo thứ tự HĐ ngược nhau trong cùng tx (HD2 phải ghi item một câu theo tập). |
| S-06 | Hàm IMMUTABLE thật sự immutable | Đạt | `fold`/`person_key`/`as_bigint`/`as_date` là `LANGUAGE sql` (thân SQL chuẩn, `RETURN`) và chỉ dùng `translate`, `regexp_replace`, `btrim`, `strpos`, `left`, `least`, cast `int/bigint`, `make_date`. Không có `lower()` ngoài ASCII, `concat_ws` hay `now()`. Bộ ký tự `btrim` khớp đúng tập của JS `trim` (đã dump mã điểm). `as_date` không ném 22008. EXECUTE chỉ cấp cho `contracts_rw`. |
| S-07 | Quyền viewer/editor mọi route | Đạt | `read`: list, facets, detail, source, file (`contracts.routes.ts:70-92`). `write`: PATCH (`:94`, guard trước khi đọc thân) và POST upload (`upload.routes.ts:97`, guard trước `limitBody`/parse). `/me` của N1. Guard 0 SQL khi nóng. |
| S-08 | 404 đồng nhất chéo tenant | Đạt | detail/source/file/PATCH: RLS cộng `tenant_id` cho 0 hàng ⇒ `NOT_FOUND`, giống id lạ. PATCH khoá trước khi so `version` nên không ra 409 chéo tenant. Cha của phụ lục ở tenant khác hay không tồn tại đều cho 23503 ⇒ cùng 422 `PARENT_INVALID`. 400/422 do hình dạng thân đều xảy ra trước SQL. |
| S-09 | Tải lên: bodyLimit, magic bytes, zip chỉ central directory, zip bomb | Đạt | `Content-Length` > 20 MiB + 64 KiB ⇒ 413 trước khi parse; thân chunked ⇒ `bodyLimit`; `file.size` kiểm lại. `sniffFileType` dựa vào chữ ký, DOCX cần `word/document.xml` trong central directory (`fflate.unzipSync` với `filter` trả false, không giải nén). Bom zip: `DocxConverter` worker (`DOCX_MAX_UNZIP` 100 MiB, `DOCX_MAX_RATIO` 500, `DOCX_MAX_PARTS`, timeout 10 s). 415 xảy ra trước Redis và FileBox. |
| S-10 | Quota Redis không vượt được, Redis vắng ⇒ 503 | Đạt | `INCR` nguyên tử, chỉ nhận khi giá trị sau INCR ≤ trần, và chỉ hoàn lượt INCR của chính mình (cùng khoá ngày), nên số tải thành công ≤ trần kể cả khi đua. Đua chỉ gây 429 sớm (hướng an toàn). Redis vắng hoặc lỗi ⇒ 503 `UPLOAD_QUOTA_UNAVAILABLE`, không ghi gì. Lỗi một phần: m-09. |
| S-11 | FileBox `org`, link ngắn hạn | Đạt | `org = t_<tenant>` từ token (`orgForTenant`), CHECK `files_org_ck` ở DB, `/file` kiểm lại org, lệch ⇒ 404 + log. Gọi `getLink` ngoài tx. FileBox chưa cấu hình ⇒ 5xx (đóng an toàn). |
| S-12 | PATCH: FOR UPDATE, 409, event ≤ 64 KiB | Đạt | `patch-fields.repo.ts:23-24` dùng `FOR UPDATE` và UPDATE kèm `version = expected`. Event cắt theo điểm mã còn 200 (+ "…"): 23 × 2 × 201 × ≤ 6 B ≈ 55 KB < CHECK 65.536. Thân không giới hạn: m-02. |
| S-13 | SQL văn bản cố định, không nối chuỗi người dùng | Đạt | Mọi giá trị đi qua tham số `sql\`${}\``. Mảng là một tham số literal có thoát `"`/`\` (`pgTextArray`). `sql.raw` chỉ nhận tên cột hằng (`dim`). `migrate-packs.ts` ghép tên bảng từ hằng `PACK_DIRS`. |
| S-14 | Log không lộ PII hay file id | Đạt | `get-file-link` chỉ log `{pack, contract_id}`. Upload không log. `safeErrorFields` chỉ ghi `name`/`message` (không `detail` hay "Failing row"). URL `/d/` không bị log. |
| S-15 | Cách ly chạy thật (int RLS 2 tenant, HD-AC01/02) | Chưa kiểm được | Không chạy int theo brief. Test khoá `rls.int.test.ts` và `detail.int.test.ts` phủ các ca này. |

## Ghi chú review chung
- **Tự quyết D-19…D-22 và T8–T10**: đều hợp lý và đã ghi trong `spec-decisions.md`. Bỏ `PackFiles.put` (nợ #213) là đúng, vì cách cũ thêm 5 câu và để lại hàng `files` mồ côi; FileBox được gọi trước tx và gỡ khi tx lỗi. Không tạo GIN (D-22) có số đo đi kèm (9,6 so với 2,2 ms).
- **Luật 4c**: không có sleep, poll hay `setTimeout` trong code và test HD1. Số câu cố định: đọc 2, PATCH 4 (dừng sớm thì 2), upload 3 câu + 1 pipeline (+1 khi hoàn). Không truy vấn theo hàng. Câu danh sách dùng `= any(array)` và semi-join, không join `unnest` trên bảng lớn (`unnest` ở facets chỉ chạy trên nhóm đã gộp).
- **Clean Architecture**: domain thuần; application chỉ phụ thuộc ports; adapters chứa SQL, Redis, Hono, fflate. Hàm và file đều trong giới hạn §4.
- Nợ ngoài phạm vi HD1 đang làm `bun run check` đỏ trên nhánh: `check:fn` (#212, N1) và `depcruise` (kh/processes). Cần xử lý trước khi chạy `done:` toàn nhánh.

## Rubric
1 ✓ · 2 ✓ (Minor m-03, m-08) · 3 ✓ (SAFE; Minor m-02, m-06, m-07, m-10) · 4 ✓ (Minor m-05, m-09, m-14, m-15) · 5 ✗ (M-01: thiếu số đo T8/T10) · 6 ✓ (Minor m-04, m-13) · 7 ✓ · 8 — (không UI) · 9 ✗ nhẹ (m-01, m-12)
