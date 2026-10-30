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
