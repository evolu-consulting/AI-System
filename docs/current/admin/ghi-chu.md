# Admin · ghi chú (người dùng ngoài, vai theo app, tab công ty, Công cụ AI)

Cập nhật: 2026-10-28 · Gộp từ: com-c1-ext-identity, com-c2-ext-deny. Chưa phải mô tả đầy đủ Admin (chưa có `current/admin`).

- Công ty đối tác: bảng `admin.external_orgs`, route `/admin/external-orgs*`, menu admin-web "Đối tác"; vô hiệu công ty ghi audit từng user; `POST /admin/external-orgs/:id/reactivate` (nút "Mở lại").
- User ngoài: `admin.users.kind='external'` + `external_org_id`, `deactivated_at`; `/admin/users?kind=&external_org_id=`. Vai luôn `member`; không vào Group, không làm quản lý/trưởng phòng (422).
- Cổng admin-api cho đối tác: chỉ hồ sơ, đổi mật khẩu, đăng xuất, mã SSO, app/portal của mình. Danh sách bề mặt chặn: `current/community/nghiep-vu.md` §13.
- Migration admin 0028 (identity ngoài), 0029 (trigger).
- Tạo công ty + user đối tác ở ai-admin; nhãn NCC/mua và liên kết SHT đặt ở Community › Đối tác.

## Chưa rõ
1. Tự quản lý thành viên của công ty đối tác (GĐ2).
2. Chưa có `current/admin` đầy đủ (quota, Trello, features).
3. (admin-sso-bounce) Người chỉ đăng nhập admin-web mở Sổ Hợp Tác bằng URL/tab mới vẫn thấy form đăng nhập: giữ nguyên (đề xuất) hay thêm nguồn SSO `/sso?app=` theo `document.referrer` (cần duyệt). Prod: hàng catalog `contracts` phải đúng origin.
4. (cr121-c13) Lối "Tạo quy trình công ty từ mẫu (sdlc)" của tenant_admin ở `/processes` đã bỏ; công ty nhận quy trình qua Sao chép từ Thư viện — cần xác nhận.
5. (cr121-c19) Quy tắc 2 của check `app_roles` (member vượt trần) mới là cảnh báo; chạy trên prod để xác minh rồi mới nâng thành lỗi.

## Delta gộp 2026-11-09 (đợt cr125-wave)
Mục dưới thắng nội dung cũ cùng chủ đề ở trên (lát: admin-sso-bounce, cr112-app-roles, cr112-apps-tab, cr112-backfill, cr112-review-fix, cr121-c10-admin-nav, cr121-c16-ai-tools, cr121-c22-system-page, cr121-f10-ai-tools-polish, cr121-f4-ai-tools-workflows, cr121-f4b-commands-toggle, cr121-qc-e2e-ui, cr121-qc-e2e-ui2, feature-ui).

#### Yêu cầu: Link từ admin-web sang app khác giữ phiên (nguồn: admin-sso-bounce)
Link trong admin-web mở một app có SSO (vd "Cấu hình trong Sổ Hợp Tác" ở màn Agents) chuyển phiên bằng mã một lần như app switcher, không mở thẳng URL app.
- Kịch bản: khi người đã đăng nhập admin-web bấm link sang Sổ Hợp Tác thì đích là trang /sso của Sổ Hợp Tác kèm mã một lần [test: apps/admin-web/src/features/shell/lib/open-app.test.ts » có phiên admin ⇒ trang /sso của Sổ Hợp Tác kèm mã một lần]
- Kịch bản: khi platform_admin đăng nhập admin-web xin mã cho contracts thì contracts đổi mã lấy phiên được [test: apps/admin-api/src/modules/auth/sso/sso.int.test.ts » platform_admin đăng nhập admin-web ⇒ mã cho contracts ⇒ phiên contracts]

