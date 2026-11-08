# Sổ Hợp Tác · Duyệt, khoá, ký số

Cập nhật: 2026-10-27 · Gộp từ: contract-flow (CR-098, ADR-0030), engine-flag-tenant, M3-decouple/HD3 (máy cũ), k1-lock/lock-strict (CR-097), cf-esign-docusign, esign-multi, esign-anchor(+fix), esign-flow(+fix), esign-sweep, esign-sweep2.

## 1. Hai cơ chế duyệt HĐ
Bảng `contracts.approvals` có `mode ∈ machine | engine`. **Hàng cũ `machine` chạy nốt máy cũ**; lượt mới mở ở chế độ engine **chỉ khi** engine được phép cho công ty (§3).

### 1a. Máy 2 bước (`machine`)
`extracting` (AI đọc) → `level1` → (giá trị < ngưỡng) `done`; (≥ ngưỡng hoặc trống) → `level2` → `done`. Cấp 1: Group cấp 1 (người bắt đầu **được**). Cấp 2: Group cấp 2, **người bắt đầu bị chặn** mọi thao tác. Từ chối + lý do ⇒ `rejected`; Đọc lại + lý do ⇒ `extracting`. Ngưỡng/nhóm lấy từ `approval_settings` (`GET|PUT /approval-settings`). Code: `H/domain/approval-machine.rules.ts`, `approval-def.rules.ts` (`needsLevel2`), `H/application/approval.usecase.ts`.

