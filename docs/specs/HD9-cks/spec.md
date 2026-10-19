---
id: HD9-cks
fr: [HD-FR-91, HD-FR-92, HD-FR-93, HD-FR-94, HD-FR-95, HD-FR-96, HD-FR-97]
nguon: docs/platform/intake-hd.md (HD9 — R27 CKS), CR-094 đợt 3; mgmt-app `api/app/cks/*`, `prices/cks.py`, `routes/{cks,signed_docs}.py`, `signed/*`; web `pages/cks/*`, `pages/prices/CksPricesTab.tsx`
nen: docs/specs/HD1-contracts-base, HD2-extract-verify, N1-pack-frame (plan-frontend §2 S08/S10/S11, §6 so màn hình)
lan: đầy đủ (giá = tiền, quyền, RLS bảng mới) · màn hình theo làn nhanh trong cùng lát
---
# HD9 — Chữ ký số (CKS): lô mua, bán, khách, gia hạn, giá mua–bán

## 1. Phạm vi
**Làm**
| Mã | Nội dung | Nguồn mgmt-app |
|---|---|---|
| HD-FR-91 | Lô mua từ CA: tạo HĐ mua (`LO-<nhãn>`, 1 dòng hàng), tồn kho = `qty` − chữ ký đã xuất (không tính chữ ký gia hạn) | `cks/lots.py`, `routes/cks.py:51-67` |
| HD-FR-92 | Bán chữ ký: HĐ bán `CKS-YYYY-NNN` + khách (tạo theo MST/tên) + mỗi người giữ một chữ ký lấy từ lô; chặn quá tồn, serial trùng, hết hạn ≤ ngày ký; thêm chữ ký khách tự mua (`elsewhere`) | `cks/sales.py:42-84`, `routes/cks.py:70-126` |
| HD-FR-93 | Tổng quan 4 số + danh sách khách gom theo HĐ bán (lọc sắp/đã hết hạn, tự mua, lô, CA) + một khách | `cks/overview.py` |
| HD-FR-94 | Gia hạn cả nhóm (HĐ gia hạn, chữ ký `pending_renewal`), hoàn tất bằng serial mới (chữ ký mới `replaces` cũ), mất khách (`lost`, HĐ gia hạn `terminated/not_renewed`) | `cks/sales.py:87-165`, `routes/cks.py:180-243` |
| HD-FR-95 | Văn bản đã ký: tải XML (hoá đơn TT78, tờ khai HTKK) / PDF ký số, đọc serial chứng thư, gắn với chữ ký theo serial (cả chuỗi gia hạn); liệt kê theo khách/chữ ký/loại | `signed/{parse,store}.py`, `routes/signed_docs.py` |
| HD-FR-96 | Giá CKS mua–bán theo gói (CA · năm · thiết bị): giá mua (lô mới nhất), giá bán (bán gần nhất 12 tháng), lãi, biên lãi, giá đại lý khác (bảng giá thị trường của tenant), cờ `cheapest_buy`/`above_market`, thống kê 12 tháng | `prices/cks.py:23-95` |
| HD-FR-97 | Màn S08 (tab Giá CKS ở `/prices`), S10 `/cks`, S11 `/cks/$id` + 3 hộp thoại — port nguyên giao diện (D-02), so 3 lớp với mgmt-app | `CksPricesTab.tsx:57-197`, `CksPage.tsx:26-187`, `CksCustomerPage.tsx:17-196`, `dialogs.tsx:41-153` |

**Không làm** (chủ khác, ghi ở §4): công nợ/đã thanh toán của HĐ (HD7 — `paid` luôn `false`), gửi nhắc đúng giờ (HD4 — HD9 chỉ ghi lịch nhắc), sự kiện uy tín khách (HD8 — dữ liệu suy ra được từ chữ ký `replaced` + `done_at`), bảng giá rẻ nhất thị trường S09 + nút "Kiểm tra thị trường" mở S09 (HD8), AI "Dò giá" (cần cầu run agent N2 như D2-01), nhập CKS từ Excel qua trợ lý (HD6), xoá/thu hồi chữ ký và xoá văn bản đã ký (không có nút trên S10/S11), tóm tắt trợ lý `digest.py` (HD6).

