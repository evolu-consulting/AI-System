# Sổ Hợp Tác · Duyệt, khoá, ký số

Cập nhật: 2026-10-27 · Gộp từ: contract-flow (CR-098, ADR-0030), engine-flag-tenant, M3-decouple/HD3 (máy cũ), k1-lock/lock-strict (CR-097), cf-esign-docusign.

## 1. Hai cơ chế duyệt HĐ
Bảng `contracts.approvals` có `mode ∈ machine | engine`. **Hàng cũ `machine` chạy nốt máy cũ**; lượt mới mở ở chế độ engine **chỉ khi** engine được phép cho công ty (§3).

### 1a. Máy 2 bước (`machine`)
`extracting` (AI đọc) → `level1` → (giá trị < ngưỡng) `done`; (≥ ngưỡng hoặc trống) → `level2` → `done`. Cấp 1: Group cấp 1 (người bắt đầu **được**). Cấp 2: Group cấp 2, **người bắt đầu bị chặn** mọi thao tác. Từ chối + lý do ⇒ `rejected`; Đọc lại + lý do ⇒ `extracting`. Ngưỡng/nhóm lấy từ `approval_settings` (`GET|PUT /approval-settings`). Code: `H/domain/approval-machine.rules.ts`, `approval-def.rules.ts` (`needsLevel2`), `H/application/approval.usecase.ts`.