#### Yêu cầu: Vai theo app là nguồn quyền gói, biên dịch một chiều xuống Group (nguồn: cr112-app-roles)
Mỗi vai (`admin.app_roles`) gắn đúng một Group, một app, một mức; bật gói tạo 3 vai mặc định (Chỉ xem=read, Nhân viên=write, Toàn quyền=admin). Đổi mức vai ⇒ thêm/gỡ đúng 3 mã gói trên Group của vai, tăng config_version, audit mỗi grant; Group khác và feature ngoài gói không bị đụng. Vai vượt trần công ty (CR-111) hiện không hiệu lực.
- Kịch bản: khi platform_admin bật gói cho công ty thì có 3 vai mặc định trỏ đúng 3 Group vai, bật lại không nhân đôi [test: apps/admin-api/src/modules/app-roles/app-roles.service.int.test.ts » ADM-FR-81 · bật gói tạo 3 vai mặc định]
- Kịch bản: khi đổi mức vai thì chỉ mã gói trên Group của vai đổi; grant ngoài gói và Group phòng ban giữ nguyên; audit đúng số grant đổi [test: apps/admin-api/src/modules/app-roles/app-roles.service.int.test.ts » ADM-BR-15 · đổi mức chỉ thêm/gỡ mã gói]
- Kịch bản: khi công ty chỉ có entitlement tới Sửa thì vai Toàn quyền có effective=false [test: apps/admin-api/src/modules/app-roles/app-roles.service.int.test.ts » ADM-BR-12 · vai vượt trần công ty]
- Kịch bản: khi lập kế hoạch biên dịch thì drop = 3 mã gói trừ mã theo mức [test: apps/admin-api/src/modules/app-roles/app-roles.rules.test.ts » compilePlan: scope]
- Kịch bản: khi biên dịch 50 vai thì số câu SQL bằng khi biên dịch 2 vai (≤ 3) [test: apps/admin-api/src/modules/app-roles/app-roles.service.int.test.ts » Luật 4c · biên dịch 50 vai]

#### Yêu cầu: Vai tuỳ biến và gán người vào vai (nguồn: cr112-app-roles)
platform_admin và tenant_admin (công ty mình) tạo vai tuỳ biến (Group mới + grant theo mức), đổi tên/mức, xoá (không với vai mặc định, không khi còn người), gán/gỡ user nội bộ. Đối tác không bao giờ vào vai. Công ty khác ⇒ 404.
- Kịch bản: khi xoá hoặc đổi mức vai mặc định thì 409; app chưa cài thì 422; xoá vai còn người thì 409 kèm số người [test: apps/admin-api/src/modules/app-roles/app-roles.service.int.test.ts » ADM-FR-80 · vai mặc định: không xoá]
- Kịch bản: khi tenant_admin công ty B thao tác vai/tenant của A thì mọi lời gọi trả 404 [test: apps/admin-api/src/modules/app-roles/app-roles.service.int.test.ts » ADM-FR-77 · tenant_admin công ty khác]
- Kịch bản: khi gán lô có đối tác thì 422 cả lô; user nội bộ vào vai thì member_count và GET packs (số vai/người) đổi theo [test: apps/admin-api/src/modules/app-roles/app-roles.service.int.test.ts » ADM-BR-16 · đối tác không vào vai]

#### Yêu cầu: Backfill vai mặc định từ Group vai có sẵn (nguồn: cr112-app-roles)
Migration 0030 tạo hàng vai cho Group `<k'>-viewer|editor|owner` của gói đã cài; không đổi grant; chạy lại không tạo thêm; Group phòng ban không thành vai.
- Kịch bản: khi chạy backfill hai lần thì lần 1 tạo 3, lần 2 tạo 0, `pb-ke-toan` không có vai [test: apps/admin-api/src/modules/app-roles/app-roles.service.int.test.ts » ADM-FR-83 · backfill tạo vai mặc định]

