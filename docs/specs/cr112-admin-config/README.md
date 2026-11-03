---
id: cr112-admin-config
cr: CR-112
fr: ADM-FR-76..83
br: ADM-BR-15..17
adr: 0033
nguồn: docs/intake/2026-11-03-ai-admin-config/intake.md (17 câu đã chốt 2026-11-03, mục "Chốt")
---
# CR-112 · Cải tổ cấu hình ai-admin — spec phát triển (master)

Tài liệu cho đội dev. Hành vi hiện hành: `docs/current/admin/`. Quyết định kiến trúc: `docs/adr/0033-app-roles-source-of-truth.md`. Mock tham chiếu: `docs/intake/2026-11-03-ai-admin-config/cai-to-cau-hinh-ai-admin.html`.

## 1. Mục tiêu
1. Gom cấu hình theo ngữ cảnh công ty: chọn công ty rồi cấu hình trong workspace, không nhảy nhiều màn.
2. Trình bày quyền bằng ngôn ngữ vai + mức (Quản trị/Sửa/Xem), không lộ khái niệm feature kỹ thuật.
3. Giữ nguyên cách ly tenant và điểm chặn quyền ở backend (`pack-access.rules.ts`, `feature_grants`); engine đóng băng.

## 2. Phạm vi
Làm: nav lồng + sidebar công ty; tenant_admin vào workspace công ty mình; tab Ứng dụng & Gói hợp nhất; vai theo app (bảng `admin.app_roles`, biên dịch một chiều); vai tuỳ biến; tab Phân quyền (gán người vào vai); backfill chuẩn hoá; wizard onboard; tab Tổng quan (COULD).

Ngoài phạm vi: dock "Sổ Hợp Tác" trong chat-web; vai cho Chat/Studio/Admin (không có); tính năng thêm theo vai (v1); đổi engine/Hub; tự quản lý thành viên của công ty đối tác; module đóng băng (workflows, commands, transfer, sources) chỉ đổi vị trí menu, không đổi logic.

## 3. Mô hình "vai là nguồn quyền" (ADM-BR-15, 16)
- Bảng mỏng `admin.app_roles`: `tenant_id, pack, key, name(jsonb vi/en), level(read|write|admin), group_id (1–1, unique), is_default, version`, RLS theo tenant. Group vẫn là đơn vị thực thi.
- 1 vai ↔ 1 Group ↔ đúng một app (gói nghiệp vụ: contracts, community, knowledge) và đúng một mức. Mức là bộ grant cộng dồn: Xem = read; Sửa = read+write; Quản trị = read+write+admin (đã có `PACK_ROLE_ACTIONS`).
- Biên dịch một chiều: lưu/sửa/xoá vai ⇒ tính lại grant của Group vai (thêm thiếu, gỡ thừa) + tăng `config_version` + NOTIFY `config_changed` (ADM-FR-53) + audit. Không có chiều ngược (sửa grant trực tiếp trên Group vai bị ghi đè khi biên dịch lại).
- Trần công ty = mức entitlement của gói (CR-111, Tắt/Xem/Sửa/Quản trị). Vai có mức cao hơn trần ⇒ hiển thị "không hiệu lực" (ADM-BR-12: grant giữ nguyên, không thi hành).
- Vai mặc định: bật gói ⇒ `enablePack` tạo 3 vai/Group `<pack>-owner/-editor/-viewer`, nhãn "Toàn quyền/Nhân viên/Chỉ xem" (mọi app); mức hiển thị "Quản trị/Sửa/Xem". Vai mặc định không xoá được, không đổi mức.
- Một người giữ nhiều vai cùng app: cho phép; quyền thực tế = mức cao nhất. Cấp qua Group, backend bỏ quyền gán lẻ cho user với gói (D-11).
- `caps.contracts` (CR-110) vẫn tính từ quyền gói hiện có, không đọc `app_roles`.
- "Quyền ngoài vai": Group phòng ban/Group thường có grant gói không phải vai; ở lại mục Nhóm; Kiểm tra quyền ghi nhãn "quyền ngoài vai"; backfill không thu hồi.

