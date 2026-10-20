---
id: M1d-fixes
title: Đóng hẳn A-2 (khoá bên giả được, N-1) + nhắc hạn theo luật thấy (N-4)
cr: CR-095
lane: đầy đủ (RLS/quyền) — test trước code; review gộp cuối đợt
requirements: [M1D-FR-01, HD-FR-33, HD-NFR-02]
---

# M1d · Sửa sau security review (`docs/reviews/cr095-fixes-security.md`, gd0 de9840f7)

## Việc
| # | Mục | Sửa | Trạng thái |
|---|---|---|---|
| 1 | N-1 (a) đổi MST bên trên HĐ đã duyệt | `PARTY_FIELDS` (buyer/supplier name + tax_id) vào nhóm mở lại duyệt như trường tiền (`approval-edit.rules.ts`) | xong |
| 2 | N-1 (b) HĐ dưới ngưỡng tự xác nhận cấp 1 | Migration gói **0019** (0018 của HD8): `visible_party_keys()` chỉ lấy HĐ đã duyệt có `confirmed_by IS DISTINCT FROM created_by`; HĐ bán/mua CKS ghi `confirmed_by` = người tạo (tự duyệt) | xong |
| 3 | N-4 `contract_reminders` | Policy RESTRICTIVE SELECT theo HĐ thấy được (như `contract_items`) | xong |
| 4 | Test abuse | `tests/acceptance/M1-sec/visibility.int.test.ts` (thư mục riêng — `M1d` trùng `M1D` trên Windows) | xong |

## Quyết định
- D-M1d-01 (N-1 b): HĐ do chính người tạo duyệt (`confirmed_by = created_by`) **không** mở đối tác ra ngoài HĐ đó: sự kiện sổ đối tác của
  chính HĐ (`partner_events.contract_id`) và chữ ký CKS của HĐ vẫn thấy. HĐ không ghi người duyệt (dữ liệu cũ, fixture) giữ hành vi M1c.
  **Khác mgmt-app có chủ ý**: `access.View.company` của mgmt-app lấy công ty từ MỌI HĐ thấy được (kể cả nháp) — luật ở đây chặt hơn
  vì đối tác mở ra công nợ/thanh toán trên HĐ người khác.
- D-M1d-02 (N-1 a): mở lại duyệt (D3-13) nay gộp vào CÙNG câu CTE của `save` (chèn lượt `approvals` + gắn `run_id`) — test khoá
  HD-NFR-02 đòi PATCH đúng 4 câu kể cả khi đổi trường bên; trước đây reopen tốn câu thứ 5 (`reopenApproval`, đã bỏ ở repo thật).
- D-M1d-03: chính sách `lock` (409) vẫn áp cho trường bên như trường tiền.
- Lưu ý merge: journal gói đặt `0019` idx 18, `when` 1794182400000 — 0018 (HD8) phải có `when` nhỏ hơn và merge TRƯỚC khi DB nào chạy
  0019 (drizzle bỏ migration có `when` ≤ lần chạy cuối).

## Số đo (evotest)
- int: M1-sec + M1c + M1b + M1D + HD1 + HD3 + HD7 + HD9 + M3 + rls-packs + `apps/hub-api/.../packs/contracts`: **796 pass, 0 fail**.