#### Yêu cầu: Tab Ứng dụng & Gói hợp nhất (Feature + Gói) (nguồn: cr112-apps-tab)
Chi tiết công ty có một tab "Ứng dụng & Gói": mỗi app một thẻ chọn mức Tắt/Xem/Sửa/Quản trị. Tắt ⇒ tắt gói; mức khác ⇒ bật gói + cấp entitlement theo mức (trần công ty). Lưu một lượt theo thứ tự bật gói → cấp/thu hồi → tắt gói; tắt gói hoặc thu hồi ⇒ hộp xác nhận nêu số người mất quyền và liệt kê quyền thu hồi. Thẻ hiện số vai, số người, số vai không hiệu lực và lối tắt Phân quyền; bật Community hiện cảnh báo đối tác. tenant_admin chỉ xem. Tab Gói cũ không còn, URL `?tab=packs` mở tab gộp.
- Kịch bản: khi đặt mức Sửa cho app chưa bật gói thì kế hoạch bật gói, cấp Xem+Sửa và thu hồi mức Quản trị thừa do gói cấp sẵn [test: apps/admin-web/src/features/tenants/lib/apps-plan.test.ts]
- Kịch bản: khi đặt Tắt thì kế hoạch tắt gói và thu hồi mức + tính năng thêm [test: apps/admin-web/src/features/tenants/lib/apps-plan.test.ts » AC2: Sửa → Tắt ⇒ tắt gói, thu hồi mức và tính năng thêm]
- Kịch bản: khi chạy kế hoạch thì bật gói trước khi cấp và thu hồi trước khi tắt gói [test: apps/admin-web/src/features/tenants/lib/apps-plan.test.ts » bật gói TRƯỚC khi cấp, thu hồi TRƯỚC khi tắt gói]
- Kịch bản: khi entitlement lỗi giữa chừng thì không tắt gói và báo các bước đã áp dụng [test: apps/admin-web/src/features/tenants/lib/apps-plan.test.ts » entitlement lỗi ⇒ gói đã bật được ghi nhận, KHÔNG tắt gói (người dùng chưa mất quyền)]
- Kịch bản: khi tắt gói thì hộp xác nhận cảnh báo mất quyền kèm số người [test: apps/admin-web/src/features/tenants/lib/apps-plan.test.ts » tắt gói ⇒ cảnh báo mất quyền kèm số người + liệt kê thu hồi theo tên]
- Kịch bản: khi mức công ty hạ thì vai có mức cao hơn được đếm là không hiệu lực [test: apps/admin-web/src/features/tenants/lib/apps-plan.test.ts » mức Sửa ⇒ vai Quản trị không hiệu lực, Tắt ⇒ mọi vai, app khác không lẫn]
- Kịch bản: khi platform_admin chọn Sửa rồi Tắt ở tab thì gói bật rồi tắt có xác nhận và entitlement khớp [test: e2e/tenant-packs.spec.ts » ADM-FR-78 · đặt mức Sửa ⇒ bật gói + entitlement Xem/Sửa (gỡ mức Quản trị do gói cấp sẵn), Tắt ⇒ hỏi xác nhận rồi tắt gói]
- Kịch bản: khi mở ?tab=packs thì tab Ứng dụng & Gói được chọn và không còn tab Gói [test: e2e/feature-ui.spec.ts » CR-112 · URL cũ ?tab=packs mở tab Ứng dụng & Gói, tab Gói không còn]
- Kịch bản: khi tenant_admin mở workspace thì không thấy tab Gói trong danh sách [test: apps/admin-web/src/features/tenants/lib/workspace-tabs.test.ts]

