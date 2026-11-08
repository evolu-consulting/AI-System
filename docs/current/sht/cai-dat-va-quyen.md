# Sổ Hợp Tác · Cài đặt, quyền, cờ

Cập nhật: 2026-10-27 · Gộp từ: V2-L (Cài đặt), DOC-legal, delivery-opts, contract-flow, cf-esign-docusign, REP-v3(-ui), K4, engine-flag-tenant, chat-api-gate.

## 1. Quyền trong gói `contracts`
- Ba mức guard: `read` (xem), `write` (ghi), `admin` (quản lý = Group vai `contracts-owner`). Vai editor tương ứng `write` (tên Group `contracts-editor` có trong mẫu duyệt mặc định; ánh xạ đầy đủ xem "Chưa rõ"). Viewer ghi ⇒ 403 `PACK_FORBIDDEN` (kiểm trước khi đọc thân, 0 SQL). Guard: `packGuard(view, "contracts", action)`, luật `checkPackAccess` (`kit/domain/pack-access.rules.ts`).
- Hiển thị theo RLS tenant + visibility (M1/M1b): chứng từ không thấy ⇒ 404; HĐ NT cha không thấy ⇒ `frame.restricted`.
- Việc cần quyền `admin` (owner gói): xoá chứng từ; mở lại HĐ (hoặc người phụ trách, `chung-tu.md` §4); `PUT /company`; `PUT /esign/settings`; `PUT /esign/anchors`; `PUT /approval-settings` (`PUT /approval-flow` đã bỏ, CR-105); `POST /contracts/:id/approval/reopen`; gỡ cờ đỏ (`partner-events/:id/void` dòng nghiêm trọng); `switch-preview`; bước Dify catalog (`/dify-workflows`).
- Việc `write`: tải lên/tạo giao dịch, sửa trường (HĐ chưa khoá), mốc, settle, ghi sao/việc với đối tác, ghi cờ đỏ, attach/gỡ HĐ NT, nâng thành HĐ, quyết bước duyệt (theo `can_act` của engine).
- Dock trợ lý Sổ Hợp Tác: chỉ vào hội thoại `surface=contracts`; hub-api trả 403 `CHAT_APP_DISABLED` khi Chat App tắt (chat-api-gate). Nguồn: `docs/specs/chat-api-gate/tasks.md`.

- User ngoài (`kind=external`, Community): contracts 0067 policy `ext_deny` ⇒ 0 hàng ở mọi bảng gói; người được giao HĐ, `/directory`, members-pickers không liệt kê họ; guard gói chỉ cho `community` (gộp com-c2-ext-deny, `current/community/nghiep-vu.md` §13). Chủ quản dùng Community qua Group `community-owner`.

## 2. Màn Cài đặt (contracts-web, `/settings`, `SettingsDialog.tsx`; năm mục `SECTIONS` = co, rep, biz, scout, flow)
| Mục | Nội dung | Ghi |
|---|---|---|
| Công ty (`CompanyPane.tsx`) | thông tin công ty (`GET|PUT /company`); cờ duyệt `approval_enabled`; **Kho & giao hàng**: `allow_negative_stock` (mặc định tắt); **Ngưỡng cảnh báo pháp lý** `legal_warn_threshold` (mặc định 5.000.000, 0 = tắt) | chỉ `admin` ghi; nhật ký `approval_settings_audit` |
| Quy trình duyệt | CR-105: chỉ hiện quy trình đang dùng + link editor ai-admin (§3b); ô bật ký số (`esign_enabled`) | `duyet-ky-so.md` |
| Điểm uy tín (`ScoringPane`/`ScoringV2EPane`) | theo cờ engine: HD8 hai tab theo vai; V2-E 5 ô × 3 tab + Mức & đánh giá + thử tính; ô khoá khi không phải chủ sở hữu | `doi-tac-uy-tin.md` |
| Điểm kinh doanh (`BizPane`) | chấm điểm SP | nền |
| Scout (`ScoutPane`) | tìm giá/nguồn | nền |
| Thành viên (`/settings/members`) | thành viên + vai | `manage.members.ts` |
Các mục tuỳ chọn theo vai: owner/editor thấy "Quy trình duyệt"; nút "Chỉnh quy trình duyệt" trên thẻ duyệt engine trỏ link editor ai-admin (CR-105).

