# com-c2-ext-deny — Chặn user ngoài ở mọi bề mặt (CR-102a)

Đọc: `docs/current/community/nghiep-vu.md` §13, `hien-thi.md` HT-76, HT-78; ADR-0031 (port chỉ nội bộ).
| Lát | Làn | Model | Migration | Phụ thuộc |
|---|---|---|---|---|
| C2 | **Đầy đủ** (quyền/auth; security review riêng) | Opus | admin **0029** (`when` 1798750000000), contracts **0067** (`when` 1800050000000) | C1 |

## Phạm vi
Từ chối mặc định `kind=external` ở: pack guard (chỉ gói trong `EXTERNAL_PACKS={community}`, bỏ qua Group) · `chat-gate` (không Chat App) · agent grants `subject_type='tenant'` (hub 0018) + agent mặc định/dự phòng · `/directory` (`directory.repo.ts`) · kit `members.route`/`member-names`/pickers · portal app-catalog + `default_app` · admin-web/admin-api (chỉ `/me`, đổi mật khẩu) · RLS `contracts` phòng thủ (`kind=external` ⇒ 0 hàng) · quota/usage tính tenant chủ quản (ghi nhận, không chặn). Không mở lại module đóng băng.
Thêm (review bảo mật C1): TB-1 trigger `user_managers` (cả 2 cột) + `departments.head_user_id`, 422 ở org.service; SSO chỉ Community; cổng trung tâm admin-api; TB-2 audit từng user khi vô hiệu công ty; Thấp-3 tenant `platform` ⇒ 422; mở lại công ty (API + nút admin-web).

## Plan
| # | Việc | Trạng thái |
|---|---|---|
| 1 | Test trước: `hub-api/.../kit/adapters/external-deny.int.test.ts` (ma trận bề mặt hub + RLS contracts), `admin-api/.../external-orgs/external-deny.int.test.ts` (cổng admin, catalog/SSO, TB-1 API+DB, TB-2, mở lại, platform); unit `external-access.test.ts`, `agent-access.external.test.ts`, `lib/external-guard.test.ts` | x |
| 2 | hub-api: tường lửa `externalFirewall` sau `requireAuth` trên mọi `PROTECTED_PREFIXES`; `packAccessInput` bỏ Group của đối tác; chat-gate; `visibleAgents`/`defaultRoute`; `/directory`, `/members`, `memberNames`, `packAssignees` lọc `kind='internal'` | x |
| 3 | DB: admin 0029 (trigger `user_managers_internal_only`, `departments_head_internal_only`); contracts 0067 (policy RESTRICTIVE `ext_deny` mọi bảng RLS); `withPackScope` đặt `app.user_kind` | x |
| 4 | admin-api: `requireAuth` + `externalRouteAllowed`; catalog `EXTERNAL_APPS`; onError 23514 `*_internal_ck` ⇒ 422; org.service 422; `reactivateOrg`; audit từng user; platform 422 | x |
| 5 | admin-web: menu "Mở lại" công ty đã vô hiệu + i18n vi/en | x |