#### Yêu cầu: Chuẩn hoá vai cho dữ liệu có sẵn (backfill dry-run/apply) (nguồn: cr112-backfill)
CLI `admin:roles-backfill` mặc định chạy thử: báo cáo theo công ty/gói/vai (vai sẽ tạo, mã gói thêm/gỡ trên Group của vai, số người, Group ngoài vai có mã gói, vai vượt trần) và không ghi gì. `--apply` ghi mỗi công ty một transaction, audit từng thay đổi, NOTIFY; Group không phải vai giữ nguyên; chạy lại không đổi gì.
- Kịch bản: khi chạy thử trên công ty lệch chuẩn thì DB không đổi và báo cáo liệt kê đúng thêm/gỡ, Group phòng ban ở mục quyền ngoài vai [test: apps/admin-api/src/modules/app-roles/app-roles.backfill.int.test.ts » ADM-FR-83 · dry-run không ghi, apply sửa tenant lệch, giữ Group phòng ban, audit mỗi thay đổi, lần 2 không đổi]
- Kịch bản: khi apply thì viewer mất mã admin thừa, editor có lại write, Group phòng ban giữ grant, audit đúng số thay đổi; apply lần 2 không đổi gì [test: apps/admin-api/src/modules/app-roles/app-roles.backfill.int.test.ts » ADM-FR-83 · dry-run không ghi, apply sửa tenant lệch, giữ Group phòng ban, audit mỗi thay đổi, lần 2 không đổi]

#### Yêu cầu: Group của vai do vai quản (nguồn: cr112-backfill)
Xoá Group của vai mặc định qua mục Nhóm ⇒ 409 `DEFAULT_ROLE_PROTECTED`; Group của vai tuỳ biến ⇒ 409 `ROLE_GROUP_MANAGED` (xoá qua vai). Vai tuỳ biến nhận trợ lý AI của gói như Group vai mặc định cùng mức. Import người dùng từ mgmt-app tạo luôn 3 vai mặc định.
- Kịch bản: khi xoá Group vai qua /admin/groups thì 409 và Group còn nguyên; vai tuỳ biến mới có grant agent trợ lý [test: apps/admin-api/src/modules/app-roles/app-roles.backfill.int.test.ts » ADM-FR-80 · xoá Group vai qua /admin/groups ⇒ 409 DEFAULT_ROLE_PROTECTED / ROLE_GROUP_MANAGED, vai tuỳ biến mới nhận agent]
- Kịch bản: khi import tạo công ty mới thì có 3 vai mặc định trỏ Group vai contracts [test: apps/admin-api/src/modules/identity-import/import.roles.int.test.ts » ADM-FR-81 · import tenant mới ⇒ 3 vai mặc định (viewer/editor/owner) trỏ Group vai contracts]

#### Yêu cầu: Vai tuỳ biến không chiếm vai mặc định và chỉ tạo khi công ty có gói (nguồn: cr112-review-fix)
Tạo vai tuỳ biến chỉ khi công ty có entitlement còn hiệu lực của gói; khoá viewer/editor/owner dành cho vai mặc định. Bật gói từ chối nếu Group vai mặc định đang thuộc vai tuỳ biến, không ghi gì.
- Kịch bản: khi tenant_admin tạo vai cho gói chưa bật thì 422 PACK_NOT_ROLEABLE và không có Group nào được tạo [test: apps/admin-api/src/modules/app-roles/app-roles.review.int.test.ts » ADM-FR-80 · gói chưa bật cho công ty]
- Kịch bản: khi tạo vai với khoá viewer/editor/owner thì 422 ROLE_KEY_RESERVED [test: apps/admin-api/src/modules/app-roles/app-roles.review.int.test.ts » ADM-FR-80 · khoá viewer/editor/owner]
- Kịch bản: khi Group `<k'>-owner` thuộc vai tuỳ biến mà bật gói thì 409 ROLE_GROUP_CONFLICT, không entitlement/grant nào được ghi [test: apps/admin-api/src/modules/app-roles/app-roles.review.int.test.ts » ADM-FR-81 · Group `<k'>-owner` đã thuộc vai tuỳ biến]
- Kịch bản: khi phiên tenant gọi cấp agent vai cho tenant khác thì DB từ chối 42501 [test: apps/admin-api/src/modules/app-roles/app-roles.review.int.test.ts » ADM-FR-80 · scope tenant gọi cho tenant khác]