## 3. Cờ và công tắc
| Cờ | Loại | Giá trị | Tác dụng |
|---|---|---|---|
| `REPUTATION_ENGINE` | env hub-api, đọc mỗi yêu cầu | `v2e` \| (vắng/lạ = `hd8`) | engine điểm hiện hành, ghi V2-E/HD8, ±10, vòng chốt tháng, nguồn "Đánh giá đối tác", lưu delta khi xác nhận mốc |
| `CONTRACTS_APPROVAL_ENGINE` | env | `on` \| khác = tắt | tắt hết = máy 2 bước; `on` + feature theo công ty = engine |
| feature `contracts-approval-engine` | Admin › Features (entitlement theo công ty) | còn hiệu lực/không `off` | cổng mở lượt duyệt engine mới |
| `ESIGN_PROVIDERS` | env | danh sách `docusign,selfsign,misa` (thắng `ESIGN_PROVIDER`) | nhà cung cấp ký số chạy song song; `ESIGN_PROVIDER` (`none` mặc định \| `selfsign` \| `docusign`) vẫn đọc khi vắng danh sách; thêm env DocuSign (key, user, account, base URI, oauth host, private key file, HMAC) khi có `docusign` |
| `CONTRACTS_ESIGN_SWEEP` / `_SWEEP_EVERY_MS` / `CONTRACTS_ESIGN_SYNC_MAX` / `_SYNC_MIN` | env | `off`; ms (300 000); 0–200 (20); phút (15) | vòng nền bước Ký số + đồng bộ phong bì (`duyet-ky-so.md` §4b) |
| `approval_settings.esign_enabled` | theo công ty | bool | bật ký số cho công ty |
| `approval_settings.esign_default_provider` | theo công ty | khoá nhà cung cấp | mặc định khi Gửi ký (owner đổi qua `PUT /esign/settings`) |
| `approval_settings.esign_anchors` | theo công ty | danh sách cụm Bên A/B | cụm chữ đặt ô ký DocuSign (`PUT /esign/anchors`, owner; `duyet-ky-so.md` §4c) |
| `approval_settings.allow_negative_stock` | theo công ty | mặc định false | giao vượt tồn |
| `approval_settings.legal_warn_threshold` | theo công ty | mặc định 5.000.000 | ngưỡng pháp lý |
| `approval_settings.approval_enabled` | theo công ty | bool | tắt ⇒ xác nhận một lần là khoá, không lượt duyệt |
Ngưỡng/Group duyệt máy cũ: `approval_settings.threshold`, `level1_group_key`, `level2_group_key` (`PUT /approval-settings`).

## 3b. Quy trình duyệt: chỉ đọc + gán khi onboarding (CR-105)

### Yêu cầu: Cài đặt › Quy trình duyệt chỉ hiện quy trình đang dùng
Bỏ form thiết kế luồng; mục hiện "Quy trình duyệt đang dùng: <tên> · v<N>" (sơ đồ chỉ xem + xem trước đường đi) và link sang editor ai-admin; `GET /approval-flow` chỉ đọc; `PUT /approval-flow` bỏ. Ô bật ký số và `PUT /approval-settings` (máy 2 bước) giữ.
- Kịch bản: khi owner mở Cài đặt › Quy trình duyệt thì thấy tên + phiên bản quy trình đang dùng và không có nút lưu luồng [test: e2e/contracts-web/approval-current.cw.ts » Cài đặt hiện quy trình đang dùng, không có form sửa]
- Kịch bản: khi gọi `GET /approval-flow` thì nhận tên, bản, cờ mặc định và các bước có tên phòng ban; `PUT /approval-flow` trả 404 [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-flow-current.int.test.ts » GET chỉ đọc quy trình đang dùng, PUT không còn]