### 1b. Engine quy trình (`engine`) — contract-flow
- **Mẫu luồng theo công ty** `contracts.approval_flows` (Cài đặt › Quy trình duyệt; `GET|PUT /approval-flow`, khoá lạc quan `version`, lệch ⇒ 409 `VERSION_CONFLICT`). Tối đa 8 bước người dùng thấy. Bước review: `{key, name, department_group_id, head_only, due_h, remind_every_h, escalate_group_id, exclude_starter, when}`; `when` = AND/OR trên `deal ∈ {buy,sell,referral}` và `total_value` (≥/>/≤/<; tối đa 6 vế; trống ⇒ cần bước). Bước 0 = bước soạn không điều kiện. Bước Dify `{workflow_key}` chọn từ catalog (`GET /dify-workflows`, quyền admin; PUT kiểm ⇒ 422 `APPROVAL_FLOW_INVALID`).
- **Mẫu mặc định** (chưa lưu, version 1): cấp 1 → cấp 2 `exclude_starter` chỉ khi giá trị ≥ ngưỡng hoặc trống ⇒ giữ đúng hành vi 2 bước.
- `compileDef` biên dịch ra def engine `contracts-approval` (`s0 → route → s1..sn → finalize`); run chụp def ⇒ sửa luồng không ảnh hưởng run đang chạy. Toàn quyền quyết: mọi bước Group còn thêm `also_group_ids` = Group cấp 2 + `contracts-owner`.
- `head_only`: chỉ trưởng phòng quyết (phòng không có trưởng ⇒ cả nhóm). Quá hạn: nhắc vào chuông + chuyển cấp sang nhóm khác. Trả lại (cần góp ý; chỉ từ bước ≥ 1) về bước soạn; Từ chối cần lý do; Đọc lại = huỷ run, đọc AI, mở run mới.
- Thao tác: `POST /contracts/:id/approval` (action approve/reject/redo/**return**); thẻ `GET /contracts/:id/approval` (`mode`, `steps[]`, `task_id`, `can_act`, `block_reason`, `finalizes_on_approve`, `needs_reopen`); `POST /contracts/:id/approval/reopen` (admin) mở lại run bị kẹt. Bước cuối: `pending_links` (gắn SP) lưu trong tx gói rồi `act`; tool `contracts-finalize` kiểm lại bước bắt buộc theo giá trị hiện tại, `needs_review → active`, trigger K1 khoá, `confirmed_by = lastApprover`.
- Run lỗi/kết thúc bất thường **không** quay về máy cũ: giữ `mode='engine'`, `feedback=ENGINE_RUN_<STATUS>`, thẻ có "Mở lại quy trình". Reconcile theo lô trong `approval-sweep`.
- Run gắn gói (`pack_key`) không chịu trần run/tenant của engine. Chỉ gói huỷ được run (`cancelSys`).
- "Việc của tôi": `GET /my-work` có `approvals[]` khi engine bật; Tổng quan hiện "Chờ tôi duyệt". `GET /groups` trả `[{id,name}]` mọi Group tenant.
- Tenant tắt duyệt (`approval_on()` false): lượt `cancelled`, không run engine, trang hiện xác nhận-và-lưu (khoá khi bấm một lần).
- Code: `H/application/approval-engine*.ts`, `approval-flow*.ts`, `H/domain/approval-flow*.rules.ts`, `H/adapters/approval-engine*.ts`, `approval-sweep.*`, `W/features/contract-approval/**`, `W/features/settings/components/Flow*.tsx`. Engine ở Hub: `pack-runs*` (hub migration 0058–0060).

## 2. Khoá sau xác nhận (K1)
Xác nhận xong = khoá cứng (tenant tắt duyệt: bấm xác nhận là khoá; bật duyệt: khoá khi duyệt xong). Chi tiết thao tác được/không: `chung-tu.md` §4. Giao dịch (`deal`) không khoá. Mở lại: người phụ trách hoặc owner (`chung-tu.md` §4).

## 3. Cờ bật engine
- Env `CONTRACTS_APPROVAL_ENGINE`: ≠ `on` ⇒ tắt hết (công tắc khẩn, chỉ máy cũ). `on` ⇒ chỉ công ty có feature `contracts-approval-engine` (entitlement còn hiệu lực, feature không `off`); thiếu ⇒ máy cũ (fail-closed). Cổng chỉ ở **mở lượt mới** (kể cả heal của sweep); lượt đã `engine` chạy nốt không cổng. Đọc từ cache cấu hình, 0 SQL. Cấp ở trang Features của Admin (migration admin 0026 cấp sẵn cho `demo` và tenant đã có lượt engine). Nguồn: engine-flag-tenant.

## 4. Ký số (cf-esign-docusign)
- Cổng trung lập `ESignProvider`; adapter chọn bằng env `ESIGN_PROVIDER` = `none` (mặc định) | `selfsign` (ký thử demo) | `docusign`. Bật theo công ty ở `approval_settings.esign_enabled` (`GET|PUT /esign/settings`: đọc `read`, đổi `admin`; trả `{configured, enabled, provider, demo}`).
- Điều kiện: HĐ **đã khoá** (đã duyệt xong), tệp **PDF** (DOCX/ảnh ⇒ 422 `ESIGN_UNSUPPORTED_FILE`). Server sinh **trang ký cuối** (PDF A4, ASCII) nối làm tài liệu 2 của envelope, toạ độ ô ký cố định.
- API: `GET|POST /contracts/:id/esign` (POST `{signers[]}` tuần tự, `write`), `POST …/refresh`, `POST …/sign-url` (chỉ người ký nhúng = chính user; email trùng email user gửi), `POST …/void`, `GET …/signed-link`; webhook `POST /pack/contracts/esign/webhook/:provider` không JWT, adapter tự xác thực (DocuSign HMAC-SHA256, thiếu khoá ⇒ 401); chỉ tin `envelopeId` rồi đọc trạng thái thật từ nhà cung cấp.
- Bảng `contracts.esign_envelopes` (RLS tenant), không FK tới `contracts`/`files`; một envelope chờ mỗi HĐ (index một phần); "Bản đã ký" idempotent (khoá hàng `FOR UPDATE`, webhook lặp không thêm tệp). Trạng thái: sent → delivered → completed | declined | voided.
- `selfsign`: ký xong ở lần đọc đầu; "Bản đã ký" = PDF gốc đổi tên `-ky-thu.pdf`, **không** đóng dấu/PAdES.
- DocuSign: JWT Grant RS256, cache token tới hết hạn − 60 s.
- Code: `H/domain/esign.rules.ts`, `H/application/esign.usecase.ts`, `H/adapters/{esign.*,docusign.*}.ts`, `MG/0054_esign.sql`, `W/features/contract-esign/**`.

## Chưa rõ
1. Trạng thái bật `CONTRACTS_APPROVAL_ENGINE` trên prod và công ty nào có feature `contracts-approval-engine`: STATE ghi "prod: chỉ demo" (2026-10-27), chưa kiểm env thật.
2. DocuSign chưa thử với dịch vụ thật (chỉ server giả); định dạng Connect giả định JSON (`data.envelopeId`). Chọn CA Việt Nam = thêm adapter mới (chưa có).
3. Envelope đang chờ không tự huỷ khi HĐ mở lại; HĐ bị xoá để lại envelope mồ côi (vô hại, chưa dọn).
4. Chuông/inbox hub "cần duyệt" không gửi thêm cho Group "toàn quyền" (thẻ + Việc của tôi của gói đã có); mẫu đã lưu không tự đồng bộ khi đổi Group cấp 2 ở cài đặt tới lần lưu mẫu kế.
5. Thẻ duyệt chưa có hành động "Thử lại" cho bước Dify lỗi (xử lý ở màn quy trình).
6. Tên phòng ở thẻ duyệt cho người không phải admin dựa vào `GET /groups`; không resolve tên trưởng phòng.
