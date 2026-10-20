---
id: HD8-partners
title: Đối tác + điểm uy tín + cách tính + so giá hàng hoá + nối khách CKS (app mgmt, contracts-web)
cr: CR-095 (Luật 0b, lát HD78 gộp HD7 phần còn lại + HD8)
lane: đầy đủ cho tiền/điểm/RLS (test trước phần đó), nhanh cho màn hình
requirements: [HD8-FR-01, HD8-FR-02, HD8-FR-03, HD8-FR-04, HD8-FR-05, HD8-FR-06, HD8-FR-07, HD8-NFR-01, HD8-NFR-02]
---

# HD8 · Tasks (plan ngắn + quyết định + việc còn lại)

Nguồn port NGUYÊN (mgmt-app, chỉ đọc): `api/app/scoring/{engine,config,service,labels}.py`, `routes/{scoring,prices}.py`,
`prices/compare.py`, `contracts/products.py`, `cks/sales.py:130-145`; web `pages/partners/{PartnersPage,PartnerLog,PartnerRatings}.tsx`,
`pages/settings/ScoringPage.tsx`, `pages/prices/PricesPage.tsx`. Parity lấy từ `tests/test_scoring_{engine,config,routes,ratings}.py`,
`test_prices.py`, `test_overdue.py` L43-55.

## Mã yêu cầu
| Mã | Nội dung |
|---|---|
| HD8-FR-01 | `GET /partners?role=all\|customer\|supplier`: mỗi (đối tác, vai) có HĐ đã duyệt người dùng thấy; điểm/mức/lý do tính khi đọc; role=all một dòng mỗi đối tác (vai có (event_count, contracts) lớn hơn). `GET /partners/score?party=&role=` kèm chi tiết. |
| HD8-FR-02 | Điểm = `engine.score` (cửa sổ tháng, gần đây ×2, quá hạn treo tính trễ, chỉnh tay ±10, tiêu chí tự chấm), làm tròn `round()` Python. |
| HD8-FR-03 | `GET/PUT /scoring/:role`, `POST …/preview`, `GET …/history`; chỉ `admin` lưu; câu lỗi 422 đúng chữ `config.problem`; lưu ⇒ version+1, lịch sử, ảnh chụp điểm. |
| HD8-FR-04 | `GET/PUT /partners/ratings`: chấm 0–100 tiêu chí tự chấm (dòng `rating` trên sổ), viewer 403, tiêu chí ngoài cách tính 422. |
| HD8-FR-05 | `GET /prices/products`, `/prices/compare?product=`, `POST /prices/quotes`, `DELETE /prices/quotes/:id` (port `compare.py`). |
| HD8-FR-06 | Tiêu chí "Giá cạnh tranh" của NCC = % chênh so nơi rẻ nhất (`_price_gaps`), giá HĐ đang áp dụng theo phụ lục HD5. |
| HD8-FR-07 | Khách CKS ↔ đối tác (`cks_customers.party_key`); gia hạn xong ⇒ `cks_renewed` mỗi chữ ký (`days_before_expiry`, `with_us`), mất khách ⇒ `cks_lapsed` (lý do). |
| HD8-FR-08 | Giá thị trường hàng hoá: `market_observations` 30 ngày ⇒ `{status:"ok",min,max,seen,n}`, chưa có ⇒ `tbd` (mgmt `market_range`). |
| HD8-FR-09 | Danh bạ công ty `/companies` (tạo/sửa/tra lại Cục Thuế, `short_name` dùng làm tên đối tác; NCC chỉ có báo giá vào danh bạ `created_from=quote`). |
| HD8-NFR-01 | RLS FORCE 6 bảng mới (`defineRlsSuite`); list p95 ≤ 50 ms, số câu cố định. |
| HD8-NFR-02 | Không đầu vào nào ra 500 (thân/tham số rác ⇒ 400/404/422). |