### Yêu cầu: Gán quy trình khi onboarding tenant
Yaml tenant có `approval_process: <ký hiệu>` ⇒ gán khe `contracts.approval` sau khi bật gói; không có ⇒ chạy mặc định. Onboarding gán qua route nội bộ của hub `PUT /internal/tenants/:tid/process-slots/:slot`, xác thực bằng `HUB_INTERNAL_TOKEN` (không dùng token platform_admin tĩnh).
- Kịch bản: khi yaml có `approval_process` hợp lệ thì tenant mới có một gán tới quy trình đó [test: apps/admin-api/src/modules/tenant-onboard/application/onboard-approval-process.int.test.ts » approval_process trong yaml ⇒ gán khe]
- Kịch bản: khi yaml ghi ký hiệu không tồn tại hoặc chưa xuất bản thì báo lỗi bước gán, tenant vẫn tạo xong [test: apps/admin-api/src/modules/tenant-onboard/application/onboard-approval-process.int.test.ts » ký hiệu sai ⇒ lỗi bước, tenant vẫn tạo]

## 4. Ghi nhật ký
`approval_settings_audit` ghi trước/sau đổi ở `PUT /company` (cờ duyệt, tồn âm, ngưỡng pháp lý) và bật/tắt ký số.

## Chưa rõ
0. Bảng contracts mới sau 0067 cần policy `ext_deny` (hoặc `packs.secure_table`).
1. Ánh xạ chính xác vai ↔ guard cho mọi route (bảng §1 chỉ kê các route đã thấy trong lát CR-097/101): chưa quét toàn bộ.
2. Nhãn hiển thị của năm mục Cài đặt chưa đối chiếu locale; ô bật ký số nằm ở mục Quy trình duyệt theo spec cf-esign-docusign, chưa mở `FlowPane` để xác nhận. Nhật ký `approval_settings_audit` chắc chắn cho `PUT /company` và `esign`; `PUT /approval-settings` chưa kiểm.
3. Biến Trello/quota admin (tenant-quotas, trello-config-ui) thuộc Admin, không ở khu vực này; chưa có `docs/current` cho Admin.

## CR-118 · Delta gộp 2026-11-04 (đợt cr118-r1)
Mục dưới đây thắng nội dung cũ cùng chủ đề ở trên (lát: cr118-flow-canvas, cr118-tenant-settings).

#### Yêu cầu: Sơ đồ quy trình duyệt đang dùng của tenant dùng gói sơ đồ chung (CR-106/108/113, UW-FR-14) (nguồn: cr118-flow-canvas)
Sơ đồ chỉ đọc trong Cài đặt › Quy trình duyệt do gói chung `@ai/flow-canvas` vẽ (chế độ chỉ xem), nạp lười; hình, chữ, nhánh bỏ qua, "(mặc định)" của nhóm chuyển cấp và cảnh báo cấu hình giữ nguyên như trước.
- Kịch bản: khi có ba bước và bước hai có điều kiện thì sơ đồ xếp dọc Bắt đầu → bước → Ghi Đã duyệt, kèm nhánh bỏ qua nét đứt [test: packages/flow-canvas/src/layout/vertical.test.ts » nhánh bỏ qua (CR-108): bước có điều kiện (không phải bước đầu) ⇒ cạnh nét đứt từ node liền trước sang node liền sau]
- Kịch bản: khi nhóm chuyển cấp là mặc định thì dòng chuyển cấp có chữ "(mặc định)", khi nhóm đã bị xoá thì hiện cảnh báo thay dòng chuyển cấp [test: packages/flow-canvas/src/layout/vertical.test.ts » chiều cao node theo số dòng thông tin (chuyển cấp / cảnh báo thiếu nhóm)]
- Kịch bản: khi mở Cài đặt › Quy trình duyệt thì sơ đồ vẫn hiện đủ Bắt đầu, bước và Ghi Đã duyệt, bước bị bỏ qua theo xem trước thì mờ [test: e2e/contracts-web/approval-current.cw.ts » Cài đặt hiện quy trình đang dùng, không có form sửa]
- Kịch bản: khi loại bước là loại lạ (DLC) hay `form` thì sơ đồ vẫn vẽ chung, không huy hiệu riêng, không lỗi [test: packages/flow-canvas/src/registry.test.ts » loại lạ (DLC) ⇒ vẽ chung, không huy hiệu]

