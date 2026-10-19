# Review HD9 — CKS: lô, bán, khách, gia hạn, văn bản đã ký, giá mua–bán (code + bảo mật, một vòng)

## Kết luận
- **Code: CHANGES_REQUESTED** · Spec: `docs/specs/HD9-cks/` · Vòng: 1. Hai lỗi Major nhỏ, sửa nhanh, không chặn bảo mật:
  `stats.margin_pct` lệch mgmt-app ở ca hoà `.x5`, và MST khách không chuẩn hoá/kiểm như D9-20 (MST có ký tự lạ ⇒ 500).
- **Bảo mật: SAFE**. Không có hard stop: không thấy đường chéo tenant, không có lỗi tiền ở số lưu (mọi tiền là `bigint` đồng, trong
  biên, nhật ký giá ghi cùng câu), không lách quyền (guard `write` chạy trước khi đọc thân, viewer không tạo được "Hẹn nhắc").

Phạm vi: `git show fd8357f9 0f4a22f6 4d681312 58269e13` (nhánh `platform/gd0`). **Không có commit docs spec HD9 riêng**:
`spec.md`/`plan.md`/`spec-decisions.md`/`readiness.md`/`tasks.md` nằm trong fd8357f9, rồi sửa ở 0f4a22f6, 4d681312, 58269e13.
Đọc kỹ migration `0004_cks.sql`, `cks-write.repo.ts`, `cks-read.repo.ts`, 4 use case, `cks.routes.ts`, `signed.routes.ts`,
`domain/{sale,prices,serial}.rules.ts`, `pack-contracts/cks.ts`, `rls-packs.int.test.ts`, `HD9/{access,price}.int.test.ts`. FE: đọc phần tiền
(`features/cks/lib/cks.ts`, `cks-prices/lib/prices.ts`, các hộp thoại) và cổng quyền. So với mgmt-app (chỉ đọc):
`api/app/cks/{lots,sales}.py`, `prices/cks.py`, `companies/registry.py::normalize_tax_id`.

## Lệnh đã chạy
- Chỉ đọc (`git show`/`log`/`status`). **Không chạy int/e2e**: máy đang tải nặng, bằng chứng tĩnh đủ. Số liệu int/perf trong `tasks.md`
  là của agent làm lát, reviewer chưa chạy lại.
- `bun test apps/hub-api/src/modules/packs/contracts/cks apps/contracts-web/src/lib/utils.test.ts apps/contracts-web/src/features/cks apps/contracts-web/src/features/cks-prices`
  ⇒ 22 pass, 0 fail (unit thuần).
- Kiểm chứng M1: `python -c "print(round(100*247000/2000000,1))"` ⇒ `12.3`; `roundHalfEven(1000*247000, 2000000)/10` (bun) ⇒ `12.4`.