### 1b. Engine quy trình (`engine`) — contract-flow
- ⚠ Từ CR-105 mẫu theo công ty `contracts.approval_flows` và `PUT /approval-flow` không còn là nguồn chạy; quy trình lấy từ thư viện (§1c, `engine/thu-vien-quy-trinh.md`). Phần dưới còn đúng cho cấu trúc bước và `compileDef`.
- **Mẫu luồng theo công ty** `contracts.approval_flows` (Cài đặt › Quy trình duyệt; `GET|PUT /approval-flow`, khoá lạc quan `version`, lệch ⇒ 409 `VERSION_CONFLICT`). Tối đa 8 bước người dùng thấy. Bước review: `{key, name, department_group_id, head_only, due_h, remind_every_h, escalate_group_id, exclude_starter, when}`; `when` = AND/OR trên `deal ∈ {buy,sell,referral}` và `total_value` (≥/>/≤/<; tối đa 6 vế; trống ⇒ cần bước). Bước 0 = bước soạn không điều kiện. Bước Dify `{workflow_key}` chọn từ catalog (`GET /dify-workflows`, quyền admin; PUT kiểm ⇒ 422 `APPROVAL_FLOW_INVALID`).
- **Mẫu mặc định** (chưa lưu, version 1): cấp 1 → cấp 2 `exclude_starter` chỉ khi giá trị ≥ ngưỡng hoặc trống ⇒ giữ đúng hành vi 2 bước.
- `compileDef` biên dịch ra def engine `contracts-approval` (`s0 → route → s1..sn → finalize`); run chụp def ⇒ sửa luồng không ảnh hưởng run đang chạy. Toàn quyền quyết: mọi bước Group còn thêm `also_group_ids` = Group cấp 2 + `contracts-owner`.
- `head_only`: chỉ trưởng phòng quyết (phòng không có trưởng ⇒ cả nhóm). Quá hạn: nhắc vào chuông + chuyển cấp sang nhóm khác. Trả lại (cần góp ý; chỉ từ bước ≥ 1) về bước soạn; Từ chối cần lý do; Đọc lại = huỷ run, đọc AI, mở run mới.
- Thao tác: `POST /contracts/:id/approval` (action approve/reject/redo/**return**); thẻ `GET /contracts/:id/approval` (`mode`, `steps[]`, `task_id`, `can_act`, `block_reason`, `finalizes_on_approve`, `needs_reopen`); `POST /contracts/:id/approval/reopen` (admin) mở lại run bị kẹt. Bước cuối: `pending_links` (gắn SP) lưu trong tx gói rồi `act`; tool `contracts-finalize` kiểm lại bước bắt buộc theo giá trị hiện tại, `needs_review → active`, trigger K1 khoá, `confirmed_by = lastApprover`.
- Run lỗi/kết thúc bất thường **không** quay về máy cũ: giữ `mode='engine'`, `feedback=ENGINE_RUN_<STATUS>`, thẻ có "Mở lại quy trình". Reconcile theo lô trong `approval-sweep`.
- Run gắn gói (`pack_key`) không chịu trần run/tenant của engine. Chỉ gói huỷ được run (`cancelSys`).
- "Việc của tôi": `GET /my-work` có `approvals[]` khi engine bật; Tổng quan hiện "Chờ tôi duyệt". `GET /groups` trả `[{id,name}]` mọi Group tenant.
- Tenant tắt duyệt (`approval_on()` false): lượt `cancelled`, không run engine, trang hiện xác nhận-và-lưu (khoá khi bấm một lần).
- **Người duyệt cụ thể** (esign-flow): bước review có thêm `approver_user_id?` (thay phòng): cửa một người như `head_only` và thắng nó; chuông/nhắc/Việc của tôi/cổng quyết đều theo người đó; Group Toàn quyền vẫn quyết qua `also_group_ids`. Chỉ hiệu lực khi user cùng tenant còn dùng được (khoá/xoá ⇒ rơi về cửa trưởng phòng / cả Group); `def.rules` kiểm user thuộc tenant (`PROCESS_REF_INVALID` ref `user`). Lưu mẫu: người cụ thể (duyệt + ký) phải thuộc tenant + quyền `write` gói, sai ⇒ 422 `APPROVAL_FLOW_INVALID` `USER_NOT_MEMBER`; người cụ thể không phòng mà tenant không còn Group Toàn quyền ⇒ `GROUP_REQUIRED`. Nguồn: esign-flow(+fix).
- **Bước Ký số trong mẫu** (esign-flow): bước `kind:"esign"` tối đa 1, luôn cuối (`ESIGN_MULTI`, `ESIGN_NOT_LAST`), gồm `company_signer{mode owner|dept_head|user, department_group_id?, user_id?}` (`SIGNER_GROUP_REQUIRED`, `SIGNER_USER_REQUIRED`), `partner_signs`, `order`, `provider|null`, `due_h`, `remind_every_h`, `escalate_group_id`. Không biên dịch thành stage engine (`engineSteps()` bỏ nó) — gói chạy sau "Đã duyệt"; trạng thái ở `contracts.approvals.esign_status|reason|signer|at` của lượt hiện tại. Thẻ duyệt có `esign{key,name,status,reason,can_resend,due_at?,overdue?,reminded_at?}`; UI hiện "Hạn ký", nhãn "Quá hạn", "Đã nhắc lúc". Không có bước Ký số ⇒ Gửi ký tay như cũ. Chi tiết gửi/theo dõi: §4b.
- Code: `H/application/approval-engine*.ts`, `approval-flow*.ts`, `H/domain/approval-flow*.rules.ts`, `H/adapters/approval-engine*.ts`, `approval-sweep.*`, `W/features/contract-approval/**`, `W/features/settings/components/Flow*.tsx`. Engine ở Hub: `pack-runs*` (hub migration 0058–0060).

## 1c. Quy trình lấy từ thư viện (CR-105, thay mẫu `approval_flows` của §1b)

### Yêu cầu: Engine mở lượt theo quy trình gán cho tenant
Mỗi lần mở lượt duyệt (kể cả mở lại), gói tra quy trình theo tenant của HĐ: gán của khe `contracts.approval`, không có ⇒ mặc định; lấy bản xuất bản, phân giải mã phòng ban theo tenant, đồng bộ def tenant `contracts-approval` khi `source_ref` khác; lượt đang chạy giữ snapshot. Không còn đọc `contracts.approval_flows`.
- Kịch bản: khi X gán A, Y gán B thì HĐ của X chạy các bước của A, HĐ của Y chạy các bước của B [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine-slot.int.test.ts » X gán A, Y gán B chạy đúng quy trình]
- Kịch bản: khi đổi gán X từ A sang B lúc một HĐ đang duyệt thì lượt đó chạy hết theo A, HĐ vào duyệt sau chạy B [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine-slot.int.test.ts » đổi gán: lượt dở giữ snapshot, lượt mới chạy quy trình mới]
- Kịch bản: khi Group theo mã đã bị xoá khỏi tenant thì lượt kẹt `FLOW_GROUP_MISSING:<mã>` (không về máy cũ; xem mục CR-107 cuối file) [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine-slot.int.test.ts » thiếu Group lúc chạy ⇒ lượt kẹt FLOW_GROUP_MISSING]
- Kịch bản: khi mở lượt với 10.000 tenant và 500 bản phát hành thì `resolveSlot` p95 ≤ 5 ms với số câu SQL cố định [test: apps/hub-api/src/modules/processes/library/slot-resolve.perf.int.test.ts » resolveSlot p95 ≤ 5 ms]

### Yêu cầu: Chuyển mẫu cũ sang thư viện
Tenant có `contracts.approval_flows` (hoặc cài đặt duyệt khác mặc định) ⇒ quy trình thư viện riêng "Quy trình HĐ – <tên tenant>" đã xuất bản + gán; tenant khác chạy mặc định; id phòng ban đổi sang mã; chạy lại không tạo trùng.
- Kịch bản: khi chạy script hai lần trên tenant có mẫu riêng thì có đúng một quy trình riêng, một gán, bước dùng mã phòng ban [test: apps/hub-api/scripts/process-library-backfill.int.test.ts » chạy hai lần: một quy trình riêng, một gán, bước theo mã]
- Kịch bản: khi tenant chưa lưu mẫu và cài đặt mặc định thì không có gán và lượt mới chạy quy trình mặc định [test: apps/hub-api/scripts/process-library-backfill.int.test.ts » tenant chưa lưu mẫu không gán, chạy mặc định]

## 2. Khoá sau xác nhận (K1)
Xác nhận xong = khoá cứng (tenant tắt duyệt: bấm xác nhận là khoá; bật duyệt: khoá khi duyệt xong). Chi tiết thao tác được/không: `chung-tu.md` §4. Giao dịch (`deal`) không khoá. Mở lại: người phụ trách hoặc owner (`chung-tu.md` §4).

## 3. Cờ bật engine
- **Đã gỡ (CR-121 A-2/D-4).** Không còn env `CONTRACTS_APPROVAL_ENGINE`, cổng "đã gán quy trình", feature `contracts-approval-engine` hay ghi chú `engine_off`: mọi lượt duyệt MỚI luôn chạy engine (xem mục CR-121 cuối file).

## 4. Ký số (cf-esign-docusign, esign-multi, esign-anchor)
- Cổng trung lập `ESignProvider`; registry nhiều nhà cung cấp song song (`H/domain/esign.providers.ts`): env **`ESIGN_PROVIDERS`** = danh sách theo thứ tự (`docusign`, `selfsign`, `misa`; khoá lạ/`none`/trùng bị bỏ). Đặt (khác rỗng) thì **thắng** `ESIGN_PROVIDER` (cũ, vẫn đọc khi vắng danh sách; `none` mặc định). Prod: `ESIGN_PROVIDERS=docusign,selfsign` (docusign đầu = mặc định). Mỗi nhà cung cấp có `kind`: docusign = `envelope`, selfsign/misa = `ca`. Khả dụng khi đủ cấu hình env + có FileBox; `misa` mới khai báo, chưa khả dụng (chờ Client ID, chưa có adapter).
- Bật theo công ty ở `approval_settings.esign_enabled`; nhà cung cấp mặc định theo công ty `approval_settings.esign_default_provider` (migration `MG/0061_esign_multi.sql`, CHECK định dạng). Mặc định lưu không còn khả dụng ⇒ tự rơi về khả dụng đầu tiên, KHÔNG xoá giá trị đã lưu.
- `GET /esign/settings` (`read`): `{configured, enabled, provider, demo, providers[{key,label,kind,available,legal}], default_provider}` — liệt kê MỌI nhà cung cấp trong env (cả `available:false`); `provider`/`demo` = mặc định hiệu lực. `PUT` (`admin` = owner) nhận `{enabled?, default_provider?}`, trường vắng = giữ, mặc định phải khả dụng (⇒ 422), audit before/after.
- Điều kiện: HĐ **đã khoá** (đã duyệt xong), tệp **PDF** (DOCX/ảnh ⇒ 422 `ESIGN_UNSUPPORTED_FILE`). Công ty tắt ⇒ 409 `ESIGN_DISABLED` (kiểm trước). DocuSign: nếu đặt được MỌI người ký trong văn bản (§4c) thì chỉ tài liệu HĐ; không thì server sinh **trang ký cuối** làm tài liệu 2: HTML UTF-8 (giữ dấu tiếng Việt, `fileExtension: "html"`, DocuSign tự chuyển PDF), bảng Bên A (công ty) / Bên B… (đối tác theo thứ tự), escape mọi trường, ô ký/ngày theo anchor chữ trắng `\sN\`/`\dN\` (`anchorIgnoreIfNotPresent=false`). Selfsign không cần trang ký.
- Người ký công ty = **tài khoản gửi** (tối đa MỘT, tên trống ⇒ dùng email, luôn ký nhúng `client_user_id` = người gửi; name/email client gửi lên được chấp nhận nhưng bị bỏ qua); không có email ⇒ 422 `ESIGN_SIGNER_NO_EMAIL`. "Ký ngay" chỉ người ký công ty (khác ⇒ 403 `ESIGN_NOT_SIGNER`). Người ký lưu `provider` + `certificate_ref` (jsonb `signers`; envelope out thêm `provider_label`).
- API: `GET|POST /contracts/:id/esign` (POST `{signers[], provider?}` tuần tự, `write`; `provider` vắng ⇒ mặc định, không khả dụng/lạ ⇒ 422 `ESIGN_PROVIDER_UNAVAILABLE`), `POST …/refresh`, `POST …/sign-url` (chỉ người ký nhúng = chính user; email trùng email user gửi; `provider?` chỉ nhận khi phong bì loại `ca` và provider chọn cũng `ca` + khả dụng, khác ⇒ 422; ghi `signers[i].provider`, `certificate_ref=null`), `POST …/void`, `GET …/signed-link`; lệnh sau gửi dùng adapter theo `envelope.provider` (đã gỡ khỏi env ⇒ refresh không làm gì, sign-url/void 409 `ESIGN_DISABLED`; webhook chỉ xử lý envelope có `provider` = khoá route); webhook `POST /pack/contracts/esign/webhook/:provider` không JWT, adapter tự xác thực (DocuSign HMAC-SHA256, thiếu khoá ⇒ 401); chỉ tin `envelopeId` rồi đọc trạng thái thật từ nhà cung cấp.
- Bảng `contracts.esign_envelopes` (RLS tenant), không FK tới `contracts`/`files`; một envelope chờ mỗi HĐ (index một phần); "Bản đã ký" idempotent (khoá hàng `FOR UPDATE`, webhook lặp không thêm tệp). Trạng thái: sent → delivered → completed | declined | voided.
- Người ký công ty (`signers[].client_user_id`, role `company`) **ĐỌC** được HĐ dù ngoài cây quản lý của chủ HĐ (chế độ thấy `org`) khi phong bì của HĐ ở `sent`/`delivered`/`completed`/`declined` — mở trang HĐ, "Ký ngay", làm mới, và vẫn xem HĐ mình vừa ký/đã từ chối; `voided` (mở lại/quá hạn huỷ) không tính. Chỉ đọc (policy UPDATE không đổi), theo tenant. Hàm `contracts.esign_signer_contract_ids()` trong policy SELECT `contracts_visible` (MG/0083 + 0084, index GIN `signers`).
- `selfsign`: ký xong ở lần đọc đầu; "Bản đã ký" = PDF gốc đổi tên `-ky-thu.pdf`, **không** đóng dấu/PAdES.
- DocuSign: JWT Grant RS256, cache token tới hết hạn − 60 s.
- Code: `H/domain/esign.rules.ts`, `esign.providers.ts`, `H/application/esign.usecase.ts`, `H/adapters/{esign.*,docusign.*}.ts`, `H/esign.mount.ts`, `MG/0054_esign.sql`, `MG/0061_esign_multi.sql`, `W/features/contract-esign/**`.

### 4b. Bước Ký số trong luồng duyệt (esign-flow, esign-sweep, esign-sweep2)
- **Gửi tự động:** tool finalize xong (SAU commit) ⇒ `afterApproved` (claim idempotent) ⇒ người ký công ty theo cấu hình bước (không phải người bấm; phải còn active/không khoá, còn quyền ghi gói, và THẤY HĐ theo RLS của chính họ, không ⇒ `NO_SIGNER`) ⇒ email đối tác từ liên hệ đối tác (parse bằng `ESignSignerSchema`, sai ⇒ `NO_PARTNER_EMAIL`) ⇒ `esign.sendSystem` (scope hệ thống) ⇒ `esign_status=sent` + chuông người ký. Lỗi gửi (nhà cung cấp tắt/không PDF/…) ⇒ `needs_decision` `SEND_FAILED`, không ném lại tool finalize (HĐ đã khoá).
- **Trạng thái cuối:** hook `onStatus` của use case ký số (webhook/làm mới/đồng bộ nền): `completed` ⇒ `completed`; `declined|voided` ⇒ `needs_decision` + chuông người phụ trách (có nhãn HĐ). Một câu `update … where esign_status='sent' returning`, chuông chỉ khi có hàng; chỉ tác động lượt hiện tại đang `sent` (webhook muộn của phong bì cũ không đổi gì).
- **Gửi lại:** `POST /contracts/:id/approval/esign-resend` (người phụ trách/owner gói; `can_resend` cả cho owner). Nhận được ở `needs_decision` và ở `sending` kẹt quá `ESIGN_SENDING_STALE_MIN` = 10 phút (theo `esign_at`).
- **Mở lại HĐ (K4) huỷ phong bì đang mở** (`esign.voidOpen`; bản đã ký cũ giữ). Huỷ ở nhà cung cấp hụt ⇒ GIỮ phong bì mở, `reason=void-pending:contract-reopened` + log; làm mới/webhook/đồng bộ nền thử huỷ lại (`application/esign-void.ts`).
- **Vòng nền** `application/esign-sweep.ts` (scope hệ thống, quét mọi tenant bật gói, mỗi tenant một tx, ≤ 3 câu SQL/tenant, lô ≤ 200, `FOR UPDATE SKIP LOCKED`): (a) `sending` kẹt > 10' ⇒ `needs_decision` `SEND_FAILED` + chuông người phụ trách (KHÔNG tự gửi lại, tránh phong bì đôi); (b) phong bì `sent`: chuông "Nhắc ký số HĐ …" cho người ký công ty mỗi `remind_every_h` (từ `max(esign_at, esign_reminded_at)`; tiếp tục sau quá hạn tới khi xong); quá `due_h` (từ `esign_at`) ⇒ chuông "quá hạn" cho người phụ trách + trưởng phòng (`departments.head_user_id`) / thành viên còn dùng được (≤ 50) của `escalate_group_id`, một lần mỗi lần gửi (`esign_escalated_at`). Mốc so với `esign_at` của lần gửi hiện tại ⇒ Gửi lại tự reset. Chỉ đọc DB, không gọi nhà cung cấp trong pha này. Migration `MG/0064_esign_sweep.sql` (`esign_reminded_at`, `esign_escalated_at`, index một phần `approvals_esign_open_idx`); `MG/0062_esign_flow.sql` (`approvals.esign_status|reason|signer|at`, CHECK).
- **Đồng bộ nền** `application/esign-sync.ts` (chạy SAU pha SQL, ngoài tx): hỏi lại nhà cung cấp tối đa `CONTRACTS_ESIGN_SYNC_MAX` phong bì `sent|delivered` mà `greatest(updated_at, sync_checked_at)` cũ hơn `CONTRACTS_ESIGN_SYNC_MIN` phút (lưới an toàn khi webhook không tới); chỉ nhà cung cấp khả dụng và KHÔNG demo, tenant bật gói; một câu SQL chéo tenant (role `contracts_job`, đánh dấu `sync_checked_at` cùng câu), cũ nhất trước; mỗi phong bì qua `ESignUsecase.syncEnvelope` (cùng đường với webhook), song song ≤ 4, lỗi chỉ log (tên lỗi + tenant + provider). `MG/0065_esign_sync.sql`: cột `esign_envelopes.sync_checked_at`, index một phần `esign_envelopes_sync_idx`; `contracts_job` được SELECT (id, status, updated_at, sync_checked_at) + UPDATE (`sync_checked_at`) + policy `esign_envelopes_job_sync` chỉ trên phong bì mở.
- **Env vòng nền:** `CONTRACTS_ESIGN_SWEEP=off` tắt cả vòng (chỉ chạy khi `APP_ENV` development/production); `CONTRACTS_ESIGN_SWEEP_EVERY_MS` (mặc định 300 000, ≥ 1000); `CONTRACTS_ESIGN_SYNC_MAX` (mặc định 20, 0 = tắt, trần 200); `CONTRACTS_ESIGN_SYNC_MIN` phút (mặc định 15, ≥ 1). Vòng gắn qua `esignUserRoutes` → `ESignModule.startSweep(view)`, bật một lần.
- **Bước Ký số của flow mới (CR-122, tool `contracts-esign-send`):** gửi xong ⇒ chuông "Mời ký số HĐ …" cho MỌI người ký công ty của bước (cấu hình node, vắng ⇒ người bắt đầu), cùng câu chữ với đường cũ (`signInviteBell`); lỗi chuông không làm hỏng gửi ký. "Ký ngay" quay về đúng `/contracts/c/<id>?esign=return` (`signReturnUrl`) ⇒ trang tự làm mới trạng thái một lần, ký xong bước kế chạy ngay cả khi webhook chưa tới [test: apps/workspace-web/src/features/contract-esign/lib/esign-view.test.ts]. Người ký của phong bì đang mở thấy HĐ theo RLS (contracts 0083). [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.int.test.ts]
- Code: `H/application/{esign-flow.usecase,esign-sweep,esign-sync,esign-void}.ts`, `H/domain/{approval-flow-esign.rules,esign-sweep.rules}.ts`, `H/adapters/{esign-flow,esign-sweep,esign-sync}.repo.ts`, `esign-flow.routes.ts`, `W/features/contract-approval/**` (`EsignStepRow`), `W/features/settings/components/FlowEsignFields.tsx`.

### 4c. Vị trí ô ký DocuSign trong văn bản (esign-anchor)
- Chỉ nhà cung cấp loại `envelope` dùng anchor (selfsign/CA bỏ qua). Luật thuần `H/domain/esign.anchor.ts` `pickAnchors({text, side, roles, lists})` ⇒ `{mode:"text", anchors[]}` | `{mode:"page", reason}`. Cụm chữ: danh sách sửa được theo công ty `approval_settings.esign_anchors` (Bên A, Bên B; migration `MG/0063_esign_anchor.sql`) rồi thêm SAU danh sách theo hướng HĐ (`deal` ưu tiên, rồi `direction`: bán ⇒ "ĐẠI DIỆN BÊN BÁN"/"BÊN BÁN", mua ⇒ "…BÊN MUA"; cố định trong code). Văn bản gán rõ ("Bên mua (Bên B)", "Bên A (Bên bán)", "… gọi tắt là Bên B") ⇒ đổi chữ cái của công ty theo gán.
- Đặt được khi cụm xuất hiện đúng 1 lần trong CẢ văn bản và nằm ở phần cuối (30% cuối, 800–4000 ký tự). Đặt được MỌI người ký ⇒ bỏ hẳn trang ký cuối; không đặt được bất kỳ ai (cụm 2 lần / hai người ký trùng vùng / gán mua-bán mâu thuẫn / scan / lỗi) ⇒ cả phong bì dùng trang ký cuối (không trộn hai chế độ), không chặn gửi. `anchorString` gửi DocuSign = đoạn khớp trong văn bản (NFC, khoảng trắng gộp), `anchorMatchWholeWord`, `anchorCaseSensitive=false`, `anchorIgnoreIfNotPresent=false`, offset `TEXT_TAB_OFFSET`. Lỗi `ANCHOR*` từ DocuSign ⇒ gửi lại MỘT lần bằng trang ký cuối + log `esign-anchor-fallback`.
- Nguồn chữ: `contracts.source_text` (trích lúc tải lên), không có ⇒ lớp chữ PDF của bytes đang gửi (`PdfConverter`, worker tạo lười). Chữ trích cache trong bộ nhớ theo `(tenant, file_id)` (FIFO trần 200; chỉ lưu kết quả cuối chữ/scan/hỏng; bận hoặc lỗi tải không lưu; không ghi `source_text`).
- API: `GET /esign/anchors` (`read`), `PUT /esign/anchors` (`admin` = owner; `Phrase` cấm ký tự điều khiển ⇒ 400), `GET /contracts/:id/esign/placement` (`read`; xem trước `text|page|unknown`, dùng converter RIÊNG maxPending 1; bận `PDF_BUSY` ⇒ `"unknown"`, UI "chưa xác định (sẽ tự chọn khi gửi)"; lúc gửi dùng converter riêng maxPending 2). UI: Cài đặt › Quy trình duyệt › Ký số (hai ô, mỗi dòng một cụm) + hộp Gửi ký hiện "Vị trí ký".
- Code: `H/domain/esign.anchor.ts`, `H/application/esign-anchor.usecase.ts`, `H/adapters/esign-anchor.{repo,routes}.ts`, `C/esign-anchor.ts`, `W/features/contract-esign/{anchor-api.ts,EsignAnchorSetting.tsx,EsignSendDialog.tsx}`; công cụ đo bố cục: `deploy/prod-sohoptac2/esign-layout/`.
- `TEXT_TAB_OFFSET` (sign y=50, date y=84; `esign.anchor.ts`) đo trên phong bì nháp DocuSign sandbox 2026-10-27: ô ký ngay dưới dòng "(Ký, ghi rõ họ tên…)", ô ngày trên tên người ký.
- Nhắc ký (esign-remind-fix): người ký công ty chưa ký và đã tới lượt (mọi `order` nhỏ hơn đã ký) ⇒ chuông người ký; công ty đã ký / đối tác ký trước ⇒ chuông người phụ trách "đang chờ đối tác ký". Trạng thái từng người ký theo webhook/đồng bộ nền (trễ ≤ 15 phút ⇒ có thể thừa một lần nhắc).

### 4d. UI chọn nhà cung cấp (esign-multi)
Cài đặt: chọn mặc định (nhãn + mức pháp lý), công ty chỉ-đọc. Hộp Gửi ký: dropdown khi > 1 nhà cung cấp khả dụng; phong bì hiện tên nhà cung cấp. i18n vi/en. Log thiếu cấu hình: `esign-provider-not-configured {provider}`.

## Chưa rõ
1. (Đã hết hiệu lực từ CR-121: không còn cờ bật engine.)
2. DocuSign: prod đang dùng sandbox (deploy 2026-10-27); định dạng Connect giả định JSON (`data.envelopeId`). CA Việt Nam: adapter MISA chưa có (chờ Client ID); lát `esign-cks` ("Chữ ký số của tôi", ký PAdES nối tiếp cho phong bì loại `ca`, điền `certificate_ref`) chưa làm.
3. HĐ bị xoá để lại envelope mồ côi (vô hại, chưa dọn). (Mở lại HĐ đã huỷ phong bì đang mở — §4b.)
7. Mốc nhắc/quá hạn của bước Ký số chưa có `*.perf.int.test.ts` (lô 200/tenant/lượt; tồn đọng lớn xả dần); thẻ HĐ chưa hiện lần kiểm nhà cung cấp gần nhất. Quyền mới của role `contracts_job` (0065) đã qua review security cuối đợt 2026-10-27.
4. Chuông/inbox hub "cần duyệt" không gửi thêm cho Group "toàn quyền" (thẻ + Việc của tôi của gói đã có); mẫu đã lưu không tự đồng bộ khi đổi Group cấp 2 ở cài đặt tới lần lưu mẫu kế.
5. Thẻ duyệt chưa có hành động "Thử lại" cho bước Dify lỗi (xử lý ở màn quy trình).
6. Tên phòng ở thẻ duyệt cho người không phải admin dựa vào `GET /groups`; không resolve tên trưởng phòng.

## CR-118 · Delta gộp 2026-11-04 (đợt cr118-r1)
Mục dưới đây thắng nội dung cũ cùng chủ đề ở trên (lát: cr118-flow-web).

#### Yêu cầu: Thẻ duyệt HĐ vẽ dòng thời gian qua FlowPanel, hành vi không đổi (nguồn: cr118-flow-web)
Web gộp vẽ dòng thời gian các bước duyệt của HĐ bằng `<FlowPanel slot="contracts.approval">` (nguồn = thẻ duyệt đã tải, không thêm yêu cầu mạng);
chữ, khung, `data-testid`/`data-status`, nhãn quá hạn/chuyển cấp/bỏ qua, dòng Ký số và nút "Gửi lại" y hệt trước. Lượt máy trạng thái cũ
(`mode=machine`) đi qua renderer legacy (không dòng bước). Nút Duyệt/Trả lại/Từ chối và hộp lý do vẫn do thẻ duyệt lo.
- Kịch bản: khi thẻ duyệt engine có bước (kể cả quá hạn tự tính, bỏ qua, chuyển cấp, Dify) thì dòng thời gian dựng từ FlowView trùng dòng thời gian cũ [test: apps/workspace-web/src/features/contract-approval/lib/flow-view.test.ts » dòng thời gian từ FlowView trùng timelineRows(steps) cũ (kể cả quá hạn tự tính, bỏ qua, chuyển cấp)]
- Kịch bản: khi lượt chạy bằng máy cũ thì FlowPanel không vẽ dòng bước, chỉ đánh dấu legacy [test: apps/workspace-web/src/platform/flow/ui/flow-ui.test.tsx » lượt machine ⇒ LegacyMachineRenderer (không dòng bước)]
- Kịch bản: khi thẻ có bước Ký số thì bước này nối cuối danh sách [test: apps/workspace-web/src/features/contract-approval/lib/flow-view.test.ts » slot/ref/state/phase + bước Ký số nối cuối · tasks rỗng (nút thẻ do useApprovalUi)]
- Kịch bản: khi e2e thẻ duyệt hiện có chạy thì vẫn xanh [test: e2e/contracts-web/contract-flow.cw.ts » dòng thời gian: tên bước, tên phòng, trạng thái, hạn quá hạn]

#### Yêu cầu: Cờ flow theo sự kiện tắt giữ đường duyệt cũ
Công ty chưa bật `FLOW_TRIGGERS`: AI đọc xong ⇒ lượt duyệt mở run engine ngay theo quy trình khe (bản xuất bản hiện hành), thẻ duyệt có
bước mở, Đạt đủ bước ⇒ HĐ Đã duyệt + khoá, như trước CR-122.
- Kịch bản: khi cờ tắt và AI đọc xong HĐ dưới ngưỡng thì lượt mở run engine, thẻ có bước 0 mở, Đạt bước 0 ⇒ Đã duyệt + khoá [test: tests/acceptance/CF/flag-off-legacy.int.test.ts » cờ tắt ⇒ AI đọc xong mở run engine như cũ (bản xuất bản hiện hành, thẻ có bước mở) · Đạt bước 0 ⇒ Đã duyệt + khoá]

#### Yêu cầu: Duyệt thay ghi đúng một lần khi bấm trùng
Chủ gói bấm Đạt nhiều lần (kể cả song song) ở bước không thuộc Group của mình ⇒ đúng một bản ghi "duyệt thay", không mất khi lần bấm ghi
bản ghi thua đua.
- Kịch bản: khi chủ gói bấm Đạt hai lần song song thì có đúng 1 dòng duyệt thay và thẻ hiện owner_override [test: tests/acceptance/CF/owner-override.int.test.ts » review · H bấm Đạt hai lần liên tiếp (song song + lần nữa) ⇒ đúng 1 dòng duyệt thay]

#### Yêu cầu: Người ký công ty thấy HĐ đang chờ ký
Người ký công ty (`signers[].client_user_id`) của phong bì đang mở (sent/delivered) của một HĐ ĐỌC được HĐ đó (trang HĐ, trạng thái ký số,
"Ký ngay", làm mới) dù ngoài cây quản lý của chủ HĐ (chế độ thấy `org`); không sửa được HĐ. Phong bì xong/huỷ/từ chối ⇒ hết thấy theo
nhánh này. Chỉ trong tenant của mình.
- Kịch bản: khi bước Ký số gửi phong bì cho người ký ngoài cây thì người đó mở HĐ, xem trạng thái, lấy link Ký ngay và làm mới được; editor không phải người ký và tenant khác vẫn không thấy [test: tests/acceptance/cf-esign/signer-visible.int.test.ts » người ký đọc HĐ + trạng thái + Ký ngay + làm mới, editor khác và tenant khác không thấy]
- Kịch bản: khi phong bì xong hoặc bị huỷ thì người ký hết thấy HĐ theo nhánh này [test: tests/acceptance/cf-esign/signer-visible.int.test.ts » phong bì xong hoặc huỷ ⇒ người ký hết thấy theo nhánh này]

#### Yêu cầu: Trang HĐ không ghi "Chưa xác nhận" sau khi đã gửi duyệt
Sau "Xác nhận và lưu" (lượt duyệt đang mở) trang HĐ không còn dải/dòng dẫn "Chưa xác nhận". HĐ đã khoá do bước Ký số nhưng chưa xác nhận hiện dải "Đang ký số", không ghi "Đã xác nhận".
- Kịch bản: khi đã Xác nhận và lưu và lượt duyệt đang chạy thì không còn dải "Chưa xác nhận" [test: apps/workspace-web/src/features/contract-lock/lib/lock-view.test.ts » CR-122 · đã Xác nhận và lưu (lượt duyệt đang chạy) ⇒ không còn banner Chưa xác nhận]
- Kịch bản: khi bước Ký số đã khoá HĐ chưa xác nhận thì dải là "Đang ký số" [test: apps/workspace-web/src/features/contract-lock/lib/lock-view.test.ts » CR-122 · bước Ký số đã khoá HĐ chưa xác nhận ⇒ banner signing (không ghi 'Đã xác nhận')]
- Kịch bản: khi HĐ đã gửi duyệt thì lời dẫn đầu trang không còn nhắc "chưa xác nhận" [test: apps/workspace-web/src/features/contract-review/lib/review.test.ts]

#### Yêu cầu: Bước Ký số khoá HĐ trước khi gửi ký
Bước Ký số giữa flow khoá HĐ (`lockForSign`) rồi mới gửi ký; Từ chối / Trả lại mở khoá. Migration contracts 0082: bản cũ chỉ bị thay (supersede) khi xác nhận, không phải lúc gửi ký.
- Kịch bản: khi HĐ đang trong lượt duyệt thì bước Ký số khoá HĐ rồi gửi; bản cũ chỉ bị thay khi xác nhận [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.int.test.ts]

#### Yêu cầu: Bước Ký số/Chờ ký của mẫu Thư viện là node `contracts.esign`
Các stage Ký số/Chờ ký của mẫu flow Thư viện là node `contracts.esign` nên trình sửa hiện ô chọn người ký; hub 0113 gán node này cho flow đã lưu.
- Kịch bản: khi nạp mẫu Thư viện thì stage Ký số là node `contracts.esign` [test: apps/hub-api/src/modules/processes/library/flow-templates.seed.int.test.ts]
- Kịch bản: khi chạy hub 0113 trên flow đã lưu thì stage Ký số được gán node `contracts.esign` [test: thủ công — chưa có test riêng cho 0113, ghi vào việc còn lại]

#### Yêu cầu: Hạn tải phong bì DocuSign theo dung lượng tệp
Hạn tạo phong bì = 15 s + 6 s mỗi MB, tối đa 110 s (nhỏ hơn hạn bước tool 120 s), để HĐ scan lớn không hết hạn sớm.
- Kịch bản: khi tệp nhỏ thì hạn ≈ 15 s, 11 MB đủ > 60 s, trần 110 s [test: apps/hub-api/src/modules/packs/contracts/adapters/docusign.timeout.test.ts]

#### Yêu cầu: Thẻ duyệt hiển thị ba dòng cho mỗi bước
Mỗi bước trên thẻ duyệt hiện đúng ba dòng ngắn: trạng thái · lý do · bước kế (ai cần làm gì). Một chữ "Cần xử lý" cho trạng thái cần người xử lý.
Lỗi gửi ký lại nói vì sao và cách sửa.
- Kịch bản: khi bước duyệt đang mở thì thẻ hiện "Đang chờ <phòng> duyệt", hạn, và "Bạn cần: Duyệt, Trả lại sửa hoặc Từ chối" cho người duyệt [test: apps/workspace-web/src/features/contract-approval/lib/card-status.test.ts » rowStatusLines · mỗi trạng thái đủ 3 dòng]
- Kịch bản: khi bước ký số lỗi thì lý do kèm cách sửa và bước kế theo quyền gửi lại [test: apps/workspace-web/src/features/contract-approval/lib/card-status.test.ts » esignStatusLines]
- Kịch bản: khi xem thẻ ở trình duyệt thì mỗi bước có ba dòng [test: e2e/contracts-web/contract-flow.cw.ts » dòng thời gian: tên bước, tên phòng, trạng thái, hạn quá hạn]

#### Yêu cầu: Người duyệt chỉ thấy Duyệt · Trả lại sửa · Từ chối
Ở bước duyệt, người có quyền chỉ thấy ba nút Duyệt, Trả lại sửa, Từ chối (Từ chối và Trả lại bắt buộc ghi lý do). Không dùng chữ "Đạt" hay "Cần quyết".
- Kịch bản: khi người duyệt mở thẻ thì đúng ba nút, không Xác nhận/Đọc lại [test: apps/workspace-web/src/features/contract-approval/lib/card-status.test.ts » nút theo vai (người duyệt chỉ thấy Duyệt · Trả lại sửa · Từ chối)]
- Kịch bản: khi đọc chuỗi tiếng Việt của ứng dụng Hợp đồng thì không còn "Cần quyết", "Giai đoạn", "Đạt", "đi tới" [test: apps/workspace-web/src/features/contract-approval/lib/card-status.test.ts » từ vựng thẻ duyệt trong chuỗi contracts]

#### Yêu cầu: Bước Thông báo không có người nhận được báo cho chủ hợp đồng
Khi một bước Thông báo xong nhưng không có người nhận, thẻ duyệt hiện cho chủ hợp đồng dòng "Không có ai nhận thông báo bước <tên> — chọn người nhận trong Công ty › Quy trình" thay vì im lặng.
- Kịch bản: khi hub gửi cờ cảnh báo ở bước Thông báo thì chủ hợp đồng thấy dòng cảnh báo [test: apps/workspace-web/src/features/contract-approval/lib/card-status.test.ts » noRecipientSteps (NOTIFY_NO_RECIPIENT)]
- Kịch bản: khi xem thẻ ở trình duyệt thì dòng cảnh báo hiện cho chủ hợp đồng [test: e2e/contracts-web/u2-contracts-ux.cw.ts » chủ HĐ thấy cảnh báo bước Thông báo không có người nhận]

## CR-124/125 · Delta gộp 2026-11-08 (đợt cr124-cr125)

#### Yêu cầu: Người ký chọn cách ký lúc ký (nguồn: cr125-m4-esign)
Node Ký số chỉ khai người ký, hạn ký và nhắc; không chọn nhà cung cấp. Lúc bấm «Ký ngay», người ký chọn trong các cách công ty đã bật; chỉ một cách thì ký thẳng. Def cũ có `provider` vẫn chạy (trường bị bỏ qua).
- Kịch bản: args cũ có `provider` ⇒ đọc cấu hình vẫn hợp lệ, trường bị bỏ qua [test: packages/contracts/src/pack-contracts/esign-node.test.ts » CR-125 m4 · provider cũ bị bỏ qua]
- Kịch bản: người ký chọn cách khác loại phong bì ⇒ huỷ phong bì cũ và gửi lại cùng người ký/hạn [test: apps/hub-api/src/modules/packs/contracts/application/esign-switch.test.ts » CR-125 m4 · đổi cách ký]
- Kịch bản: nhiều cách khả dụng ⇒ hỏi; một cách ⇒ ký thẳng [test: apps/workspace-web/src/features/contract-esign/lib/esign-view.test.ts » CR-125 m4 · chọn cách ký]

#### Yêu cầu: Thêm node tự nối đầu vào có đúng một nguồn (nguồn: cr125-m4-esign)
Thêm node tự nối mọi đầu vào có đúng một nguồn (vd mã hợp đồng từ «Bắt đầu khi»); chỉ hỏi khi nhiều nguồn hoặc không có, bằng câu nghiệp vụ kèm cách khắc phục.
- Kịch bản: một nguồn ⇒ nối, không hỏi; không nguồn ⇒ «cần … — thêm bước Tải hợp đồng trước» [test: packages/contracts/src/modules/auto-map.test.ts » autoMapInputs]
- Kịch bản: thêm Ký số vào flow bắt đầu từ hợp đồng ⇒ `contract_id` được nối vào tham số tool [test: apps/admin-web/src/features/processes/lib/auto-bind.test.ts » autoBindNode]

#### Yêu cầu: Lịch sử HĐ ghi mọi quyết định duyệt, ký số và trao đổi với đối tác (nguồn: cr125-audit-trail)
Mỗi quyết định Đạt/Trả lại/Từ chối ở một bước duyệt, mỗi lần gửi ký / ký xong / từ chối / huỷ / đổi nhà cung cấp ký, mỗi lần gửi–nhận–trả lời đối tác đều thêm một dòng "Lịch sử thay đổi" của HĐ (người, thời điểm, nội dung); sự kiện lặp lại không ghi đôi. "Lưu và áp dụng" flow ghi `hub.audit_log` kèm danh sách bước trước/sau.
- Kịch bản: khi người duyệt Đạt bước thì lịch sử HĐ có `stage_decided` với người duyệt [test: apps/hub-api/src/modules/processes/triggers/audit-trail.int.test.ts » gửi duyệt → Đạt ở bước → Kết thúc Đã duyệt: trạng thái đúng + lịch sử có ai/lúc nào/gì]
- Kịch bản: khi người duyệt Từ chối kèm lý do thì HĐ `rejected` và lịch sử ghi lý do [test: apps/hub-api/src/modules/processes/triggers/audit-trail.int.test.ts » Từ chối ở bước (có lý do): HĐ rejected + lịch sử ghi người từ chối, lý do]
- Kịch bản: khi gửi ký, ký xong, đổi nhà cung cấp (webhook gửi lại) thì mỗi việc đúng một dòng [test: apps/hub-api/src/modules/processes/triggers/audit-trail.int.test.ts » ký số: gửi, ký xong, đổi nhà cung cấp ⇒ lịch sử HĐ, gọi lại cùng trạng thái không ghi đôi]
- Kịch bản: khi gửi đối tác và đối tác trả lời thì lịch sử có hai dòng, trả lời chạy lại không ghi đôi [test: apps/hub-api/src/modules/processes/triggers/audit-trail.int.test.ts » đối tác: gửi → trả lời (một lần) ⇒ lịch sử HĐ]
- Kịch bản: khi "Lưu và áp dụng" thêm một bước thì audit before/after khác nhau ở `steps` [test: apps/hub-api/src/modules/processes/defs/audit-snapshot.test.ts » thêm một bước ⇒ steps before/after khác nhau]

#### Yêu cầu: Đổi cách ký không làm lượt rời bước chờ (nguồn: cr125-m10-switch-void-race)
Trong lúc đổi cách ký (giữ quyền đổi), sự kiện của phong bì cũ từ nhà cung cấp chỉ được ghi audit, không báo cho luồng; sau khi đổi xong chỉ sự kiện của phong bì mới báo cho luồng, mỗi sự kiện một lần.
- Kịch bản: khi webhook voided của phong bì cũ tới giữa lúc đổi cách ký thì luồng vẫn chờ phong bì mới và chỉ nhận đúng một sự kiện của phong bì mới [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-switch-webhook.int.test.ts » trong lease chỉ audit, không tín hiệu, sau khi đổi chỉ phong bì mới tới lượt, một lần]

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Làm mới trạng thái ký không gọi nhà cung cấp quá dày (nguồn: cr125-esign-refresh-throttle)
Làm mới trạng thái ký (và kiểm lượt khi «Ký ngay») chỉ hỏi nhà cung cấp nếu phong bì chưa được đồng bộ trong 10 giây gần nhất; trong cửa sổ đó trả trạng thái hiện có, vẫn thành công.
- Kịch bản: khi bấm làm mới lần hai trong 10 giây thì trả trạng thái hiện có không gọi nhà cung cấp [test: tests/acceptance/esign-multi/esign-multi.int.test.ts » giám đốc ký xong ở nhà cung cấp (webhook không tới) ⇒ refresh ghi signed_at và hết lượt, bấm lại trong 10 s không gọi nhà cung cấp (giữ hạn mức API)]
- Kịch bản: khi đủ 10 giây thì cho gọi lại [test: apps/hub-api/src/modules/packs/contracts/application/esign-throttle.test.ts » vừa đồng bộ < 10 s ⇒ bỏ qua, đủ 10 s ⇒ cho gọi lại, phong bì khác không ảnh hưởng]

#### Yêu cầu: Ghép người ký theo mã người nhận (nguồn: cr125-esign-refresh-throttle)
Trạng thái người ký từ nhà cung cấp được ghép theo mã người nhận (rồi thứ tự gửi + email, rồi vị trí) nên danh sách trả về khác thứ tự hoặc trùng email vẫn đúng người.
- Kịch bản: khi nhà cung cấp trả người nhận khác thứ tự thì ghép theo mã người nhận [test: apps/hub-api/src/modules/packs/contracts/application/esign-merge.test.ts » nhà cung cấp trả người nhận KHÁC thứ tự ⇒ ghép theo recipientId (= vị trí + 1), kể cả trùng email]

#### Yêu cầu: Quay về từ nhà cung cấp ký thì trạng thái được cập nhật (nguồn: cr125-fix-docusign-return)
Khi người dùng quay về trang HĐ sau khi ký ở nhà cung cấp (có `?esign=return`, hoặc vừa rời trang để ký), web gọi MỘT lần làm mới phong bì từ nhà cung cấp; người ký được ghi nhận đã ký, hết «Đến lượt bạn ký», bước kế chạy khi phong bì xong. Thẻ ký số có nút «Cập nhật trạng thái ký» (kèm «Đã kiểm tra lúc …») cho lúc webhook chậm; gọi lại không đổi kết quả.
- Kịch bản: khi nhà cung cấp báo giám đốc đã ký thì làm mới ghi signed_at, đối tác ký xong thì phong bì hoàn tất, gọi lại không đổi [test: tests/acceptance/esign-multi/esign-multi.int.test.ts » phong bì hoàn tất ở nhà cung cấp ⇒ refresh đầu tiên chuyển hoàn tất + lưu bản đã ký, gọi lại idempotent]
- Kịch bản: khi quay về mất tham số URL thì cờ vừa rời đi ký vẫn kích hoạt làm mới [test: apps/workspace-web/src/features/contract-esign/lib/esign-view.test.ts » làm mới khi có ?esign=return HOẶC cờ vừa rời đi ký (đường quay về mất tham số)]
- Kịch bản: khi nhà cung cấp báo người ký completed mà thiếu mốc giờ thì không còn Ký ngay [test: apps/workspace-web/src/features/contract-esign/lib/esign-view.test.ts » nhà cung cấp báo người ký completed mà chưa có signed_at ⇒ coi là đã ký (cùng luật hub): hết 'Ký ngay']
- Kịch bản: khi hai người ký dùng chung email thì trạng thái ghép theo thứ tự [test: apps/hub-api/src/modules/packs/contracts/application/esign-merge.test.ts » cùng một email cho hai người ký ⇒ ghép lần lượt, không dồn cả hai về người đầu]

#### Yêu cầu: «Ký ngay» không bị chặn lượt oan (nguồn: cr125-fix-docusign-return)
Khi người ký trước đã ký ở nhà cung cấp mà hub chưa nhận (webhook trễ), `sign-url` hỏi nhà cung cấp một lần trước khi trả 409 `ESIGN_NOT_YOUR_TURN`.
- Kịch bản: khi đối tác ký trước đã ký ở nhà cung cấp thì giám đốc bấm Ký ngay nhận được đường dẫn ký [test: tests/acceptance/esign-multi/esign-multi.int.test.ts » người ký trước (đối tác) đã ký ở nhà cung cấp nhưng hub chưa biết ⇒ Ký ngay của giám đốc không bị chặn lượt (hỏi nhà cung cấp một lần)]

#### Yêu cầu: Link «Mời ký» (`?ky=1`) không hỏi cách ký khi đã xác định (nguồn: cr125-fix-docusign-return)
Với `?ky=1` và nhiều nhà cung cấp, nếu phong bì đã có cách ký (hoặc công ty có mặc định) thì mở thẳng trang ký; hộp «Chọn cách ký» chỉ hiện khi người dùng thực sự phải chọn.
- Kịch bản: khi phong bì đã có nhà cung cấp thì `?ky=1` mở thẳng không hỏi [test: apps/workspace-web/src/features/contract-esign/lib/esign-view.test.ts » ?ky=1 nhiều nhà cung cấp: có cách ký của phong bì / mặc định công ty ⇒ mở thẳng không hỏi, chưa xác định ⇒ null (mới hỏi)]

#### Yêu cầu: Chuyển cấp trên flow theo sự kiện (nguồn: cr125-fix-escalate-kick)
Bước Duyệt của flow theo sự kiện có chuyển cấp thì mở bình thường và task có hạn chuyển cấp về Group đích (id của snapshot, vắng thì
mã Group của cùng công ty); không tìm được Group thì bước vẫn mở, không chuyển cấp. Mẫu "Duyệt 2 cấp" có hạn 72 h, quá hạn chuyển về
Toàn quyền (`contracts-owner`) như đường khe.
- Kịch bản: khi flow Thư viện có escalate theo mã ở bước đầu thì bước 0 chờ duyệt, task có hạn + Group Toàn quyền [test: apps/hub-api/src/modules/processes/triggers/flow-escalate-kick.int.test.ts » mở lượt ⇒ bước 0 chờ duyệt, task có hạn chuyển cấp về Group Toàn quyền, không có process-kick-failed]
- Kịch bản: khi bản công ty mất Group chuyển cấp thì bước 0 vẫn mở, không chuyển cấp [test: apps/hub-api/src/modules/processes/triggers/flow-escalate-kick.int.test.ts » bản công ty: escalate thiếu Group (group_id null) ⇒ bước 0 vẫn mở, không chuyển cấp (trước sửa: vi phạm review_tasks_remind_ck)]
- Kịch bản: khi mẫu "Duyệt 2 cấp" được dùng thì mọi bước Duyệt có hạn 72 h, chuyển cấp về contracts-owner [test: apps/hub-api/src/modules/processes/library/flow-templates.def.test.ts » cr125-fix-escalate-kick · Duyệt 2 cấp: mọi bước Duyệt có hạn 72 h, quá hạn chuyển cấp về contracts-owner (như đường khe)]

#### Yêu cầu: Lượt không khởi động được (nguồn: cr125-fix-escalate-kick)
Kick ngay sau khi tạo lượt lỗi thì không nuốt im lặng: log có run id + mã lỗi; lượt chưa chạy bước nào chuyển "Cần xử lý" lý do
`start_failed` (mã lỗi ở bước đầu), có Thử lại / Huỷ, thay vì chờ mãi.
- Kịch bản: khi kick lỗi thì log `process-kick-failed` có mã và lượt `needs_decision` start_failed [test: apps/hub-api/src/modules/processes/triggers/flow-escalate-kick.int.test.ts » kick lỗi ⇒ log có mã + lượt 'Cần xử lý' start_failed (không pending mãi)]

#### Yêu cầu: Toàn quyền duyệt thay trên flow theo sự kiện (nguồn: cr125-fix-owner-override)
Lượt duyệt HĐ mở từ flow theo sự kiện (company_flows + flow_triggers) có cùng luật "Toàn quyền duyệt thay" như đường khe: thành viên
Group chủ app (`contracts-owner`) cùng công ty quyết được mọi bước duyệt, thẻ ghi "duyệt thay" và có bản ghi `approval_override`;
người không thuộc Group bước, không Toàn quyền vẫn bị từ chối NOT_REVIEWER.
- Kịch bản: khi cờ flow_triggers bật, flow được gán, chủ app duyệt bước của Group Kế toán thì được (duyệt thay, có audit); người ngoài bị NOT_REVIEWER [test: apps/hub-api/src/modules/processes/triggers/flow-owner-override.int.test.ts » contracts-owner quyết bước của Group khác (duyệt thay, audit), người ngoài bị NOT_REVIEWER]
- Kịch bản: khi một stage duyệt đã có Group cũng quyết thì luật chung gộp thêm Group Toàn quyền, trừ chính Group gắn task [test: packages/contracts/src/flow/owner-override.test.ts » withOwnerOverride chỉ gắn stage review, gộp also sẵn có, không owner thì giữ nguyên]

#### Yêu cầu: Link «Mời ký» (`?ky=1`) không tự ký thay người dùng (nguồn: cr125-fix-quicksign)
Link `?ky=1` chỉ tự mở trang ký khi đến lượt người xem (mọi người ký có thứ tự nhỏ hơn đã ký) và nhà cung cấp chỉ chuyển sang trang ký riêng của họ (DocuSign). Với nhà cung cấp tự hoàn tất ký trong lời gọi `sign-url` (ký thử, CA), link chỉ cuộn tới và nhấn mạnh nút «Ký ngay»; chữ ký chỉ hoàn tất sau cú bấm của người dùng.
- Kịch bản: khi nhà cung cấp tự hoàn tất ký thì `?ky=1` chỉ focus nút, không tự mở [test: apps/workspace-web/src/features/contract-esign/lib/esign-view.test.ts » H1 · nhà cung cấp tự hoàn tất ký (ký thử/CA) ⇒ chỉ focus nút, không bao giờ open]
- Kịch bản: khi người ký 2 mở link trước người ký 1 thì không tự mở [test: apps/workspace-web/src/features/contract-esign/lib/esign-view.test.ts » M1 · người ký 2 mở link trước người ký 1 thì không có lượt và không tự mở]

#### Yêu cầu: «Ký ngay» chỉ khi đến lượt (nguồn: cr125-fix-quicksign)
`POST /esign/sign-url` trả 409 `ESIGN_NOT_YOUR_TURN` khi còn người ký có thứ tự nhỏ hơn chưa ký (hoặc người gọi đã ký); phong bì không đổi.
- Kịch bản: khi đối tác ký trước chưa ký thì người ký công ty bấm Ký ngay bị 409 và phong bì không hoàn tất [test: tests/acceptance/esign-multi/esign-multi.int.test.ts » đối tác ký trước mà chưa ký ⇒ người ký công ty bấm Ký ngay = 409 ESIGN_NOT_YOUR_TURN, phong bì giữ nguyên (không hoàn tất)]

#### Yêu cầu: Công tắc ký số trong Cài đặt làm việc thật (nguồn: cr125-ux-s2-current-flow)
Chủ gói bật/tắt ký số ở Cài đặt › Quy trình duyệt và thấy "Đã lưu"; người không đổi được (không phải chủ gói / chưa cấu hình) thấy trạng thái và lý do, không có ô khoá.
- Kịch bản: khi chủ gói bấm công tắc ký số thì lưu, báo đã lưu và tải lại vẫn giữ [test: e2e/journey-approval/cr125-s2-settings-flow.spec.ts » 3 · công tắc ký số trong Cài đặt bật được thật (lưu, tải lại vẫn bật)]



## CR-107/108/113/121 · Delta gộp 2026-11-09 (đợt cr125-wave)
Mục dưới thắng nội dung cũ cùng chủ đề ở trên (kể cả §1c/§3). Kịch bản và test: `docs/specs/<lát>/tasks.md`.

### Engine là đường duy nhất (cr121-a2-engine-only, cr121-d4-assign-engine)
- Mọi lượt duyệt HĐ MỚI mở run engine theo luật định tuyến của khe `contracts.approval`: luật admin gán nếu có, không thì luật/mẫu mặc định của khe. Công ty không cần bật tính năng nào; không còn công tắc env hay ghi chú `engine_off`. Mở 2 lần đồng thời chỉ ra 1 lượt + 1 run.
- Engine không mở được (vắng, ném lỗi) ⇒ lượt kẹt `ENGINE_RUN_FAILED` chờ "Mở lại quy trình", không về máy cũ.
- Lượt `mode='machine'` mở trước đây, chưa gắn run, vẫn quyết nốt qua `decide` 2 bước cũ (cấp 1 → cấp 2 → Đã duyệt), không chuyển sang engine giữa chừng. Việc gỡ hẳn máy cũ chờ đếm lượt machine còn mở = 0 trên prod.
- Ops-watch có check `flow_coverage` (crit, nêu tên công ty + cách sửa): còn lượt duyệt đang chạy mà khe hết luật gán, luật trỏ quy trình đã xoá/chưa xuất bản, hoặc run kẹt chờ quyết định; sửa xong thì xanh (`docs/current/ops/flow-coverage.md`).
- Journey (cr121-d5): platform admin nhân bản quy trình từ thư viện, đặt điều kiện bước (vd Giám đốc chỉ khi Giá trị ≥ 500 tr và Loại = Mua), xuất bản, gán từng công ty; mỗi công ty chạy đúng quy trình mình, bước không thoả điều kiện bị bỏ qua, sửa giá trị HĐ đang chờ làm đổi bước theo giá trị mới, công ty này không thấy dữ liệu công ty kia.

### Quy trình không mở được ⇒ lượt kẹt, không về máy cũ (eng-reliable, CR-107)
- Mỗi lần mở lượt (kể cả mở lại) gói tra quy trình theo tenant của HĐ (gán của khe, không có ⇒ mặc định), lấy bản xuất bản, phân giải mã phòng ban theo tenant, đồng bộ def tenant `contracts-approval` khi `source_ref` khác; lượt đang chạy giữ snapshot. Quy trình không mở được (thiếu Group, body hỏng, khe không có bản) ⇒ lượt giữ `level1`, `mode='engine'`, chưa có run, `feedback` = `FLOW_GROUP_MISSING:<mã>` / `FLOW_INVALID` / `FLOW_MISSING`; thẻ `attention.kind = "stalled"`. Owner/admin "Mở lại quy trình" mở run khi quy trình đã hợp lệ (còn thiếu ⇒ 422 `APPROVAL_GROUP_MISSING`, ghi lý do mới).
- Run `needs_decision` (vd `tool_failed`, `retry_exhausted`) không đổi trạng thái HĐ/lượt; thẻ có `attention {kind:"needs_decision", reason, since}`. Owner/admin gói: `POST …/approval/retry` (engine `add_attempt`, chạy lại bước lỗi) hoặc `POST …/approval/cancel-reopen` (huỷ run, ghi `CANCELLED_BY_OWNER`, mở run mới dưới người gửi theo quy trình hiện hành). Không chờ quyết ⇒ 409 `APPROVAL_NOT_OPEN`; không phải owner ⇒ 403. Lượt đang chạy/đã đóng: `attention = null`.
- Lỗi logic của tool hệ thống (`contracts-route`/`contracts-finalize` ném `PackToolBusinessError`) ⇒ `needs_decision` `tool_failed` ngay, không thử lại; lỗi hạ tầng (DB, mạng) giữ `UPSTREAM_ERROR` thử lại 30 s/2'/8'.
- Vòng quét mỗi tenant dọn run engine mồ côi: ≤ 100 run gói `contracts` chưa kết thúc, bắt đầu trước `now − 10'`, không gắn lượt nào ⇒ `cancelSys` (1 câu phía engine + 1 câu `= any` phía gói); kết quả quét có `orphans`. Tra quy trình `resolveSlot` p95 ≤ 5 ms, số câu SQL cố định.
- Đạt bước cuối giữ chỗ `pending_links` (lần bấm, người, task) trong tx gói trước khi `act`; người khác Đạt cùng task bị chặn (`APPROVAL_NOT_OPEN`) tới khi trả chỗ hoặc quá 15 phút; chính người giữ giữ lại được; act lỗi chỉ trả đúng chỗ của lần bấm đó; gắn run mới xoá chỗ giữ. `contracts-finalize` áp đúng SP của người thắng (eng-links-race, eng-review-fix).

### Thẻ duyệt (eng-card-ui, eng-review-fix, pl-uat-fixes, card-skip-label, cr113-approve-ui)
- Khi `attention` có giá trị: banner "Quy trình đang dừng: <lý do>" kèm thời điểm. Owner/admin với `needs_decision` thấy **Thử lại** và **Huỷ & mở lại** (có hộp xác nhận); với `stalled` thấy **Mở lại quy trình**; người khác chỉ thấy "Báo chủ hợp đồng để xử lý". Lý do `FLOW_GROUP_MISSING:<mã>` nêu mã phòng ban cần thêm; mã lỗi 409/422/503/403 có câu tiếng Việt riêng.
- Thẻ không poll vô hạn: nghe `/me/stream` (`process.updated`, `review_task.created` của đúng run) để tải lại; lưới an toàn giãn dần 2·4·8·16 s rồi giữ 30 s, chỉ khi đang chuyển bước và không có `attention`. Stream trả 4xx (trừ 408/429) thì dừng nối lại. Hub cho công ty không có Chat AI vẫn mở `/me/stream` nhưng chỉ phát sự kiện quy trình của chính user.
- Sau khi một bước Đạt/bỏ qua mà bước kế chưa mở: ghi chú "Đang chuyển sang bước duyệt kế tiếp…" và tự tải lại tới khi bước mở; bước duyệt mở và người xem quyết được ⇒ Đạt / Trả lại / Từ chối (kể cả bước thêm từ quy trình thư viện).
- Bước chưa tới mà `when` không thoả với HĐ hiện tại được trả kèm `skip_when`; thẻ hiện "Sẽ bỏ qua (giá trị < 500.000.000)" chữ mờ thay "Chưa đến"; giá trị trống ⇒ không báo bỏ qua.
- Bước do Toàn quyền duyệt thay hiện "Duyệt thay · Toàn quyền"; bước quá hạn hiện "Quá hạn" và "Đã chuyển cho <nhóm>".

### Chủ gói duyệt thay, quá hạn chuyển cấp (cr113-approve-rules, cr113-fix)
- Thành viên Group Toàn quyền quyết được mọi bước engine. Khi không phải người của bước (Group duyệt / trưởng phòng / người cụ thể / Group chuyển cấp) thì lần quyết được ghi `approval_override` TRƯỚC khi engine nhận (ghi lỗi ⇒ không quyết; ghi lặp không nhân bản; Từ chối/Trả lại cũng ghi) và thẻ hiện `decided_as = owner_override`; ngược lại `member`. Bước đã chuyển cấp cho nhóm owner, hoặc owner thuộc Group bước ⇒ người của bước; bước head_only (owner không phải trưởng phòng) hoặc người cụ thể ⇒ duyệt thay.
- Bước có hạn (`due_h`) không đặt nhóm chuyển cấp ⇒ quá hạn chuyển về Group Toàn quyền; đặt tường minh thắng; không hạn thì không chuyển cấp; lượt đang chạy giữ snapshot. Nhóm chuyển cấp tường minh đã xoá ⇒ Cài đặt › Quy trình duyệt báo lỗi cấu hình (không rơi về mặc định).
- `GET /pack/contracts/approval-flow` trả `owner_can_override`, `owner_group_name` và mỗi bước review `escalate_default`.

### Dữ liệu HĐ của lượt duyệt, tên HĐ, id lượt chạy (cr121-f5-notify-vars, cr121-q4-contract-name, cr121-f2)
- Trước mỗi lần Đạt, gói cập nhật input lượt (số HĐ, tên, giá trị, người phụ trách, ngày) theo HĐ hiện tại; bản cũ không đè bản mới; lượt đã kết thúc/bản ghi khác không đổi; quy trình không có bước đọc dữ liệu HĐ thì bỏ qua. Thông báo sau bước duyệt dùng số và tên đã xác nhận.
- Tên HĐ một nguồn: mọi nơi (danh sách, chi tiết, Việc của tôi, Chờ tôi duyệt, nhật ký, nhãn lượt, thông báo, sắp xếp theo tên) dùng trường "Tên hợp đồng"; chỉ khi trống mới dùng tên file lúc tải. Định nghĩa SQL duy nhất `contractNameSql` (`adapters/contract-name.sql.ts`); script `check-contract-name` chặn tự viết lại biểu thức hoặc đọc thô `c.title`.
- Thẻ duyệt của lượt engine trả thêm `engine_run_id` (khác `run_id` = lượt duyệt của gói); trang "Chi tiết lượt chạy" của quản trị mở bằng id này; tenant_admin công ty khác nhận 404.
- ⚠ Lệch code (cr121-f5): còn chỗ đọc `c.title` với ý tên HĐ chưa chuyển sang `contractNameSql` — context-label.repo.ts:18, esign-flow.repo.ts:69, esign-sweep.repo.ts:37, activity.repo.ts, mywork.repo.ts, intake.tools.ts:96, rep.sql.ts:250, transactions-read.sql.ts:13, manage.repo.ts:88, appendix.repo.ts:103, business.repo.ts:199; biểu thức tự viết lại ở followups.repo.ts:35, ledger-read.repo.ts:31, service-customers.repo.ts:52, todo.repo.ts:18. Danh sách/chi tiết (`contracts.repo.ts`) trả `title` thô; `contract_delete_log.title` còn là tên file; HĐ cũ chưa có "Tên hợp đồng" vẫn ra tên file.

### Mục "Chờ tôi duyệt" (cr121-c7-approval-inbox-nav)
Người có vai duyệt trong quy trình duyệt HĐ đang gán (hoặc đang có việc chờ) thấy mục "Chờ tôi duyệt" kèm số HĐ chờ sau "Hợp đồng"; mở ra danh sách HĐ chờ quyết. Rỗng ⇒ nói rõ vì sao và bước tiếp theo, kèm liên kết xem tất cả HĐ. Người khác không thấy; số chỉ đếm trong công ty.

## CR-120/121 · Delta gộp 2026-11-09 (đợt cr125-wave)

#### Yêu cầu: Thẻ duyệt quyết qua FlowRuntime, dòng thời gian đọc FlowView của hub (nguồn: cr120-runtime-on, cr121-a1-drop-legacy-view)
Xác nhận/Duyệt/Trả lại/Từ chối (+ lý do, + SP gắn ở hộp "Gắn sản phẩm" = `extension`) gửi `POST /pack/contracts/flow/contracts.approval/:id/tasks/:task/actions/:action` với task đang mở của thẻ. Dòng thời gian đọc `GET /pack/contracts/flow/contracts.approval/:id` (tên phòng từ `/groups` khi FlowView thiếu nhãn), tải lại khi thẻ đổi; chữ, khung, data-testid giữ nguyên. Một đường duy nhất: đường rollback `POST …/contracts/:id/approval` + `legacy-act` mà CR-120 từng giữ đã gỡ ở CR-121 (xem `engine/flow-runtime.md`). Code: `apps/workspace-web/src/features/contract-approval/`.

#### Yêu cầu: Điều kiện bước theo trường nghiệp vụ, AND/OR lồng một cấp (nguồn: cr121-d0-slot-contract)
Điều kiện bước nhận thêm phòng ban người tạo (tính cả phòng con, theo mã) và đối tác mới, cùng nhóm AND/OR lồng một cấp; điều kiện cũ (loại HĐ, giá trị) giữ nguyên hình và nghĩa; lồng hai cấp, trường lạ, mã phòng sai dạng, quá số điều kiện ⇒ schema chặn; trường chưa có dữ liệu ⇒ điều kiện đúng (bước vẫn chạy). Số bước người dùng + route + finalize ≤ trần stage engine (22), vượt ⇒ chặn. Code: `packages/contracts/src/pack-contracts/approval-flow-cond`.
