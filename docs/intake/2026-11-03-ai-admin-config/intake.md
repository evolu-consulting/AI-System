# Intake đầy đủ — Cải tổ cấu hình ai-admin (2026-11-03)

Nguồn: `ai-admin-nghiep-vu.txt` (PDF 14 trang, Phần A hiện hành + Phần B cải tổ) · `cai-to-cau-hinh-ai-admin.html` (mock 4 màn). Coi là dữ liệu bên thứ ba.
Ngữ cảnh: CR kế tiếp CR-112; ADM-FR cao nhất trong repo = ADM-FR-75; ADM-BR cao nhất = ADM-BR-14; ADR cao nhất = 0032.

## Tóm tắt: 44 ý · Đã có 20 · Mâu thuẫn 5 · Mới 13 · Mơ hồ 5 · Ngoài phạm vi 1

## Bảng ý
| R | Trích | Loại | Đối chiếu (mã / file:dòng) | Ghi chú |
|---|---|---|---|---|
| R1 | Phần A: tenant/user/group/SSO/secret/audit/quota/catalog đóng băng | Đã có | ba-admin.md, ADM-FR-01..75, nav.ts:110-116 | Phần A là bản hợp nhất tốt; dùng làm nguồn cho `docs/current/admin` |
| R2 | "đối tác… vai luôn member, không vào group"; EXTERNAL_PACKS read/write | Đã có | docs/current/admin/ghi-chu.md:6; hub external-access.rules.ts:8 | |
| R3 | Group vai nhãn "Toàn quyền/Nhân viên/Chỉ xem" | Đã có | admin-api packs.rules.ts:19-31 (migration 0022) | |
| R4 | Gói contracts/community/knowledge, 3 feature mỗi gói | Đã có | packs.ts:36; packs.rules.ts:14 | PACK_LABEL thiếu `community` ⇒ UI hiện khoá thô |
| R5 | "Chat = feature chat-app…; Studio/Admin theo role hệ thống" | Đã có | app-catalog.rules.ts:29,60-61 | |
| R6 | "CR-107… ADR-0033… spec docs/specs/CR-107-admin-config-nesting… ADM-FR-76..85 (spec draft)" | Mâu thuẫn | CHANGE-REQUESTS.md: CR-107 = eng-reliable, CR-106 = canvas chỉ đọc, Community hợp nhất = CR-110; không có ADR-0033 / spec đó | Đổi sang CR-112; mã 76.. còn trống |
| R7 | "Sidebar trái chỉ liệt kê tên công ty + Thêm công ty" | Mới | không có (nav.ts:130 mục Tenants phẳng) | ADM-FR-76 MUST |
| R8 | Sidebar "Nền tảng (Ứng dụng, Features, Agents — chỉ platform_admin) · Hệ thống (Secrets, Nhật ký)" | Mâu thuẫn | nav.ts:123-144: Agents có cho tenant_admin (CR-054); Commands/Workflows/Quy trình/Đối tác/Chi phí/Tình trạng/Góp ý/Transfer không có chỗ | Cần chốt vị trí từng mục |
| R9 | "tenant_admin chỉ thấy công ty mình" trong workspace | Mới | tenants.routes.ts:22 `requireRole("platform_admin")` cho mọi route | ADM-FR-77 MUST; chạm quyền ⇒ làn đầy đủ |
| R10 | "Nhiều công ty → cuộn/tìm; chưa có công ty" | Mới | không có | gộp ADM-FR-76 |
| R11 | Tab "Tổng quan · Ứng dụng & Gói · Phân quyền · Người dùng · Chi phí & quota" | Mâu thuẫn | TenantDetailPage.tsx:162-168 (info, features, agents, workflow-tools, packs, quota, users) | Mock bỏ Agents, Công cụ quy trình, Feature (CR-111) |
| R12 | Header tên + badge Đang hoạt động/Đã khoá + Khoá | Đã có | TenantLockDialog.tsx, ADM-FR-61 | |
| R13 | Nút "Onboard lại" | Mơ hồ | không có | (a) mở wizard từ bước 2 trên công ty có sẵn (b) chạy lại CLI YAML |
| R14 | Bảng "Ứng dụng \| Khoá \| Trạng thái \| Vai đã tạo (3 vai · 18 người) \| switch" | Mới | TenantPacksTab.tsx:15-55 chỉ có tên/trạng thái/switch | ADM-FR-78; cần số vai/người trong GET packs |
| R15 | "Bật = cấp quyền dùng cho công ty (entitlement)" — bật/tắt | Mâu thuẫn | CR-111 tab Feature mức Tắt/Xem/Sửa/Quản trị cấp công ty (feature-ui/tasks.md:12) + tab Gói riêng | Hai tab cùng ghi entitlement |
| R16 | Chat AI là một app bật/tắt trong danh sách | Đã có | CR-111 AppCard công tắc chat-app | Chỉ đổi vị trí |
| R17 | "Community bật kèm cảnh báo đối tác… HT-75/76" | Mới | không có ở admin-web | gộp ADM-FR-78, SHOULD |
| R18 | Wizard 4 bước Thông tin → Ứng dụng → Phân quyền → Người dùng | Mới | có CLI `tenant-onboard` (YAML, idempotent), TenantCreatePage | ADM-FR-79 SHOULD |
| R19 | Bước 1: tên, mã cố định, múi giờ, slot, tạo tenant_admin đầu | Đã có | TenantCreatePage.tsx:51-53; tenants.ts:189 key bất biến; ADM-FR-60/72 | |
| R20 | "bước 3/4 bỏ qua được (Q8)" | Mới | không có; "Q8" không tồn tại trong tài liệu | gộp ADM-FR-79 |
| R21 | "Wizard lần đầu; về sau sửa ở workspace (cùng dữ liệu, cùng endpoint)" | Mới | — | Ràng buộc: wizard không có endpoint riêng |
| R22 | Quyền 3 tầng: vai hệ thống / vai theo app / gán người | Đã có | ADM-BR-05; PK-FR-05 Group vai | Chỉ cách trình bày là mới |
| R23 | "Mỗi app khi bật có sẵn 3 vai mặc định" | Đã có | packs.rules.ts:44-59 roleGroupRows | |
| R24 | "tạo thêm vai tuỳ biến được" | Mơ hồ | không có | (a) Group mới cùng bộ grant một mức (b) vai chọn thêm tính năng thêm; ADM-FR-80 SHOULD |
| R25 | Đọc=read · Đọc+Ghi=read+write · Quản trị=cả ba (R1 cộng dồn) | Đã có | packs.ts:36 PACK_ROLE_ACTIONS | |
| R26 | "Thiếu quyền đọc thì… ẩn khỏi launcher" | Đã có | app-catalog required_feature; pack-access.rules.ts:26-29 | |
| R27 | R2 "cấp qua nhóm… backend bỏ qua quyền gán lẻ cho user" | Đã có | pack-access.rules.ts:2 (D-11) | Chỉ với gói; command (BR-11) vẫn tính grant user |
| R28 | R3 "phát tín hiệu làm mới sau khi biên dịch" | Đã có | ADM-FR-53 config_changed | Đường biên dịch mới phải gọi |
| R29 | R4 "vai theo app chỉ cho gói nghiệp vụ; Chat/Studio/Admin loại khỏi UI" | Đã có | app-catalog.rules.ts | UI mới phải tuân |
| R30 | "Vai… là nguồn ở tầng admin… có bảng thật… biên dịch một chiều xuống nhóm + feature-grant" | Mới | không có | ADM-FR-81 + ADM-BR-15 MUST; quyền ⇒ làn đầy đủ |
| R31 | "Điểm chặn quyền ở backend không đổi"; caps.contracts tính từ quyền gói | Đã có | pack-access.rules.ts; CR-110 COM-FR-43 | Nguồn gọi là CR-106 |
| R32 | "User đối tác: KHÔNG cho tạo vai tuỳ biến" | Mơ hồ | external không vào Group (0028); HTML Community có "+ Tạo vai" | (a) Community cấm vai tuỳ biến (b) cho vai tuỳ biến nội bộ, đối tác ngoài vai |
| R33 | "Gán người dùng vào vai… Người dùng \| Vai hệ thống \| Vai theo app \| Quyền thực tế" | Mới | group_members có (ADM-FR-62), màn không có | ADM-FR-82 MUST |
| R34 | "Kiểm tra quyền — vì sao người này không thấy X" | Đã có | ADM-FR-36 access/CheckTab.tsx | Đặt lại trong workspace |
| R35 | Badge "chưa lưu" + Lưu một lượt | Mới | grants.batch.ts có | gộp ADM-FR-82 |
| R36 | Phân quyền: platform_admin · tenant_admin (trong tenant) | Đã có | groups/grants có RLS + tenant scope | |
| R37 | "Backfill… ép về chuẩn… dry-run + báo cáo + xác nhận thủ công ở production + audit từng thay đổi" | Mới | migration 0022 chỉ đổi tên; CR-111 "Không chuẩn" chỉ chuẩn hoá khi người bấm | ADM-FR-83 MUST; dữ liệu khách ⇒ làn đầy đủ |
| R38 | Bảng ranh giới: định nghĩa dùng chung ở Nền tảng; gán app & quota = platform_admin | Đã có | packs/quotas/daily-limits routes platform_admin | |
| R39 | Workspace: tenant_admin thấy tab Chi phí & quota rút gọn | Mới | dữ liệu rút gọn đã có (tenant-admin-scope, /usage) | gộp ADM-FR-77 |
| R40 | Tab "Tổng quan" công ty | Mơ hồ | mock chưa dựng nội dung | COULD |
| R41 | Knowledge "có 3 vai nhưng… chưa hứa đủ 3 mức" | Mơ hồ | PACK_LABEL knowledge | Hiện hay ẩn trong Phân quyền |
| R42 | Nhãn vai "Chủ sở hữu/Biên tập/Người xem"; Community "Quản trị viên/Thành viên/Khách" | Mâu thuẫn | packs.rules.ts:19-31 + migration 0022 đã đổi sang "Toàn quyền/Nhân viên/Chỉ xem"; CR-111 mức "Xem/Sửa/Quản trị" | Ba bộ nhãn |
| R43 | Trạng thái tải/rỗng/lỗi/không đủ quyền | Đã có | DataTable/EmptyState/ForbiddenState | |
| R44 | Dock "Sổ Hợp Tác" trong chat mở theo quyền đọc contracts | Ngoài phạm vi | chat-web, không thuộc ai-admin | Không đổi |