## Việc
| # | Việc | Làn | Trạng thái |
|---|---|---|---|
| 1 | Migration `0015_hd8_partners` (journal idx 14, `when` 1793836800000, sau `0014_w1b_followup_send` của `platform/gd0` 88f70a73; đã đổi số 0010→0011→0013→0014→0015 qua các lần rebase M1b/M3/I1/W1/W1b) | đầy đủ | xong |
| 9 | Kiểm link báo giá phía máy chủ, giá thị trường hàng hoá, danh bạ công ty + tên ngắn; int `companies.int.test.ts`, parity ngẫu nhiên `agg-parity.int.test.ts` | đầy đủ | xong |
| 2 | Domain thuần: `scoring.rules`, `scoring-config.rules`, `partners.rules`, `goods-prices.rules` + unit parity (22 ca engine/config) | đầy đủ | xong |
| 3 | Repo + use case + route + mount (`partners.mount.ts`) | đầy đủ | xong |
| 4 | CKS: dòng uy tín gia hạn/mất khách | đầy đủ | xong |
| 5 | Int `tests/acceptance/HD8/{scoring,prices}.int.test.ts` + RLS `rls-packs` (evotest) | đầy đủ | xong (8/8) |
| 6 | Perf `tests/acceptance/HD8/perf/partners.perf.int.test.ts` | đầy đủ | xem Kết quả |
| 7 | FE `/partners`, `/settings/scoring`, `/prices?product=` + i18n `partners.{vi,en}.json` + unit | nhanh | xong |
| 8 | e2e so màn + hành vi `e2e/contracts-web/hd78-partners.cw.ts` (baseline mgmt `CW_MODE=ref`) | nhanh | xem Kết quả |

## Quyết định trong lúc làm
- D8-01: Đối tác = `party_key` (D7-04); tên = `short_name` (rồi `name`) trong danh bạ `contracts.companies` nếu có, không thì tên bên đối
  tác trên HĐ đầu tiên (như mgmt).
- D8-02: Làm tròn = `pyRound` của HD9 (nửa về chẵn trên giá trị nhị phân đúng ≡ `round()` Python; ca `round(62.5)=62` có test); giữ đúng thứ
  tự phép tính của mgmt để ra cùng số double. `{gap:.1f}` = `pyRound(gap,1).toFixed(1)`. Tiền = bigint đồng (giá báo giá CHECK 1…10¹⁵);
  % chênh giá là số thực như mgmt (chỉ để chấm điểm, không phải tiền).
- D8-03: Điểm không lưu sẵn (như mgmt); chỉ lưu cấu hình, lịch sử, ảnh chụp khi lưu cấu hình.
- D8-04: Chỉ phạm vi người dùng trong HTTP (không `system` — `packTenantOnly`). Sổ đối tác không có policy M1 ⇒ điểm trên CẢ sổ như mgmt;
  sự thật từ HĐ (số HĐ, gắn bó, chênh giá) chỉ từ HĐ người dùng thấy (chế độ `tenant` mặc định + owner thấy hết ⇒ trùng mgmt). Danh sách,
  chấm tay, so giá: chỉ đối tác/HĐ người dùng thấy (M1 `view.company`/`visible_ids`).
- D8-05: "Giá đang áp dụng" = dòng HĐ trạng thái `active|expiring|renewed`, không bị phụ lục thay (HD5 `applyAppendixPricingKeyed`, giữ khoá
  sản phẩm đã quy về HĐ gốc), trong `valid_from…valid_to`. Phụ lục đã duyệt của HĐ gốc chưa duyệt: không thay giá ai.
- D8-06: Không có danh mục sản phẩm ⇒ nhãn mặt hàng = "tên (đ/đơn vị)" (mgmt thêm "danh mục · ").
- D8-07: `by` của sổ = id người dùng (D7-11); tên hiện qua `contracts.user_label(uuid)` (SECURITY DEFINER, chỉ `admin.users` của tenant
  phiên — như M1 `org_owner_ids`). Gọi theo dòng chỉ ở chỗ ít dòng (chấm điểm, đọc sổ một đối tác ≤ 2000).
- D8-08: Giá thị trường hàng hoá port `market_range` trên bảng `market_observations` (30 ngày, min/max/ngày mới nhất/số nguồn); chưa có
  quan sát ⇒ `tbd`. mgmt cũng chưa có nguồn tự dò cho hàng hoá ⇒ "Dò giá" (agent, N2) để sau; bảng nhận quan sát từ đó.
- D8-09: Thông số API khác mgmt có chủ ý: `party` qua query (`/partners/score?party=`, `/partners/ratings`) thay `/partners/{cid}/…`
  (khoá có `:` và `|`); lỗi luật 422 mã `SCORING_INVALID` + đúng câu mgmt; `POST /prices/quotes` trả 201.
- D8-10: Kiểm link báo giá phía máy chủ (port `link_check`: giá trên trang, ngày trang, câu ghi chú mgmt) có chặn SSRF: tự phân giải DNS,
  mọi địa chỉ phải công khai, nối thẳng IP đã kiểm (SNI/Host = tên máy), không proxy, chuyển hướng ≤ 5 kiểm lại, ≤ 3 MB, 15 s. Link hỏng
  ⇒ báo giá vẫn lưu, `verified=false` + ghi chú.