#### Yêu cầu: Cài đặt › Ứng dụng & quy trình (tenant tự sửa luật chọn quy trình) (nguồn: cr118-tenant-settings)
Quản trị công ty + chủ gói thấy mục "Ứng dụng & quy trình": mức, add-on, mỗi khe các quy trình đã gán (tên, phiên bản, sơ đồ chỉ đọc) và bộ sửa luật
chọn quy trình theo phòng ban (thêm/xoá/đổi thứ tự, nhiều phòng ban, chỉ chọn trong số đã gán, một mặc định, lưu cả danh sách theo `version`). Không
gán thêm, không sửa nội dung quy trình. Thành viên/đối tác không thấy mục.
- Kịch bản: tenant admin thêm luật theo phòng ban, chọn quy trình, đặt mặc định, Lưu ⇒ PUT đúng thân và luật khớp phòng ban chọn quy trình đó [test: e2e/contracts-web/tenant-routing.cw.ts » tenant admin thêm luật theo phòng ban ⇒ người phòng đó khởi tạo đúng quy trình]
- Kịch bản: lưu lệch `version` (409) ⇒ báo "đã có người sửa", giữ bản nháp, có nút Tải lại [test: e2e/contracts-web/tenant-routing.cw.ts » 409: báo 'đã có người sửa', giữ bản nháp, Tải lại lấy bản mới]
- Kịch bản: thành viên không thấy mục [test: e2e/contracts-web/tenant-routing.cw.ts » thành viên không thấy mục 'Ứng dụng & quy trình']
- Kịch bản: thêm/xoá/đổi thứ tự luật, chọn phòng ban, một mặc định, trần 50, kiểm trước khi lưu [test: packages/web-kit/src/routing-rules.test.ts » thêm xoá đổi thứ tự sửa luật và trần 50 luật]
- Kịch bản: lỗi 409/422 của hợp đồng ánh xạ về loại lỗi để hiện tiếng Việt [test: packages/web-kit/src/routing-rules.test.ts » mã 409/422 của hợp đồng]
- Kịch bản: contracts-web proxy `/hub-admin` và `/tenants` sang hub [test: apps/workspace-web/rsbuild.config.test.ts » proxy /hub-admin và /tenants chuyển sang hub-api]