## Lỗi
| # | Mức | Nhóm | file:dòng | Vấn đề | Cách sửa đề xuất | Giao cho |
|---|---|---|---|---|---|---|
| M1 | Major | 1 Đúng spec (tiền hiển thị) | `cks/domain/prices.rules.ts:190` | `stats.margin_pct` = `roundHalfEven(1000·profit, revenue)/10` làm tròn half-even trên **giá trị đúng**. mgmt `round(100*profit/revenue, 1)` làm tròn trên **số float** của phép chia, nên ở ca hoà thập phân hai kết quả khác nhau. Ví dụ doanh thu 2.000.000, lãi 247.000 (2 chữ ký bán 1.000.000, lô 876.500): mgmt **12,3 %**, evolu **12,4 %**. Ca này ra được với số đồng tròn. Trái BR-1/D9-15/AC06 ("khớp `prices/cks.py`"). `margin_pct` nguyên của từng gói (`:169`) thì **khớp**: k+0,5 biểu diễn đúng bằng float nên Python cũng half-even đúng. Ngoài ra `1000*profit` là phép nhân `number` trước `BigInt` (chỉ mất chính xác khi lãi > 9·10¹², xa thực tế). | Làm đúng ngữ nghĩa Python: `x = 100*profit/revenue` (float), rồi làm tròn 1 chữ số theo giá trị nhị phân thật của `x`. Cách gọn: so `x*10` với `BigInt` khai triển chính xác của float, hoặc dùng `Number(x.toPrecision(17))` rồi xét phần dư. Thêm ca test 247.000/2.000.000 ⇒ 12,3 (unit + `price.int` AC06). Hoặc, nếu muốn giữ half-even "đúng", ghi D9 mới nói rõ là lệch có chủ ý. | backend |
| M2 | Major | 2 Đúng đắn | `cks/domain/sale.rules.ts:48-51` (`normTaxId`), `pack-contracts/cks.ts:36-42` (`taxId`), `0004_cks.sql:15` (`cks_customers_tax_ck`) | D9-20 ghi port `normalize_tax_id`, nhưng code chỉ bỏ khoảng trắng và dấu chấm, **không kiểm dạng**. mgmt trả `None` khi MST sai dạng (`-` chỉ ở `\d{10}-\d{3}`, còn lại phải toàn số) và khi đó khoá khách theo tên. Hệ quả: (1) MST có ký tự ngoài `[0-9A-Za-z-]` (vd `0312/345`, `MST:031…`, chữ có dấu) qua zod rồi chạm CHECK DB ⇒ **500**, không phải 400; (2) MST rác như `abc` thành khoá khách, nên cùng một khách có thể tách thành hai. Chỉ ảnh hưởng `POST /sales`, `/certificates`. `supplier_tax_id` của lô chỉ vào `fields` HĐ, không gặp CHECK. | Port đủ `normalize_tax_id` (10 / 12 / 10-3 chữ số, sai dạng ⇒ `null` ⇒ khoá theo tên như mgmt), hoặc ít nhất zod `regex` cho MST ⇒ 400 `VALIDATION`. Thêm int: MST `0312/345` ⇒ không 500. | backend |
| m1 | Minor | 2 Đúng đắn | `cks/domain/serial.rules.ts:56` ↔ `0004_cks.sql:183` | `certSerial` nhận INTEGER tới 64 byte (128 ký tự hex), nhưng CHECK `cks_signed_docs.serial_key ≤ 100`. Một tệp có chứng thư serial 51–64 byte (tự tạo) làm **cả lô tải lên** lỗi 500. Chỉ người có quyền `write` của chính tenant làm được, nên không phải lỗ hổng. | Giới hạn `serial.len ≤ 50` (hoặc coi là `unreadable`), cho khớp CHECK. | backend |
| m2 | Minor | 2 Đúng đắn | `pack-contracts/cks.ts:89,103` (`LocalAt`, `at`) | Regex nhận ngày/giờ không tồn tại (`2026-02-30T25:00`). Cast `::timestamp` trong SQL lỗi 22008 ⇒ 500. | Kiểm bằng `asDate` + giờ `00–23`/phút `00–59` trong zod ⇒ 400. | backend |
| m3 | Minor | 1 Đúng spec | `cks/application/renewal.usecase.ts:35` | `i.price_each ?? first.sale_price ?? 0` khác mgmt `price_each or group[0].sale_price or 0`: gửi `price_each: 0` thì mgmt lấy giá nhóm, evolu ghi 0. UI hiện không gửi `price_each` (`api.ts:62-65`), nên chỉ lệch qua API. | Theo mgmt (`price_each \|\| …`) hoặc ghi D9 rằng 0 là giá hợp lệ. | backend |
| m4 | Minor | 3 Bảo mật (phòng thủ chiều sâu) | `0004_cks.sql:257-261` | Nhật ký giá chỉ được bảo đảm bởi code: `contracts_rw` vẫn có `UPDATE` trên `cks_certificates` (`sale_price`) và `cks_renewals` (`price_each`). Hôm nay **không có** câu UPDATE giá nào, nhưng một lát sau có thể đổi giá mà không ghi `cks_price_audit`. | Trigger `BEFORE UPDATE OF sale_price/price_each` chặn (hoặc tự ghi audit), hoặc ghi vào CONVENTIONS: "đổi giá CKS chỉ qua hàm có `auditCte`". | backend |
| m5 | Minor | 6 Vận hành | `cks-write.repo.ts:62-64` (số `CKS-YYYY-NNN`) | Số kế = lớn nhất + 1 trên `contracts.number` (cột sinh từ `fields.number`). HĐ CKS vẫn sửa được `number` qua PATCH HD1, nên đổi tên HĐ số lớn nhất làm số đó bị cấp lại. HĐ tạo tay ở HD1 không qua khoá CKS nên có thể trùng số. mgmt cũng y hệt, nên **không phải lệch port**. | Ghi TECH-DEBT; cân nhắc khoá trường `number` của HĐ `origin=cks` ở HD1. | — |

