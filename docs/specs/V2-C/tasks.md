---
id: V2-C
title: Đối tác nhiều vai + ghi chú (backend/API)
cr: CR-096
lane: đầy đủ (bảng mới RLS) — test RLS viết trước code
ba: so-hop-tac-ba-v2.pdf §2 "Đối tác và vai trò", 3.1 HD-10, 3.2 DT-05, 5.6 · intake KN-08, HD-10, 5.6b/c/d, DT-05, C11
---
# V2-C (plan ngắn)

| Việc | Làn | Trạng thái |
|---|---|---|
| Test int RLS/M1 + khớp đối tác + ghi chú + gợi ý (`tests/acceptance/V2-C/partner-roles.int.test.ts`) — viết trước | đầy đủ | [x] |
| Migration `0024_v2c_partner_roles.sql`: `partner_roles`, `partner_notes`, policy M1, trigger khớp đối tác, backfill | đầy đủ | [x] |
| API `GET /partners/roles`, `GET /partners/lookup`, `GET/POST /partners/notes`, `DELETE /partners/notes/:id` + unit luật | đầy đủ | [x] |

**Dữ liệu.** `partner_roles (tenant, party_key, role ∈ supplier|customer|commission_payer, name, created_from, contract_id, created_by,
first_at)` khoá duy nhất (tenant, party_key, role); chỉ thêm (REVOKE UPDATE/DELETE). `partner_notes (party_key, body ≤ 2000, source
manual|internet, created_by, created_at)`; không sửa, xoá được.

**RLS (như `companies` 0019).** SELECT: `sees_all()` ∨ do mình tạo ∨ `party_key ∈ visible_party_keys()`. INSERT: tác giả = người phiên
(không giả `created_by`); ghi chú còn phải là đối tác mình thấy. DELETE ghi chú: hàng mình thấy; route thêm: người viết hoặc `admin`.

**Khớp đối tác (5.6).** Trigger câu lệnh (bảng chuyển tiếp, một INSERT mỗi câu — Luật 4c) trên `contracts.contracts`: HĐ `kind=contract` ở
trạng thái đã xác nhận (tập HD4/HD7) ⇒ thêm vai còn thiếu (`ON CONFLICT DO NOTHING`); UPDATE chỉ xét hàng đổi `fields`/`direction` hoặc
vừa vào trạng thái xác nhận (HD-09 đổi tên đối tác ⇒ tạo). Hàm dùng chung `contracts.partner_role_of(contracts)`.

**Gợi ý (HD-10).** `GET /partners/lookup?name&tax_id&deal=buy|sell|referral` ⇒ `existing` (party, tên, MST, vai, `has_role`, `is_new`,
điểm HD8) hoặc `{status:new, label:"Đối tác mới · sẽ tạo khi lưu"}`. Đối tác ngoài phạm vi M1 ⇒ `new` (không lộ).

## Quyết định trong lúc làm
- C11: khoá = `party_key` (MST hoặc fold tên) ⊇ BA "khớp tên không phân biệt hoa thường". Vai **không** tạo hàng `companies` (giữ test
  khoá HD8 "thêm công ty đã có ⇒ 409"); "đối tác có sẵn" = có vai hoặc có trong danh bạ.
- Không có MST khi gõ ⇒ thêm khớp theo tên đã fold (vai, tên/tên ngắn danh bạ), trả `tax_id` để form điền MST (khoá khi lưu khớp).
- Loại HĐ = cột `deal` của V2-A (0022), null ⇒ suy từ `direction`. Bên đối tác theo `direction` như lịch HD7: Giới thiệu có
  `direction = sale` (V2-A) ⇒ bên trả HH = `buyer_*`.
- "Tạo khi lưu" = HĐ vào trạng thái đã xác nhận (như `visible_party_keys()`); HĐ nháp/trích AI chưa lưu không tạo đối tác.
- MỚI (5.6d): số việc = `partner_events` của vai, bỏ việc huỷ + `rating`/`manual_adjust`; tối thiểu = `score_configs.rules.min_events`
  của vai, chưa có ⇒ 3. Bên trả HH chưa có sổ việc ⇒ MỚI tới V2-E.
- Bỏ nhóm SP khỏi `partner_roles` (intake C11 có ghi): điểm theo nhóm suy từ việc/SP ở V2-E, vai không cần.
- Xoá ghi chú: người viết, hoặc quản lý (`admin`); ghi chú người khác ⇒ 403, ngoài phạm vi ⇒ 404.
- Journal `when` = 1795100000000 (chừa chỗ 0022/0023 của V2-A/B, phải nhỏ hơn số này).

## Test (evotest, `-Dirty`)
- `tests/acceptance/V2-C` 4/4 · cùng HD7 + HD8: 60 pass · HD1/HD3/HD9/I1/M1D/NITI (ghi HĐ, chịu trigger mới): 242 pass.
- Sau rebase lên gd0 733fa52b (V2-A): V2-C 5/5 (thêm test Giới thiệu ⇒ bên trả HH) · V2-C+V2-A+HD1/7/8/9+I1+M1D: 283 pass.
- Unit `domain/partner-roles.rules.test.ts` 4/4.

## Việc còn lại
- Journal: 0024 có `idx` 23, `when` 1795100000000; 0023 của V2-B cần `when` trong (1794886400000, 1795100000000) — drizzle chỉ so
  `when` (idx trong journal vốn đã lặp/không liên tục).
- V2-E: `partner_events.role` thêm `commission_payer`; điểm vai bên trả HH trong lookup. V2-F/V2-I: UI ô gợi ý + tab ghi chú.
