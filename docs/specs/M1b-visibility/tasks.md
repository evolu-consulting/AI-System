---
id: M1b-visibility
title: Hoàn tất phòng ban + luật thấy (M1D phần còn mở)
cr: CR-095
lane: đầy đủ cho RLS/quyền (mục 1–3) · nhanh cho màn/e2e/deploy (mục 4) — một agent, review + security gộp cuối đợt
requirements: [M1D-FR-01, M1D-FR-02, M1D-FR-04, M1D-NFR-01]
---

# M1b · Luật thấy: phần còn lại (plan ngắn)

Nguồn luật: mgmt-app `api/app/orgs.py` (`Ctx.sees`: phụ lục chưa giao theo HĐ cha) + `access.py` (đối tác/CKS theo HĐ thấy).
Nền: `docs/specs/M1-departments/tasks.md` (M1D, commit 24b689a3..f26447f0).

## Quyết định (theo phương án đề xuất — người dùng 2026-10-20: "làm như recommend")
- D-M1b-01: **Giữ chế độ theo tenant.** Tenant nhập từ mgmt-app ⇒ `org` (importer I1 đặt). **Tenant mới ⇒ `org`**: admin-api
  `createTenant` ghi `admin.tenants.settings.visibility = 'org'`; gói đọc qua `contracts.org_default_mode()` khi tenant chưa có
  hàng `visibility_settings`. Thứ tự: hàng cài đặt (owner đổi) > `settings.visibility` > `tenant`. Fixture test và seed dev chèn
  tenant thẳng bằng SQL (`settings {}`) ⇒ vẫn `tenant` ⇒ không đổi khẳng định khoá nào. N5 (identity-import) KHÔNG ghi
  `settings.visibility` (test khoá N5 so nguyên `settings`) — để I1 đặt.
- D-M1b-02: Phụ lục chưa giao theo HĐ cha bằng cột khử chuẩn `contracts.visibility_owner_id` (= người phụ trách HĐ cha) do trigger
  giữ — policy chỉ đọc cột của hàng ⇒ không đệ quy. BEFORE INSERT/UPDATE tính lại từ HĐ cha **dưới RLS của người ghi** (không thấy
  HĐ cha ⇒ null: không lộ người phụ trách, không tự đặt được cột). AFTER đổi `owner_user_id` của HĐ ⇒ lan xuống phụ lục, chạy như
  việc nền (`app.user_id` rỗng trong trigger rồi trả lại; policy tenant vẫn áp). Không dùng SECURITY DEFINER trên bảng FORCE RLS
  (role chủ migration không phải superuser ở production ⇒ không thấy hàng). Giới hạn: HĐ cha cũng chưa giao ⇒ phụ lục chỉ theo
  người tạo của chính nó (mgmt-app đệ quy tiếp tới người tạo HĐ cha) — hiếm, chỉ ở dữ liệu nhập.
- D-M1b-03: Đối tác theo người: `contracts.visible_party_keys()` (INVOKER, một mảng mỗi câu) = khoá bên (`party_key`) bên mua + bên
  bán của mọi HĐ người gọi thấy. `cks_customers` thấy khi khoá bên ∈ mảng, hoặc do mình tạo (cột mới `created_by` mặc định
  `app.user_id` — INSERT…RETURNING của câu CKS), hoặc có chữ ký số mình thấy. `partner_events` thấy khi khoá bên ∈ mảng, sự kiện của
  HĐ mình thấy, hoặc `by_user` = mình. Chữ ký số "không HĐ bán + khách thấy" (access.cert) **không** thêm: policy CKS ↔ khách sẽ
  đệ quy; chữ ký vẫn theo HĐ bán hoặc người tạo (M1D D-M1-05).
- D-M1b-04: N5 nhập `manager_email` (tuỳ chọn) sau pha user: lô theo tenant (tổng cặp ≤ `batch`, không tách tenant), mỗi lô 1 câu đọc
  user + quản lý, 1 câu chèn `on conflict (user_id) do nothing`. Domain chặn vòng (kể cả tự quản lý) theo thứ tự file trước khi ghi
  (trigger DB không thấy closure của hàng trước trong cùng câu); user đã có quản lý ⇒ không đè (L2). Lỗi: `MANAGER_CYCLE`,
  `MANAGER_UNKNOWN` (kind `manager`); báo cáo thêm `managers {read, set, existing, errors}`; audit `update/user` mỗi user được đặt.
- D-M1b-05: e2e `/settings/members` chạy trên stack cw (build + mock `page.route`, như các spec cw khác) — giả lập luật thấy giống RLS;
  luật thật đã có test RLS int (`tests/acceptance/M1b`, `M1D`).

## Việc
| # | Việc | Làn | Trạng thái |
|---|---|---|---|
| 1 | Migration gói 0010: `visibility_owner_id` + trigger, policy HĐ; `org_default_mode`/`visibility_mode`; policy khách CKS + sổ đối tác | đầy đủ | xong |
| 2 | admin-api tạo tenant ⇒ `settings.visibility=org`; hub-api GET `/visibility` trả chế độ hiệu lực | đầy đủ | xong |
| 3 | N5 nhập `manager_email` (lô, chặn vòng) + unit `managers.rules.test.ts` | đầy đủ | xong |
| 4 | Test RLS `tests/acceptance/M1b/visibility.int.test.ts` + `org-setup.int.test.ts` (tenant mới = org, nhập quản lý) | đầy đủ | xong |
| 5 | contracts-web: lối vào Cài đặt › Thành viên; e2e `e2e/contracts-web/org-visibility.cw.ts`; proxy `/admin` (deploy.md §10 + `apps/contracts-web/scripts/deploy-proxy.test.ts`); sửa select đọc giá trị sau khi React trả về cũ | nhanh | xong 49798028 |
| 6 | qc khoá: M1D (2 file) + M1b (2 file) + `org-visibility.cw.ts` | — | xong |

## Số đo (evotest)
- int: M1b + M1D + N5 + route visibility + tenants.service + rls-packs: 180 pass, 1 đỏ có sẵn trên nền f26447f0 (xem Còn mở).
- perf M1D (chế độ org, 10.000 HĐ + 60.000 nền, n=200): V p95 11,82 ms · H p95 10,00 · E p95 9,00 · owner p95 11,43 · tenant p95 10,63;
  2 câu SQL; EXPLAIN không Seq Scan (trước M1b: 10,52 / 8,80 / 8,23 / 11,98 / 12,07).

## Còn mở
- `rls-packs.int.test.ts` › `partner_event_voids` › thăm dò tồn tại: đỏ ngay trên nền f26447f0 (ins 42501 vs 22P02) — không do M1b.
- Phụ lục của HĐ cha chưa giao (D-M1b-02); chữ ký số không HĐ bán theo khách (D-M1b-03).