#### Yêu cầu: Bật gói tới đúng mức từ tab Ứng dụng & Gói (nguồn: cr112-review-fix)
Bật gói nhận mức đích, chỉ cấp entitlement tới mức đó; tab Ứng dụng gửi mức đích nên lỗi ở bước sau không để trần lên Quản trị. tenant_admin xem tab mà không gọi API chỉ dành cho platform.
- Kịch bản: khi bật gói với level=write thì công ty có entitlement read+write, vai Toàn quyền không hiệu lực [test: apps/admin-api/src/modules/app-roles/app-roles.review.int.test.ts » ADM-FR-78 · PUT ?level=write]
- Kịch bản: khi chọn Tắt → Sửa thì kế hoạch bật gói mức Sửa, không thu hồi gì [test: apps/admin-web/src/features/tenants/lib/apps-plan.test.ts » AC1: Tắt → Sửa]
- Kịch bản: khi tenant_admin mở tab thì trạng thái gói suy từ entitlement + vai [test: apps/admin-web/src/features/tenants/lib/apps-plan.test.ts » bật ⇔ có entitlement Xem]

#### Yêu cầu: Thanh điều hướng 6 mục phẳng (nguồn: cr121-c10-admin-nav)
Sidebar admin-web gồm Tổng quan · Công ty · Ứng dụng · Quy trình · Công cụ AI · Hệ thống, không nhóm; Features/Commands/Agents/Workflow Dify gộp vào Công cụ AI; `/commands` và `/agents` chuyển tới `/ai-tools?kind=` (c16: trang Công cụ AI thật, lọc theo loại dùng).
- Kịch bản: khi platform_admin mở admin thì sidebar đúng 6 mục theo thứ tự, không tiêu đề nhóm [test: apps/admin-web/src/features/shell/lib/nav.test.ts » platform_admin: đúng 6 mục theo thứ tự artboard Main, không nhóm]
- Kịch bản: khi vào /commands hoặc /agents thì sang /ai-tools?kind=command|agent [test: apps/admin-web/src/features/ai-tools/lib/ai-tools.test.ts » tham số URL lạ bị bỏ]

#### Yêu cầu: Công cụ AI — danh sách gộp + bật/tắt Dify theo công ty (nguồn: cr121-c16-ai-tools)
Trang `/ai-tools` (platform_admin) liệt kê MỖI DÒNG một công cụ (agent · lệnh · workflow Dify) với trạng thái, "Dùng bởi" (công ty), chip Tất cả · Đang bật · Chưa dùng · Agent · Lệnh · Workflow và ô tìm; bấm hàng mở ngăn chi tiết có "Dùng bởi" và "Công ty dùng" với công tắc bật/tắt theo công ty (nơi duy nhất; tab `workflow-tools` của trang công ty đã gỡ, URL cũ chuyển tới `/ai-tools`).
- Kịch bản: khi lọc "Chưa dùng" thì chỉ còn công cụ chưa công ty nào dùng [test: apps/admin-web/src/features/ai-tools/lib/ai-tools.test.ts » filterTools]
- Kịch bản: khi mở `?tab=workflow-tools` của công ty thì chuyển tới /ai-tools kèm thông báo [test: apps/admin-web/src/features/tenants/lib/workspace-search.test.ts » CR-121 c16 · ?tab=workflow-tools cũ]
- Kịch bản: khi bật workflow cho một công ty ở ngăn chi tiết thì dòng đó có companies_count 1 và tên công ty [test: apps/admin-api/src/modules/workflow-tools/workflow-tools.usage.int.test.ts » đọc theo tập]
- Kịch bản: khi tenant_admin gọi `/admin/ai-tools` hoặc `/companies` thì 403 [test: apps/admin-api/src/modules/workflow-tools/workflow-tools.usage.int.test.ts » vai khác platform_admin]
- Kịch bản: hành trình tìm công cụ, bật cho công ty, tải lại vẫn bật, tắt có xác nhận [test: e2e/cr121-c16-ai-tools.spec.ts » tìm công cụ → ngăn chi tiết]

