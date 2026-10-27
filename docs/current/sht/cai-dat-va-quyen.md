# Sổ Hợp Tác · Cài đặt, quyền, cờ

Cập nhật: 2026-10-27 · Gộp từ: V2-L (Cài đặt), DOC-legal, delivery-opts, contract-flow, cf-esign-docusign, REP-v3(-ui), K4, engine-flag-tenant, chat-api-gate.

## 1. Quyền trong gói `contracts`
- Ba mức guard: `read` (xem), `write` (ghi), `admin` (quản lý = Group vai `contracts-owner`). Vai editor tương ứng `write` (tên Group `contracts-editor` có trong mẫu duyệt mặc định; ánh xạ đầy đủ xem "Chưa rõ"). Viewer ghi ⇒ 403 `PACK_FORBIDDEN` (kiểm trước khi đọc thân, 0 SQL). Guard: `packGuard(view, "contracts", action)`, luật `checkPackAccess` (`kit/domain/pack-access.rules.ts`).
- Hiển thị theo RLS tenant + visibility (M1/M1b): chứng từ không thấy ⇒ 404; HĐ NT cha không thấy ⇒ `frame.restricted`.
- Việc cần quyền `admin` (owner gói): xoá chứng từ; mở lại HĐ (hoặc người phụ trách, `chung-tu.md` §4); `PUT /company`; `PUT /esign/settings`; `PUT /approval-settings`/`/approval-flow`; `POST /contracts/:id/approval/reopen`; gỡ cờ đỏ (`partner-events/:id/void` dòng nghiêm trọng); `switch-preview`; bước Dify catalog (`/dify-workflows`).
- Việc `write`: tải lên/tạo giao dịch, sửa trường (HĐ chưa khoá), mốc, settle, ghi sao/việc với đối tác, ghi cờ đỏ, attach/gỡ HĐ NT, nâng thành HĐ, quyết bước duyệt (theo `can_act` của engine).
- Dock trợ lý Sổ Hợp Tác: chỉ vào hội thoại `surface=contracts`; hub-api trả 403 `CHAT_APP_DISABLED` khi Chat App tắt (chat-api-gate). Nguồn: `docs/specs/chat-api-gate/tasks.md`.

## 2. Màn Cài đặt (contracts-web, `/settings`, `SettingsDialog.tsx`; năm mục `SECTIONS` = co, rep, biz, scout, flow)
| Mục | Nội dung | Ghi |
|---|---|---|
| Công ty (`CompanyPane.tsx`) | thông tin công ty (`GET|PUT /company`); cờ duyệt `approval_enabled`; **Kho & giao hàng**: `allow_negative_stock` (mặc định tắt); **Ngưỡng cảnh báo pháp lý** `legal_warn_threshold` (mặc định 5.000.000, 0 = tắt) | chỉ `admin` ghi; nhật ký `approval_settings_audit` |
| Quy trình duyệt (`FlowPane.tsx`) | thiết kế luồng, xem trước đường đi, bước Dify (chỉ owner); ô bật ký số (`esign_enabled`) | `duyet-ky-so.md` |
| Điểm uy tín (`ScoringPane`/`ScoringV2EPane`) | theo cờ engine: HD8 hai tab theo vai; V2-E 5 ô × 3 tab + Mức & đánh giá + thử tính; ô khoá khi không phải chủ sở hữu | `doi-tac-uy-tin.md` |
| Điểm kinh doanh (`BizPane`) | chấm điểm SP | nền |
| Scout (`ScoutPane`) | tìm giá/nguồn | nền |
| Thành viên (`/settings/members`) | thành viên + vai | `manage.members.ts` |
Các mục tuỳ chọn theo vai: owner/editor thấy "Quy trình duyệt"; nút "Chỉnh quy trình duyệt" trên thẻ duyệt engine mở thẳng mục này.

## 3. Cờ và công tắc
| Cờ | Loại | Giá trị | Tác dụng |
|---|---|---|---|
| `REPUTATION_ENGINE` | env hub-api, đọc mỗi yêu cầu | `v2e` \| (vắng/lạ = `hd8`) | engine điểm hiện hành, ghi V2-E/HD8, ±10, vòng chốt tháng, nguồn "Đánh giá đối tác", lưu delta khi xác nhận mốc |
| `CONTRACTS_APPROVAL_ENGINE` | env | `on` \| khác = tắt | tắt hết = máy 2 bước; `on` + feature theo công ty = engine |
| feature `contracts-approval-engine` | Admin › Features (entitlement theo công ty) | còn hiệu lực/không `off` | cổng mở lượt duyệt engine mới |
| `ESIGN_PROVIDER` | env | `none` (mặc định) \| `selfsign` \| `docusign` | nhà cung cấp ký số; thêm env DocuSign (key, user, account, base URI, oauth host, private key file, HMAC) khi `docusign` |
| `approval_settings.esign_enabled` | theo công ty | bool | bật ký số cho công ty |
| `approval_settings.allow_negative_stock` | theo công ty | mặc định false | giao vượt tồn |
| `approval_settings.legal_warn_threshold` | theo công ty | mặc định 5.000.000 | ngưỡng pháp lý |
| `approval_settings.approval_enabled` | theo công ty | bool | tắt ⇒ xác nhận một lần là khoá, không lượt duyệt |
Ngưỡng/Group duyệt máy cũ: `approval_settings.threshold`, `level1_group_key`, `level2_group_key` (`PUT /approval-settings`).

## 4. Ghi nhật ký
`approval_settings_audit` ghi trước/sau đổi ở `PUT /company` (cờ duyệt, tồn âm, ngưỡng pháp lý) và bật/tắt ký số.

## Chưa rõ
1. Ánh xạ chính xác vai ↔ guard cho mọi route (bảng §1 chỉ kê các route đã thấy trong lát CR-097/101): chưa quét toàn bộ.
2. Nhãn hiển thị của năm mục Cài đặt chưa đối chiếu locale; ô bật ký số nằm ở mục Quy trình duyệt theo spec cf-esign-docusign, chưa mở `FlowPane` để xác nhận. Nhật ký `approval_settings_audit` chắc chắn cho `PUT /company` và `esign`; `PUT /approval-settings` chưa kiểm.
3. Biến Trello/quota admin (tenant-quotas, trello-config-ui) thuộc Admin, không ở khu vực này; chưa có `docs/current` cho Admin.