- D8-11: HĐ CKS gia hạn bị mất khách không tính sự thật (mgmt `lost_renewal`) — nhận ra qua `cks_renewals.status='lost'`.
- D8-12: Báo giá NCC không MST ⇒ đối tác cùng tên (`fold`) đã có trên HĐ (mgmt `supplier_company`/`_named`), không sinh khoá thứ hai.
- D8-13: Ghi việc (HD7) theo M1: sự kiện gắn HĐ người dùng không thấy ⇒ không liệt kê, huỷ ⇒ 404 (mgmt
  `test_a_member_neither_sees_nor_undoes…`).
- D8-14: Báo giá tenant-wide (mgmt `view.quote` theo người tạo) — TODO nếu cần luật thấy theo người cho báo giá.
- D8-15: Danh bạ chỉ phần mgmt dùng cho đối tác: tạo/sửa/tra lại MST, tên ngắn, danh sách + số HĐ/vai. Ngoài phạm vi: người phụ trách,
  liên hệ, gộp công ty, "công ty mình". Cục Thuế chưa cấu hình ⇒ 503 đúng câu mgmt.
- D8-16 (điều phối chốt): `/partners` gom sẵn đầu vào engine ở SQL theo (đối tác, vai, loại, gần đây), không cache. Engine tách hai tầng
  `aggregate` → `scoreAgg`; mọi tổng có trọng số là số nguyên nên gom trước ≡ chấm từng dòng — có test parity ngẫu nhiên nhiều hạt giống
  (gồm ca hoà làm tròn 62,5 và đối tác rỗng) so SQL với TS tham chiếu.
- D8-17 (quyết định chung, đưa vào review đợt): tắt JIT trong tx gói (`pack-scope.ts`, `set_config('jit','off',true)`) — policy M1 đẩy
  ước lượng vượt `jit_above_cost`, JIT tốn 70 ms/câu.
- D8-18: Đọc chỉ-đọc tách nhiều tx song song (`Promise.all` qua `uow.tenant`): `/partners` 3 câu (sổ đã gom ‖ sự thật HĐ ‖ giá mua),
  `/payments` 2 câu (tổng ‖ hàng); số câu cố định (6 và 4 kể cả set_config).

## Kết quả (2026-10-20, evotest, rebase trên platform/gd0 88f70a73 có M1b/M3/I1/W1/W1b)
- Unit: hub-api contracts + contracts-web features 345/345 xanh (parity engine/config, giá hàng hoá, link check, danh bạ).
- Int (evotest, sau rebase cuối): HD7 + HD8 + `rls-packs` 234/234 xanh (gồm thăm dò tồn tại `partner_event_voids`: id số giả cho NIL ⇒
  42501/0 hàng thay 22P02; `legacy_records` I1 đã khai trên gd0). Trước đó lượt rộng 1176/1178 (2 đỏ đều `legacy_records` của I1, đã hết).
- Parity SQL gom ↔ TS tham chiếu (`agg-parity.int.test.ts`): 6 hạt giống ngẫu nhiên + ca 62,5 + đối tác rỗng — khớp.
- e2e (local, `CW_E2E_WEB_PORT=3378`): `hd78-partners.cw.ts` 12/12 (9 cảnh chữ/khung/ảnh khớp mgmt-app + 3 hành vi), cks/scenes không hồi quy.
- Perf (số thật, 400 đối tác / 2.000 HĐ / 6.000 dòng hàng / 10.000 dòng sổ + nền beta, sau ANALYZE):
  - HD7 `GET /payments`: p95 142,8 → 54,3 → **25,0 ms** (quá hạn 26,8; đã xong 17,2) — **đạt**. 4 câu cố định.
  - `GET /partners`: p95 708,0 → 145,4 → 102,5 → **57,8–69,2 ms** (p50 41–51) — **CHƯA ĐẠT 50 ms**. Số câu 6 cố định (đạt). Phân rã:
    câu sổ đã gom 23 ms ‖ giá mua (HĐ + dòng hàng + phụ lục) 19 ms ‖ sự thật HĐ 6,7 ms, + ~20 ms ngoài SQL (JSON, engine, HTTP). Hướng tiếp:
    bớt quét `fields` jsonb của HĐ mua (cột sinh sẵn party/ngày), hoặc cache theo dấu phiên bản nếu điều phối đổi quyết định "không cache".

