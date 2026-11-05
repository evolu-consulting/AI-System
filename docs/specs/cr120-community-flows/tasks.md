---
id: cr120-community-flows
lát: cr120-community-flows
cr: CR-120
làn: đầy đủ (RLS bảng/cột mới + quyền người duyệt + máy trạng thái ở gói; Opus low soát diff RLS/run-state)
migration: hub 0092 (when 1804000000000, sau 0093), community 0008 (when 1803600000000)
phụ thuộc: cr120-contracts-flow (hub 0093), cr120-slot-contract (SlotSpec/registry kit)
---
## Plan (ngắn)
Spec `docs/specs/CR-120/spec.md` §2, §5–§6. Ba khe Community chạy theo flow tại gói: `community.post-moderation` (agent `screen` → quản trị
duyệt → đăng), `community.partner-join` (form → tenant admin duyệt → liên kết đối tác), `community.report` (agent `triage` → điều phối
viên → ẩn/cảnh báo/bỏ qua). Trạng thái ở gói (community 0008), hiển thị qua `FlowView`; agent chạy NỀN sau commit, kết quả là dữ liệu JSON.

## Làm
- [x] community 0008: `posts.moderation` (+ cột screen/quyết) + RLS RESTRICTIVE `posts_moderation` + trigger chặn đối tác đổi cột duyệt; bảng
      `join_requests`, `reports` (RLS tenant + người xem, REVOKE DELETE).
- [x] hub 0092: 3 def thư viện + release + khe; hub-api seed agent `community-screen`, `community-triage`.
- [x] G1: loại bước `agent` (contract view + `AgentStep.tsx` + registry canvas).
- [x] gói: `flow.rules` / `flow-view.rules` / `flow-slots.rules` (thuần), `flows.repo/service/routes`, `flow-slots` (FlowSlotAdapter), mount.
- [x] rebase lên gd0: journal hub 0092 `when` 1804000000000 (idx 79, sau 0093).
- [x] sửa nội dung bài (tiêu đề/nội dung/tệp) khi khe bật ⇒ mở lại duyệt cùng tx + chạy lại screen sau commit; trigger 0008 cho đối tác chỉ mở/mở lại lượt.
- [x] reportList: chủ quản không phải admin ⇒ 403 (RLS cho chủ quản thấy mọi báo cáo ⇒ chặn ở service).

## Không làm / Chạm
- UI (hàng đợi duyệt, trạng thái bài của tôi, yêu cầu tham gia, báo cáo): lát sau (sau cr120-one-shell).
- Không chạm engine hub (`processes/**`); bài cũ `moderation = none` không đổi hành vi; tenant chưa gán khe ⇒ tắt hẳn.

## Perf (Luật 4c)
Không chạm đường nóng có ngưỡng. Mỗi hàm repo MỘT câu SQL cố định, lô qua `= any(uuid[])`, không câu theo hàng:
- hàng đợi duyệt `modQueue`: index riêng `posts_mod_queue_idx (tenant_id, mod_at) WHERE moderation='pending'`, `limit 100`;
- bài của tôi `myModeration`, bảng tin: thêm 1 điều kiện cột `moderation` (không thêm câu);
- `joinList` / `reportList`: index `(tenant_id, created_at desc)` / `(tenant_id, status, created_at desc)`, `limit 100`;
- quyết báo cáo + ẩn bài: một câu CTE; `moderationOn` mỗi lần đăng bài: 1 câu `exists` theo PK/index hub (chỉ khi gói bật).

## Test tối thiểu
- unit: `domain/flow.rules.test.ts`, `flow-view.rules.test.ts`, `flow-slots.rules.test.ts`.
- int (evotest): `adapters/community.flows.int.test.ts` (chuyển trạng thái từng khe, quyền thành viên/admin/đối tác, RLS người xem),
  `community.rls-tenant.int.test.ts` (+ `join_requests`, `reports` chặn chéo tenant).
- e2e: ở lát UI (chạy cuối đợt).

## Quyết định trong lúc làm
- Agent lỗi / hết hạn / sai hình ⇒ vào duyệt, KHÔNG tự đăng. Screen treo quá 2 phút ⇒ coi là lỗi.
- Người duyệt = Admin chủ quản (`tenant_admin` hoặc Group `community-admin`); đối tác không bao giờ duyệt.
- Quyết là compare-and-set theo task id + trạng thái chờ ⇒ hai người bấm cùng lúc chỉ một thắng (người kia 409).