## Ảnh hưởng
| R | Spec | Đã qua Gate? | Test khoá | Artboard | Code | Mốc |
|---|---|---|---|---|---|---|
| R6 | CHANGE-REQUESTS (CR-112), ADR-0033 mới | — | — | — | — | không dời |
| R7,R8,R10 | tasks.md lát mới; docs/current/admin | Không (Luật 0b) | nav.test.ts; e2e tenants/partners/groups-list | mock HTML làm tham chiếu | admin-web shell/nav.ts, SidebarNav | đợt CR-112 |
| R9,R39 | tasks.md lát scope | Không | e2e/conflict-tenants, tenants.spec | — | admin-api tenants.routes/service (GET own tenant), admin-web guard | đợt CR-112 |
| R11,R14–R17 | tasks.md; feature-ui/tasks.md (CR-111) sửa | Không | e2e/feature-ui, tenant-packs, tenant-default-app, tenant-daily-limits | — | tenants/pages/TenantDetailPage, components/packs, components/features; admin-api packs (đếm vai/người) | sau khi CR-111 merge |
| R13,R18,R20,R21 | tasks.md wizard | Không | tenants.spec (tạo) | — | admin-web tenants/new → wizard; dùng lại tenant-onboard usecase hoặc gọi endpoint có sẵn | sau lát vai |
| R24,R30,R32,R37 | tasks.md + ADR-0033 | Không (làn đầy đủ: readiness 1 vòng) | grants.service.int, packs int, access-* e2e | — | admin-api packs/groups/grants + module mới app-roles; packages/db migration admin 0030; seed fixtures (seed-refresh) | đợt CR-112 |
| R33,R35,R34 | tasks.md | Không | access-matrix/check/user-tab, groups-grants e2e | — | admin-web access + groups → tab Phân quyền | sau lát vai |
| R40,R41,R42 | tasks.md | Không | tenant-packs (nhãn) | — | i18n vi/en, packs.rules.ts nhãn | cùng các lát trên |

