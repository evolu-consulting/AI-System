# HD7 · Tasks

**Trạng thái 2026-10-19: TẠM DỪNG theo yêu cầu người dùng** (BE + migration + test đã commit; FE, e2e, perf, review chưa làm).

| # | Task | Làn | Trạng thái |
|---|---|---|---|
| T1 | Spec + plan + readiness (1 vòng, áp 13 mặc định) | đầy đủ | xong |
| T2 | Test trước: luật tiền thuần (`ledger.rules.test.ts`, 14 xanh), int tiền/quyền/quá hạn/CKS, RLS 3 bảng, perf | đầy đủ | xong (viết) |
| T3 | Migration 0008 + trigger lịch mặc định + `party_key` | đầy đủ | xong (áp sạch dev DB) |
| T4 | BE: domain, repo, use case, route, vòng quá hạn, mount | đầy đủ | xong |
| T5 | CKS: lập đợt + `paid` thật (thay D9-08) | đầy đủ | xong (`cks-paid.int` xanh) |
| T6 | FE: `features/ledger` (ContractLog + PartnerLog) + i18n `ledger.{vi,en}.json` + unit | nhanh | chưa làm |
| T7 | e2e hành vi + so màn S05/S06b với mgmt-app (baseline `CW_MODE=ref`) | nhanh | chưa làm |
| T8 | Cổng lát: perf (`ledger.perf.int`), e2e, review + security | — | chưa làm |

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