## Việc còn lại
- Bài duyệt lại sau sửa phát chuông ài mới lần nữa khi được duyệt (chưa phân biệt bài sửa).
- UI 4 trang (hàng đợi duyệt, trạng thái bài của tôi, yêu cầu tham gia, báo cáo) + e2e hành trình thật (D5) — lát sau cr120-one-shell.
- Hàng chờ nhắc/chuyển cấp bước duyệt bài (đồng hồ 24/48 h mới hiển thị, chưa phát chuông).
- Gán khe cho tenant (onboard) để bật duyệt bài: bật qua cấu hình quy trình (D7 ops-watch chưa có check riêng cho 3 khe).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Duyệt bài trước khi đăng (khe `community.post-moderation`) (nguồn: cr120-community-flows)
Tenant đã gán khe duyệt bài: bài mới ở trạng thái chờ, chỉ người đăng và chủ quản thấy; agent sàng lọc chạy nền. Sạch ⇒ đăng ngay; gắn cờ,
lỗi hoặc kết quả sai hình ⇒ vào hàng đợi của Admin chủ quản (duyệt/từ chối, một lần). Đối tác không bao giờ duyệt và không tự đổi trạng thái.
Tenant chưa gán khe: bài đăng như cũ.
- Kịch bản: khi agent gắn cờ thì bài chờ duyệt, chỉ người đăng + chủ quản thấy, admin duyệt ⇒ lên bảng tin [test: apps/hub-api/src/modules/packs/community/adapters/community.flows.int.test.ts » gắn cờ ⇒ pending/flagged, chỉ người đăng + chủ quản thấy, admin duyệt ⇒ approved, hiện trên bảng tin]
- Kịch bản: khi agent sạch thì đăng ngay, khi lỗi/sai hình thì vào duyệt không tự đăng [test: apps/hub-api/src/modules/packs/community/adapters/community.flows.int.test.ts » agent sạch ⇒ approved ngay (không qua duyệt), agent lỗi/sai hình ⇒ vào duyệt, KHÔNG tự đăng]
- Kịch bản: khi từ chối thì bài không lên bảng tin, người đăng vẫn xem được trạng thái [test: apps/hub-api/src/modules/packs/community/adapters/community.flows.int.test.ts » từ chối ⇒ rejected, không lên bảng tin, người đăng vẫn thấy trạng thái ở 'bài của tôi']
- Kịch bản: khi tenant chưa gán khe thì bài đăng như cũ [test: apps/hub-api/src/modules/packs/community/adapters/community.flows.int.test.ts » tenant chưa gán khe ⇒ bài đăng như cũ (moderation = none)]
- Kịch bản: khi người đăng sửa tiêu đề/nội dung/tệp bài đã duyệt thì bài mở lại duyệt (chờ), ẩn khỏi bảng tin chung, chạy lại sàng lọc; sửa không đổi nội dung thì giữ nguyên [test: apps/hub-api/src/modules/packs/community/adapters/community.flows.int.test.ts » sửa nội dung bài đã duyệt ⇒ mở lại duyệt (pending), ẩn khỏi bảng tin chung, sửa không đổi nội dung thì giữ nguyên]
- Kịch bản: khi đối tác tự đặt approved/người quyết thì trigger chặn (chỉ được mở/mở lại lượt) [test: apps/hub-api/src/modules/packs/community/adapters/community.flows.int.test.ts » đối tác không tự đổi cột duyệt (trigger posts_moderation_guard)]
- Kịch bản: khi đối tác đặt none → approved hoặc approved → pending kèm người quyết thì bị chặn [test: apps/hub-api/src/modules/packs/community/adapters/community.flows.int.test.ts » đối tác không tự đặt approved/quyết định: none → approved và approved → pending kèm người quyết đều bị trigger chặn]
- Kịch bản: khi hết 2 phút sàng lọc chưa xong thì coi như lỗi và chờ duyệt [test: apps/hub-api/src/modules/packs/community/domain/flow.rules.test.ts » awaitingReview]
#### Yêu cầu: Đối tác xin tham gia (khe `community.partner-join`) (nguồn: cr120-community-flows)
Người của công ty đối tác gửi form (công ty, liên hệ, email, lý do, nhãn); mỗi công ty một yêu cầu đang chờ. Tenant admin duyệt ⇒ công ty được
liên kết đối tác với nhãn đã xin; từ chối ⇒ không liên kết, được gửi lại. Chủ quản không gửi form; thành viên thường không xem danh sách.
- Kịch bản: khi đối tác gửi form thì chờ duyệt, trùng bị 409, admin duyệt ⇒ liên kết công ty [test: apps/hub-api/src/modules/packs/community/adapters/community.flows.int.test.ts » đối tác gửi form ⇒ pending, trùng ⇒ 409, chủ quản gửi ⇒ 403, tenant admin duyệt ⇒ liên kết công ty đối tác]
- Kịch bản: khi từ chối thì không liên kết và được gửi lại [test: apps/hub-api/src/modules/packs/community/adapters/community.flows.int.test.ts » từ chối ⇒ rejected, KHÔNG liên kết, sau đó được gửi lại yêu cầu mới]
- Kịch bản: khi đối tác sửa trạng thái hoặc tạo dưới tên công ty khác thì RLS chặn [test: apps/hub-api/src/modules/packs/community/adapters/community.flows.int.test.ts » RLS: đối tác không sửa trạng thái / không tạo dưới tên công ty khác]
#### Yêu cầu: Báo cáo vi phạm (khe `community.report`) (nguồn: cr120-community-flows)
Người xem thấy bài có thể báo cáo (mỗi người một lần mỗi bài). Agent phân loại (loại, mức) chạy nền; lỗi ⇒ vẫn xử lý tay. Admin chủ quản chọn ẩn
bài / cảnh báo / bỏ qua, một lần; ẩn bài và ghi quyết định cùng một thao tác. Đối tác chỉ xem báo cáo của mình; thành viên thường không xem.
- Kịch bản: khi đối tác báo cáo thì triage chạy nền, trùng bị 409, bài không thấy bị 404 [test: apps/hub-api/src/modules/packs/community/adapters/community.flows.int.test.ts » đối tác báo cáo ⇒ triage chạy nền, trùng ⇒ 409, bài không thấy ⇒ 404, chỉ thấy báo cáo của mình]
- Kịch bản: khi triage lỗi vẫn xử lý tay, ẩn bài ⇒ bài bị ẩn, không quyết lại [test: apps/hub-api/src/modules/packs/community/adapters/community.flows.int.test.ts » triage lỗi ⇒ triage=error nhưng vẫn xử lý tay, quyết hide ⇒ resolved + bài bị ẩn, quyền + quyết lại]
- Kịch bản: khi đối tác đọc/sửa báo cáo của người khác thì RLS chặn [test: apps/hub-api/src/modules/packs/community/adapters/community.flows.int.test.ts » RLS: đối tác không đọc báo cáo của người khác, không sửa kết quả xử lý]
#### Yêu cầu: Bảng mới chặn đọc/ghi chéo tenant (nguồn: cr120-community-flows)
`join_requests` và `reports` không đọc/ghi được chéo tenant.
- Kịch bản: khi tenant B đọc/ghi hàng tenant A thì bị chặn [test: apps/hub-api/src/modules/packs/community/adapters/community.rls-tenant.int.test.ts » join_requests]

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Loại bước `agent` hiển thị trong FlowView (G1) (nguồn: cr120-community-flows)
Bước do agent làm hiển thị như một bước hệ thống kèm khoá agent và tóm tắt kết quả; chiếu hàng của 3 khe Community sang FlowView, task chỉ có
khi người xem là người duyệt và bước duyệt đang mở.
- Kịch bản: khi bài gắn cờ và người xem là người duyệt thì bước duyệt mở kèm task approve/reject [test: apps/hub-api/src/modules/packs/community/domain/flow-view.rules.test.ts » gắn cờ + người duyệt ⇒ bước review open + task [approve, reject], id task = mod_task_id]
- Kịch bản: khi body khe đổi số/loại bước thì vi phạm khung cố định [test: apps/hub-api/src/modules/packs/community/domain/flow-slots.rules.test.ts » thêm/bớt bước ⇒ SLOT_STEPS_FIXED, đổi key/kind ⇒ SLOT_STEPS_FIXED tại bước đó]
