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

Mốc: [ROADMAP M3](../../ROADMAP.md). Nền: [M1](../M1-foundation-identity/spec.md) (`withScope` + RLS scope `platform`/`tenant`, `users` có `version`, `VERSION_CONFLICT` theo CR-008, shell/shared web) và [M2](../M2-catalog-command/spec.md) (`features`, `feature_commands`, `feature_entitlements` có `revoked_at`, `commands/:id/access` phần tenant, `RefPicker`, `DependencyList`, `lock-order.int.test.ts`, `testHooks`). Không chép BA; chỉ ghi phần cụ thể hoá. Số hiệu luật `M3-Rnn`; nhãn nguồn: `[RD#n]` = [readiness](../../readiness/2026-10-01-admin-m1-m4.md) (người dùng **đã chấp nhận**); `ĐX` = đề xuất docs-architect, đã chấp nhận ở Gate 2026-10-02 (xem §9).

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

Luật gốc: [BA §5.2, §5.5, §5.7, §6 (BR-09, 11, 12)](../../design/admin/ba-admin.md); UI: [ui-admin 7.14, 7.15, F3, F4](../../design/admin/ui-admin.md) + [missing-screens §5, §12.5](../_design/admin-missing-screens.md) + canvas `Groups`, `Access`, `Users`, `States`. Bảng dưới là phần **cụ thể hoá** (nguồn `[RD#n]` và `ĐX` đều đã được chấp nhận, `ĐX` ở Gate 2026-10-02, xem §9).

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
| M3-R21 | **Câu của modal (TECH-DEBT #7):** nếu `current.updated_by` có (workflow, command, feature, group — M2 đã trả username): "{user} vừa sửa {entity} này lúc {time} (v{n}). Bản của bạn dựa trên v{mine}." và "Ghi đè thay đổi của {user}?"; nếu không có (user, tenant, hoặc `null`): "Bản này vừa được sửa lúc {time} (v{n}). Bản của bạn dựa trên v{mine}." và "Ghi đè thay đổi mới nhất?". Chuỗi VI/EN nguyên văn đủ 2 locale, `bun run i18n:check` | TECH-DEBT #7, §12.5, ĐX (đã chấp nhận Gate 2026-10-02, CR-016) |
| M3-R22 | Câu "Lịch sử vẫn giữ v{n}" của ConfirmDialog con **bỏ ở M3** (chưa có audit/Lịch sử; thêm lại ở M4 cùng `{user}` cho mọi thực thể) → "Bản v{n} sẽ bị thay bằng bản của bạn (thành v{next})." | §12.5, TECH-DEBT #7, ĐX |
| M3-R23 | Danh sách dùng quy ước M1/M2 (`{items,total,counts}`, `?q&limit=50&offset`): Groups `?q`, đếm `member_count`, `feature_count`, `agent_count` (= 0, "—" ở UI tới M5); sắp `key`, `beta-testers` đầu. Lỗi `{error:{code,message,details?}}`, `message` tĩnh theo mã | M1-R19, M2-R26 |
| M3-R24 | Nhãn UI nguyên văn từ canvas `Groups`/`Access`, ui-admin 7.14/7.15/F3/F4, missing-screens §5, §12.5; chuỗi mới frontend-lead ghi ở plan-frontend, đủ VI/EN | UI 15, RD#41 |

## 3. Contract (backend-lead)
<!-- backend-lead -->
File: `packages/contracts/src/{groups,grants,access,config}.ts` (mới) + `common.ts` (2 mã lỗi, `REFERENCE_FIELDS`, `NotEntitledDetailsSchema`), sửa `users.ts` (T4), `commands.ts` (T6), export `index.ts`. Chi tiết hiện thực: [plan.md](plan.md). Đã đối chiếu yêu cầu FE C1–C12 ([plan-frontend.md §9](plan-frontend.md)); trả lời từng mục ở plan.md §11.

**Quy ước** (kế thừa M1 §3, M2 §3, không nhắc lại): body/query strict, `:id`/`:user_id` không phải uuid → 404, lỗi `{error:{code,message,details?}}` `message` tiếng Anh cố định theo mã, ISO UTC, id uuid v7 (riêng `beta-testers` do trigger tạo: v4).
- **Role:** mọi route M3 = `requireAuth` + `requireRole("platform_admin","tenant_admin")`, kiểm **trước** khi parse/tra → `member` 403 `FORBIDDEN`. Ngoại lệ: `GET /admin/commands/:id/access` giữ chỉ `platform_admin` (M2).
- **Tenant** (như `/admin/users`, `resolveTenantScope`): `tenant_admin` luôn tenant mình (`?tenant_id` bị bỏ qua); `platform_admin` truyền `?tenant_id=` — thiếu khi **ghi** hoặc khi đọc `matrix` → 400 `TENANT_REQUIRED`; thiếu khi đọc list → mọi tenant; `tenant_id` không tồn tại → 404 (ghi, matrix), list rỗng. Scope DB: `tenant_admin` → `tenant`, `platform_admin` → `platform`. Group/user/grant của tenant khác → 404 khi ở path, `INVALID_REFERENCE` khi ở body.
- `updated_by`, `granted_by`, `added_by` = **username** (`string | null`). Thành viên và grant là **tập hợp**: idempotent, không `version`, không tăng `version` group/feature/user (R05). `PATCH` group nhận `version` (M1-R19).
- **Mọi ghi cấu hình** thành công có đổi dữ liệu (kể cả module M1/M2, R15, bảng sự kiện ở plan §5.3) → `config_version` +1 trong cùng transaction + đúng một NOTIFY `config_changed` **sau commit** (R16); không đổi gì / lỗi / rollback → không.

**Hằng/enum export** (dùng được ở trình duyệt): `BETA_GROUP_KEY = "beta-testers"`, `GROUP_KEY_RE = CATALOG_KEY_RE`, `GROUP_NAME_MAX = 64`, `GROUP_DESC_MAX = 400`, `GROUP_PASTE_MAX = 500`, `USERNAME_INPUT_MAX = 64`, `USER_GROUPS_MAX = 50`, `OTHER_GROUPS_MAX = 3`, `GRANT_BATCH_MAX = 200`, `MATRIX_GROUPS_MAX = 200`, `MATRIX_COMMAND_NAMES_MAX = 10`, `ACCESS_COMMANDS_MAX = 1000`, `ACCESS_GROUPS_MAX = 20`, `CONFIG_CHANNEL = "config_changed"`. Enum: `MATRIX_ROW_STATES = [core, entitled, revoked, none]`, `ACCESS_REASONS = [core, grant_user, grant_group, beta_member]`, `USER_BLOCKERS = [user_inactive, tenant_locked]`, `FEATURE_MISSING = [user_inactive, tenant_locked, feature_off, beta_not_member, no_entitlement, no_grant]`, `COMMAND_MISSING = [user_inactive, tenant_locked, command_disabled, workflow_disabled, no_effective_feature]`, `CONFIG_ENTITIES = [tenant, user, group, grant, feature, entitlement, workflow, command, secret, batch]`. Hàm thuần: `parseUsernameList(text)` (tách `/[\s,]+/`, trim, chữ thường, bỏ rỗng/trùng giữ thứ tự), `configChangedPayload(v, events)` (plan §4).

**Groups** (`groups.ts`) — R01…R05, R23
- `GroupKey` = trim → lower → `GROUP_KEY_RE`. `GroupName = LocalizedText(64)`. `GroupDescription` = trim ≤ 400, `""` → `null`.
- `GroupRef = {id, key, name: LocalizedText(64), is_beta: boolean}` (`is_beta ⇔ key = "beta-testers"`).
- `GroupListItem = {id, tenant_id, tenant_key, tenant_name, key, name, description: string|null, is_beta, member_count, feature_count (số grant của group), agent_count (= 0 tới M5), version, updated_at, updated_by}`. `Group = GroupListItem & {created_at}`.
- `GroupCreateRequest {key, name, description? = null}` · `GroupUpdateRequest {version, name?, description?: GroupDescription | null}` (không có `key` → 400; R01 bất biến).
- `GroupListQuery = ListQueryBase + {tenant_id?: uuid}` (`q` khớp `key`, `name.vi`, `name.en` ILIKE) · `GroupListResponse = {items, total}` (không chip nên không `counts`), sắp `tenant_key`, `beta-testers` đầu, rồi `key`.
- `GroupMember = {user_id, username, display_name, role, status, locked_by_tenant, last_login_at: iso|null, added_at, added_by, other_groups: GroupRef[] (≤ 3, beta đầu rồi key, không gồm group đang xem), other_groups_total}` · `GroupMemberListQuery = ListQueryBase` (`q` khớp `username`/`display_name`) · `{items, total}` sắp `username`.
- `GroupMembersAddRequest {usernames: string trim → lower, 1–64 ký tự [] (1–500; bỏ trùng sau chuẩn hoá), dry_run?: boolean = false}` → `GroupMembersAddResponse {added: string[], not_found: string[], already: string[]}` (username đã chuẩn hoá, theo thứ tự gửi lên). `not_found` = không khớp `USERNAME_RE`, không tồn tại, hoặc thuộc tenant khác (R03); user bị khoá vẫn vào `added`. **Không** all-or-nothing. `dry_run` → cùng kết quả, không ghi, không NOTIFY (FE C4).
- `GroupVersionConflictDetails = versionConflictDetailsSchema(GroupSchema)` (`{current: Group, updated_at}`).

**Grants** (`grants.ts`) — R07…R10
- `GrantFeatureRef = {id, key, name: LocalizedText(64), status, is_core}`. `GrantSubject` = discriminatedUnion `type`: `{type:"group", group: GroupRef}` · `{type:"user", user: {id, username, display_name}}`.
- `Grant = {id, tenant_id, feature: GrantFeatureRef, subject: GrantSubject, entitled: boolean (entitlement chưa thu hồi **lúc đọc**; BR-12), granted_at, granted_by}`.
- `GrantListQuery = ListQueryBase + {tenant_id?, feature_id?, group_id?, user_id?}` (`q` khớp key/tên feature) · `{items, total}` sắp `feature.key`, rồi group trước user, rồi `group.key`/`username`.
- `GrantCreateRequest {feature_id, group_id?, user_id?}` — đúng một trong `group_id`/`user_id` (refine → `VALIDATION_ERROR` path `[]`). `GrantDeleteQuery {tenant_id?, feature_id, group_id?, user_id?}` cùng luật.
- `GrantKey = {feature_id, group_id}` · `GrantBatchRequest {add?: GrantKey[] = [], remove?: GrantKey[] = []}` — `add.length + remove.length` 1–200; một cặp xuất hiện hai lần (trong một mảng hoặc giữa hai mảng) → 400 `VALIDATION_ERROR` (path tới phần tử trùng). Chỉ group (R09). `GrantBatchResponse {added, removed, unchanged}` (đếm; `unchanged` = thêm cặp đã có + bớt cặp không có).
- `GrantMatrixQuery = {tenant_id?, group_id?: uuid, q?: (lọc group) trim ≤ 100, limit: 1–200 = 200, offset: 0–100000 = 0}` · `GrantMatrix = {tenant_id, groups: (GroupRef & {member_count})[] (≤ 200, sắp `beta-testers` đầu rồi `key`; `group_id` → đúng một), group_total, features: [{feature: GrantFeatureRef, state: MATRIX_ROW_STATES, command_names: string[] (≤ 10, sắp), command_count, granted_group_ids: uuid[] (trong số `groups` trả về, sắp)}]}`. `features` = **mọi** feature catalog, sắp `core` đầu rồi `key`; `state`: `core` · `entitled` (entitlement chưa thu hồi) · `revoked` (đã thu hồi **và** còn grant, R09) · `none` (chưa mở; FE ẩn mặc định, D11).

**Kiểm tra quyền** (`access.ts`) — R11, R12
- `AccessReason` = discriminatedUnion `code`: `{code:"core"}` · `{code:"grant_user"}` · `{code:"grant_group", group: GroupRef}` · `{code:"beta_member"}`.
- `EffectiveFeature = {feature: GrantFeatureRef, effective: boolean, reasons: AccessReason[], missing: FEATURE_MISSING[]}` — `effective ⇔ missing = []`; `reasons` có cả khi không hiệu lực (vd grant còn giữ khi `no_entitlement`, A11).
- `FeatureMini = {id, key, name}`. `EffectiveCommand = {id, name, aliases, description: LocalizedText(200), visible: boolean, via: [{feature: FeatureMini, reasons: AccessReason[]}], blocked_by: [{feature: FeatureMini, missing: FEATURE_MISSING ∖ USER_BLOCKERS []}], missing: COMMAND_MISSING[], suggestion: {action: "grant_feature", feature: FeatureMini} | null}` — `visible ⇔ missing = []`; `suggestion` khác null ⇔ không thấy chỉ vì thiếu grant ở một feature (F4 "Cấp cho group…").
- `EffectiveAccess = {user: {id, username, display_name, tenant_id, tenant_key, status, groups: GroupRef[]}, blockers: USER_BLOCKERS[], features: EffectiveFeature[] (mọi feature, `core` đầu rồi key), commands: EffectiveCommand[] (sắp `name`, ≤ 1.000), command_total, agents: {available: false}, config_version}`. Luật tính chính xác = `computeEffectiveAccess` (plan §4), cùng nghĩa với SQL tham chiếu (plan §3.2) mà Hub dùng.
- `EffectiveAccessQuery {command?: string}` = trim → lower → bỏ một `/` đầu → `CATALOG_KEY_RE`; khớp `name` hoặc alias → `commands` chỉ còn command đó; không khớp → `commands: []`, `command_total: 0` (không 404).

**Users** (`users.ts`, sửa ở T4) — R13: `User` thêm `groups: GroupRef[]` (≤ 50, beta đầu rồi key) + `group_count` ở **mọi** response user (list, get, PATCH, tạo, `first_admin`, `VERSION_CONFLICT.current`); `UserListQuery` thêm `group?: uuid` (group không thấy được → list rỗng). `PATCH /admin/users` **không** đổi (A11).

**Commands "Ai dùng được"** (`commands.ts`, sửa ở T6) — R14: `CommandAccessItem` thêm `groups: [{id, key, name, is_beta, feature: FeatureMini}]` (≤ 20; một mục = một cặp group–feature của command đang được cấp, feature `on|beta` có entitlement chưa thu hồi; sắp group key rồi feature key), `group_count` (tổng số cặp), `visible_user_count` (số user **thấy thật** theo R11, = đếm từ `effective-access`). `active_user_count`, tập tenant, phân trang giữ nghĩa M2.

**NOTIFY — contract với Hub** (`config.ts`) — R15, R16
- Kênh `config_changed`; payload = JSON `ConfigChangedPayload = strict {v: int ≥ 1, entity: CONFIG_ENTITIES, tenant_id?: uuid}`, ≤ 8.000 byte. `v` = `config_meta.config_version` sau ghi; `entity` = thực thể của transaction (nhiều loại → `batch`); `tenant_id` có khi mọi thay đổi thuộc **một** tenant (group, grant, user, entitlement, tenant), vắng khi toàn hệ thống (catalog, secret). **Không bao giờ** có tên, username, giá trị secret, mật khẩu.
- Đúng một NOTIFY mỗi transaction thành công có đổi; gửi ngoài transaction sau commit. NOTIFY có thể **mất** (crash giữa commit và gửi) hoặc **đến lệch thứ tự** → Hub lấy `max(v)`, và đọc `select config_version from admin.config_meta` (role `hub_ro`) khi khởi động, khi LISTEN nối lại và định kỳ (mặc định 30 s).
- Không có endpoint HTTP cho `config_version` (Hub đọc DB; FE không cần). `effective-access.config_version` chỉ để hiển thị/kiểm.

| Method | Path | Request | Response | Lỗi (HTTP · code) |
|---|---|---|---|---|
| GET | `/admin/groups` | `GroupListQuery` | 200 `GroupListResponse` | 400 · 401 · 403 |
| POST | `/admin/groups` | `?tenant_id` + `GroupCreateRequest` | 201 `Group` | 400 `VALIDATION_ERROR` / `TENANT_REQUIRED` · 404 (tenant) · 409 `KEY_TAKEN` |
| GET | `/admin/groups/:id` | — | 200 `Group` | 404 |
| PATCH | `/admin/groups/:id` | `GroupUpdateRequest` | 200 `Group` | 400 · 404 · 409 `VERSION_CONFLICT {current: Group, updated_at}` |
| DELETE | `/admin/groups/:id` | — | 204 (cascade thành viên + grant) | 404 · 409 `BETA_GROUP_PROTECTED` |
| GET | `/admin/groups/:id/members` | `GroupMemberListQuery` | 200 `{items: GroupMember[], total}` | 404 |
| POST | `/admin/groups/:id/members` | `GroupMembersAddRequest` | 200 `GroupMembersAddResponse` | 400 (rỗng, > 500, phần tử > 64) · 404 |
| DELETE | `/admin/groups/:id/members/:user_id` | — | 204 (không là thành viên / user lạ → vẫn 204) | 404 (group) |
| GET | `/admin/grants` | `GrantListQuery` | 200 `{items: Grant[], total}` | 400 |
| POST | `/admin/grants` | `?tenant_id` + `GrantCreateRequest` | 201 `Grant` (mới) · 200 `Grant` (đã có, không ghi) | 400 `VALIDATION_ERROR` / `TENANT_REQUIRED` / `INVALID_REFERENCE {field:"feature_id"\|"group_id"\|"user_id"}` · 404 (tenant) · 409 `CORE_FEATURE_PROTECTED` / `NOT_ENTITLED {feature_ids}` |
| DELETE | `/admin/grants` | `GrantDeleteQuery` | 204 (không có grant / feature hoặc subject không thấy → vẫn 204) | 400 · 404 (tenant) · 409 `CORE_FEATURE_PROTECTED` |
| PUT | `/admin/grants/batch` | `?tenant_id` + `GrantBatchRequest` | 200 `GrantBatchResponse` (một transaction, R08) | 400 `VALIDATION_ERROR` / `TENANT_REQUIRED` / `INVALID_REFERENCE {field:"feature_ids"\|"group_ids", ids}` · 404 (tenant) · 409 `CORE_FEATURE_PROTECTED` / `NOT_ENTITLED {feature_ids}` |
| GET | `/admin/grants/matrix` | `GrantMatrixQuery` | 200 `GrantMatrix` | 400 `TENANT_REQUIRED` · 404 (tenant, `group_id`) |
| GET | `/admin/users/:id/effective-access` | `EffectiveAccessQuery` | 200 `EffectiveAccess` | 400 · 404 (user tenant khác) |
| GET | `/admin/users` (đổi) | `UserListQuery` + `group?` | 200, item có `groups`, `group_count` | như M1 |
| GET | `/admin/commands/:id/access` (đổi) | như M2 | 200, item có `groups`, `group_count`, `visible_user_count` | như M2 |

Không có: cấp agent (FR-37, M5), import/export grant (M4), endpoint `config_version`, UI cấp cho user (API có, A6).

**Mã lỗi mới** (vào `API_ERRORS`, `MESSAGES`; `details` export strict):
| Code | HTTP | `details` | Khi nào |
|---|---|---|---|
| `BETA_GROUP_PROTECTED` | 409 | — | `DELETE` group `beta-testers` (R02). Đổi key không có đường (PATCH không nhận `key`) |
| `NOT_ENTITLED` | 409 | `{feature_ids: uuid[]}` (≥ 1, sắp tăng) | thêm grant cho feature không có entitlement chưa thu hồi ở tenant (R07; cả `platform_admin`) |
Dùng lại: `KEY_TAKEN` (23505 `groups_tenant_key_uq`), `CORE_FEATURE_PROTECTED` (grant/batch có `core`), `INVALID_REFERENCE` (`REFERENCE_FIELDS` thêm `feature_id`, `group_id`, `user_id`, `group_ids`), `TENANT_REQUIRED`, `VERSION_CONFLICT`, `NOT_FOUND`, `FORBIDDEN`. `API_ERRORS` sau M3: 34 + 2 = **36** mã.

**Thứ tự kiểm** (role → parse → tenant (`TENANT_REQUIRED` → 404) → …):
- Group POST: `KEY_TAKEN`. PATCH: 404 → `version` → không đổi gì (200 hiện tại, không bump). DELETE: 404 → `BETA_GROUP_PROTECTED`.
- Members POST: 404 group → kết quả từng phần. DELETE: 404 group → 204.
- Grant POST: `INVALID_REFERENCE` (feature, rồi subject) → `CORE_FEATURE_PROTECTED` → `NOT_ENTITLED` → đã có (200) / tạo (201).
- Batch: `INVALID_REFERENCE` (`feature_ids`, rồi `group_ids`; `ids` sắp tăng, không trùng) → `CORE_FEATURE_PROTECTED` (bất kỳ phần tử) → `NOT_ENTITLED` (chỉ `add`; `remove` không cần entitlement) → ghi; lỗi → **không ghi gì**.
- Effective-access: 404 user → tính (user khoá/tenant khoá không phải lỗi, ra `blockers`).

**`version`** (R18): group tăng khi đổi `name`, `description`; không tăng khi đổi thành viên/grant. `updated_by/updated_at` đổi cùng `version`. Thực thể có `version` và `VERSION_CONFLICT`: tenant, user (M1), workflow, command, feature (M2), group (M3).

## 4. Dữ liệu (backend-lead)
<!-- backend-lead -->
Kiểu chung như M1/M2 §4. Schema Drizzle mới ở `packages/db/src/schema/permissions.ts` (tách khỏi `admin.ts` để ≤ 400 dòng; `drizzle.config.ts` nhận cả hai file). FK kép `(tenant_id, x_id) → x(tenant_id, id)` bảo đảm ở **DB** rằng thành viên/grant không trỏ sang tenant khác (R03, R07; thay `subject_type + subject_id` của BA §7, A14).

| Bảng | Cột | Kiểu | Null | Default | Ràng buộc / index | RLS |
|---|---|---|---|---|---|---|
| `users` (sửa) | — | | | | thêm UNIQUE `users_tenant_id_uq (tenant_id, id)` (đích FK kép) | như M1 |
| `groups` | `id` | uuid | không | `gen_random_uuid()` | PK; UNIQUE `groups_tenant_id_uq (tenant_id, id)` | **bật**: `groups_admin_rw` như `users` (platform, hoặc `tenant` ∧ `tenant_id = app.tenant_id`); `groups_hub_ro` SELECT `USING (true)` |
| | `tenant_id` | uuid | không | | FK `tenants(id) ON DELETE CASCADE` | |
| | `key` | text | không | | UNIQUE `groups_tenant_key_uq (tenant_id, key)`; CHECK `~ '^[a-z0-9-]{2,32}$'`; bất biến (app) | |
| | `name` | jsonb | không | | `{vi, en?}`; CHECK `jsonb_typeof = 'object' AND name ? 'vi'` | |
| | `description` | text | có | null | CHECK `char_length <= 400` | |
| | `version`, `created_at`, `updated_at`, `updated_by` | | | | như M2 (`updated_by` FK `users(id) ON DELETE SET NULL`) | |
| `group_members` | `tenant_id` | uuid | không | | FK kép `(tenant_id, group_id) → groups(tenant_id, id) ON DELETE CASCADE`; FK kép `(tenant_id, user_id) → users(tenant_id, id) ON DELETE CASCADE` | **bật**: `group_members_admin_rw`, `group_members_hub_ro` |
| | `group_id` | uuid | không | | PK `group_members_pkey (group_id, user_id)` | |
| | `user_id` | uuid | không | | INDEX `group_members_user_idx (user_id)` | |
| | `added_by` | uuid | có | null | FK `users(id) ON DELETE SET NULL` | |
| | `added_at` | timestamptz | không | `now()` | | |
| `feature_grants` | `id` | uuid | không | | PK | **bật**: `feature_grants_admin_rw`, `feature_grants_hub_ro` |
| | `tenant_id` | uuid | không | | FK `tenants(id) ON DELETE CASCADE`; INDEX `feature_grants_tenant_feature_idx (tenant_id, feature_id)` | |
| | `feature_id` | uuid | không | | FK `features(id) ON DELETE CASCADE` (R10) | |
| | `group_id` | uuid | có | | FK kép `(tenant_id, group_id) → groups(tenant_id, id) ON DELETE CASCADE` (R04); UNIQUE từng phần `feature_grants_group_uq (feature_id, group_id) WHERE group_id IS NOT NULL`; INDEX `feature_grants_group_idx (group_id)` | |
| | `user_id` | uuid | có | | FK kép `(tenant_id, user_id) → users(tenant_id, id) ON DELETE CASCADE`; UNIQUE từng phần `feature_grants_user_uq (feature_id, user_id) WHERE user_id IS NOT NULL`; INDEX `feature_grants_user_idx (user_id)` | |
| | `granted_by` | uuid | có | null | FK `users(id) ON DELETE SET NULL` | |
| | `granted_at` | timestamptz | không | `now()` | CHECK `feature_grants_subject_check`: `num_nonnulls(group_id, user_id) = 1` | |
| `config_meta` | `id` | smallint | không | `1` | PK; CHECK `id = 1` (một hàng) | **không** (toàn hệ thống); `admin_rw`: SELECT/INSERT/UPDATE (REVOKE DELETE, TRUNCATE); `hub_ro`: SELECT |
| | `config_version` | integer | không | `0` | CHECK `>= 0`; +1 mỗi transaction ghi cấu hình (R15) | |
| | `updated_at` | timestamptz | không | `now()` | | |

- **Không cột/bảng "đã tính sẵn"** (R10): hiệu lực luôn tính lúc đọc từ `feature_entitlements.revoked_at IS NULL` + grant + thành viên.
- **Trigger** `tenants_beta_group` (AFTER INSERT ON `tenants`, hàm `admin.create_beta_group()` `SECURITY INVOKER`, `search_path` cố định): chèn `beta-testers` (`name {"vi":"Beta testers","en":"Beta testers"}`, `description` "Thấy các feature đang Beta") trong cùng transaction với **mọi** INSERT tenant (service, seed, fixture SQL), `ON CONFLICT DO NOTHING` (R02, A10).
- **Xoá**: xoá group → cascade `group_members`, `feature_grants` của group; xoá feature → cascade `feature_grants` (cùng `feature_commands`, `feature_entitlements` M2); xoá user/tenant không có ở app (CR-006) nhưng FK cascade để dọn dữ liệu test/vận hành.
- **Quyền**: default privileges M0 cấp `admin_rw` S/I/U/D + `hub_ro` SELECT cho 4 bảng mới; `hub_ro` không có ghi nào; không đổi quyền `secrets` (R17).
- **Migration**: `0005_admin_permissions.sql` (drizzle-kit sinh: 4 bảng + `users_tenant_id_uq`; `db:generate` lần 2 "No schema changes") · `0006_permissions_rls.sql` (custom: RLS + 6 policy, REVOKE trên `config_meta`, hàng `config_meta (1, 0)`, hàm + trigger `beta-testers`, backfill `beta-testers` cho tenant đã có; SQL đầy đủ ở plan §3.1). **Không sửa** `0000`–`0004`.
- **Sau M3**: 7 migration chính (`0000`–`0006`) + 2 dev; 14 bảng `admin.*`; RLS bật 8 bảng (`feature_entitlements, feature_grants, group_members, groups, refresh_tokens, secrets, tenants, users`), không FORCE.
- **Thứ tự khoá toàn cục** (mọi service M1/M2/M3, khoá tường minh + ngầm qua FK `KEY SHARE` và unique index; `config_meta` cuối): plan §6 — nguồn duy nhất, reviewer đối chiếu.

## 5. UI (frontend-lead)
<!-- frontend-lead -->
Artboard: `Groups`, `Access`, `Users`, `States` (`docs/design/canvas/`); modal xung đột theo missing-screens §12.5 + M3-R20…R22. Chi tiết (bố cục, trạng thái, câu chữ VI/EN, nhãn e2e, validate, yêu cầu contract C1–C12): [`plan-frontend.md`](plan-frontend.md).

| Route | Màn | Ghi chú |
|---|---|---|
| `/groups` `?tenant&q&page` | Danh sách Groups | Mẫu A; cột Group · Thành viên · Feature · Agent ("—"); `beta-testers` có nhãn "Thấy các feature đang Beta", không xoá được |
| `/groups/new` | Tạo group | Key · Tên (VI/EN) · Mô tả |
| `/groups/:id` `?tab=members\|features\|agents` | Editor Group (mẫu B) | Tab Thành viên (RefPicker + dán tối đa 500, thêm một phần, liệt kê `not_found`) · Feature (chỉ feature đã entitlement, batch) · Agent "Chưa khả dụng"; `Đổi tên` dùng `ConflictDialog` |
| `/access` `?tab=matrix\|check&tenant&user` | Phân quyền | Ma trận feature × group (cuộn ngang, cột đầu cố định, tick hàng/cột, một batch ≤ 200, hàng "Đã thu hồi entitlement") · Kiểm tra quyền (`AccessExplainer`, "Vì sao không?", "Cấp cho group…") |
| `/users` (bật) `?group` | Users | Cột Groups (≤ 2 chip + "+n"), lọc Group, tab "Quyền hiệu lực" (chỉ đọc, link "Mở Kiểm tra quyền"), ô Groups chỉ đọc (A11) |
| `/commands/:id?tab=access` (đổi) | Ai dùng được | Cột Group được cấp, "Số user thấy" (`visible_user_count`) |
| Mọi editor/danh sách có `version` | `ConflictDialog` dùng chung | Thay "Tải lại" của M1/M2 ở Users, Tenants, Workflows, Commands, Features, Groups; câu có `{user}` khi `updated_by` có (A4) |

Chốt FE (chi tiết `plan-frontend.md` §0): không thêm thư viện, không ADR (DiffViewer và cửa sổ hoá ma trận tự viết); ma trận lưu một `PUT /admin/grants/batch` (> 200 thay đổi thì chặn Lưu); A6 không có UI cấp feature cho user; chưa chọn tenant thì Groups/Phân quyền không gọi API. A2, A4, A6, A11 đã được người dùng chấp nhận theo mặc định.

## 6. Hiệu năng
Mặc định `CONVENTIONS.md` §6, ADM-NFR-03. Ngân sách riêng (p95, in-process, dữ liệu: 500 tenant × 20 user, 200 group/tenant, 200 feature, 100 grant/feature; backend-lead siết thêm ở plan): `GET /admin/groups` < 100 ms · `GET /admin/users/:id/effective-access` < 150 ms · ma trận 200 × 200 < 150 ms · batch ≤ 200 thao tác < 300 ms · `GET /admin/commands/:id/access` (kèm group) < 150 ms · bump `config_version` + NOTIFY thêm ≤ 5 ms/ghi. Không N+1 (gộp bằng `GROUP BY`/`json_agg`). Bundle giữ ngân sách (JS ban đầu ≤ 150 KB gzip, chunk route ≤ 50 KB; `ConflictDialog`/DiffViewer `lazy()`).

**Backend** (chi tiết plan §3.2, §5; đo ở `access.perf.int.test.ts`, 20 lần, p95, in-process, dữ liệu trên): giữ đúng các ngân sách trên, siết thêm: `GET /admin/groups/:id/members` (5.000 thành viên) < 100 ms · `POST …/members` 500 username < 200 ms · `GET /admin/users` (kèm `groups`) giữ ngân sách M1 (< 300 ms CRUD) và tăng ≤ 20 ms so với M2 · `GET /admin/grants` < 100 ms · upsert `config_meta` trong tx ≤ 2 ms, `pg_notify` sau commit ≤ 3 ms. Số câu mỗi request (không N+1): effective-access 4, ma trận 3, batch ≤ 8, members add 4, command access 3. Index từng query:
| Query | Index |
|---|---|
| groups list (tenant, sắp `key`) + `member_count`/`feature_count` | `groups_tenant_key_uq`; `group_members_pkey` (tiền tố `group_id`); `feature_grants_group_idx` |
| members list / thêm (`username = any`) | `group_members_pkey`; `users_tenant_username_uq` |
| `groups[]` của user, `?group=` | `group_members_user_idx`; `group_members_pkey` |
| grant theo cặp, lock pass, `ON CONFLICT` | `feature_grants_group_uq` / `feature_grants_user_uq` |
| ma trận, grant list theo tenant | `feature_grants_tenant_feature_idx`; `feature_entitlements_pkey`; `feature_commands_pkey` |
| effective-access, `visible_user_count` | `group_members_user_idx`; `feature_grants_*_uq`; `feature_entitlements_pkey`; `feature_commands_command_idx`; `users_tenant_username_uq` (tiền tố `tenant_id`) |
| bump | `config_meta_pkey` (một hàng) |

**Frontend** (chi tiết `plan-frontend.md` §6): JS ban đầu hiện 115,8 KB, ước sau M3 ≤ 122 KB (i18n +~4,5 KB); chunk route ước groups ~28 KB, access ~30 KB, `ConflictDialog` lazy ~6 KB, `AccessExplainer` dùng chung ~8 KB, drawer user nạp tab "Quyền hiệu lực" bằng `lazy()`. Ma trận 200 × 200 **bắt buộc** cửa sổ hoá hai chiều (≤ ~240 ô trong DOM, ô và hàng `memo`, nháp là `Map` chênh lệch); bảng Groups/thành viên/Users phân trang server `limit=50`; `effective-access` chỉ nạp khi có user/tab mở; `staleTime: 0` cho ma trận và `effective-access`, invalidate sau mọi lưu. Mọi hook ≤ 50 dòng, component chỉ gọi hook, thư mục ≤ 10 file.

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| Postgres 16 `LISTEN/NOTIFY` | Test mở **kết nối riêng** `postgres(TEST_DATABASE_URL).listen("config_changed", fn)` (đóng vai Hub); server gửi bằng `Db.notify` = `sql.notify` của postgres.js 3.4.9 (kết nối pool, ngoài `withScope`, sau commit). Ca retry: `testHooks.afterLock(op, "bump")` ném `{code:"40P01"}` lần đầu (plan §5.2) |
| Thứ tự khoá | `testHooks.afterLock(op, step)` với step `locked` / `names` (M2) / `rows` / `bump` (M3) — chỉ khi `appEnv = "test"` (plan §6.3) |
| Hub (đọc `config_meta`, tính menu, `CMD_NOT_FOUND`) | Không có; thay bằng role `hub_ro` + SQL tham chiếu (M3-R19). Mock Hub của M0 chưa cần |
| `hub.agent_grants` (FR-37) | Không dùng ở M3 |
| SMTP / Dify / Redis | Không dùng. Không thêm thư viện, không ADR |

Env mới: không (`DATABASE_URL` hiện có; không thêm biến). Không thêm thư viện, không ADR (backend: NOTIFY qua postgres.js có sẵn; `check:fn` dùng `typescript` đã có).

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
- Gate 2026-10-02: xem [readiness.md](readiness.md).
- Mốc xong: AC-A07, A10, A11 (phía Admin) xanh (ROADMAP); cộng vế ≤ 5 s của AC-A03 theo M3-R19.
### Đề xuất của docs-architect — **đã chấp nhận (Gate 2026-10-02)**, xem [readiness.md](readiness.md)
Người dùng trực tiếp chấp nhận A2, A4, A6, A11 (CR-015, CR-016, CR-017); A1, A3, A5, A7–A10, A12–A14 là mặc định kỹ thuật đi kèm, backend-lead đã xác nhận. Nhãn `[mới-hỏi]`/`[mới-kỹ thuật]` giữ để truy nguồn; **tất cả đã chấp nhận**.
- **A1 `[mới-kỹ thuật]`** NOTIFY: RD#13 nói "cùng transaction"; TECH-DEBT #13 + yêu cầu của điều phối: sau commit. Chọn **sau commit**, `config_version` trong tx, Hub có đường dự phòng đọc `config_meta` (R15, R16). Đổi vì NOTIFY trong tx an toàn khi rollback nhưng vi phạm quy tắc "callback `withScope` chỉ làm việc DB".
- **A2 `[mới-hỏi]`** — **đã chấp nhận (Gate 2026-10-02)** ([CR-015](../../CHANGE-REQUESTS.md)). Mức kiểm vế "≤ 5 s" (R19): NOTIFY ≤ 1 s + dữ liệu `hub_ro` đúng; vế menu/`CMD_NOT_FOUND` chuyển sang M5. Cụ thể hoá CR-011 (đã ghi CR-015); đầu vào M5 ghi ở ROADMAP.
- **A3 `[mới-kỹ thuật]`** Phạm vi bump/NOTIFY (R15) gồm cả module M1/M2 (sửa service tenants/users/workflows/commands/features/entitlements/secrets); loại trừ sổ sách đăng nhập. Đã nằm trong RD#13 + M2-A1; chỉ phần loại trừ là mới.
- **A4 `[mới-hỏi]`** — **đã chấp nhận (Gate 2026-10-02)** ([CR-016](../../CHANGE-REQUESTS.md)). Câu modal (TECH-DEBT #7): có `{user}` khi `updated_by` sẵn có (workflow/command/feature/group), câu không `{user}` cho user/tenant (R21); bỏ "Lịch sử vẫn giữ v{n}" (R22). Mâu thuẫn: CR-008 và §12.5 nói `updated_by` có từ M4, nhưng M2 đã trả `updated_by` cho 4 thực thể catalog. Phương án thay thế: câu không `{user}` cho **mọi** thực thể tới M4 (đơn giản, khớp TECH-DEBT #7 gốc).
- **A5 `[mới-kỹ thuật]`** `ConflictDialog` áp cho cả Tenants (có `version` từ M1) và mọi editor M1/M2; thay "Tải lại" của M2 (R18, R20). Spec M2 §5 đã hẹn "M3 làm modal".
- **A6 `[mới-hỏi]`** — **đã chấp nhận (Gate 2026-10-02)** ([CR-017](../../CHANGE-REQUESTS.md)). Cấp feature trực tiếp cho **user** (FR-32 MUST: "group hoặc user"): M3 chỉ có **API** + hiển thị lý do `grant_user` trong Kiểm tra quyền; không có UI cấp cho user (không artboard). Phương án thay: nút "Cấp trực tiếp…" trong tab "Quyền hiệu lực" của drawer user.
- **A7 `[mới-kỹ thuật]`** `core` không nhận grant (409 `CORE_FEATURE_PROTECTED`); `beta` cần cả grant lẫn `beta-testers` (R07, R11); chỉ cấp khi entitlement chưa thu hồi, kể cả `platform_admin`.
- **A8 `[mới-kỹ thuật]`** Thành viên/grant: idempotent, không `version`, không tăng `version` group (R05).
- **A9 `[mới-kỹ thuật]`** FR-24: thêm `visible_user_count` + `groups[]`, giữ `active_user_count` của M2 (R14).
- **A10 `[mới-kỹ thuật]`** `beta-testers`: tạo cùng tenant + backfill migration, bảo vệ (R02).
- **A11 `[mới-kỹ thuật]`** — **đã chấp nhận (Gate 2026-10-02)** ([CR-017](../../CHANGE-REQUESTS.md)). Users: bật cột Groups, lọc `?group`, tab "Quyền hiệu lực"; ô Groups trong drawer **chỉ đọc** (chip) vì `PATCH /admin/users` không nhận `group_ids`; sửa thành viên ở trang Group. **Lệch artboard `Users`** (multi `RefPicker`) — nếu muốn đúng artboard cần đổi contract user (`[mới-hỏi]` nếu phản đối).
- **A12 `[mới-kỹ thuật]`** Dán danh sách: tối đa 500, tách xuống dòng/phẩy/khoảng trắng, partial add (R03).
- **A13 `[mới-kỹ thuật]`** T0 thêm `check:fn` (TECH-DEBT #18) vào `bun run check` để "kiểm độ dài hàm" có lệnh thật; chạm `tools/scripts` + `package.json`.
- **A14 `[mới-kỹ thuật]`** `feature_grants` dùng hai cột FK `group_id`/`user_id` (CHECK đúng một) thay `subject_type + subject_id` của BA §7 để có toàn vẹn + cascade (§4).
### Backend-lead PLAN (2026-10-02; theo thứ tự nguồn Luật 2; chi tiết [plan.md](plan.md))
Xác nhận mục kỹ thuật của docs-architect (không cần Gate hỏi người dùng):
- **A1 xác nhận.** Cơ chế: `withConfigWrite` (`packages/db`) tạo sink sự kiện **mới mỗi lần thử** của `withScope`, bump `config_meta` là câu cuối trong tx; `configWrite` (`admin-api/lib/config`) phát `pg_notify` qua `Db.notify` **sau** khi `withScope` trả (đã commit), đúng một lần, lỗi gửi chỉ log. Chọn "trả events" (không `afterCommit` hook tuỳ ý) vì callback vẫn thuần DB, và rollback/retry tự loại sự kiện (plan §5.2).
- **A3 xác nhận, cụ thể hoá loại trừ:** không bump khi unlock chỉ xoá khoá tạm, reset-password, logout-all, login/refresh/đổi mật khẩu (sổ sách đăng nhập); bảng sự kiện theo thao tác ở plan §5.3.
- **A5 xác nhận** phía contract: `VERSION_CONFLICT.details.current` đã đủ cho tenant/user (M1) và workflow/command/feature (M2); thêm `GroupVersionConflictDetails`.
- **A7 xác nhận.** Thêm: `DELETE /admin/grants` với `core` cũng 409 (đồng nhất); `remove` trong batch không cần entitlement (dọn được grant của feature đã thu hồi).
- **A8, A12 xác nhận.** A12 thêm: server nhận **mảng** `usernames` (FE tách bằng `parseUsernameList` của contract), username sai định dạng → `not_found` (không 400), có `dry_run` (FE C4).
- **A9 xác nhận có sửa** theo FE C9: `groups[]` là cặp group–feature (≤ 20) + `group_count` + `visible_user_count`.
- **A10 xác nhận, đổi cơ chế:** tạo `beta-testers` bằng **trigger** `AFTER INSERT ON tenants` (migration `0006`) thay vì code ở module tenants, để mọi đường chèn tenant (service, seed, fixture SQL của qc) đều có group; backfill trong cùng migration. Bảo vệ xoá ở app (`BETA_GROUP_PROTECTED`).
- **A13 xác nhận:** `check:fn` dùng TypeScript compiler API, hàm ≤ 50 dòng (component `.tsx` PascalCase ≤ 200), ≤ 4 tham số, phạm vi `apps|packages|tools/*/src` gồm test cạnh code, bỏ `tests/**`, `e2e/**` (của qc); allowlist `tools/scripts/check-fn.allow.json` có lý do (plan §7).
- **A14 xác nhận, siết thêm:** FK **kép** `(tenant_id, group_id|user_id) → groups|users(tenant_id, id)` (thêm UNIQUE `users_tenant_id_uq`, `groups_tenant_id_uq`) để DB chặn grant/thành viên chéo tenant.
Quyết định riêng của backend (Luật 2):
- **B1** Mã lỗi mới: `BETA_GROUP_PROTECTED` (409), `NOT_ENTITLED` (409, `{feature_ids}`); dùng lại `KEY_TAKEN`, `CORE_FEATURE_PROTECTED`, `INVALID_REFERENCE` (thêm 4 giá trị `field`). `API_ERRORS` = 36.
- **B2** Đường dẫn: `POST/DELETE /admin/grants` (BA §8) với `DELETE` theo **query** (`feature_id` + `group_id|user_id`) và luôn 204 (idempotent, R05); `DELETE /admin/groups/:id/members/:user_id` (thay `DELETE …/members` có body); `GET /admin/grants/matrix` (`?group_id` cho tab Feature của group, thay endpoint "feature cấp được" riêng). `effective-access` mount từ module `access` trước router users.
- **B3** `POST /admin/grants`: 201 khi tạo, 200 khi đã có (không ghi, không NOTIFY).
- **B4** `User` có `groups` (≤ 50) + `group_count` ở **mọi** response user (một hình cho drawer, list, conflict); ma trận `features[].state` thêm `none` (FE D11; R09 vẫn đúng cho hàng hiển thị mặc định).
- **B5** Ma trận đọc cũng cần tenant: `platform_admin` thiếu `?tenant_id` → 400 `TENANT_REQUIRED` (list groups/grants thiếu → mọi tenant như users).
- **B6** Thứ tự khoá toàn cục 14 hạng + 2 ngoại lệ có chứng minh (Workflow POST; `KEY SHARE` lên tenants/users) + luật batch (sắp tăng, lock pass phủ thêm ∪ bớt) + 10 ca xen kẽ tất định L1–L10: plan §6. `config_meta` hạng cuối; bump chỉ khi có sự kiện.
- **B7** Payload NOTIFY `{v, entity, tenant_id?}`; Hub lấy `max(v)` và đọc `config_meta` khi khởi động / nối lại LISTEN / mỗi 30 s (PRODUCTION-NOTES ở D1).
- **B8** `effective-access.commands` trần 1.000 + `command_total`; `?command=` không khớp → `commands: []` (không 404).
- **B9** (test-plan G4, TECH-DEBT #17) DB test riêng mỗi agent: `bun run db:test:create <tag>` tạo `ai_system_<tag>_test` (luôn hậu tố `_test`, role dùng chung của cluster, đã migrate) và ghi `.env.test-<tag>.local`; `db:test:drop <tag>`; test không đổi, chỉ đọc env. Làm ở T0, hướng dẫn ở `packages/db/README.md` (plan §12).
- **B10** Trả lời test-plan G1, G6–G10, G12, G13 (plan §13): `beta-testers` chỉ bảo vệ ở app (trigger chỉ tạo, không chặn SQL); `entity:"batch"` chỉ qua hàm thuần; op hook M1/M2 có sẵn trong `test-hooks.ts`; trần 500 username tính trước khi bỏ trùng; `DELETE` entitlement đã thu hồi/chưa cấp → 204, không bump.
### Trong lúc làm (agent tự quyết theo Luật 2)
- (chưa có)

## 10. Tranh chấp test
- (không)