## 4. Vai tuỳ biến (ADM-FR-80)
Tạo = Group mới gắn một app + một mức, cùng bộ grant với vai mặc định cùng mức; khác tên + thành viên. platform_admin và tenant_admin (trong công ty mình) đều tạo/sửa/xoá. Xoá vai có thành viên ⇒ 409 kèm số thành viên. Community: chỉ cho user nội bộ.

## 5. Community và đối tác (ADM-BR-16)
Đối tác (`kind=external`) không vào Group, không vào vai; giữ 2 mức tĩnh read/write (`EXTERNAL_PACKS`). Màn Phân quyền không cho gán đối tác vào vai. Bật Community hiện cảnh báo kiểm cách ly đối tác. Chat AI chỉ bật/tắt theo công ty; Studio/Admin theo vai hệ thống; Phân quyền không có "tạo vai" cho 3 app này. Knowledge hiện khi gói bật, ghi chú "chưa có màn dùng mức Quản trị".

## 6. Giao diện
### 6.1 Sidebar lồng (Q9)
- Nền tảng (platform_admin): Ứng dụng · Features · Commands · Workflows · Quy trình · Agents.
- Công ty: danh sách tên + ô tìm (cuộn khi nhiều) + "Thêm công ty"; trạng thái đang tải / chưa có công ty.
- Hệ thống: Secrets · Tình trạng · Chi phí toàn hệ thống · Nhật ký · Góp ý · Import/Export.
- Người dùng / Nhóm / Đối tác / Phân quyền chuyển vào workspace. Route cũ (`/users`, `/groups`, `/access`, `/partners`...) giữ và chuyển hướng tới tab tương ứng (nếu chưa chọn công ty: tới danh sách công ty).
### 6.2 Workspace công ty `/tenants/$id`
Header: tên + badge Đang hoạt động/Đã khoá + Khoá + Onboard lại. Tab: Tổng quan (COULD) · Ứng dụng & Gói · Phân quyền · Người dùng · Agents · Công cụ quy trình · Chi phí & quota. Khe quy trình (`contracts.approval`) ở tab Ứng dụng & Gói như hiện.
### 6.3 Tab Ứng dụng & Gói
Bảng/thẻ: Ứng dụng | Khoá | Trạng thái | Vai đã tạo (n vai · m người) | mức trần (Tắt/Xem/Sửa/Quản trị) | công tắc. Tắt ⇒ tắt gói; mức khác ⇒ bật gói + entitlement theo mức. Chat AI là thẻ bật/tắt. Tính năng thêm (CR-111) giữ trong thẻ. Chỉ platform_admin sửa; tenant_admin thấy chỉ đọc.
### 6.4 Tab Phân quyền
Callout 3 tầng; khối theo app (bảng Vai | Mức | Người | Sửa + "Tạo vai"); bảng gán người dùng (Người dùng | Vai hệ thống | Vai theo app | Quyền thực tế); Kiểm tra quyền (ADM-FR-36); badge "chưa lưu" + Lưu một lượt. Trạng thái đang tải/rỗng/lỗi/không đủ quyền.
### 6.5 Nhãn
Vai: Toàn quyền/Nhân viên/Chỉ xem. Mức: Quản trị/Sửa/Xem. Thêm `community` vào `PACK_LABEL`. i18n vi/en.

## 7. tenant_admin (ADM-FR-77)
Sidebar chỉ công ty mình, không có nhóm Nền tảng. `GET /admin/tenants/:id` cho tenant_admin chỉ với công ty mình (khác ⇒ 404, ADM-BR-09); thông tin chỉ đọc; sửa Người dùng, Phân quyền, Agents (cấp agent cho group, FR-37); Chi phí & quota rút gọn (không tiền). Gói/entitlement/quota/hạn mức ngày vẫn platform_admin.

