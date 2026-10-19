# HD7 · Tasks

**Trạng thái 2026-10-20: làm tiếp trong lát HD78** (nhánh `slice/hd78`, gộp HD8 — xem `docs/specs/HD8-partners/tasks.md`).
4 đỏ đã sửa (dưới); FE T6, e2e T7, perf T8 làm trong HD78; review + security gộp cuối đợt (Luật 0b).

## HD78 (2026-10-20)
- 4 đỏ: (1) AC02 — `remind` gửi `{to}` mà thân strict ⇒ 400 trước kiểm 409; test gửi `{}` (mgmt `remind` không có thân); không phải lỗi
  ngày. (2) AC04 — mgmt không đếm sự kiện; đúng là 4 dòng (hẹn lại, nhắc, thu, thu lại), test sửa 5 → 4. (3) `access.int` 42501 — bắt
  quanh `inPack`. (4) RLS `partner_event_voids` — thăm dò NIL là uuid vào cột bigint ⇒ 22P02; probe dùng số cho NIL. DB mẫu test tự dựng
  lại khi hash migration lệch (`test-db-template`), evotest dựng DB sạch mỗi lượt ⇒ PK `(event_id, tenant_id)` của 0008 đã áp; xanh 163/163.
- Luật thấy M1 (đã có ở base): sự kiện gắn HĐ người dùng không thấy ⇒ không liệt kê, huỷ ⇒ 404 (D8-13); `by_name` = tên người ghi.
- FE `features/ledger` (ContractLog + PartnerLog + InstalmentRow + OtherForm), i18n `ledger.{vi,en}.json`; các "panel" lịch thanh toán /
  đợt (obligations) / sổ đối tác / quá hạn = các khối của PartnerLog (mgmt không có màn "Thanh toán" riêng, giữ D7-08).

| # | Task | Làn | Trạng thái |
|---|---|---|---|
| T1 | Spec + plan + readiness (1 vòng, áp 13 mặc định) | đầy đủ | xong |
| T2 | Test trước: luật tiền thuần (`ledger.rules.test.ts`, 14 xanh), int tiền/quyền/quá hạn/CKS, RLS 3 bảng, perf | đầy đủ | xong (viết) |
| T3 | Migration 0008 + trigger lịch mặc định + `party_key` | đầy đủ | xong (áp sạch dev DB) |
| T4 | BE: domain, repo, use case, route, vòng quá hạn, mount | đầy đủ | xong |
| T5 | CKS: lập đợt + `paid` thật (thay D9-08) | đầy đủ | xong (`cks-paid.int` xanh) |
| T6 | FE: `features/ledger` (ContractLog + PartnerLog) + i18n `ledger.{vi,en}.json` + unit | nhanh | xong (HD78) |
| T7 | e2e hành vi + so màn S05/S06b với mgmt-app (baseline `CW_MODE=ref`) — `e2e/contracts-web/hd78-partners.cw.ts` | nhanh | xong (HD78) |
| T8 | Cổng lát: perf (`ledger.perf.int`), e2e; review + security gộp cuối đợt | — | xem HD8 tasks "Kết quả" |

## Kết quả lần chạy cuối (`test:int:par` HD7 + RLS): 154 xanh, 4 đỏ
1. `money.int` AC02 "hẹn lại … trả đúng 10-20 ⇒ 0 ngày" và AC04 "huỷ việc" (đếm sự kiện 4 ≠ 5): chưa chẩn đoán. Nghi do sắp sổ theo
   (`at`, `id`) khi ngày ghi = hôm nay thật (múi VN đã sang 10-20) ⇒ thứ tự `at(-1)` khác giả định; kiểm lại test hoặc `events` sắp.
2. `access.int` "sổ chỉ thêm (42501)": lỗi quyền đúng là 42501 nhưng ném ra ngoài `inPack` (try/catch trong `fn` không bắt) —
   sửa harness test (bắt quanh `inPack`), không phải code.
3. RLS `partner_event_voids` "thăm dò tồn tại": đã sửa PK thành `(event_id, tenant_id)` trong 0008 + `ON CONFLICT (event_id, tenant_id)`,
   nhưng DB dev/mẫu test đã áp bản 0008 cũ (drizzle không áp lại) ⇒ cần dựng lại DB mẫu test rồi chạy lại để xác nhận.

## Việc còn lại
T6–T8 ở trên; 4 đỏ ở trên; số đo perf (chưa chạy `bun run test:perf`); nợ: AI đọc điều khoản (N2), hẹn nhắc giờ `followups` (N3),
điểm uy tín + `/partners` (HD8), trang "Thanh toán" (reference web không có).
Thứ tự journal: `0008` có `when` 1793232000000 > `0007_hd4_lock_order` (1793145600000, HD4 chưa commit) — HD4 phải commit 0007 trước khi
0008 tới DB dùng chung, nếu không drizzle sẽ bỏ qua 0007 ở DB đã áp 0008.