## 2. Hành vi và luật
| # | Luật |
|---|---|
| BR-1 | Tiền là số nguyên **đồng** (`bigint`), 0 ≤ đơn giá ≤ 10¹⁰; tổng ≤ 10¹⁵ (< 2⁵³). Không float ở DB/API cho số tiền; `margin_pct` là tỉ lệ hiển thị (làm tròn half-even như Python `round`) |
| BR-2 | Mọi lần đặt giá (`unit_cost` lô, `price_each` bán, `price_each` gia hạn, giá chữ ký mới khi hoàn tất) ghi một dòng `cks_price_audit` (ai, lúc, thực thể, cũ → mới) **cùng tx**; bảng chỉ thêm (REVOKE UPDATE/DELETE) |
| BR-3 | Quyền gói N1: `read` (viewer) mọi GET; `write` (editor, owner) mọi POST. Guard trước đọc thân (viewer ⇒ 403 `PACK_FORBIDDEN`, 0 SQL) |
| BR-4 | Tenant từ token; id của tenant khác ⇒ 404 như không có; mọi SQL qua `PackUow` (RLS) + lọc `tenant_id` tường minh |
| BR-5 | Chữ ký "còn hiệu lực" = `active` ∨ `pending_renewal`; `replaced`/`revoked` không tính |
| BR-6 | Hôm nay = ngày theo múi giờ tenant (`ConfigCache.tenant().timezone`, mặc định Asia/Ho_Chi_Minh); `days_left = valid_to − hôm nay` |
| BR-7 | Serial so theo khoá chuẩn hoá (chỉ hex, hoa, bỏ 0 đầu — `norm_serial`); duy nhất trong tenant ⇒ 409 `CKS_SERIAL_TAKEN` |
| BR-8 | Một nhóm (HĐ bán) chỉ một lượt gia hạn `open` (index duy nhất từng phần) ⇒ 409 `CKS_RENEWAL_OPEN`; hạn mới = max(hôm nay, hạn sớm nhất nhóm) + `years` năm (tháng 2 ⇒ ngày ≤ 28) |
| BR-9 | Văn bản đã ký: tối đa 50 tệp × 20 MB/lần, chỉ `.xml`/`.pdf`; cùng (sha256, serial) ⇒ `skipped`; serial lạ ⇒ lưu `unmatched` (không gắn khách); không đọc được ⇒ `unreadable`. Chỉ đọc chứng thư, không kiểm chữ ký mật mã (như mgmt-app) |

## 3. Tiêu chí chấp nhận
| AC | Nội dung | FR |
|---|---|---|
| HD9-AC01 | Tạo lô 5 × 1.100.000 ⇒ HĐ mua `LO-2026-03` (active, purchase, 1 dòng hàng), lô `in_stock 5`; audit `lot.unit_cost null→1100000` | 91 |
| HD9-AC02 | Bán 3 người giữ × 1.650.000 ⇒ HĐ `CKS-<năm>-001`, khách mới, 3 chữ ký `active`; tồn 2; bán quá tồn ⇒ 409 `CKS_STOCK`; serial đã có ⇒ 409 `CKS_SERIAL_TAKEN`; `valid_to ≤ signed_at` ⇒ 422; lô tenant khác ⇒ 404 | 92 |
| HD9-AC03 | Bộ dữ liệu `test_cks.py` ⇒ overview `{5, 3, 4, 1, 1}`; lô `sold 4, customers 2, in_stock 1, margin 2.150.000`; Bếp Việt `cert_count 3, group_count 1, ca Viettel-CA, days_left 9, sale_price 4.950.000`; lọc `expired`/`elsewhere`/`ca` như mgmt | 93 |
| HD9-AC04 | Gia hạn ⇒ `renewal.status open`, lần 2 ⇒ 409; hoàn tất 1 serial ⇒ khách vẫn 3 chữ ký, `days_left > 300`, có `NEW-1`, overview vẫn 5; mất khách ⇒ chữ ký về `active`, HĐ gia hạn `terminated` + `handled.outcome not_renewed` | 94 |
| HD9-AC05 | Tải XML hoá đơn ký bởi serial của khách ⇒ `added 1`, `signed_count` chữ ký +1; tải lại ⇒ `skipped`; serial lạ ⇒ `unmatched`; tệp rác ⇒ `unreadable`; văn bản của chữ ký cũ hiện ở chữ ký mới sau gia hạn | 95 |
| HD9-AC06 | Giá gói: buy = lô mới nhất, sell = bán gần nhất, `margin`, `margin_pct` (half-even), `market {min,max,n,any_device,sources≤6}`, cờ, lọc `1y/multi/token/remote`, stats 12 tháng — khớp `prices/cks.py` | 96 |
| HD9-AC07 | Viewer: mọi GET 200, mọi POST 403; không Group 403; gói tắt 403 `PACK_DISABLED`; tenant beta không thấy khách/lô/văn bản acme (404/rỗng) | 91–96 |
| HD9-AC08 | `defineRlsSuite` phủ 8 bảng mới (đọc/ghi chéo, thăm dò, FORCE RLS, không bảng quên khai) | NFR |
| HD9-AC09 | Perf (2.000 chữ ký / 400 khách / 20 lô / 2.000 văn bản): `customers`, `overview`, `lots`, `prices` p95 ≤ 50 ms, đúng 1 câu SQL nghiệp vụ mỗi request; bán 50 người giữ ≤ 50 ms, số câu cố định (không theo số người giữ) | NFR |
| HD9-AC10 | S08/S10/S11 + 3 hộp thoại: chữ 0 ký tự lệch, khung ±2 px, ảnh ≤ 0,5 % so mgmt-app (lệch có chủ ý ở `DEVIATIONS.md`) | 97 |

## 4. Quyết định
Xem [`spec-decisions.md`](spec-decisions.md) (D9-01…).

## 5. Tranh chấp test
(trống)