## Trả lời các trọng tâm
**(a) Tiền.**
- Mọi cột tiền là `bigint` với CHECK `0…10¹⁰` (`unit_cost`, `sale_price`, `price_each`, `price_ex_vat`); zod `CksMoney` là `int 0…10¹⁰`.
- Tổng lớn nhất: lô `qty ≤ 100.000 × 10¹⁰ = 10¹⁵ < 2⁵³`; bán `≤ 200 × 10¹⁰`; `margin` của lô cũng ≤ 10¹⁵.
- Đọc: bigint ra JSON số nguyên chính xác, còn `liveCerts` đọc `::text` rồi `Number`. Không có `numeric`/float trong SQL tiền.
- Số học khớp mgmt từng dòng:
  - Lô: `total_value = qty·unit_cost`; `margin = Σ(sale_price − unit_cost)` trên chữ ký không phải gia hạn; `null` khi chưa bán.
  - Bán: `count·price_each`.
  - Gia hạn: `max(hôm nay, hạn sớm nhất) + years`, tháng 2 ⇒ ngày ≤ 28.
  - Gói giá: mua = lô mới nhất, bán = `valid_from` mới nhất trong 365 ngày, cờ, lọc, sắp.
  - `margin_pct` nguyên của gói: khớp.
  - **Ngoại lệ:** `stats.margin_pct` ở ca hoà (M1).
- FE: tiền gõ vào qua `num()` (bỏ ký tự không phải số ⇒ số nguyên, như `dialogs.tsx:8`); số quá 10¹⁰ bị zod chặn. Phép chia duy nhất là để
  hiển thị (`tr = n/1e6`, thanh `margin_pct*2`). Không có `parseFloat`/`toFixed` trên tiền.

**(b) Nhật ký giá.**
- Đủ 4 đường đặt giá: lô `unit_cost`, bán `price_each`, gia hạn `price_each` (cũ = giá nhóm), hoàn tất `certificate.sale_price` (một hàng mỗi chữ ký mới).
- Mỗi đường ghi bằng `auditCte` **trong cùng câu** CTE với lệnh ghi. CTE ghi luôn chạy, nên không có đường ghi giá nào thiếu audit, và cùng tx.
- `addCertificate` (`elsewhere`) có `sale_price null`, không phải đặt giá, nên không ghi audit. Khớp D9-18.
- Bảng chỉ thêm: `REVOKE UPDATE, DELETE` khỏi `contracts_rw`, sau `secure_table` (vốn GRANT S/I/U/D).
- `actor_user_id` lấy từ `app.user_id` do `withPackScope` đặt từ token, không từ thân request.
- Phòng thủ chiều sâu: xem m4.