#### Yêu cầu: Màn Hệ thống gom lối vào quản trị chung (nguồn: cr121-c22-system-page)
`/system` hiển thị thẻ lối vào theo vai từ một registry: platform_admin thấy Chi phí · Nhật ký · Góp ý · Tình trạng hệ thống · Secrets · Nguồn · Bước DLC · Import/Export; tenant_admin thấy Chi phí · Nhật ký · Góp ý và sidebar có mục Hệ thống.
- Kịch bản: khi tenant_admin xem registry thì chỉ có Chi phí, Nhật ký, Góp ý [test: apps/admin-web/src/features/system/lib/registry.test.ts]
- Kịch bản: khi platform_admin xem registry thì thấy đủ 8 mục [test: apps/admin-web/src/features/system/lib/registry.test.ts]
- Kịch bản: khi tenant_admin mở admin thì sidebar có Hệ thống [test: apps/admin-web/src/features/shell/lib/nav.test.ts]
- Kịch bản: khi tenant_admin bấm Hệ thống rồi Chi phí thì vào /usage [test: e2e/cr121-c22-system.spec.ts » CR-121 · tenant_admin: Hệ thống → Chi phí, chỉ thấy các mục của công ty mình]

#### Yêu cầu: Công cụ AI hiện tên agent thật và chặn tenant_admin bằng trang có lý do (nguồn: cr121-f10-ai-tools-polish)
Danh sách `/ai-tools` hiện tên agent thật (chưa đặt tên ⇒ "Agent chưa đặt tên"); tenant_admin mở bằng URL thấy trang 403 nêu lý do, không gọi API.
- Kịch bản: khi tìm theo tên agent thì ra dòng agent đó [test: apps/admin-web/src/features/ai-tools/lib/ai-tools.test.ts » bộ lọc cộng dồn (AND)]
- Kịch bản: khi đọc danh sách gộp thì tên agent khớp Hub hoặc null [test: apps/admin-api/src/modules/workflow-tools/workflow-tools.usage.int.test.ts » đọc theo tập]

#### Yêu cầu: Công cụ AI giữ đủ thao tác của danh sách workflow cũ (nguồn: cr121-f4-ai-tools-workflows)
Trên `/ai-tools`, workflow có menu hàng và ngăn chi tiết để bật/tắt, xoá (đang dùng ⇒ hộp thoại nêu agent/lệnh và cách gỡ), mở trong Dify; lọc theo secret bằng chip "Dùng secret X" (`?secret=`), nút ở trang Secrets trỏ tới đó.
- Kịch bản: khi lọc `?secret=<tên>` thì chỉ còn workflow dùng secret đó [test: apps/admin-web/src/features/ai-tools/lib/ai-tools.test.ts » lọc theo secret (nút ở Secrets) và tìm theo mã workflow]
- Kịch bản: khi danh sách gộp được đọc thì dòng workflow có secret và mã [test: apps/admin-api/src/modules/workflow-tools/workflow-tools.usage.int.test.ts » đọc theo tập]

#### Yêu cầu: Công cụ AI bật/tắt lệnh ngay trên hàng (nguồn: cr121-f4b-commands-toggle)
Menu hàng của một lệnh ở `/ai-tools` có "Bật lệnh"/"Tắt lệnh" (đọc phiên bản mới nhất, xung đột phiên bản hiện hộp thoại giải quyết, tắt có Hoàn tác).
- Kịch bản: khi chọn "Tắt lệnh" ở menu hàng thì lệnh tắt và có thông báo Hoàn tác [test: thủ công — thao tác giao diện qua hook cũ, e2e do qc viết lại]