#### Yêu cầu: Token chỉ hiện cho quản trị
Mức dùng và ô trần "token" ở Cài đặt › Dò giá chỉ hiện cho quản trị công ty/nền tảng; người bán hàng và giám đốc không thấy.
- Kịch bản: khi người không phải quản trị mở mục Dò giá thì không thấy "token" [test: thủ công — hiển thị theo vai ở ScoutQuota, không có logic tách riêng để kiểm đơn vị]

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Quy trình duyệt chỉ chọn ở một nơi (nguồn: cr125-ux-s2-current-flow)
Cài đặt chỉ có MỘT mục quy trình ("Quy trình duyệt") và đọc cùng nguồn với trang Quy trình của công ty (flow Bật cho hợp đồng); không còn mục "Ứng dụng & quy trình" hay quy trình mặc định của khe; câu chưa có quy trình không đẩy sang quản trị nền tảng.
- Kịch bản: khi công ty chưa có quy trình Bật thì Cài đặt nói quản trị công ty thêm ở trang Quy trình và chỉ có một mục quy trình [test: e2e/journey-approval/cr125-s2-settings-flow.spec.ts » 1 · chưa có quy trình Bật: Cài đặt nói rõ ai làm gì, không đẩy sang quản trị nền tảng, chỉ MỘT mục quy trình]
- Kịch bản: khi quản trị gán flow thì Cài đặt hiện cùng tên với tab Quy trình [test: e2e/journey-approval/cr125-s2-settings-flow.spec.ts » 2 · platform admin gán flow ⇒ Cài đặt hiện CÙNG tên với tab Quy trình, không còn 'Quy trình HĐ mặc định']
- Kịch bản: khi hỏi flow đang chạy thì lấy flow Bật của company_flows, flow Tắt không tính [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-flow-current.int.test.ts » GET = flow Bật của company_flows: tên, bản, bước theo thứ tự, phòng ban theo tên công ty]
- Kịch bản: khi chỉ có flow Tắt thì trả 404, không có mặc định của khe [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-flow-current.int.test.ts » công ty chỉ có flow Tắt ⇒ 404 (không có 'mặc định của khe'), PUT không còn route]
- Kịch bản: khi stage flow có bước duyệt/ký số/thông báo thì hiện đúng thứ tự, bỏ bước kỹ thuật [test: apps/hub-api/src/modules/packs/contracts/domain/event-flow-steps.rules.test.ts » Duyệt 2 cấp: hai bước duyệt + ký số + thông báo, bỏ Chờ ký xong / Kết thúc, theo thứ tự step]
- Kịch bản: khi mở khoá cũ ?sec=apps thì vào mục Quy trình duyệt [test: apps/workspace-web/src/features/settings/lib/section-key.test.ts » CR-125 · khoá cũ apps ⇒ mục Quy trình duyệt (đã gộp một cửa)]


## CR-108/110/113/118/121 · Delta gộp 2026-11-09 (đợt cr125-wave)
Mục dưới thắng nội dung cũ cùng chủ đề ở trên (kể cả §3b). Kịch bản và test: `docs/specs/<lát>/tasks.md`.

### Mở thẳng một mục Cài đặt bằng đường dẫn (cr110-sht-sec)
`/settings?sec=<co|rep|biz|scout|flow>` mở hộp thoại Cài đặt ở mục đó rồi về Tổng quan; khoá lạ mở mục mặc định (Công ty); không có `sec` giữ nguyên chuyển sang Thành viên. Quyền xem/sửa theo hộp thoại hiện có. Community dùng đường này cho nhóm Sổ Hợp Tác trong Cài đặt của nó.

### Cài đặt › Quy trình duyệt (pl-tenant-canvas, flow-ui-clarity, cr113-approve-ui)
- Quy trình đang dùng hiện là canvas chỉ đọc (Bắt đầu → các bước → "Ghi Đã duyệt" khoá hệ thống; mỗi bước có tên, phòng ban, huy hiệu Có điều kiện / Ký số / Dify, tóm tắt điều kiện); công tắc "Sơ đồ | Danh sách" mặc định Sơ đồ. "Xem trước đường đi" làm mờ bước bị bỏ qua.
- `GET /approval-flow` trả thêm (nếu có) `due_h`, `remind_every_h`, `escalate_group_name`, `approver_count` (số thành viên còn dùng được của nhóm duyệt, một câu SQL cho cả quy trình); node và danh sách hiện "Hạn 24 giờ · nhắc mỗi 8 giờ", "3 người duyệt", "Quá hạn ⇒ chuyển <nhóm>" (kèm "(mặc định)" khi là nhóm mặc định); thiếu ⇒ ẩn.
- Bước có điều kiện (không phải bước đầu): cạnh vào ghi điều kiện ("Giá trị ≥ 500.000.000"), thêm cạnh nét đứt từ node trước sang node sau nhãn "Không thoả ⇒ bỏ qua", sáng lên khi xem trước bỏ qua bước đó; chú giải dưới canvas.
- Xem trước: ô "Giá trị mẫu" định dạng vi-VN khi gõ, nút nhanh "100 triệu", "500 triệu", "1 tỷ", "Để trống"; dòng "Hợp đồng này đi qua N/M bước: …".
- Hộp "Luật duyệt" dưới sơ đồ: Toàn quyền duyệt thay được mọi bước (lượt duyệt thay được ghi rõ); bước có hạn quá hạn tự chuyển cho nhóm chuyển cấp (mặc định Toàn quyền).
- Công ty chưa gán: huy hiệu "Đang dùng mặc định" + "Công ty bạn chưa được gán quy trình riêng, đang dùng quy trình mặc định của hệ thống."; lời dẫn "Mục này chỉ để xem. Muốn đổi quy trình, liên hệ quản trị nền tảng." Ở mục này, khi không có nháp chưa lưu, đầu hộp thoại thay "Khôi phục tất cả / Bỏ thay đổi / Lưu cài đặt" bằng ghi chú; sang mục khác thanh hiện lại.

