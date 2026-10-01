---
id: M3-permissions
title: Phân quyền (Groups, Grants + ma trận, Kiểm tra quyền, NOTIFY config_changed, chống ghi đè)
milestone: M3
status: draft                # draft → ready → approved → in-progress → done
requirements: [ADM-FR-32, ADM-FR-35, ADM-FR-36, ADM-FR-53, ADM-FR-55, ADM-FR-62, ADM-FR-24, ADM-BR-11, ADM-BR-12, AC-A07, AC-A10, AC-A11, AC-A03]   # ADM-FR-24: chỉ phần group/grant (CR-013); AC-A03: chỉ vế "≤ 5 giây" (CR-011); AC-A10/A11: phía Admin (M3-R19)
design: [docs/ROADMAP.md#M3, docs/design/admin/ba-admin.md#52-tenant--group, docs/design/admin/ba-admin.md#55-feature--phân-quyền, docs/design/admin/ba-admin.md#57-secret-audit-importexport, docs/design/admin/ba-admin.md#6-luật-nghiệp-vụ, docs/design/admin/ba-admin.md#7-mô-hình-dữ-liệu-schema-admin, docs/design/admin/ba-admin.md#8-api, docs/design/admin/ba-admin.md#11-tiêu-chí-nghiệm-thu-các-kịch-bản-chính, docs/design/admin/ui-admin.md#714-groups, docs/design/admin/ui-admin.md#715-phân-quyền, docs/design/admin/ui-admin.md#8-luồng-thao-tác-chính, docs/specs/_design/admin-missing-screens.md#5-users--users--drawer, docs/specs/_design/admin-missing-screens.md#125-xung-đột-409-version_conflict-fr-55-ac-a07, docs/specs/_design/admin-missing-screens.md#14-cần-backend-lead-không-tự-đổi-contract, docs/adr/0001-stack.md, docs/readiness/2026-10-01-admin-m1-m4.md, docs/TECH-DEBT.md#7, docs/TECH-DEBT.md#13, docs/CONVENTIONS.md#8-migration-db, canvas: Groups · Access · Users · States]
owner: backend-lead + frontend-lead
---

# M3 Phân quyền

Mốc: [ROADMAP M3](../../ROADMAP.md). Nền: [M1](../M1-foundation-identity/spec.md) (`withScope` + RLS scope `platform`/`tenant`, `users` có `version`, `VERSION_CONFLICT` theo CR-008, shell/shared web) và [M2](../M2-catalog-command/spec.md) (`features`, `feature_commands`, `feature_entitlements` có `revoked_at`, `commands/:id/access` phần tenant, `RefPicker`, `DependencyList`, `lock-order.int.test.ts`, `testHooks`). Không chép BA; chỉ ghi phần cụ thể hoá. Số hiệu luật `M3-Rnn`; nhãn nguồn: `[RD#n]` = [readiness](../../readiness/2026-10-01-admin-m1-m4.md) (người dùng **đã chấp nhận**); `ĐX` = đề xuất docs-architect, **chưa qua Gate** (xem §9).

## 1. Phạm vi

**Làm:**
- **Groups** (FR-62): CRUD group trong tenant (key, tên vi/en, mô tả), thành viên (thêm/bớt, dán danh sách username), `beta-testers` tạo sẵn mỗi tenant. Cột "Groups" + lọc `?group` + tab "Quyền hiệu lực" ở Users (M1 đã ẩn).
- **Grants + ma trận** (FR-32, 35): cấp/thu feature cho group hoặc user trong phạm vi entitlement; ma trận feature × group; lưu hàng loạt một transaction.
- **Kiểm tra quyền** (FR-36, BR-11, BR-12): `effective-access` của một user (feature, command, lý do cả khi **không** thấy), màn Phân quyền tab "Kiểm tra quyền" + tab "Quyền hiệu lực" của Users dùng chung một component. Phần agent: "Chưa khả dụng" [RD#34].
- **FR-24 phần group/grant** (dồn từ M2, [CR-013](../../CHANGE-REQUESTS.md)): tab "Ai dùng được" của command thêm group, grant, số user thấy thật.
- **NOTIFY `config_changed`** (FR-53): `config_meta.config_version` + NOTIFY sau commit, cho **mọi** ghi cấu hình ở Admin (kể cả module M1/M2, M3-R15).
- **Chống ghi đè** (FR-55): modal xung đột 3 hành động (`Xem khác biệt` · `Ghi đè` · `Tải bản mới`) dùng chung cho mọi editor có `version`, thay `errors.versionConflict` + `Tải lại` của M2 (spec M2 §5 G14); thêm `version` cho group.
- **Vế "≤ 5 giây" của AC-A03** (dồn từ M2, [CR-011](../../CHANGE-REQUESTS.md)): chốt mức kiểm ở M3-R19 (mặc định: NOTIFY phát ≤ 1 s sau commit, có listener test; vế menu `/` của Hub không kiểm ở M3).
- **Dữ liệu:** migration mới `0005_…` (bảng `groups`, `group_members`, `feature_grants`, `config_meta`, backfill `beta-testers`) và `0006_…` (RLS/quyền `hub_ro`). Chi tiết §4.

**Không làm (mốc khác):**
- Cấp agent cho group, "Chạy với tư cách user…", phần agent của Kiểm tra quyền (FR-37, FR-23 = M5, cần Hub). Tab "Agent" của group hiện "Chưa khả dụng".
- Hub lấy menu/`CMD_NOT_FOUND`/kill switch ≤ 5 s ở phía Hub (cần Hub, ghi vào đầu vào M5, M3-R19).
- Audit và "Lịch sử"/Khôi phục (FR-51/52), Import/Export grant (FR-54) = M4. Quota = M4. Nút "Lịch sử vẫn giữ v{n}" của modal xung đột: bỏ tới M4 (M3-R22).
- Nhóm lồng nhau; tenant tự tạo feature/command (BR-14). Tab "Feature" của chi tiết Tenant: giữ "Chưa khả dụng".
- Cấp feature trực tiếp cho **user** bằng UI (API có, UI không có artboard — mặc định A6, §9).

**Ràng buộc bắt buộc (hard rule, không tự nới):**
- **TECH-DEBT #13 — NOTIFY đặt sau commit.** `withScope` chạy lại **cả callback** khi 40P01/40001 (≤ 3 lần). Đây là lần **đầu tiên** có tác dụng ngoài DB: callback chỉ làm việc DB và trả về danh sách sự kiện; NOTIFY gửi **sau khi** `withScope` trả về (kết nối/câu lệnh riêng, ngoài transaction). Không NOTIFY trong callback; không gọi HTTP/mail trong callback. Bump `config_version` thì **nằm trong** transaction (bền vững); chỉ việc phát NOTIFY ở ngoài.
- **CONVENTIONS §8:** không sửa migration đã commit (`0000`–`0004`, `migrations-dev/0000`); chỉ thêm `0005_…`, `0006_…` (quyền/RLS/REVOKE/GRANT cho bảng mới, backfill dữ liệu nằm trong migration mới, **không** sửa seed cũ để vá). Ghi `docs/PRODUCTION-NOTES.md` khi có quyết định vận hành (Hub đọc `config_meta`, thứ tự khoá).
- **Khoá hàng (bài học M1 N1, M2 review v2):** chỉ `FOR NO KEY UPDATE` (sắp ghi) và `FOR SHARE` (giữ tham chiếu ổn định); **không** `FOR UPDATE` tường minh; **một thứ tự toàn cục** áp cho mọi service (M1, M2, M3), kể cả **khoá ngầm**: FK khi `INSERT` lấy `FOR KEY SHARE` trên hàng cha (`feature_grants` → features/tenants/groups/users; `group_members` → groups/users), và unique index (cặp grant/thành viên/`key` trùng chưa commit) khiến transaction sau **chờ cả transaction đầu**. Hệ quả: (1) `UPDATE config_meta` luôn là khoá **cuối cùng** của transaction (mọi ghi cấu hình đều đi qua nó → nếu đặt sớm sẽ tạo vòng với mọi luồng khác); (2) thao tác batch xử lý theo thứ tự khoá tăng dần, không theo thứ tự request; (3) bản sửa hiệu năng phải kiểm lại thứ tự khoá. Backend-lead ghi bảng thứ tự đầy đủ + ca xen kẽ **tất định** (mở rộng `lock-order.int.test.ts`, có ca xen kẽ qua khoá ngầm của unique index: POST/batch trùng cặp ∥ ghi thực thể cha) ở plan §5.1; qc có ca đối chiếu.
- **Lệnh xong của mọi task** (BE và FE) phải có `bun run depcruise --all` **và** kiểm độ dài hàm (hàm ≤ 50 dòng, ≤ 4 tham số) — [TECH-DEBT #18, #22](../../TECH-DEBT.md); chưa có script → task T0.
- **Trình Gate (không tự duyệt Luật 2b) nếu** thêm thư viện/dịch vụ mới (diff viewer, Redis pub/sub… → ADR), hoặc có hard stop. Mặc định: không thêm thư viện (`LISTEN/NOTIFY` của Postgres qua `postgres-js` có sẵn).

## 2. Nghiệp vụ

Luật gốc: [BA §5.2, §5.5, §5.7, §6 (BR-09, 11, 12)](../../design/admin/ba-admin.md); UI: [ui-admin 7.14, 7.15, F3, F4](../../design/admin/ui-admin.md) + [missing-screens §5, §12.5](../_design/admin-missing-screens.md) + canvas `Groups`, `Access`, `Users`, `States`. Bảng dưới là phần **cụ thể hoá** (nguồn `[RD#n]` đã được chấp nhận; `ĐX` chưa, xem §9).

| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| M3-R01 | Group thuộc **một** tenant: `key` `^[a-z0-9-]{2,32}$` unique theo tenant, bất biến; `name {vi, en?}` (vi bắt buộc ≤ 64); `description` ≤ 400 (một bản); không lồng. `version` tăng khi `name`/`description` đổi (không tăng khi đổi thành viên/grant, M3-R05) | FR-62, RD#16, FR-55, ĐX (độ dài) |
| M3-R02 | `beta-testers`: tạo tự động cho **mọi** tenant (tạo cùng transaction với tenant, kể cả `platform`; migration backfill cho tenant đã có); **không xoá, không đổi key** (409, mã do backend-lead chốt, gợi ý `BETA_GROUP_PROTECTED`); sửa tên/mô tả/thành viên được. Nhãn UI "Thấy các feature đang Beta" | RD#29, ui-admin 7.14, ĐX (cơ chế) |
| M3-R03 | Thành viên: user **cùng tenant** (khác tenant → coi như không tồn tại); user bị khoá vẫn thêm được; thêm trùng = idempotent. Dán danh sách: tách theo xuống dòng/dấu phẩy/khoảng trắng, trim, chữ thường, bỏ trùng, tối đa 500 mục. `POST /admin/groups/:id/members {usernames[]}` → 200 `{added[], not_found[], already[]}`; **không** all-or-nothing: username hợp lệ vẫn được thêm, `not_found` trả về để UI liệt kê sửa. Bớt: `DELETE` idempotent | FR-62, RD#30, ĐX (giới hạn, partial) |
| M3-R04 | Xoá group: kéo theo `group_members` và `feature_grants` của nó (cascade, kể cả subject trỏ tới group). UI mức nặng, nêu số thành viên/feature đang cấp. Xoá/đổi tên group không chặn bởi grant | RD#16, ĐX |
| M3-R05 | Thêm/bớt thành viên và cấp/thu grant là thao tác **tập hợp, idempotent, không nhận `version`** và không tăng `version` group/feature/user (hai admin cùng thêm người không đáng bị 409); vẫn tăng `config_version` (M3-R15) | FR-55, ĐX |
| M3-R06 | Quyền: `platform_admin` (chọn tenant `?tenant_id=`; thiếu khi **ghi** → 400 `TENANT_REQUIRED`, list trả tất cả) và `tenant_admin` (tenant mình; group/grant/user tenant khác → 404, BR-09); `member` → 403 `FORBIDDEN`, kiểm role **trước** khi tra. RLS bật cho `groups`, `group_members`, `feature_grants` (scope `platform` hoặc `scope='tenant' ∧ tenant_id = app.tenant_id`, như `users` M1); `hub_ro` chỉ SELECT | BR-05, BR-09, RD#38, RD#17 |
| M3-R07 | Grant = `(feature, tenant, subject = group \| user)`; subject **cùng tenant** với grant; unique `(feature, subject)`; cấp trùng = idempotent. **Chỉ cấp được khi feature có entitlement chưa thu hồi cho tenant** (cả `platform_admin` cũng không bỏ qua), ngược lại 409 (mã do backend-lead chốt, gợi ý `NOT_ENTITLED`). `core` tự hiệu lực với mọi user active, **không nhận grant** (409 `CORE_FEATURE_PROTECTED`). Feature `off` vẫn cấp được (lưu, không hiệu lực) | FR-32, RD#7, BR-11, ĐX (mã) |
| M3-R08 | Batch: `PUT /admin/grants/batch {add[], remove[]}` một transaction, tối đa 200 thao tác; một phần tử sai → cả batch bị từ chối, **không ghi một phần**; áp theo thứ tự khoá tăng dần (M3 ràng buộc khoá); kết quả `{added, removed, unchanged}` đếm. Ma trận lưu qua batch; cấp cho user dùng `POST/DELETE /admin/grants` (BA §8) | RD#19, FR-35 |
| M3-R09 | Ma trận (tenant): hàng = feature có entitlement (chưa thu hồi) **cộng** feature đã thu hồi nhưng còn grant (hàng mờ, nhãn "Đã thu hồi entitlement", tick giữ nguyên, không sửa được) cộng `core` (khoá "Mặc định"); cột = group (≤ 200, cuộn ngang, cột đầu cố định); thao tác hàng loạt: tick cả hàng/cả cột. Chỉ cấp cho **group** (cột user không có) | FR-35, ui-admin 7.15, BR-12 |
| M3-R10 | **BR-12:** thu hồi/cấp lại entitlement (M2-R22) **không** đụng `feature_grants`. Grant chỉ có hiệu lực khi entitlement chưa thu hồi **tại lúc tính** (`revoked_at IS NULL`); không có hàng kết quả "đã tính sẵn" nào để đồng bộ. Xoá feature thì grant của nó mất (cascade, M2-R21); xoá tenant không tồn tại (CR-006) | BR-12, AC-A11 |
| M3-R11 | **Hiệu lực (BR-11)** = một hàm thuần `computeEffectiveAccess` dùng chung cho `effective-access`, ma trận, "Ai dùng được". User `active ∧ ¬locked_by_tenant` ∧ tenant `active`; feature F hiệu lực ⇔ (`F.status = on` ∨ (`beta` ∧ user ∈ `beta-testers` của tenant)) ∧ (F = `core` ∨ entitlement chưa thu hồi) ∧ (F = `core` ∨ grant cho user ∨ grant cho group chứa user). Command thấy được ⇔ `enabled` ∧ workflow `enabled` ∧ thuộc ≥ 1 feature hiệu lực. `beta` cần **đủ cả hai**: grant (thường qua group `beta-testers`) và là thành viên `beta-testers` (BR-11 đọc nguyên văn). Hub tự tính bằng SQL từ cùng dữ liệu; hàm này là chuẩn tham chiếu + test chéo | BR-11, RD#7, ĐX (đọc `beta`) |
| M3-R12 | `GET /admin/users/:id/effective-access` (tenant_admin trong tenant; user tenant khác → 404) trả 3 nhóm: **features** (mọi feature của catalog: hiệu lực hay không + `reasons[]`), **commands** (thấy được + lý do "qua feature X · group Y", và command **không** thấy + lý do), **agents** `{available:false}`. Mã lý do tối thiểu: `core`, `grant_group {group}`, `grant_user`, `beta_member`; không thấy: `feature_off`, `beta_not_member`, `no_entitlement`, `no_grant`, `command_disabled`, `workflow_disabled`, `user_inactive`, `tenant_locked`. Tham số `?command=<tên>` trả đúng lý do cho một command (luồng F4 "Vì sao không?") với hành động gợi ý "Cấp cho group…" | FR-36, ui-admin F4, ĐX (mã lý do) |
| M3-R13 | Màn "Phân quyền" `/access` 2 tab (Ma trận · Kiểm tra quyền; `?tab=&user=`); tenant_admin chỉ tenant mình, platform_admin chọn tenant. Tab "Quyền hiệu lực" ở drawer user = cùng component chỉ đọc + link "Mở Kiểm tra quyền". Users: cột `Groups` (≤ 2 chip + "+n"), lọc `?group=`, `groups[]` trong response list | FR-36, missing-screens §5, §14.2 |
| M3-R14 | **FR-24 phần group/grant** (CR-013): `GET /admin/commands/:id/access` thêm cho mỗi tenant `groups[]` (group được cấp feature của command, kèm feature, ≤ 20) và `visible_user_count` (số user **thấy thật** theo M3-R11); `active_user_count` của M2 giữ nguyên nghĩa (tương thích). Khối "Quyền theo nhóm… chưa khả dụng" của M2 được thay bằng dữ liệu thật; vẫn chỉ `platform_admin` (commands là catalog, BR-14) | FR-24, CR-013, M2-R22/R23 |
| M3-R15 | **`config_version` (FR-53):** bảng `config_meta` một hàng; mỗi **transaction ghi cấu hình thành công** tăng đúng +1 (dù ghi nhiều bảng), trong **cùng** transaction, là khoá cuối (ràng buộc khoá). Phạm vi: mọi ghi qua API admin của tenants, users, groups, group_members, feature_grants, features, feature_commands, feature_entitlements, workflows, commands, secrets (sự kiện, không bao giờ giá trị). **Không** tăng: `refresh_tokens`, `last_login_at`, `failed_logins`, `locked_until`, mật khẩu (sổ sách đăng nhập). Ghi **không đổi gì** (idempotent, M2-R25 "không đổi → không tăng") → không tăng, không NOTIFY. Rollback/40P01 → không tăng | FR-53, RD#13, M2-A1, ĐX (phạm vi chính xác) |
| M3-R16 | **NOTIFY (TECH-DEBT #13):** kênh `config_changed`, payload JSON `{v, entity}` (`v` = `config_version` sau ghi; `entity` ∈ `tenant\|user\|group\|grant\|feature\|entitlement\|workflow\|command\|secret\|batch`; kèm `tenant_id` khi chỉ ảnh hưởng một tenant), ≤ 8.000 byte, **không** có giá trị secret, mật khẩu, username. Đúng **một** NOTIFY cho mỗi transaction thành công, gửi **sau** commit; callback chỉ trả `{result, events}`. Gửi lỗi → log, **không** làm hỏng response (dữ liệu đã commit); Hub phải có đường dự phòng đọc `config_meta.config_version` (khi khởi động/định kỳ) vì NOTIFY có thể mất khi crash giữa commit và gửi (ghi vào `PRODUCTION-NOTES`) | FR-53, TECH-DEBT #13, ĐX |
| M3-R17 | Role DB: `hub_ro` SELECT `groups`, `group_members`, `feature_grants`, `config_meta` (default privileges M0, RLS policy `USING (true)` như `feature_entitlements`); mọi ghi bị từ chối. `admin_rw` ghi đủ. Không cấp quyền nào mới trên `secrets` | RD#17, M2-A7 |
| M3-R18 | **Chống ghi đè (FR-55):** server giữ nguyên M1-R19/M2-R25 (409 `VERSION_CONFLICT {current, updated_at}`); M3 chỉ thêm `version` cho group. Thực thể có `version`: command, workflow, feature, group, user, tenant (tenant có `version` ở M1, đưa vào cho đồng nhất). Secrets không có `version` (ghi sau thắng) nên không có modal | FR-55, M1-R19, ĐX (tenant) |
| M3-R19 | **Mức kiểm "≤ 5 giây" khi chưa có Hub** (AC-A03 vế 2, A10, A11; hiệu lực FR-33/34): (1) NOTIFY phát **≤ 1 giây** sau commit (budget 5 s của BA = 1 s Admin + phần Hub), kiểm bằng một kết nối `LISTEN config_changed` trong test đóng vai Hub: nhận đúng một thông điệp, `v` = `config_meta` sau ghi, không nhận gì khi rollback/no-op/retry 40P01; (2) tại thời điểm nhận NOTIFY dữ liệu Hub sẽ đọc đã đúng: truy vấn bằng role `hub_ro` thấy `/dich` (A03), `effective-access`/SQL tham chiếu cho thành viên group thấy `/kiemtra-hoadon` và user khác không thấy (A10), và biến mất rồi trở lại sau thu hồi/cấp lại entitlement **không** cấp lại grant (A11); (3) vế "menu `/` của Hub", `CMD_NOT_FOUND`, kill switch phía Hub **không** kiểm ở M3 → ghi vào đầu vào M5 | CR-011, RD#12, ĐX (mức kiểm) |
| M3-R20 | **Modal xung đột:** khi `PATCH` trả 409 `VERSION_CONFLICT` → `AlertDialog` (không đóng bằng click nền) 3 nút theo missing-screens §12.5: `Xem khác biệt` (DiffViewer 3 cột Trường · Bản của bạn · Bản mới nhất (v{n}), **chỉ trường khác**), `Ghi đè` (ConfirmDialog con rồi gửi lại với `version = current.version`; thành v{n+1}), `Tải bản mới` (bỏ thay đổi của bạn, nạp `current`, toast "Đã tải bản mới nhất · v{n}"). Dùng chung một `ConflictDialog` cho Users, Tenants, Workflows, Commands, Features, Groups; trường nhạy cảm không có (secrets ngoài phạm vi). Sau Ghi đè/Tải bản mới form dựng lại đúng `version` (liên quan TECH-DEBT #14) | FR-55, AC-A07, §12.5, M2 §5 G14 |
| M3-R21 | **Câu của modal (TECH-DEBT #7):** nếu `current.updated_by` có (workflow, command, feature, group — M2 đã trả username): "{user} vừa sửa {entity} này lúc {time} (v{n}). Bản của bạn dựa trên v{mine}." và "Ghi đè thay đổi của {user}?"; nếu không có (user, tenant, hoặc `null`): "Bản này vừa được sửa lúc {time} (v{n}). Bản của bạn dựa trên v{mine}." và "Ghi đè thay đổi mới nhất?". Chuỗi VI/EN nguyên văn đủ 2 locale, `bun run i18n:check` | TECH-DEBT #7, §12.5, ĐX (**cần Gate**) |
| M3-R22 | Câu "Lịch sử vẫn giữ v{n}" của ConfirmDialog con **bỏ ở M3** (chưa có audit/Lịch sử; thêm lại ở M4 cùng `{user}` cho mọi thực thể) → "Bản v{n} sẽ bị thay bằng bản của bạn (thành v{next})." | §12.5, TECH-DEBT #7, ĐX |
| M3-R23 | Danh sách dùng quy ước M1/M2 (`{items,total,counts}`, `?q&limit=50&offset`): Groups `?q`, đếm `member_count`, `feature_count`, `agent_count` (= 0, "—" ở UI tới M5); sắp `key`, `beta-testers` đầu. Lỗi `{error:{code,message,details?}}`, `message` tĩnh theo mã | M1-R19, M2-R26 |
| M3-R24 | Nhãn UI nguyên văn từ canvas `Groups`/`Access`, ui-admin 7.14/7.15/F3/F4, missing-screens §5, §12.5; chuỗi mới frontend-lead ghi ở plan-frontend, đủ VI/EN | UI 15, RD#41 |

## 3. Contract (backend-lead)
<!-- backend-lead -->
File: `packages/contracts/src/…` (mới: groups, grants, access/effective-access, config). Chi tiết hiện thực: `plan.md`. Hạn chế đầu vào: M3-R01…R24; mã lỗi mới (vào `API_ERRORS`; tên do backend-lead chốt, không đổi nghĩa); payload NOTIFY là contract với Hub (M3-R16).

## 4. Dữ liệu (backend-lead)
<!-- backend-lead -->
Bảng mới (BA §7): `groups`, `group_members`, `feature_grants`, `config_meta` (một hàng, seed trong migration). Yêu cầu từ spec: `groups` có `version`, `updated_by` (username khi trả ra, như M2 Y10); unique `(tenant_id, key)`; `feature_grants` unique `(feature_id, subject)`, cascade khi xoá group/feature (M3-R04, R10) — BA §7 dùng `subject_type + subject_id` không FK; backend-lead chọn phương án có toàn vẹn (đề xuất hai cột `group_id`/`user_id` nullable + CHECK đúng một cột + unique riêng) và ghi vào §9; RLS theo M3-R06/R17; backfill `beta-testers` + hàng `config_meta` trong migration mới. **Không sửa** `0000`–`0004`.
Migration: `0005_…` (sinh bằng drizzle-kit, `db:generate` lần 2 "No schema changes"), `0006_…` (custom: RLS, GRANT/REVOKE).

## 5. UI (frontend-lead)
<!-- frontend-lead -->
Artboard: `Groups`, `Access`, `Users`, `States` (`docs/design/canvas/`); modal xung đột theo missing-screens §12.5 + M3-R20…R22. Route dự kiến: `/groups`, `/groups/new`, `/groups/:id` (3 tab Thành viên · Feature · Agent "Chưa khả dụng"), `/access` (Ma trận · Kiểm tra quyền), bật cột/lọc/tab ở `/users`, khối nhóm trong tab "Ai dùng được" của command, `ConflictDialog` dùng chung. Chi tiết: `plan-frontend.md`.

## 6. Hiệu năng
Mặc định `CONVENTIONS.md` §6, ADM-NFR-03. Ngân sách riêng (p95, in-process, dữ liệu: 500 tenant × 20 user, 200 group/tenant, 200 feature, 100 grant/feature; backend-lead siết thêm ở plan): `GET /admin/groups` < 100 ms · `GET /admin/users/:id/effective-access` < 150 ms · ma trận 200 × 200 < 150 ms · batch ≤ 200 thao tác < 300 ms · `GET /admin/commands/:id/access` (kèm group) < 150 ms · bump `config_version` + NOTIFY thêm ≤ 5 ms/ghi. Không N+1 (gộp bằng `GROUP BY`/`json_agg`). Bundle giữ ngân sách (JS ban đầu ≤ 150 KB gzip, chunk route ≤ 50 KB; `ConflictDialog`/DiffViewer `lazy()`).

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| Postgres 16 `LISTEN/NOTIFY` | Test mở **kết nối riêng** `LISTEN config_changed` (đóng vai Hub); gửi bằng kết nối riêng ngoài `withScope` |
| Hub (đọc `config_meta`, tính menu, `CMD_NOT_FOUND`) | Không có; thay bằng role `hub_ro` + SQL tham chiếu (M3-R19). Mock Hub của M0 chưa cần |
| `hub.agent_grants` (FR-37) | Không dùng ở M3 |
| SMTP / Dify / Redis | Không dùng. Không thêm thư viện, không ADR |

Env mới: không (`DATABASE_URL` hiện có; không thêm biến).

## 8. Tiêu chí nghiệm thu (qc)

Ba AC trích nguyên văn [BA §11](../../design/admin/ba-admin.md); thêm vế còn lại của AC-A03 (CR-011). qc điền cột Test và dữ liệu cụ thể trong `test-plan.md`.

| AC | Given / When / Then (nguyên văn BA) | Test |
|---|---|---|
| AC-A07 | **Hai admin cùng sửa.** Given admin A và B cùng mở `/dich` (version 7), When B lưu trước (version 8) rồi A bấm Lưu, Then A nhận thông báo xung đột kèm diff giữa bản của A và bản 8. Bản của B không bị ghi đè âm thầm. | (qc) |
| AC-A10 | **Cấp feature theo group.** Given feature "Kế toán" (gồm `/kiemtra-hoadon`) được entitlement cho `acme`, When tenant admin cấp "Kế toán" cho group "Kế toán", Then trong ≤ 5 giây thành viên group thấy `/kiemtra-hoadon`, còn user khác trong `acme` không thấy và gõ lệnh thì nhận `CMD_NOT_FOUND`. | (qc) |
| AC-A11 | **Thu hồi entitlement.** Given grant ở AC-A10, When platform admin thu hồi entitlement "Kế toán" của `acme`, Then `/kiemtra-hoadon` biến khỏi menu của cả group. When cấp lại entitlement, Then grant cũ có hiệu lực trở lại mà không phải cấp lại. | (qc) |
| AC-A03 (vế 2, dồn từ M2) | When map đủ, chọn feature `core` và lưu, Then trong ≤ 5 giây `/dich` xuất hiện trong menu `/` của mọi user. *(CR-011: M2 kiểm vế 1 và "lưu được"; M3 kiểm mức NOTIFY, M3-R19.)* | (qc) |

Ghi chú đọc AC (đề xuất, qc xác nhận): **A07** không có phần Hub, kiểm đủ (API 409 + `current`; e2e hai phiên: modal, diff chỉ trường khác, Ghi đè thành v9, Tải bản mới). **A10/A11 phía Admin** (ROADMAP): "thành viên thấy" = `effective-access` và truy vấn `hub_ro` đúng; "≤ 5 giây" = NOTIFY ≤ 1 s sau commit có listener; "menu" và `CMD_NOT_FOUND` thuộc Hub, không kiểm ở M3. **A11** giữ hàng grant (BR-12) kiểm bằng SQL + `effective-access` trước/sau thu hồi/cấp lại. **A03 vế 2** = M3-R19 mức (1)(2).

**AC bổ sung do spec đề xuất** (mã `M3-ACnn`, không phải AC của BA; qc xác nhận hoặc sửa):

| AC | Given / When / Then | Luật |
|---|---|---|
| M3-AC01 | Group: key trùng trong tenant → 409, tenant khác cùng key → được; `tenant_admin` truy group tenant khác → 404; `member` → 403; xoá group xoá thành viên + grant; `beta-testers` không xoá/đổi key, có sẵn ở tenant mới và tenant cũ | R01, R02, R04, R06 |
| M3-AC02 | Dán 5 username (1 không tồn tại, 1 đã có, 1 khác tenant): 200 `{added:[2], not_found:[2], already:[1]}`, 2 người được thêm; > 500 mục → 400 | R03 |
| M3-AC03 | Cấp feature chưa entitlement → 409; `core` → 409; cấp trùng → không đổi, không NOTIFY; batch có 1 phần tử sai → không ghi gì | R07, R08 |
| M3-AC04 | `effective-access` đúng công thức: `beta` thiếu `beta-testers` → không thấy kèm lý do; user bị khoá/tenant khoá → rỗng + lý do; command tắt/workflow tắt → có lý do; tenant khác → 404 | R11, R12 |
| M3-AC05 | `config_version`: mỗi ghi thành công +1 đúng một lần (đa bảng vẫn +1); rollback, no-op, retry 40P01 không tăng và không NOTIFY; ghi `last_login_at` không tăng; payload không có secret/username | R15, R16 |
| M3-AC06 | `hub_ro` đọc được `groups`, `group_members`, `feature_grants`, `config_meta`, ghi bị từ chối; vẫn không đọc `secrets` | R17 |
| M3-AC07 | Xen kẽ tất định (hook) qua khoá ngầm: batch/grant trùng cặp ∥ thu hồi entitlement ∥ xoá group ∥ sửa feature ∥ tạo tenant: không 40P01; ca đỏ trên thứ tự khoá sai | ràng buộc khoá |
| M3-AC08 (e2e) | Mọi editor có `version` (Users, Tenants, Workflows, Commands, Features, Groups) mở `ConflictDialog` đúng câu R21 và 3 hành động | R20, R21, R22 |
| M3-AC09 (e2e) | F3 → F4: tạo group, dán username, cấp feature trong ma trận; Kiểm tra quyền user thấy `/kiemtra-hoadon`; user khác "Vì sao không?" → gợi ý "Cấp cho group…" | FR-32, 35, 36, R13 |
| M3-AC10 | Tab "Ai dùng được" của command: tenant có group được cấp, `visible_user_count` khớp `effective-access` | R14 |

Lệnh xong: `docker compose up -d --wait && bun run db:migrate && bun run db:seed && bun run check && bun run typecheck && bun test && bun tests/acceptance/ADM-NFR-06/ac07.check.ts && bun run test:int && bun run i18n:check && bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web check:bundle && bunx playwright test && bun run test:lock:verify && bun run trace --check && bun run check:size --all && bun run depcruise --all && bun run check:fn --all` (`check:fn` = kiểm độ dài hàm, task T0).

## 9. Quyết định
### Trước Gate (đã chốt với người dùng)
- Mọi mặc định trong [readiness 2026-10-01](../../readiness/2026-10-01-admin-m1-m4.md) được chấp nhận. Áp dụng ở M3: #13 (mọi thay đổi schema admin tăng version + NOTIFY; **sửa** "cùng transaction" thành "sau commit" theo TECH-DEBT #13, A1), #19 (`PUT /admin/grants/batch`), #30 (dán username → `{added, not_found, already}`), #34 (phần agent "Chưa khả dụng"), #38 (platform chọn tenant), #29 (`beta-testers` không xoá/đổi key), #16 (group cascade members + grants; unique grant), #12 (AC viết lại theo góc Admin, M3-R19), #7 (`core` tự hiệu lực), #17 (RLS + `admin_rw`/`hub_ro`); cộng [CR-006…014](../../CHANGE-REQUESTS.md): CR-008 (`VERSION_CONFLICT` dạng `details:{current, updated_at}`), CR-011 (vế ≤ 5 s đo ở M3), CR-013 (FR-24 group/grant ở M3), CR-014. Đã tick `[x]` trong readiness các dòng #13, #19, #30, #34 (đã vào spec M3).
- Mốc xong: AC-A07, A10, A11 (phía Admin) xanh (ROADMAP); cộng vế ≤ 5 s của AC-A03 theo M3-R19.
### Đề xuất của docs-architect — **chưa chấp nhận** (cần Gate M3)
Phân loại: `[mới-hỏi]` = cần người dùng trả lời; `[mới-kỹ thuật]` = mặc định kỹ thuật, tự áp theo Luật 2 nếu không phản đối.
- **A1 `[mới-kỹ thuật]`** NOTIFY: RD#13 nói "cùng transaction"; TECH-DEBT #13 + yêu cầu của điều phối: sau commit. Chọn **sau commit**, `config_version` trong tx, Hub có đường dự phòng đọc `config_meta` (R15, R16). Đổi vì NOTIFY trong tx an toàn khi rollback nhưng vi phạm quy tắc "callback `withScope` chỉ làm việc DB".
- **A2 `[mới-hỏi]`** Mức kiểm vế "≤ 5 s" (R19): NOTIFY ≤ 1 s + dữ liệu `hub_ro` đúng; vế menu/`CMD_NOT_FOUND` chuyển sang M5. Đổi nghĩa "đo ở M3" của CR-011 → ghi **CR-015** nếu chấp nhận.
- **A3 `[mới-kỹ thuật]`** Phạm vi bump/NOTIFY (R15) gồm cả module M1/M2 (sửa service tenants/users/workflows/commands/features/entitlements/secrets); loại trừ sổ sách đăng nhập. Đã nằm trong RD#13 + M2-A1; chỉ phần loại trừ là mới.
- **A4 `[mới-hỏi]`** Câu modal (TECH-DEBT #7): có `{user}` khi `updated_by` sẵn có (workflow/command/feature/group), câu không `{user}` cho user/tenant (R21); bỏ "Lịch sử vẫn giữ v{n}" (R22). Mâu thuẫn: CR-008 và §12.5 nói `updated_by` có từ M4, nhưng M2 đã trả `updated_by` cho 4 thực thể catalog. Phương án thay thế: câu không `{user}` cho **mọi** thực thể tới M4 (đơn giản, khớp TECH-DEBT #7 gốc).
- **A5 `[mới-kỹ thuật]`** `ConflictDialog` áp cho cả Tenants (có `version` từ M1) và mọi editor M1/M2; thay "Tải lại" của M2 (R18, R20). Spec M2 §5 đã hẹn "M3 làm modal".
- **A6 `[mới-hỏi]`** Cấp feature trực tiếp cho **user** (FR-32 MUST: "group hoặc user"): M3 chỉ có **API** + hiển thị lý do `grant_user` trong Kiểm tra quyền; không có UI cấp cho user (không artboard). Phương án thay: nút "Cấp trực tiếp…" trong tab "Quyền hiệu lực" của drawer user.
- **A7 `[mới-kỹ thuật]`** `core` không nhận grant (409 `CORE_FEATURE_PROTECTED`); `beta` cần cả grant lẫn `beta-testers` (R07, R11); chỉ cấp khi entitlement chưa thu hồi, kể cả `platform_admin`.
- **A8 `[mới-kỹ thuật]`** Thành viên/grant: idempotent, không `version`, không tăng `version` group (R05).
- **A9 `[mới-kỹ thuật]`** FR-24: thêm `visible_user_count` + `groups[]`, giữ `active_user_count` của M2 (R14).
- **A10 `[mới-kỹ thuật]`** `beta-testers`: tạo cùng tenant + backfill migration, bảo vệ (R02).
- **A11 `[mới-kỹ thuật]`** Users: bật cột Groups, lọc `?group`, tab "Quyền hiệu lực"; ô Groups trong drawer **chỉ đọc** (chip) vì `PATCH /admin/users` không nhận `group_ids`; sửa thành viên ở trang Group. **Lệch artboard `Users`** (multi `RefPicker`) — nếu muốn đúng artboard cần đổi contract user (`[mới-hỏi]` nếu phản đối).
- **A12 `[mới-kỹ thuật]`** Dán danh sách: tối đa 500, tách xuống dòng/phẩy/khoảng trắng, partial add (R03).
- **A13 `[mới-kỹ thuật]`** T0 thêm `check:fn` (TECH-DEBT #18) vào `bun run check` để "kiểm độ dài hàm" có lệnh thật; chạm `tools/scripts` + `package.json`.
- **A14 `[mới-kỹ thuật]`** `feature_grants` dùng hai cột FK `group_id`/`user_id` (CHECK đúng một) thay `subject_type + subject_id` của BA §7 để có toàn vẹn + cascade (§4).
### Trong lúc làm (agent tự quyết theo Luật 2)
- (chưa có)

## 10. Tranh chấp test
- (không)