#### Yêu cầu: Công ty ở sidebar đưa quản trị công ty vào thẳng công ty của mình (nguồn: cr121-qc-e2e-ui)
Quản trị công ty (tenant_admin) bấm Công ty ở sidebar thì vào workspace công ty mình, không thấy danh sách công ty.
- Kịch bản: khi binh (tenant_admin) bấm Công ty thì mở /tenants/<công ty acme> [test: e2e/auth.spec.ts]

#### Yêu cầu: Công cụ AI có lối tạo, editor lệnh có Xoá (nguồn: cr121-qc-e2e-ui2)
Trang Công cụ AI có nút Tạo lệnh và Tạo workflow; trang sửa lệnh có nút Xoá (gõ lại tên) thay cho menu hàng của danh sách lệnh cũ.
- Kịch bản: khi platform_admin mở Công cụ AI thì thấy Tạo lệnh [test: e2e/commands.spec.ts » ADM-FR-20 · M2-R26 · /commands → Công cụ AI (CR-121 c16): chip Lệnh, ô tìm, nút 'Tạo lệnh', hàng /dich đang bật]
- Kịch bản: khi xoá lệnh ở editor thì gõ tên rồi về Công cụ AI [test: e2e/commands.spec.ts » ADM-FR-20 · M2-R26 · xoá /tr-nhanh ở editor: alertdialog 'Xoá /tr-nhanh?' gõ tên → nút 'Xoá command' → toast 'Đã xoá /tr-nhanh' → về Công cụ AI, không còn hàng /tr-nhanh]

#### Yêu cầu: Danh mục feature nhóm theo app với tên dễ hiểu (nguồn: feature-ui)
`/features` nhóm feature theo app (suy từ registry/tiền tố key); mỗi dòng hiện tên dễ hiểu + mô tả, key kỹ thuật mono mờ, badge "Mặc định"/"Tính năng thêm"; key lạ vào nhóm "Khác".
- Kịch bản: khi key thuộc registry hoặc có tiền tố app thì vào đúng nhóm theo thứ tự app, trong nhóm Xem → Sửa → Quản trị → tính năng thêm [test: apps/admin-web/src/features/features/lib/feature-meta.test.ts » groupByApp]
- Kịch bản: khi platform_admin mở /features thì thấy nhóm "Sổ Hợp Tác", dòng han-muc-duyet có tên dễ hiểu + badge "Tính năng thêm" + key mono [test: e2e/feature-ui.spec.ts » CR-111 · /features nhóm theo app]

#### Yêu cầu: Gán tính năng cho công ty theo mức của từng app (nguồn: feature-ui)
Tab Feature của chi tiết công ty (platform_admin) hiện mỗi app một thẻ: mức Tắt/Xem/Sửa/Quản trị (cộng dồn) và công tắc tính năng thêm; Lưu một lượt cấp/thu hồi entitlement theo diff; bộ không chuẩn hiện mức cao nhất kèm "Không chuẩn" và được chuẩn hoá khi lưu.
- Kịch bản: khi chọn mức thì tập key = các mức thấp hơn + chính nó; bộ thiếu mức thấp bị nhận là không chuẩn [test: apps/admin-web/src/features/tenants/lib/feature-assign.test.ts » level ↔ keys]
- Kịch bản: khi đổi mức/công tắc thì diff chỉ gồm cấp/thu hồi cần thiết, không đụng core [test: apps/admin-web/src/features/tenants/lib/feature-assign.test.ts » diffEntitlements]
- Kịch bản: khi acme có bộ Sửa không chuẩn, chọn Quản trị + bật tính năng thêm rồi Lưu thì DB có đủ 4 entitlement; chuyển Tắt có xác nhận và thu hồi hết [test: e2e/feature-ui.spec.ts]
## CR-110 · Delta gộp 2026-11-09 (đợt cr125-wave)
- **Xác nhận thu hồi feature liệt kê tên (cr110-lowfix):** hộp xác nhận lưu tab Feature liệt kê tên thân thiện của mọi feature sẽ bị thu hồi, gồm tính năng thêm bị gỡ khi đặt app (vd Hợp đồng) về Tắt.