## 8. Wizard onboard (ADM-FR-79, SHOULD)
4 bước: Thông tin (tên, mã bất biến, múi giờ, tenant_admin đầu) → Ứng dụng → Phân quyền → Người dùng. Không giao dịch xuyên bước: bước 1 tạo công ty ngay; các bước sau gọi endpoint có sẵn (không endpoint riêng cho wizard); bỏ ngang thì tiếp ở workspace; bước 3/4 bỏ qua được; mã trùng ⇒ lỗi tại bước 1. "Onboard lại" mở wizard từ bước 2 trên công ty có sẵn.

## 9. Backfill (ADM-FR-83, ADM-BR-17)
CLI `app-roles-backfill`: (1) nhận 3 Group vai sẵn có (`<pack>-owner/-editor/-viewer`) thành vai mặc định (tạo hàng `app_roles`); (2) Group vai lệch chuẩn ⇒ thêm grant thiếu + gỡ grant thừa; (3) không đụng Group không phải vai (kể cả `pb-*` có grant gói). Mặc định `--dry-run`: in báo cáo theo công ty/Group (thêm/gỡ gì); `--apply` ghi mỗi thay đổi một dòng audit; idempotent. Prod: chỉ áp sau khi người dùng xác nhận (luật deploy); báo cáo dry-run trình người dùng trước.

## 10. Yêu cầu chức năng
| Mã | Mức | Yêu cầu | AC kiểm được |
|---|---|---|---|
| ADM-FR-76 | MUST | Sidebar lồng + danh sách công ty + chuyển hướng route cũ | AC1: platform_admin thấy 3 nhóm; mục Công ty liệt kê tenant và lọc theo ô tìm. AC2: `/users` cũ chuyển tới tab Người dùng của công ty đang chọn. AC3: chưa có công ty ⇒ trạng thái rỗng + "Thêm công ty". `nav.test.ts` + e2e |
| ADM-FR-77 | MUST | tenant_admin vào workspace công ty mình | AC1: GET tenant của mình = 200, công ty khác = 404 (int). AC2: sidebar chỉ 1 công ty, không nhóm Nền tảng. AC3: thông tin tenant chỉ đọc (PUT = 403). AC4: tab Chi phí rút gọn, không có tiền |
| ADM-FR-78 | MUST | Tab Ứng dụng & Gói hợp nhất | AC1: đặt mức "Sửa" ⇒ gói bật + entitlement write. AC2: "Tắt" ⇒ gói tắt. AC3: cột "Vai đã tạo" đúng số vai/người (GET packs). AC4: bật Community hiện cảnh báo đối tác. AC5: tenant_admin không đổi được |
| ADM-FR-79 | SHOULD | Wizard 4 bước + Onboard lại | AC1: bước 1 tạo tenant, đóng trình duyệt ⇒ tenant còn, tiếp ở workspace. AC2: bỏ qua bước 3/4 thành công. AC3: mã trùng ⇒ lỗi bước 1. AC4: "Onboard lại" mở bước 2 |
| ADM-FR-80 | SHOULD | Vai tuỳ biến | AC1: tạo vai (app, mức) ⇒ Group + grant = bộ của mức. AC2: gói không phải nghiệp vụ ⇒ 422. AC3: xoá vai có thành viên ⇒ 409. AC4: tenant_admin tạo trong công ty khác ⇒ 404 |
| ADM-FR-81 | MUST | Vai là nguồn + biên dịch một chiều | AC1: `enablePack` tạo 3 hàng `app_roles` + 3 Group. AC2: đổi mức vai ⇒ grant Group đổi, config_version tăng, NOTIFY. AC3: vai vượt trần ⇒ "không hiệu lực". AC4: RLS chặn đọc chéo tenant. AC5: bộ grant mỗi mức đúng PACK_ROLE_ACTIONS |
| ADM-FR-82 | MUST | Tab Phân quyền: gán người vào vai | AC1: gán/bỏ user vào vai ⇒ `group_members` đổi. AC2: user ở 2 vai cùng app ⇒ quyền thực tế = mức cao nhất. AC3: đối tác không gán được (422). AC4: Lưu một lượt; badge "chưa lưu" hết sau lưu. AC5: Kiểm tra quyền hiện "quyền ngoài vai" |
| ADM-FR-83 | MUST | Backfill vai có dry-run | AC1: dry-run không ghi DB, in báo cáo. AC2: apply ghi audit từng dòng. AC3: Group không phải vai không đổi. AC4: chạy lại không thay đổi gì (idempotent). AC5: số câu SQL mỗi lô cố định (Luật 4c) |