**(c) Khoá advisory theo tenant.**
- `pg_advisory_xact_lock(hashtextextended('cks:'‖tenant,0))` là câu nghiệp vụ **đầu tiên** của mọi lệnh ghi: lô, bán, chữ ký tự mua, gia hạn, hoàn tất, mất khách, tải văn bản.
- Tx là READ COMMITTED (drizzle mặc định, `pack-scope.ts`), nên câu kiểm sau khoá thấy dữ liệu người giữ khoá trước đã commit.
- Tồn kho: `sold` đếm chữ ký `lot_id = lô ∧ replaces is null`. Mọi đường thêm chữ ký vào lô đều đi qua khoá. Chữ ký gia hạn có `replaces`, nên không trừ tồn.
- Do đó **hai lần bán không thể bán quá lô**. Có int chứng minh: `price.int` "D9-06 hai lần bán đồng thời…" ⇒ `[201, 409]`, đúng 5 chữ ký.
- Số `CKS-YYYY-NNN`: tính dưới khoá (xem m5 cho đường ngoài CKS).
- Serial duy nhất: khoá + `uq (tenant_id, serial_key)` làm lưới an toàn.
- Gia hạn mở: khoá + index duy nhất từng phần `WHERE status='open'`.
- Một khoá mỗi tenant, không khoá hàng nào khác trước nó, nên không có thứ tự khoá thứ hai và không deadlock.
- `followup` không khoá, nhưng đúng vì nó không có bất biến chéo hàng.

**(d) Quyền.**
- `packGuard(view,'contracts','read'|'write')` đứng **trước** `bodyLimit`/`readJson`/`formData` trên mọi route, kể cả upload và `POST /scans`.
- `POST /customers/:id/followups` dùng `write`, nên viewer nhận 403 `PACK_FORBIDDEN` ngay cả khi gửi thân rác.
- `access.int` kiểm cả 9 POST (8 JSON + upload), trong đó có followups, và đếm hàng `cks_followups`/`cks_renewals` không đổi.
- FE ẩn "Hẹn nhắc", "Gia hạn" và tải văn bản khi `!me.write` (`SaleGroupPanel.tsx:145`, `SignedDocsPanel.tsx:90`, `CksPage.tsx:176`).
- Tenant/người làm chỉ lấy từ token. Thân request strict, nên `tenant_id` lạ trong thân ⇒ 400.

**(e) RLS.**
- Đủ 8 bảng `cks_*` gọi `packs.secure_table` (ENABLE + FORCE RLS, policy `tenant_id = app.tenant_id`).
- Cả 8 bảng được khai trong `defineRlsSuite` (`packages/test-kit/src/rls-packs.int.test.ts`, `cksTables`): bảng cha khai trước bảng con, hàng ghi chéo dùng cha giả.
- `reset` truncate đủ 8 bảng.
- Mọi SQL còn lọc `tenant_id` tường minh, ngoài RLS.

**(f) Không FK sang `contracts.contracts` (D9-02): an toàn.**
- `purchase_contract_id`/`new_contract_id`/`sale_contract_id` của chữ ký mới đều là id HĐ **vừa chèn trong cùng câu** (CTE `k`, cùng tenant).
- `sale_contract_id` của gia hạn đến từ URL nhưng phải khớp chữ ký `active` của chính tenant (`renewCheck`); không khớp ⇒ 404.
- Mọi join/UPDATE sang `contracts.contracts` có `k.tenant_id = t`, dưới RLS.
- HĐ không xoá được (`REVOKE DELETE`, `0001:217`) và không có xoá mềm, nên không sinh tham chiếu treo qua app.
- Liên kết chéo tenant không thể tạo qua API (id do server sinh). Ghi tay bằng SQL cũng bị `WITH CHECK` của RLS chặn ở bảng `cks_*`. Còn nếu trỏ tới HĐ tenant khác thì join có lọc tenant nên không đọc được gì.