## Quyết định trong lúc làm
- **Hai lớp ở hub-api:** (1) tường lửa đường dẫn `externalFirewall` (kit adapter, luật `externalPathAllowed` ở `kit/domain/external-access.rules.ts`) đặt ngay sau `requireAuth` trên MỌI gốc route cần JWT ⇒ route mới thêm sau này tự bị chặn; đối tác chỉ qua `/pack/<k ∈ EXTERNAL_PACKS>` + `/notifications` (chuông của chính mình). (2) Từng bề mặt vẫn tự chặn (packGuard, chat-gate, agent, danh bạ) để gọi service trực tiếp / bỏ sót tường lửa không lộ. Mã lỗi `FORBIDDEN` 403 (có sẵn trong `HUB_ADMIN_ERRORS`, không thêm mã contract).
- **`EXTERNAL_PACKS = { community: [read, write] }`** — dữ liệu (không if theo tên gói). Gói chưa cài ⇒ như chưa bật. Đối tác dùng gói theo **entitlement công ty** (không Group); Group bị bỏ qua kể cả nếu hàng `group_members` lọt vào DB (chủ thể giả `external:partner`). `admin` của gói không bao giờ cho đối tác.
- **Cờ đối tác ở Hub:** claim JWT (`userKind`) HOẶC cache cấu hình (`UserState.external` — `loadUsers` đọc `kind`, cùng câu) — một trong hai là đủ để chặn (fail-closed khi `who` dựng tay thiếu `userKind`).
- **Agent:** `AccessSubject.external` ⇒ `visibleAgents` = [] (bỏ cả grant `tenant`), `defaultRoute` = `forbidden` (không Orchestrator/agent mặc định/dự phòng). 6 nơi dựng `who` truyền cờ.
- **Danh bạ/pickers:** `/directory`, kit `GET /members`, `memberNamesOf`, `packAssignees` chỉ `kind='internal'`; đối tác gọi `/members` ⇒ 403, `memberNamesOf` ⇒ Map rỗng. Nhóm duyệt = Group ⇒ đối tác không bao giờ có (trigger 0028).
- **RLS contracts phòng thủ = GUC `app.user_kind`**, đặt trong `withPackScope` cùng câu `set_config` hiện có, **giá trị lấy từ DB** (`admin.users.kind` theo `app.user_id`, đọc bằng `hub_api` trước khi đổi role) — không tin người gọi, không phụ thuộc `PackWho` có `userKind`. Lý do không dùng hàm SECURITY DEFINER trong migration gói: `check:pack-sql` cấm migration gói tham chiếu schema `admin`. Policy RESTRICTIVE `ext_deny` FOR ALL (USING + WITH CHECK) trên mọi bảng RLS của `contracts` lúc chạy 0067; **bảng contracts mới sau 0067 phải tự thêm `ext_deny`** (nợ nhỏ — C3 có thể đưa vào `packs.secure_table` ở kit 0006). C3 đặt `app.ext_org_id` có thể dùng chung lookup này.
- **admin-api cổng trung tâm** trong `requireAuth` (mọi route dùng nó) + `/auth/me` và `/auth/sso/code` (gọi `authenticate` trực tiếp — nằm trong danh sách cho phép). Danh sách cho phép: GET/PATCH `/auth/me`, POST `/auth/change-password|logout|sso/code`, GET `/(auth/)?me/(apps|portal)`, PUT `/(auth/)?me/default-app`. Còn lại (kể cả góp ý, 2FA, `/me/tenant-default-app`) ⇒ 403 `FORBIDDEN`.
- **Catalog:** `EXTERNAL_APPS = {community}`; đối tác: app phải `audience='all'` + feature theo entitlement công ty; `chatAllowed` = false. `ssoTarget`/`/me/default-app` dùng lại `openableIn` ⇒ tự chỉ Community. **`community` chưa thuộc `WEB_APPS`** (contract) ⇒ hiện đối tác chưa xin được mã SSO nào (400 schema) — thêm `community` vào `WEB_APPS` thuộc C5 (community-web dùng SSO).
- **TB-1:** trigger 0029 là lưới cuối; API dịch `23514 user_managers_internal_ck/departments_head_internal_ck` ⇒ 422 `EXTERNAL_USER_NOT_ALLOWED` (không thêm câu SQL kiểm trước). `app.onError` dịch mọi `*_internal_ck` (cả Group 0028) ⇒ 422 cho đường ghi chưa tự kiểm. Import identity đã bắt 23xxx ⇒ `BATCH_FAILED` theo lô (không 500); mgmt-import là CLI.
- **TB-2:** vô hiệu công ty ⇒ một hàng audit `update`/`user` cho MỖI user bị vô hiệu (`summary.op=deactivate`, `external_org_id`, `cause`) — `UPDATE … RETURNING id, username, version` + các hàng vào MỘT INSERT audit của `configWrite` (theo tập).
- **Mở lại công ty** `POST /admin/external-orgs/:id/reactivate`: chỉ `active=true`; user đã vô hiệu GIỮ vô hiệu (C1: không mở khoá lại) — tạo tài khoản mới. Audit `tenant` + `summary.external_org.op=reactivate`.
- **Thấp-3:** tạo công ty trong tenant `key='platform'` ⇒ 422 `EXTERNAL_USER_NOT_ALLOWED` (user ngoài cần công ty cùng tenant ⇒ chặn luôn user).
- **Thấp-1:** bỏ qua — `AUDIT_ENTITIES` khoá 12 giá trị (test khoá); cần qc relock nếu muốn thực thể `external_org` riêng.
- **Quota/usage:** đối tác nằm trong tenant chủ quản (`tid` = tenant chủ quản) ⇒ mọi bộ đếm theo `tenant_id` tự tính vào chủ quản; GĐ1 đối tác không chạy AI (agent/chat bị chặn). Không đổi code.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-10-28 (đợt Community)
Gộp vào `current/community/nghiep-vu.md` §13 cuối đợt.
- Mới: tường lửa user ngoài hub-api (403 `FORBIDDEN` ngoài `/pack/community*`, `/notifications`); cổng admin-api cho đối tác (chỉ hồ sơ, đổi mật khẩu, đăng xuất, mã SSO, app/portal mình); `POST /admin/external-orgs/:id/reactivate` + nút "Mở lại"; admin 0029 trigger; contracts 0067 policy `ext_deny`; GUC `app.user_kind` trong `withPackScope`.
- Đổi: `/directory`, `GET /pack/<k>/members`, người được giao HĐ không còn liệt kê user ngoài; `GET /me/apps` + `/me/portal` của đối tác chỉ Community, `chat=false`; `PUT /admin/org/managers/:id`, `PUT /admin/org/departments/:id` với user ngoài ⇒ 422; tạo công ty đối tác ở tenant platform ⇒ 422; vô hiệu công ty ghi audit từng user.

## Việc còn lại
- C5: thêm `community` vào `WEB_APPS` (SSO + cookie `ai_rt_community`).
- Bảng contracts mới sau 0067 cần policy `ext_deny` (hoặc đưa vào `packs.secure_table`).
- Security review riêng (làn đầy đủ) trên diff gộp cuối đợt; e2e partners chạy một lần cuối đợt.
- Số migration admin 0029 / contracts 0067 tự chọn (không có trong bảng giao trước) — kiểm trùng khi merge.