### Cài đặt › Ứng dụng & quy trình (cr118-def-path-fix, cr118-routing-diagram)
Luật chọn quy trình trỏ tới quy trình đã xoá / chưa xuất bản (server trả `unavailable`) hiện nhãn "Quy trình đã bị xoá / chưa xuất bản"; lưu bị chặn tới khi sửa hoặc xoá luật (422 `ROUTING_PROCESS_UNAVAILABLE` ⇒ câu tiếng Việt). Hợp đồng đã đúng đường `/tenants/:tid/process-routing/...` (không `/hub-admin`). HĐ ngừng khởi tạo vì không có luật khớp / quy trình bị xoá ⇒ thẻ duyệt hiện câu rõ cho chủ/quản trị (`FLOW_ROUTE_NONE` / `FLOW_ROUTE_UNAVAILABLE`). Sơ đồ chỉ đọc xem được cho MỌI quy trình đã gán của khe, chỉ nạp khi mở; 404 hoặc thân không đọc được ⇒ "không xem được".

### Feature `contracts-approval-engine` không còn là công tắc (cr121-d4-assign-engine)
Admin không còn công tắc "Duyệt theo quy trình" và không liệt kê/cấp/thu hồi feature `contracts-approval-engine`; seed/onboard không cấp feature đó; khe "Duyệt hợp đồng" không còn đòi add-on ở xem trước (đủ mức Sửa là hiện).

### Người duyệt của bước thấy HĐ ở chế độ `org` (reviewer-visible)
Ở chế độ thấy `org`, ngoài cây quản lý của chủ HĐ, người quyết được một bước duyệt engine đang mở (thuộc Group của bước, được giao đích danh/chuyển tiếp, cửa trưởng phòng/người duyệt cụ thể, Group chuyển cấp, Group "cũng quyết") và người đã quyết một bước của HĐ ĐỌC được HĐ (chi tiết, thẻ duyệt, hàng con) và thấy nó trong "Việc của tôi". Chỉ đọc: không sửa trường/gán người; chỉ lệnh duyệt (Đạt/Chưa đạt/Từ chối/ghi Đã duyệt) ghi được hàng HĐ. Thành viên Group khác của bước đã đóng mà không quyết thì không thấy nữa. Chủ gói và chế độ `tenant` như cũ (cần migration 0070 trên prod).
## CR-120 · Delta gộp 2026-11-09 (đợt cr125-wave)

#### Yêu cầu: Menu tài khoản và đăng nhập quay về (nguồn: cr120-handson-fixes)
Menu tài khoản đặt tên theo nơi mở (Cài đặt Sổ Hợp Tác / Cài đặt Community / Thành viên & điểm đối tác), mỗi mục một icon; đăng nhập từ trang quay về SSO về `/contracts`; route gốc của app nằm dưới `/contracts` không bị coi là id HĐ cũ; mã hợp đồng sai (400/422) hiện câu dịch "Không tìm thấy hợp đồng".
