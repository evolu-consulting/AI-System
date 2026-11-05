---
id: cr120-review-fixes
lát: cr120-review-fixes
cr: CR-120
làn: đầy đủ (race máy trạng thái duyệt bài + trigger RLS + backfill hub)
migration: hub 0094 (when 1804100000000, idx 80), community 0009 (when 1803700000000, idx 8)
phụ thuộc: cr120-community-flows (đã gộp)
---
## Plan (ngắn)
Sửa các phát hiện của Opus review cuối: (1) sửa bài ĐANG chờ duyệt không mở lại lượt ⇒ screen cũ duyệt nội dung mới (Blocker, race);
(2) duyệt bài phải OPT-IN; (3) bỏ đọc view gán cũ ở moderationOn (D6); (4) schema Drizzle bảng gán cũ = view; (5) gán khi 50 luật đầy ⇒ 409;
(6) trigger guard canh thêm cột; (7) kiểm Group contracts-editor.

## Làm
- [x] #1 eopenModeration mở lại cả từ pending (task mới, screen running, xoá quyết định); pplyScreen khớp mod_task_id đọc lúc BẮT ĐẦU
      screen (cùng câu SELECT với nội dung gửi agent) ⇒ kết quả của nội dung cũ bị bỏ; decide đã là compare-and-set theo task id + pending (kiểm lại,
      thêm test). Trigger 0009 cho đối tác mở lại từ pending.
- [x] #2 SlotSpec.optIn (3 khe Community) ⇒ defaultSlotsOf không cấp luật mặc định, coverageSlotsOf (ops flow_coverage) không đòi quy trình
      hiển thị; moderationOn chỉ xét luật thật (process_routing_rules), không xét đầu luật/tập gán. Backfill hub 0094 gỡ luật do cấp tự động.
- [x] #3 moderationOn không còn đọc hub.process_slot_assignments (view cũ).
- [x] #4 processSlotAssignments (Drizzle) = hub.view(...).existing() — không còn là bảng ghi được.
- [x] #5 upsertAssignment đếm hàng đổi/chèn; 0 (50 luật đầy) ⇒ AppError 409 ROUTING_RULES_FULL, tx hoàn tác đầu luật + tập gán.
- [x] #6 community 0009: tuple canh thêm mod_reason, mod_decided_name, mod_feedback, mod_at; ngoại lệ mở/mở lại lượt đòi mọi trường quyết định rỗng.
- [x] #7 Kiểm: withConfirmStep thêm Group contracts-editor. Group này là vai mặc định contracts-editor của gói (admin insertDefaultRoles khi bật gói +
      pp_roles_backfill cho tenant cũ), Group vai mặc định không xoá được (409 DEFAULT_ROLE_PROTECTED) ⇒ không có khe hở theo thiết kế. Thiếu mã (tenant tạo bằng
      SQL trực tiếp) KHÔNG rơi về máy cũ: slotFlowOf trả {invalid: FLOW_GROUP_MISSING:<mã>} ⇒ lượt kẹt chờ owner mở lại (CR-107) — hiện rõ, không im lặng. Không đổi code.
- [x] Sửa kèm: HUB_TABLES (migrate-hub) + LATER_POLICY_TABLES (hub-rls) thiếu process_run_events (hub 0093) — đỏ có sẵn của lát trước.

## Không làm / Chạm
- Không chạm UI. Hàng chờ duyệt lại sau sửa vẫn phát chuông "bài mới" lần nữa khi được duyệt (đã ghi ở lát trước).

## Perf (Luật 4c)
Không có đường nóng mới. Backfill 0094 = 2 câu DELETE theo tập (không theo hàng; index PK/unique của bảng luật). upsertAssignment vẫn 4 câu cố định
(câu cuối thêm CTE đếm). Sửa bài khi khe bật: vẫn +1 UPDATE theo PK.

## Test tối thiểu
- unit: processes/slot-optin.test.ts (opt-in không cấp mặc định/không bị kiểm coverage).
- int (evotest): community.flows.int.test.ts (race screen/sửa, task cũ 409), community-optin.int.test.ts (tắt → gán bật → bỏ gán tắt, backfill, 409 đầy luật),
  community.rls-tenant, slot-single-source, library.routes, ops.flow-coverage, migrate-hub, hub-rls.
- e2e: community-web-stack chạy lại một lần (mặc định duyệt bài đổi).

