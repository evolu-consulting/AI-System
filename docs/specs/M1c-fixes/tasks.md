---
id: M1c-fixes
title: Sửa luật thấy theo review CR-095 đợt A (A-1, A-2 + Thấp của M1/M1b)
cr: CR-095
lane: đầy đủ (RLS/quyền) — một agent; review gộp cuối đợt
requirements: [M1D-FR-01, M1D-FR-02, M1D-FR-04]
---

# M1c · Sửa sau review A (`docs/reviews/cr095-wave-A.md`)

## Việc
| # | Mục review | Sửa | Trạng thái |
|---|---|---|---|
| 1 | A-1 Trung `GET /cks/signed-docs` không theo luật thấy | Policy RESTRICTIVE `cks_signed_docs_visible` (khách / chữ ký thấy được, hoặc do mình tải); câu repo thêm điều kiện khách thấy được **trong cùng câu** (HD9-AC09 khoá "1 câu nghiệp vụ"; tenant khác vẫn `[]` như HD9 khoá, không 404). Rà bảng con: thêm `cks_followups_visible` (của mình / khách / gia hạn thấy), `partner_event_voids_visible` (sự kiện thấy / do mình huỷ) | xong |
| 2 | A-2 Trung khoá bên giả | `visible_party_keys()` chỉ lấy từ HĐ **đã duyệt** (`active/expiring/expired/renewed/terminated` ≡ `approvals.done`) | xong |
| 3 | A-8 Thấp lan phụ lục xoá `app.user_id` | Cờ riêng `app.vis_cascade`, chỉ policy `contracts_visible` nhận | xong |
| 4 | A-9 Thấp editor ghi được `visibility_settings` ở DB | Policy RESTRICTIVE INSERT/UPDATE: `org_is_owner()` hoặc việc nền (`app.user_id` rỗng) | xong |
| 5 | A-10 Thấp audit không có giá trị cũ | `setManager`/`setDepartment` đọc giá trị cũ cùng tx (khoá hàng) ⇒ `summary.before` | xong |
| 6 | A-13 Thấp `manager_email` không kiểm định dạng | Bỏ dòng user email sai; `manager_email` sai ⇒ `MANAGER_UNKNOWN` | xong |
| 7 | A-12 Thấp N5 không ghi `settings.visibility` | **Không sửa — Tranh chấp test**: `tests/acceptance/N5/import.int.test.ts:68` (khoá) so nguyên `settings` = `{mgmt_source, mgmt_org_id}`. I1 ghi `visibility_settings` cho tenant nhập. Cần qc/người dùng duyệt relock nếu muốn N5 tự ghi. | chờ |
| 8 | A-14 Thấp đặt quản lý cho user có sẵn | Quyết định giữ: chỉ đặt khi user **chưa** có quản lý (không đè — L2); user có sẵn cùng tenant là đúng ý mgmt-app | ghi nhận |
| 9 | A-11 Thấp `hub_ro USING (true)` | Giữ theo review (khớp mẫu `users_hub_ro`) | ghi nhận |

## Quyết định
- D-M1c-01 (A-2): "đã duyệt **hoặc** đã giao" bị loại vế "đã giao": upload gán người phụ trách = người tải ⇒ HĐ nháp tự giao vẫn giả được khoá
  bên. Chỉ HĐ đã duyệt (duyệt cấp 2 do người khác người bắt đầu — 0011) mới mở đối tác. HĐ nhập từ mgmt-app mang trạng thái sau duyệt.
- D-M1c-02 (A-1): văn bản do chính mình tải lên cho khách mình không thấy bị ẩn ở `GET /signed-docs` (điều kiện khách trong câu) —
  chặt hơn policy, đúng khuyến nghị review.
- D-M1c-03 (A-9): test route `visibility.routes.int.test.ts` (không khoá) thêm owner vào Group `contracts-owner` ở DB — packGuard và
  `org_is_owner()` cùng nguồn ở production.

## Số đo (evotest)
- int: M1c + M1b + M1D + HD7 + HD9 + N5 + rls-packs + org.service + route visibility: **287 pass, 0 fail**.
- perf M1D (org): 6/6 đạt, 2 câu, không Seq Scan. HD9: `prices` p95 53,6–53,9 ms đỏ **cả trên nền 0c278eb3** (54,4 ms, không chạm);
  `customers` / `customers expiring` dao động 47,8–54,0 ms (nền 48,6 / 47,5) — liveCerts đếm `cks_signed_docs` nay qua policy mới
  (chế độ tenant dừng ở InitPlan `sees_all()`), chênh nằm trong độ nhiễu máy chung; theo dõi ở lát perf HD9.
