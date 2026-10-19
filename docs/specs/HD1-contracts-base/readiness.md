# Readiness · HD1-contracts-base

## Lần 1 — 2026-10-19 (spec-readiness, nhánh `platform/gd0`, sau 78bdab1)

## Kết luận: NOT READY
Phạm vi đã kiểm: `docs/specs/HD1-contracts-base/` (spec, spec-decisions D-01…D-13, plan, test-plan, tasks) + `N1-gate.md`, `N1-pack-frame/{plan,spec,spec-decisions,readiness}.md` (đúng mục trỏ) + `tests/acceptance/HD1/**` (đúng ca trỏ) + code `apps/hub-api/src/modules/config/*`, `packages/db/migrations/0011`, `docs/CONVENTIONS.md:92` · 9 file tài liệu · mã yêu cầu: HD-FR-01…08, HD-BR-01…03, HD-NFR-01…04, HD-AC01…14.
`bun test tests/acceptance/HD1/rules`: 0/60 xanh — 60 đỏ đúng lý do (thiếu T4/T6), khớp test-plan §5.
0 Chặn · 7 Cao (đều có mặc định, chưa ghi vào spec ⇒ chưa đóng) · 10 Thấp.

## Lỗ hổng
| # | Mức | Mục | Vị trí | Vấn đề | Mặc định đề xuất |
|---|-----|-----|--------|--------|------------------|
| 1 | Cao | C, J | plan.md:42 (`search_key`); test-plan.md:73, :86 (#9) | `fold(concat_ws(' ', …))` làm biểu thức cột sinh: `concat_ws` là STABLE ⇒ `CREATE TABLE` lỗi `generation expression is not immutable` (qc đã bắt trên DB nháp). Danh sách "6 trường text trên" cũng không nêu tên | Viết thẳng bằng toán tử IMMUTABLE: `search_key text GENERATED ALWAYS AS (contracts.fold(coalesce(title,'') \|\| ' ' \|\| coalesce(fields->'number'->>'value','') \|\| ' ' \|\| …supplier_name, buyer_name, supplier_representative, buyer_representative)) STORED` — 5 trường + title (bỏ `type`, là mã enum). `fold` đã gộp/cắt khoảng trắng nên chỗ rỗng vô hại. Không hàm mới, không cột thường cập nhật tay (lệch nguồn); chi phí chỉ ở lúc ghi (một lần/hàng), đọc 0. Ghi D-14 + sửa plan §3 |
| 2 | Cao | C, D | plan.md:39 (`as_date`); columns.int.test.ts:198 (bắt buộc `sql`) | `as_date` = regex ISO ⇒ `make_date`: chuỗi đúng khuôn nhưng ngày không có (`2027-02-30`) ⇒ `make_date` ném 22008 ⇒ **cả câu INSERT/UPDATE hỏng**. PATCH có zod chặn, nhưng HD2 (AI ghi `fields`), HD10 (chuyển dữ liệu) và seed thì không | `as_date` vẫn `sql IMMUTABLE`, thêm điều kiện ngày ≤ số ngày của tháng (`extract(day from make_date(y,m,1) + interval '1 month - 1 day')`, tháng 1…12) ⇒ ngoài ra `null`; bản TS cùng luật; thêm ca parity `2027-02-30`, `2028-02-29` (qc). Ghi D-15 |
| 3 | Cao | B, I | spec.md:34 (HD-FR-07), :68 (AC05), :88 (Q7) ↔ D-03, plan.md:8–9, test-plan.md:3, :34 | Spec còn keyset `next_cursor`, `limit` 1–100 mặc định 50, sắp cố định, tham số đơn `category_id/owner_user_id/signer`; plan/test: `page/page_size` mặc định 20 + `total`, `sort/dir`, tham số mảng `category/owner/signer[]…`. Hai nguồn hợp đồng khác nhau | docs-architect sửa **ngay** (không đợi T13) HD-FR-07 + AC05 theo plan §1 (trỏ plan, không chép), AC05 = 3 trang `page=1..3` 50/50/20, `total=120`, trang 4 rỗng; bỏ cột "File" T13 tương ứng. Q7 vẫn trình người dùng ở Gate để xác nhận (mặc định: đổi) |
| 4 | Cao | D, G, H | plan.md:108 (N1-a "tạm `Asia/Ho_Chi_Minh`"); tasks.md:16 (T10 File); upload.int.test.ts:371; N1 spec.md:26, N1 readiness #9; migration 0011 (`CHECK` chỉ độ dài) | Hai cách hiểu: HD1 thêm thật `TenantState.timezone` hay dùng hằng tạm (ca Kiritimati đỏ). N1 đã chốt "⇒ HD1". T10 không có file `modules/config`. Múi giờ sai trong DB ⇒ `Intl` ném RangeError ⇒ 500 ở tải lên | HD1 làm thật trong T10: `TenantState.timezone?: string` (`config.rules.ts:8`), `loadTenants` chọn thêm `tenants.timezone` (`hub_ro` đã có SELECT `admin.tenants`, 0002:46); vắng/không hợp lệ (kiểm một lần khi nạp bằng `Intl.DateTimeFormat` try/catch) ⇒ `Asia/Ho_Chi_Minh`. Thêm `apps/hub-api/src/modules/config/{config.rules,config.repo}.ts` vào cột File T10. Phạm vi HD1 = chỉ trường này (0 SQL thêm mỗi request). Ghi D-16, xoá chữ "tạm" ở plan §7 |
| 5 | Cao | G, J | plan.md:63, :127 N1; hd1.ts:7, :169; test-plan.md:78 (#1) | Seam `AppDeps.packs` của N1 chỉ có `{pkdemo?, filebox?}`; test cần `packs.contracts`. Chưa nói khi vắng thì sao (production không truyền ⇒ gói thật bị tắt?) và Redis vào gói thế nào | `AppDeps.packs?.contracts?: boolean`; vắng ⇒ `true` (gói thật, `devOnly:false`), `false` ⇒ không mount (404). Redis lấy từ `deps.redis` sẵn có, `packs.mount.ts` truyền vào `contracts.mount.ts`; vắng Redis ⇒ tải lên 503 `UPLOAD_QUOTA_UNAVAILABLE` (D-06), route đọc vẫn chạy. Ghi D-17 + plan §4 |
| 6 | Cao | J | plan.md:58–59 (`sniffFileType(head, zipNames?)` "đọc central directory, kit docx.rules"); N1 plan.md:113 | Kit N1 chỉ có `checkZipEntries(entries)` (thuần, nhận danh sách sẵn); **không có symbol nào đọc tên phần từ byte** ⇒ không rõ ai/ở đâu sinh `zipNames` trước bước 415 | Adapter mới `M/adapters/zip-names.ts`: `zipNames(bytes: Uint8Array): string[]` dùng `fflate` (ADR-0024) `unzipSync(bytes, { filter: (f) => (names.push(f.name), false) })` — chỉ đọc central directory, không giải nén; zip hỏng ⇒ `[]` ⇒ `sniffFileType` ⇒ null ⇒ 415. Chỉ gọi khi 4 byte đầu là `PK\x03\x04`. Bom zip vẫn do `DocxConverter` chặn. Thêm vào cột File T10 |
| 7 | Cao | D | test-plan.md:84 (#7); plan.md:39, :57 | `foldVi`/`fold` chỉ xử lý chữ dựng sẵn (NFC). Nhập từ macOS/iOS hay văn bản dán thường là NFD (dấu tổ hợp) ⇒ `q`, `signer`, facet người ký trượt khớp, `signer_keys` tách đôi một người | Chuẩn hoá NFC **ở biên**: zod `fieldValueSchema` kiểu text và mọi chuỗi ListQuery (`q`, `seller[]`, `buyer[]`, `signer[]`) `.transform(s => s.normalize("NFC"))`; `foldVi` gọi `normalize("NFC")` trước tiên. SQL `fold` giữ nguyên (dữ liệu vào DB đã NFC; HD2/HD10 ghi qua cùng schema). qc thêm ca NFD ở `rules/fold` + `list.int`. Ghi D-18 |
| 8 | Thấp | J | plan.md:61; upload.rules.test.ts:91–111 (#3) | `quotaVerdict` nhận bộ đếm sau hay trước INCR, vượt cả hai báo gì — chỉ suy được từ plan §5 + test | Ghi plan §4: nhận giá trị **sau** `INCR`; `> limit` mới vượt; vượt cả hai ⇒ `"tenant"` (khớp test) |
| 9 | Thấp | J | plan.md:58; upload.rules.test.ts:42 (#4) | Zip không kèm `zipNames` ⇒ ? | Ghi plan §4: thiếu `zipNames` ⇒ `null` (không đoán DOCX từ `PK`) |
| 10 | Thấp | B | plan.md:10 (Facets); list.int.test.ts:512–529 (#8) | `category.n` đếm gì, `direction` có `unknown` không, `signer.label` chọn bản ghi nào | Ghi plan §1: `category.n` = số HĐ có ≥ 1 item loại đó; `direction` gồm `unknown` (= null); `signer.label` = `min(raw)` theo khoá (xác định, ổn định) |
| 11 | Thấp | C, J | plan.md:66 (`fields=$2::jsonb`); test-plan.md:73 | Tham số jsonb postgres.js bị mã hoá hai lần nếu truyền chuỗi/obj thẳng vào `::jsonb` (fixture qc đã sửa bằng `::text::jsonb`). Plan không ghi cách truyền ở repo | Repo theo `CONVENTIONS.md:92`: `sql.json(obj)` (hoặc `${JSON.stringify(obj)}::text::jsonb` khi cần một văn bản SQL cố định); CHECK `jsonb_typeof='object'` bắt lỗi nếu sai |
| 12 | Thấp | I | spec.md:89 (Q8) ↔ N1 spec.md:26, N1 spec-decisions.md:35 | Q8 ghi "Kit N1, HD5 dùng"; N1 đã chốt danh bạ `members` ⇒ **HD5 làm**, code ở `packs/kit` | Đóng Q8 theo N1 (#9): sửa chữ "HD5 làm, code ở `packs/kit`" |
| 13 | Thấp | I | spec.md:55 (HD-NFR-03) ↔ plan.md:67, :96 | "kiểm quota 1 câu" — thực tế là 1 pipeline Redis (D-06), 0 câu SQL | Sửa chữ: "kiểm quota 1 pipeline Redis (4 lệnh), ghi 1 tx 3 câu" |
| 14 | Thấp | C | plan.md:39 (EXECUTE chỉ `contracts_rw`) | UPDATE bất kỳ cột nào của `contracts` tính lại cột sinh ⇒ cần EXECUTE `fold/person_key/as_*`; role `contracts_job` của HD4 (N1 D-12) sẽ lỗi 42501 | Ghi cho HD4: cấp EXECUTE 4 hàm cho `contracts_job` cùng lúc tạo role |
| 15 | Thấp | L | plan.md = 18.530 B (> 18.432, +98 B) | Vượt trần do văn xuôi lặp | Cắt §6 "Offset + count…" (lặp D-03) còn một dòng trỏ D-03 |
| 16 | Thấp | H | tasks.md:8, :9 | T2 vẫn `[ ]` dù đã xong (78bdab1); T3 còn "kèm ADR-0024" đã Accepted ở N1 Gate | Tick T2; bỏ ADR-0024 khỏi T3 |
| 17 | Thấp | I | fold.rules.test.ts:2 | Trỏ `fold-parity.int.test.ts` không tồn tại; parity ở `columns.int.test.ts` | qc sửa comment khi relock |

## Mâu thuẫn giữa tài liệu
- spec HD-FR-07/AC05/Q7 (keyset, `limit` 50, tham số đơn) ↔ D-03 + plan §1 + test-plan (page/page_size 20/total, mảng, sort/dir) → giữ plan (#3).
- plan §3 `concat_ws` trong cột sinh ↔ test `columns.int` (cột sinh + hàm IMMUTABLE) và Postgres → giữ IMMUTABLE bằng `||`/`coalesce` (#1).
- plan §7 N1-a "tạm hằng" ↔ N1 spec:26 + readiness N1 #9 ("HD1 làm `TenantState.timezone`") + test Kiritimati → giữ làm thật (#4).
- spec Q8 ↔ N1 spec:26 → giữ N1 (#12). spec HD-NFR-03 ↔ D-06 → giữ D-06 (#13).

## Câu hỏi cho người dùng
1. **Q7** — Danh sách hợp đồng đổi từ keyset (`next_cursor`) sang `page/page_size/total` để màn S03 có tổng dòng + nhảy trang số như mgmt-app (D-03)? Mặc định: **đổi**. Chờ người dùng ở Gate (đổi contract so với spec gốc; test đã viết theo mặc định).
- Q8 **đóng** (N1 spec:26: danh bạ thành viên ⇒ HD5, code ở `packs/kit`).

## Checklist
| Mục | Kết quả | Bằng chứng |
|-----|---------|------------|
| A Phạm vi | Đạt | spec.md:16–23; requirements frontmatter :7 |
| B Hợp đồng | Mâu thuẫn | plan.md:5–35 đủ DTO/mã lỗi/route; spec HD-FR-07 lệch (#3); facets chưa định nghĩa đủ (#10) |
| C Dữ liệu | Thiếu | plan.md:37–49 (DDL, FK kép, index, REVOKE, `packs.secure_table`); DDL `search_key` lỗi (#1), `as_date` ném (#2) |
| D Nghiệp vụ | Thiếu | spec.md:26–38; múi giờ (#4), NFD (#7) |
| E UI | Đạt (N/A) | spec.md:46–47, D-02 |
| F Kiểm chứng | Đạt | test-plan.md:16–46 (mỗi FR/AC có ca), §5 269/269 đỏ đúng lý do; rules chạy lại 60/60 đỏ đúng lý do |
| G Phụ thuộc & môi trường | Thiếu | FileBox giả FB1, Redis, env `CONTRACTS_*` plan.md:67; seam `packs.contracts` (#5) |
| H2 Vai trò | Đạt | plan §1–§6 backend-lead; test-plan qc; chữ ký luật thuần plan.md:51–62 |
| H Task | Thiếu | tasks.md:5–19 có Rủi ro/File/Lệnh xong; T10 thiếu file config + zip-names (#4, #6) |
| I Nhất quán | Mâu thuẫn | #3, #12, #13 |
| J Độ chính xác | Thiếu | `zipNames` không có nguồn (#6); #8–#10 |
| K Hiệu năng | Đạt | spec.md:49–56 (p95 danh sách/facets ≤ 50 ms 2 câu, chi tiết ≤ 30 ms, PATCH ≤ 30 ms 4 câu/1 tx, upload 3 câu + 1 pipeline Redis); plan.md:69–103 (số câu, index, `FOR UPDATE` 1 hàng, không unnest, đo trước/sau ANALYZE, EXPLAIN không Seq Scan); test-plan.md:55–64 (seed `generate_series` một câu/bảng×tenant, n=200, làm nóng pool+2); không sleep/poll; chưa có code cũ ⇒ không cần đo trước |
| L Gọn | Thấp | spec 10.532 B ≤ 12.288 · test-plan 13.838 B ≤ 18.432 · plan 18.530 B > 18.432 (#15); quyết định chỉ ở spec-decisions; không addendum |

## Quét từ mơ hồ
~25 kết quả: "…" dùng làm khoảng giá trị (`1…200`, `T5a…T5g`), "nhanh" không có, "khoảng/tầm/vài" không có; `field_edited, … thêm cuối` (spec.md:33) vô hại (plan.md:48 có regex + zod `ContractEventType`). Không ghi thành lỗ hổng mới.

## Chưa kiểm
`reference/mgmt-app-contracts/**` (không mở lại; spec trích dòng cụ thể, test đã đối chiếu); `docs/platform/intake-hd.md` ngoài lát HD1; không chạy int/perf (theo brief); không đọc toàn văn 7 file int test (chỉ ca được trỏ).