## Lát hd8-perf (2026-10-20) — `/partners` p95 ≤ 50 ms, điểm không đổi
Đo bằng EXPLAIN (ANALYZE, BUFFERS) dưới RLS người dùng + bấm giờ JS từng bước (400 đối tác / 2.000 HĐ / 10.000 dòng sổ + nền beta):
câu sổ 31,7–37,7 ms (gom chính 23 ms; ba tập con hiếm — gia hạn CKS, quá hạn, chấm tay — mỗi tập ~4 ms vì quét lại cả 10.000 dòng
qua `partner_events_party_idx` + lọc policy từng dòng; lập kế hoạch 8–9 ms vì quá hạn có bốn `exists` mở policy M1 bốn lần); câu giá 16 ms
+ 381 KB JSON; JS ~10 ms (giá đang áp dụng 4,7, chấm 3,0). Policy M1 không phải nút thắt (InitPlan "thấy hết" đúng cho owner/editor).
- D8-19: migration `0018_hd8_perf`: chỉ mục `partner_events_type_idx (tenant_id, type, party_key, role, at)` — tập hiếm đọc theo loại
  (~0,02 ms thay ~4 ms), lượt gom chính đi theo thứ tự chỉ mục (loại, đối tác, vai) không sắp xếp lại.
- D8-20: gia hạn CKS gộp vào lượt gom chính; hai nửa cũ/gần đây là cột `filter` của cùng nhóm; loại cần đọc `data` (chỉnh tay, CKS) đi
  lượt riêng qua chỉ mục loại; quá hạn: MỘT `exists` (thanh toán/giao HOẶC hoãn muộn hơn, `is not distinct from` mã đợt) thay bốn —
  cùng nghĩa; ngưỡng khoảng tính là InitPlan thay `cross join rw` mỗi dòng.
- D8-21: chỉ đọc sổ của vai cần chấm (`roles` qua CTE khoảng tính): `/prices/compare` chỉ NCC, `/prices/products` và thêm báo giá không
  đọc sổ, `/partners?role=` một vai. Số câu vẫn 6 cố định.
- D8-22: dòng hàng trỏ HĐ bằng vị trí trong mảng HĐ (số nhỏ thay uuid) — JSON câu giá 381 → 276 KB; đổi sang hình miền + tính giá đang
  áp dụng ngay khi câu giá xong, chồng lên lúc chờ câu sổ.
- Kết quả (evotest, máy chung, n=60 sau ANALYZE; parity `agg-parity` 7/7 + HD7/HD8 int 57/57 xanh): câu sổ 31,7–37,7 → 14,5–19,3 ms
  (EXPLAIN), trung vị 36,7 → 20,3 ms; ba câu song song 37,8 → 23,9 ms. `GET /partners` p95 57,8–69,2 → **40,9–49,1 ms** (p50 32–37);
  `?role=supplier` 43,4–48,2; `/prices/products` 30,8–42,1; `/prices/compare` 49,1–53,7 ms — **sát ngưỡng, chưa ổn định dưới 50** ở
  đuôi trên máy chung (p50 30–37). Phần còn lại: câu giá (HĐ mua + 3.000 dòng hàng, ~20 ms gồm chuyển JSON) ngang câu sổ; giảm tiếp
  cần bớt dữ liệu giá (`productList` dùng cả dòng HĐ hết hạn nên không lọc được ở SQL mà giữ parity).

## Sửa theo review HD78 (2026-10-20, lát hd8-perf)
- #1 khoá đối tác/tham số có NUL ⇒ 400 (`keyText`/`keyStr`). #2 (làn đầy đủ, test viết trước `review-visibility.int.test.ts`): migration
  `0019_hd8c_visibility` — RESTRICTIVE trên `companies` (đọc/sửa), `price_quotes` (đọc/xoá), `score_snapshots` (đọc) theo
  `visible_party_keys()` hoặc do mình tạo; xoá báo giá cần `admin`. #3 một hạn 15 s cho cả lượt kiểm link + trần 10 lần/phút/người dùng.
  #4 IPv6 so theo số 128 bit. #5 `with_us` theo truthiness Python ở TS và SQL; hạn vắng/sai ⇒ trễ 1 ở cả hai; parity sinh thêm các ca đó.
  #9 sửa chú thích. #6–#8 ⇒ TECH-DEBT #247–#249.
- D8-23: `market_observations` là giá công khai theo mặt hàng (không gắn đối tác/người) ⇒ không thêm luật thấy M1; người dùng không ghi
  (REVOKE INSERT/UPDATE/DELETE), chỉ việc dò giá nền ghi.
- Perf sau 0019 (evotest): `/partners` p95 44,7; `?role=supplier` 48,1; `/prices/products` 41,6; `/prices/compare` 52,6 ms.

## Việc còn lại / nợ
- `/prices/compare` p95 đuôi 49–54 ms trên máy chung (D8-22).
- "Dò giá" hàng hoá tự động (N2, agent) đổ vào `market_observations`; lịch sử điểm từng đối tác (ảnh chụp đã lưu, chưa có màn).
- Danh bạ: người phụ trách, liên hệ, gộp công ty (D8-15).