**(g) `GET /customers` có trang.**
- Tìm bỏ dấu: `likePattern` fold + thoát `\ % _`, truyền là **tham số** (`like ${q.like}`). Mọi giá trị lọc khác (`filter`, `lot` uuid, `ca`, `page`, `page_size ≤ 100`) đều là tham số đã zod.
- Không nối chuỗi SQL, nên **không có SQL injection**.
- Fold chỉ chạy khi có ô tìm: sentinel `'%%'`; `q` rỗng hoặc toàn khoảng trắng cũng ra `'%%'`.
- UI giữ nguyên mgmt: Pager, cột, nhãn; `cks.cw.ts` 13/13 cảnh theo `tasks.md`. Lệch phân trang phía server có ghi ở `DEVIATIONS.md`.

**(h) `cn()` (D9-23) và S03.**
- **S03 đỏ không do bản sửa `cn()`; nguyên nhân là HD5.**
  - Baseline `s03-list-*.json/png` chụp từ mgmt-app ở commit HD5 b52d9a66, có chữ `Nhập tay Lọc Cột 3 kết quả…`.
  - Nút "+ Thêm hợp đồng" (`main input[type=file][hidden] ~ button.btn-primary`) lệch lớp chữ giữa hai phía.
  - Lỗi được sửa ở commit HD5 9bfd875c (22:17, sau commit FE HD9 0f4a22f6 lúc 22:01), bằng CSS `HIDE` ẩn nút ở cả hai phía ("ẩn nút thêm ở S03 parity").
  - `tasks.md` HD9 cũng ghi "s03 (HD5) đỏ sẵn".
- Tác động thật của `cn()` lên S03:
  - Chỉ đổi **cỡ chữ** (16 → 13 px) ở các viên `PILL` "Lọc"/"Cột" (`cn(PILL, PILL_OFF)`) và số trang đang chọn của Pager (`cn(NAV, …text-on-act)`).
  - Trước khi sửa, tailwind-merge coi `text-label` là màu nên bỏ mất nó. mgmt-app dùng 13 px, nên sửa này **kéo S03 lại gần baseline**.
  - Không đổi ký tự (lớp chữ giữ nguyên).
  - Không đổi các khung đo `search/table/firstRow/pager`: viên và nút có chiều cao cố định `h-9`/`h-8`, ô tìm nằm bên trái.
- S05: không dùng `PILL`/`NAV`/`Chips`/`Stat`. `NotificationItems` chỉ có `text-body` + `font-semibold`, khác nhóm nên không đổi. Vì vậy không có tác động.
- Unit `lib/utils.test.ts` khoá hành vi mới.
- Chưa chạy lại e2e (theo brief). Cần một lần `bun run e2e:contracts` sau 9bfd875c để xác nhận S03/S05 xanh.

## Điểm tốt
- Đúng Luật 4c:
  - Ghi = khoá + 1 câu kiểm + 1 CTE ghi. Dữ liệu lô qua **một** tham số JSON, nên số câu không phụ thuộc số người giữ (`sqlcount.int`).
  - Đọc = 1 câu; danh sách khách = 2 câu.
- Lỗi luật được ném trước câu ghi, nên tx hoàn tác sạch. Có int "không ghi gì" khi 409/422.
- Bộ đọc DER kiểm biên mọi độ dài, không ném.
- Tải văn bản đọc tệp ngoài tx. Guard chạy trước khi đọc multipart. Trần 64 MB được kiểm cả theo `Content-Length` lẫn đếm luồng.

## Việc phải làm trước APPROVED
1. M1: làm tròn `stats.margin_pct` theo float như Python, kèm test ca hoà 247.000 / 2.000.000 ⇒ 12,3.
2. M2: chuẩn hoá và kiểm MST theo `normalize_tax_id` (sai dạng ⇒ khoá theo tên, hoặc 400), kèm int.
3. Minor m1–m3 nên sửa cùng vòng (mỗi lỗi một dòng zod/hằng số); m4–m5 ghi TECH-DEBT nếu không làm.
