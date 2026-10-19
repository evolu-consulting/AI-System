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
| HD8-NFR-01 | RLS FORCE 4 bảng mới (`defineRlsSuite`); list p95 ≤ 50 ms, số câu cố định. |
| HD8-NFR-02 | Không đầu vào nào ra 500 (thân/tham số rác ⇒ 400/404/422). |

## Việc
| # | Việc | Làn | Trạng thái |
|---|---|---|---|
| 1 | Migration `0010_hd8_partners` (journal idx 9, `when` 1793404800000, ngay sau `0009_m1_visibility` của HEAD) | đầy đủ | xong |
| 2 | Domain thuần: `scoring.rules`, `scoring-config.rules`, `partners.rules`, `goods-prices.rules` + unit parity (22 ca engine/config) | đầy đủ | xong |
| 3 | Repo + use case + route + mount (`partners.mount.ts`) | đầy đủ | xong |
| 4 | CKS: dòng uy tín gia hạn/mất khách | đầy đủ | xong |
| 5 | Int `tests/acceptance/HD8/{scoring,prices}.int.test.ts` + RLS `rls-packs` (evotest) | đầy đủ | xong (8/8) |
| 6 | Perf `tests/acceptance/HD8/perf/partners.perf.int.test.ts` | đầy đủ | xem Kết quả |
| 7 | FE `/partners`, `/settings/scoring`, `/prices?product=` + i18n `partners.{vi,en}.json` + unit | nhanh | xong |
| 8 | e2e so màn + hành vi `e2e/contracts-web/hd78-partners.cw.ts` (baseline mgmt `CW_MODE=ref`) | nhanh | xem Kết quả |

## Quyết định trong lúc làm
- D8-01: Đối tác = `party_key` (D7-04), không bảng công ty; tên = tên bên đối tác trên HĐ đầu tiên (mgmt lấy `short_name` danh bạ — chưa có danh bạ).
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
- D8-08: Giá thị trường hàng hoá chưa có (mgmt cũng `tbd` khi chưa dò) ⇒ luôn `{status:"tbd"}`; "Dò giá" hàng hoá cần agent (N2).
- D8-09: Thông số API khác mgmt có chủ ý: `party` qua query (`/partners/score?party=`, `/partners/ratings`) thay `/partners/{cid}/…`
  (khoá có `:` và `|`); lỗi luật 422 mã `SCORING_INVALID` + đúng câu mgmt; `POST /prices/quotes` trả 201.
- D8-10: Không kiểm link báo giá phía máy chủ (`link_check` mở URL = rủi ro SSRF, cần hạ tầng mạng ra) ⇒ `source=website` khi có link,
  chưa xác minh. Nợ.
- D8-11: HĐ CKS gia hạn bị mất khách không tính sự thật (mgmt `lost_renewal`) — nhận ra qua `cks_renewals.status='lost'`.
- D8-12: Báo giá NCC không MST ⇒ đối tác cùng tên (`fold`) đã có trên HĐ (mgmt `supplier_company`/`_named`), không sinh khoá thứ hai.
- D8-13: Ghi việc (HD7) theo M1: sự kiện gắn HĐ người dùng không thấy ⇒ không liệt kê, huỷ ⇒ 404 (mgmt
  `test_a_member_neither_sees_nor_undoes…`).
- D8-14: Báo giá tenant-wide (mgmt `view.quote` theo người tạo) — TODO nếu cần luật thấy theo người cho báo giá.

## Việc còn lại / nợ
- Kiểm link báo giá (D8-10), dò giá thị trường hàng hoá (D8-08, N2), danh bạ công ty + `short_name` (D8-01), lịch sử điểm từng đối tác
  (ảnh chụp đã lưu, chưa có màn).
