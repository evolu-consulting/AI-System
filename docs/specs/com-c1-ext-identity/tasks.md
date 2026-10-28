---
id: com-c1-ext-identity
cr: CR-102a
fr: [ADM-FR-74, ADM-FR-75]
lane: Đầy đủ (auth/tenant/identity) — UI admin-web làn nhanh
migration: admin 0028 (`0028_external_identity`, journal when 1798700000000)
source: docs/intake/community/2026-10-28-intake.md (R2, R3, R9, R12, R13, M2, CR-102a, C1, câu 2/3/9)
---
# C1 · Danh tính đối tác (user ngoài)

## Plan (≤ 1 trang)
| # | Việc | Làn | Trạng thái |
|---|---|---|---|
| 1 | Test trước: `packages/db/src/external-orgs.int.test.ts` (CHECK/FK kép/trigger/RLS), `admin-api/.../external-orgs.int.test.ts` (quyền, group 422, role 422, vô hiệu, JWT, /me, token cũ) | Đầy đủ | x |
| 2 | Migration 0028: `admin.external_orgs` (RLS như bảng tenant, hub_ro đọc, không DELETE), `users.kind/external_org_id/deactivated_at` + CHECK + FK kép + trigger bất biến + trigger chặn group | Đầy đủ | x |
| 3 | Auth: claim `kind:"external"` + `xorg` CHỈ ở user ngoài; thiếu ⇒ internal; claim hỏng ⇒ 401; admin middleware so claim với DB; `/auth/me` `kind`, `ext_org_id` | Đầy đủ | x |
| 4 | Hub: `AuthUser`/`PackWho` `userKind`/`extOrgId`; cổng `ExternalOrgResolver` (`packs/kit/application/ext-org.ports.ts`) + adapter PG (`packs/kit/adapters/ext-org.pg.ts`) | Đầy đủ | x |
| 5 | admin-api `/admin/external-orgs*` (list/tạo/đổi tên/vô hiệu công ty; list/tạo/vô hiệu user); khoá/mở/reset dùng `/admin/users/:id/*`; group add user ngoài ⇒ 422; PATCH role user ngoài ⇒ 422 | Đầy đủ | x |
| 6 | admin-web "Đối tác" + badge "Đối tác" ở Users, ẩn đổi role cho user ngoài; i18n vi/en; e2e `e2e/partners.spec.ts` (viết, chưa chạy) | Nhanh | x |

## Quyết định trong lúc làm
- Token nhỏ: user nội bộ KHÔNG thêm claim (byte-identical với token cũ); user ngoài thêm `kind`,`xorg` (~60 B). Token cũ (trước 0028) không claim ⇒ internal — an toàn vì trước 0028 không có user ngoài và `kind`/`external_org_id` bất biến (trigger `users_kind_fixed`) ⇒ claim không cũ đi; refresh luôn đọc lại DB nên token mới mang claim đúng.
- admin-api đọc `kind` từ DB mỗi request (như role) và 401 nếu claim lệch DB; Hub đọc từ claim (Hub không đọc DB mỗi request) — chữ ký EdDSA + bất biến DB đủ tin.
- Tên trường `userKind` (không `kind`) trên `AuthUser`/`PackWho`/`Actor`: nhiều chỗ trải `{ kind: "user", ...u }` vào scope DB ⇒ `kind` sẽ ghi đè discriminant.
- Cổng `ExternalOrgResolver` đặt ở `packs/kit` (cổng công khai cho gói, đúng `pack-boundary.md`), chưa nối vào `packs.mount.ts` (chưa gói nào dùng — C3 tiêm).
- Mã lỗi riêng `EXTERNAL_ORG_ERRORS` (422 `EXTERNAL_USER_NOT_ALLOWED`, 409 `EXTERNAL_ORG_INACTIVE`, 409 `USER_DEACTIVATED`) — không thêm vào `API_ERRORS` (test khoá đếm 46).
- "Vô hiệu" user (câu 9) = cột `deactivated_at` + `active=false` + thu hồi phiên; không mở khoá lại. Vô hiệu công ty ⇒ vô hiệu mọi user của nó (theo tập: 1 câu UPDATE + 1 câu thu hồi), không hoàn tác ở C1. Không DELETE (REVOKE DELETE + FK restrict).
- Audit: user ngoài = thực thể `user` như user thường; công ty = thực thể `tenant` + `summary.external_org` (AUDIT_ENTITIES khoá 12 giá trị).
- Group: chặn 2 lớp — API 422 trước khi chèn (cả lô, kể cả dry_run) + trigger `group_members_internal_only`.
- `users.service.ts` chạm 400 dòng ⇒ tách `users.dto.ts` (toUser/userAudit/mapUserConflict, re-export giữ điểm gọi cũ).

## Delta so với docs/current
Trạng thái gộp: đã gộp 2026-10-28 (đợt Community)
- Mới: bảng `admin.external_orgs`; cột `admin.users.kind`, `external_org_id`, `deactivated_at`; route `/admin/external-orgs*`; field `kind`, `ext_org_id` ở `/auth/me`; `kind`, `external_org_id`, `deactivated_at` ở DTO User; query `?kind=`, `?external_org_id=` ở `/admin/users`; menu admin-web "Đối tác".
- Đổi: `POST /admin/groups/:id/members` từ chối user ngoài (422); `PATCH /admin/users/:id` role ≠ member cho user ngoài (422); `unlock` user đã vô hiệu (409).

## Việc còn lại (C2 và sau)
- C2: chặn user ngoài ở pack guard / chat-gate / agent grants `tenant` / `/directory` / kit members-pickers / portal app-catalog / admin-web (chỉ /me + đổi mật khẩu) / RLS contracts phòng thủ. Hiện user ngoài = member ⇒ vẫn thấy những gì member không-Group thấy (tenant-wide grants, directory, Chat nếu tenant bật) — chưa tệ hơn, nhưng PHẢI làm C2 trước khi tạo user ngoài thật.
- C2: `user_managers`/`departments.head_user_id` chưa chặn user ngoài; import identity/mgmt có thể chạm trigger group (500 thay vì lỗi rõ).
- Mở lại công ty đã vô hiệu (chưa có), tự quản lý thành viên đối tác (GĐ2, câu 3).
- e2e `e2e/partners.spec.ts` chạy một lần cuối đợt; `routeTree.gen.ts` sửa tay — build rsbuild sẽ sinh lại.

- Giữ file ≤ 400 dòng: tách `schema/tenant-workflow-tools.ts` (cơ học, thêm vào drizzle.config) và `users.external.ts`; `externalOrgs` ở `schema/external-orgs.ts` (không vào drizzle-kit, như bảng custom khác).