## Quyết định trong lúc làm
- LỆCH so với brief: moderationOn giữ thêm process_tenant_defs (tập gán). Lý do: e2e hành trình thật (z-flows ca 1) gán quy trình bằng màn "Được platform gán" chỉ ghi process_tenant_defs; chỉ xét luật thì gán xong mà duyệt bài vẫn tắt (thao tác ẩn — Luật GỐC 3). Tập gán do cấp tự động (assigned_by NULL) đã bị 0094 gỡ nên không còn bật ngầm.
- E2e ca 1 trước đây KHÔNG chạy nhánh gán thật (mặc định tự cấp ⇒ đã có sẵn): phát hiện khe Community khai Group `community-admin` (khoá QUYỀN, không phải mã Group) ⇒ B2 chặn mọi lần gán. groupKeys của 3 khe Community = [] (người duyệt do gói quyết).
- Nhận diện luật "do cấp tự động" cho backfill: đầu luật tenant × khe còn nguyên updated_by IS NULL AND version = 1 (mọi đường admin gán/sửa luật ghi updated_by +
  tăng ersion), luật duy nhất là is_default priority 49, và tập gán ssigned_by IS NULL. Mọi dấu hiệu admin ⇒ giữ. Luật priority 49 KHÔNG đủ để nhận diện
  (admin gán cũng chèn ở priority trống cao nhất = 49).
- Sửa bài đang pending luôn mở lại (kể cả đang flagged): reviewer thấy nội dung hiện tại với task mới.

## Việc còn lại
- Chuông "bài mới" phát lại khi bài sửa được duyệt lại.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Duyệt bài trước khi đăng — sửa bài đang chờ (nguồn: cr120-review-fixes)
Sửa tiêu đề/nội dung/tệp bài đang chờ duyệt (hoặc đã gắn cờ) mở lại lượt với task mới: kết quả sàng lọc của nội dung cũ bị bỏ, quyết định theo task cũ bị 409.
- Kịch bản: khi tác giả sửa bài giữa lúc agent đang sàng lọc thì kết quả của nội dung cũ bị bỏ và bài vẫn chờ duyệt dưới task mới [test: apps/hub-api/src/modules/packs/community/adapters/community.flows.int.test.ts » sửa bài ĐANG chờ duyệt giữa lúc agent sàng lọc ⇒ kết quả của nội dung cũ bị bỏ, bài vẫn pending dưới task mới]
- Kịch bản: khi bài đã gắn cờ được tác giả sửa thì task đổi, screen chạy lại, quyết định theo task cũ bị 409 [test: apps/hub-api/src/modules/packs/community/adapters/community.flows.int.test.ts » bài đã gắn cờ, tác giả sửa ⇒ task đổi + chạy lại screen, task cũ của người duyệt vô hiệu]
#### Yêu cầu: Duyệt bài là opt-in (nguồn: cr120-review-fixes)
Công ty bật Community KHÔNG tự có duyệt bài: chỉ khi platform admin gán quy trình cho khe (luật thật). Bỏ gán ⇒ tắt và hub không cấp lại. Migration gỡ luật do cấp
tự động trước đây, giữ thứ admin đã gán/sửa. Gán khi đã đủ 50 luật ⇒ 409 rõ ràng.
- Kịch bản: khi công ty mới bật Community thì duyệt bài tắt, gán thì bật, bỏ gán thì tắt và không bị cấp lại [test: apps/hub-api/src/modules/packs/community-optin.int.test.ts » tenant mới bật Community ⇒ không cấp mặc định ⇒ moderation tắt, gán ⇒ bật, bỏ gán ⇒ tắt và không bị cấp lại]
- Kịch bản: khi gán vào tập (màn Được platform gán) thì duyệt bài bật, gỡ khỏi tập thì tắt [test: apps/hub-api/src/modules/packs/community-optin.int.test.ts » gán vào tập (đường màn Được platform gán, chưa có luật) ⇒ bật, gỡ khỏi tập ⇒ tắt]
- Kịch bản: khi backfill 0094 chạy thì gỡ luật tự cấp và giữ luật admin, chạy lại vô hại [test: apps/hub-api/src/modules/packs/community-optin.int.test.ts » backfill 0094: gỡ luật do cấp tự động, GIỮ luật admin gán/sửa, chạy lại vô hại]
- Kịch bản: khi gán lúc 50 luật đã đầy thì 409 và không đổi gì [test: apps/hub-api/src/modules/packs/community-optin.int.test.ts » gán khi 50 luật đã đầy ⇒ 409 ROUTING_RULES_FULL, không đổi gì (tx hoàn tác)]
- Kịch bản: khi khe là opt-in thì không bị cấp mặc định và không bị đòi quy trình hiển thị [test: apps/hub-api/src/modules/processes/slot-optin.test.ts » defaultSlotsOf: bỏ dlc.* và khe Community (opt-in), giữ khe thường]