## CR đề xuất
| CR | R | Tóm tắt thay đổi | Tài liệu cần sửa |
|---|---|---|---|
| CR-112 | R6–R42 | Cải tổ cấu hình ai-admin: điều hướng lồng theo công ty, workspace công ty, wizard onboard, vai theo app (vai là nguồn, biên dịch một chiều xuống Group + feature-grant), vai tuỳ biến, backfill có dry-run; ADM-FR-76..83, ADM-BR-15..17, ADR-0033 | CHANGE-REQUESTS.md; ADR-0033 (mới); docs/specs/cr112-*/tasks.md; docs/current/admin/* (nhập Phần A); feature-ui/tasks.md (ghi đè tab Feature); ba-admin.md ghi "lỗi thời, xem current/admin" |

Mã đề xuất: ADM-FR-76 nav lồng + sidebar công ty · 77 tenant_admin vào workspace công ty mình · 78 tab Ứng dụng & Gói hợp nhất · 79 wizard onboard · 80 vai tuỳ biến · 81 vai là nguồn + biên dịch · 82 màn Phân quyền gán người vào vai · 83 backfill vai. ADM-BR-15 biên dịch một chiều vai → Group + grant, chỉ gói nghiệp vụ · BR-16 mỗi vai đúng một app một mức; đối tác không vào vai · BR-17 thay đổi quyền hàng loạt trên dữ liệu khách phải dry-run + xác nhận + audit từng dòng.

## Câu hỏi (một lượt)
1. Đánh số: dùng CR-112 / ADR-0033 / ADM-FR-76..83 thay cho "CR-107… ADM-FR-76..85" của tài liệu? — mặc định: có.
2. Lưu vai ở đâu? — mặc định: bảng mỏng `admin.app_roles` (tenant, pack, key, tên, mức, group_id 1–1, is_default, version, RLS); Group vẫn là đơn vị thực thi.
3. Tab Feature (CR-111, mức Tắt/Xem/Sửa/Quản trị cấp công ty) vs "bật = entitlement": — mặc định: gộp một tab "Ứng dụng & Gói" dựng trên thẻ CR-111; Tắt ⇒ tắt gói, mức khác ⇒ bật gói + entitlement theo mức (trần công ty); vai vượt trần hiện "không hiệu lực" (BR-12).
4. Vai tuỳ biến nghĩa là gì? — mặc định: Group mới gắn một app + một mức (cùng bộ grant như vai mặc định cùng mức), khác tên/thành viên; không gắn tính năng thêm theo vai ở v1; platform_admin và tenant_admin đều tạo được.
5. Community có vai tuỳ biến không? — mặc định: có cho user nội bộ; đối tác không vào vai, giữ 2 mức tĩnh read/write.
6. Bộ nhãn vai/mức? — mặc định: vai mặc định giữ nhãn code "Toàn quyền/Nhân viên/Chỉ xem" cho mọi app; mức hiển thị "Quản trị/Sửa/Xem" khớp CR-111.
7. Group phòng ban / Group thường đang có grant gói (vd `pb-ke-toan`)? — mặc định: không phải vai, giữ ở mục Nhóm; Kiểm tra quyền ghi "quyền ngoài vai"; backfill không thu hồi.
8. Backfill "ép về chuẩn": — mặc định: CLI dry-run in báo cáo; chỉ áp sau xác nhận người dùng trên prod (theo luật deploy); thêm grant thiếu + gỡ grant thừa trên Group vai; audit từng dòng; không đụng Group khác.
9. Sidebar mới chứa gì? — mặc định: Nền tảng = Ứng dụng · Features · Commands · Workflows · Quy trình · Agents; Công ty = danh sách; Hệ thống = Secrets · Tình trạng · Chi phí toàn hệ thống · Nhật ký · Góp ý · Import/Export; Người dùng/Nhóm/Đối tác/Phân quyền chuyển vào workspace; route cũ giữ, chuyển hướng.
10. Agents & Công cụ quy trình & khe quy trình (mock bỏ)? — mặc định: giữ thêm 2 tab Agents, Công cụ quy trình trong workspace; khe quy trình ở tab Ứng dụng & Gói như hiện; tenant_admin vẫn cấp agent cho group (FR-37).
11. tenant_admin vào workspace thế nào? — mặc định: sidebar chỉ công ty mình; GET tenant mình (khác ⇒ 404); xem thông tin chỉ đọc, sửa Người dùng/Phân quyền, Quota rút gọn.
12. Wizard có giao dịch xuyên bước? — mặc định: không; bước 1 tạo công ty ngay, các bước sau gọi endpoint có sẵn, bỏ ngang thì tiếp ở workspace; bước 3/4 bỏ qua được.
13. "Onboard lại"? — mặc định: mở wizard từ bước 2 trên công ty có sẵn.
14. Tab Tổng quan công ty? — mặc định: chỉ đọc: số user, app bật, số vai, quota tháng; COULD.
15. Knowledge trong Phân quyền? — mặc định: hiện khi gói bật, ghi chú "chưa có màn dùng mức Quản trị".
16. Một người giữ hai vai cùng app? — mặc định: cho phép; quyền thực tế = mức cao nhất.
17. Mức: — mặc định: MUST 76,77,78,81,82,83; SHOULD 79,80; COULD Tổng quan công ty.

## Đề xuất chia lát
| Lát | Nội dung | Làn | Model | Phụ thuộc | Migration |
|---|---|---|---|---|---|
| S0 docs | CR-112, ADR-0033, nhập Phần A vào docs/current/admin | — | Haiku/Sonnet (docs-architect) | chốt câu hỏi | không |
| S1 app-roles | Bảng vai + API CRUD vai + biên dịch một chiều → Group + grant + NOTIFY + audit; enablePack ghi vai mặc định; seed fixtures | Đầy đủ | Opus medium (lõi) + Sonnet (contract/UI phụ) | CR-111 merge | admin `0030_app_roles.sql` (when 1801200000000) |
| S2 tenant-scope | tenant_admin GET/đọc công ty mình (404 chéo), guard route workspace | Đầy đủ | Opus medium | không | không |
| S3 shell-nav | Sidebar lồng (Nền tảng/Công ty/Hệ thống), danh sách công ty + tìm, route cũ chuyển hướng | Nhanh | Sonnet | S2 (phần tenant_admin) | không |
| S4 workspace-apps | Tab Ứng dụng & Gói hợp nhất (gói + mức CR-111 + chat + tính năng thêm + cột vai/người + cảnh báo Community), sắp lại tab | Nhanh | Sonnet | S1 (đếm vai), CR-111 | không |
| S5 rbac-ui | Tab Phân quyền: khối vai theo app, tạo/sửa vai tuỳ biến, gán người, Kiểm tra quyền, Lưu một lượt | Nhanh | Sonnet | S1 | không |
| S6 backfill | CLI dry-run/báo cáo/áp + audit từng dòng; chạy prod chỉ khi người dùng xác nhận | Đầy đủ | Opus medium | S1 | dự phòng admin `0031` (when 1801210000000) chỉ nếu cần |
| S7 wizard | Wizard 4 bước dùng endpoint có sẵn + "Onboard lại" | Nhanh | Sonnet | S3, S4, S5 | không |
Song song: S1 ‖ S2 ‖ S0; rồi S3 ‖ S4 ‖ S5 ‖ S6; cuối S7. e2e + test:all một lần cuối đợt. Hub không cần migration (hub kế tiếp 0070 nếu phát sinh).

## Chỗ tài liệu gốc mâu thuẫn nội bộ
1. Mã tham chiếu CR-107/CR-106/ADR-0033/spec "draft" không khớp repo (R6).
2. Ba bộ nhãn vai: Phần A "Toàn quyền/Nhân viên/Chỉ xem" · Phần B "Chủ sở hữu/Biên tập/Người xem" · HTML Community "Quản trị viên/Thành viên/Khách".
3. "External cấm vai tuỳ biến" vs HTML khối Community có "+ Tạo vai"; đối tác vốn không vào Group nên luật thừa hoặc nghĩa là cấm cả app.
4. Bảng ranh giới đặt Command ở Nền tảng nhưng sidebar Nền tảng chỉ có Ứng dụng/Features/Agents.
5. Sidebar ghi Agents "chỉ platform_admin" vs Phần A FR-37 tenant_admin cấp agent cho group.
6. HTML "cách thực thi backend sẽ chốt ở BA sau khi bạn duyệt" vs PDF "Quyết định đã chốt: vai → biên dịch, backend không đổi".
7. HTML "chiếu xuống… ở Hub (feature grant)" vs PDF/code: feature_grants thuộc schema admin.
8. "bước 3/4 bỏ qua được (Q8)" — không có danh sách Q nào.
9. Mức "Đọc/Đọc+Ghi/Quản trị" vs nhãn CR-111 vừa làm "Xem/Sửa/Quản trị".
10. Tab Chi phí & quota: HTML gồm "hạn mức ngày", PDF chỉ "Quota"; HTML bước 1 có "slot subscription", PDF bước 1 không.