Quy tắc nghiệp vụ mới:
- ADM-BR-15: vai biên dịch một chiều xuống Group + feature-grant, chỉ gói nghiệp vụ; mọi đường ghi phải phát `config_changed`.
- ADM-BR-16: mỗi vai đúng một app và một mức; đối tác không vào vai; mức vai ≤ trần công ty mới có hiệu lực.
- ADM-BR-17: thay đổi quyền hàng loạt trên dữ liệu khách phải dry-run + xác nhận thủ công + audit từng dòng.

COULD: tab Tổng quan chỉ đọc (số user, app bật, số vai, quota tháng).

## 11. Lát
| Lát | Nội dung | Làn | Model | Phụ thuộc | Migration |
|---|---|---|---|---|---|
| S1 app-roles | Bảng + API CRUD vai + biên dịch + NOTIFY + audit; `enablePack` ghi vai mặc định; seed fixtures; GET packs đếm vai/người | Đầy đủ | Opus medium (+ Sonnet contract/UI phụ) | CR-111 merge | admin `0030_app_roles.sql` (when 1801200000000) |
| S2 tenant-scope | tenant_admin GET công ty mình (404 chéo), guard route workspace | Đầy đủ | Opus medium | không | không |
| S3 shell-nav | Sidebar lồng, danh sách + tìm, redirect route cũ | Nhanh | Sonnet | S2 (phần tenant_admin) | không |
| S4 workspace-apps | Tab Ứng dụng & Gói hợp nhất, sắp lại tab | Nhanh | Sonnet | S1, CR-111 | không |
| S5 rbac-ui | Tab Phân quyền: khối vai, vai tuỳ biến, gán người, Kiểm tra quyền | Nhanh | Sonnet | S1 | không |
| S6 backfill | CLI dry-run/báo cáo/apply + audit; prod chỉ khi người dùng xác nhận | Đầy đủ | Opus medium | S1 | dự phòng admin `0031` (when 1801210000000), chỉ nếu cần |
| S7 wizard | Wizard 4 bước + Onboard lại | Nhanh | Sonnet | S3, S4, S5 | không |

Song song: S1 ‖ S2; rồi S3 ‖ S4 ‖ S5 ‖ S6; cuối S7. Hub không cần migration (kế tiếp 0070 nếu phát sinh). Mỗi lát tự ghi `docs/specs/<lát>/tasks.md` + Delta (`docs/current/admin/...`).

## 12. e2e qc cần cập nhật (chạy một lần cuối đợt)
`e2e/conflict-tenants`, `tenants.spec` (tạo công ty/wizard), `e2e/feature-ui` (tab Feature gộp), `tenant-packs`, `tenant-default-app`, `tenant-daily-limits`, `access-matrix/check/user-tab`, `groups-grants`, `groups-list`, `partners` (route chuyển hướng), `nav.test.ts`. Thêm: tenant_admin vào workspace; vai tuỳ biến; backfill dry-run (int).

## 13. Rủi ro
Hai nguồn quyền nếu ai sửa grant tay trên Group vai (⇒ biên dịch ghi đè, cảnh báo ở UI). Backfill đổi quyền hiệu lực khách (BR-17). Tab Feature và Gói cùng ghi entitlement (đã gộp ở S4). Nhãn 3 bộ (đã chốt Q6).
