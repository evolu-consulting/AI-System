---
id: pl-library-api
lát: pl-library-api
cr: CR-105
làn: đầy đủ
migration: hub 0069 (`when` 1801100000000)
phụ thuộc: docs/specs/process-library (design.md, tasks.md L2a), pl-slot-core (L1)
---
## Plan (ngắn)
L2a của CR-105 (xem `docs/specs/process-library/tasks.md`). Test quyền + chuyển dữ liệu viết trước code của phần đó.

## Làm
- Mở rộng `/process-defs…` (không tiền tố `/process-library`): `?kind=library|template`, nháp có `slot` (`slot_body` thắng `stages`,
  Hub biên dịch lại), `GET …/impact`, `POST …/publish`, `GET …/releases[/:v]`, `POST …/rollback`, `POST …/clone`, `GET …/assignments`;
  `GET /process-slots`, `PUT /process-slots/:slot/default`; `GET /tenants/:tid/process-slots`, `PUT|DELETE /tenants/:tid/process-slots/:slot`.
  Mọi route mới + mọi ghi def có `slot` chỉ platform_admin (403); đọc def có `slot` khi không phải platform_admin ⇒ 404.
- B2 (`library-publish.rules.ts` + một SQL tập `slot-assign.repo.firstMiss`) trước publish/rollback/assign/set default; 409
  `PROCESS_IN_USE` khi xoá/tắt/đổi key/đổi khe def đang gán hoặc là mặc định; audit `publish|rollback|assign|unassign|set_default`.
- Hub 0069: audit action + seed "Quy trình HĐ mặc định" (`hd-mac-dinh`, id `0c105000-…-000000000069`) + release v1 + `process_slots`.
- `apps/hub-api/scripts/process-library-backfill.ts` (`--dry-run`, idempotent, theo tập).
- Schema response ở `packages/contracts/src/hub-admin/process-library.ts` (+ danh sách def chuyển sang đó vì trần 400 dòng).

## Không làm / Chạm
UI (L3/L4), `POST …/preview` + `is_test` (L2b), `GET /approval-flow` (L4). Chạy backfill trên prod = bước deploy (chờ người dùng).

## Test tối thiểu
`library.routes.int` (9 ca), `library-publish.rules` (2), `library-seed.rules` (1), `process-library-backfill.int` (2); sửa
`library-rls.int`, `approval-engine-slot.int`, `approval-flow-current.int`, `slot-resolve.perf.int` để chịu hàng seed 0069 (upsert khe).

## Quyết định trong lúc làm
- 2026-10-31 tenantkey = `admin.tenants.key` (không có cột `slug`); key def riêng = `hd-<key>` (CHECK key ≤ 32 ⇒ mã dài cắt + 5 hex sha256).
- 2026-10-31 "khác mặc định" = `slot_body` (sau đổi id ⇒ mã) khác bản v1 của def 0069 (so JSON bỏ thứ tự khoá); không mẫu + cài đặt mặc định ⇒ không gán.
- 2026-10-31 backfill: tenant đã có gán ⇒ giữ (`on conflict do nothing`); ghi 3 câu tập trong một tx, không audit (script vận hành).
- 2026-10-31 publish/rollback: `withConfigWrite` khoá `config_meta` trước ⇒ hai lời gọi tuần tự; def `FOR UPDATE` + kiểm `version` nháp +
  tăng version khi xuất bản ⇒ lời gọi thứ hai cùng `version` nhận 409 `VERSION_CONFLICT`. Rollback nhận `version` tuỳ chọn (UI không gửi).
- 2026-10-31 B2 "tập tenant đang dùng" = gán tới def ∪ (def là mặc định ⇒ tenant có entitlement `<pack>-read` còn hiệu lực, feature
  không `off`, chưa gán khe). Người duyệt/ký cụ thể (`approver_user_id`/`user_id`) phải là user của MỌI tenant đó (422 `PROCESS_REF_INVALID`).
- 2026-10-31 bước không tới được = `stage.slot.when` không bao giờ đúng (giao khoảng `total_value` ≥ 0 rỗng / giao loại HĐ rỗng); thiếu
  tool hệ thống của khe ⇒ `SYSTEM_TOOL_MISSING:<tool>`; cả hai trong 422 `PROCESS_PUBLISH_INVALID {issues}`.
- 2026-10-31 impact `active_runs` = lượt đang chạy của các tenant đang dùng trên def tenant vật chất hoá (`source_ref` ≠ null): snapshot
  run không mang id def thư viện (L1) nên không tách theo def; v1 một khe nên đúng.
- 2026-10-31 `tenant_count` ở danh sách/def = số tenant GÁN (mặc định hiện qua `is_default`); impact tính cả tenant chạy mặc định.
- 2026-10-31 lưu chỉ `stages` (không `slot_body`): registry khe chưa có `fromStages` ⇒ nhận khi stages y như nháp (so bỏ khoá rỗng/thứ
  tự), khác ⇒ 422 `SLOT_SHAPE_UNSUPPORTED {stage: null}`. Nối `fromStages` của L2b vào `library-draft.slotDraft` khi registry có.
- 2026-10-31 nhân bản: body tuỳ chọn `{key?, name?}`; vắng key ⇒ `<key[0..28]>-<n>`, tên "<tên> (bản sao)"; audit `copy`.
- 2026-10-31 audit action mới gộp vào `PD_AUDIT_ACTIONS` (`hub.ts` chạm trần 400 dòng).
- 2026-10-31 test engine import khe thật của gói trực tiếp (như `library-preview.int` L2b) ⇒ thêm vi phạm depcruise
  `platform-no-pack-internals` chỉ ở file test (đã có từ trước trên platform/gd0).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-10-30 (đợt CR-105)

### ADDED engine/thu-vien-quy-trinh.md
#### Yêu cầu: API thư viện chỉ platform_admin
Mọi route thư viện (khe, xuất bản, lịch sử, quay lại, nhân bản, gán) và mọi ghi def có `slot` chỉ platform_admin; danh sách `kind=library` chỉ def thư viện, không mẫu chạy thử và không def vật chất hoá.
- Kịch bản: khi người không phải platform_admin gọi API thư viện thì nhận 403 [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » không phải platform_admin ⇒ 403]
- Kịch bản: khi lấy danh sách library thì không có mẫu chạy thử và không có def vật chất hoá; `kind=template` có mẫu [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » danh sách library không lẫn mẫu và def vật chất hoá]

#### Yêu cầu: Gán tenant × khe = đúng một quy trình
Gán lại thay thế; gán def chưa xuất bản ⇒ 422 `PROCESS_NOT_PUBLISHED`; tenant thiếu phòng ban theo mã ⇒ 422 `SLOT_GROUPS_MISSING`.
- Kịch bản: khi gán X → A rồi gán X → B thì chỉ còn một hàng X → B; bỏ gán ⇒ chạy mặc định [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » gán lại thay thế, một tenant một khe một quy trình]
- Kịch bản: khi tenant thiếu Group theo mã mà quy trình dùng thì gán bị từ chối 422 `SLOT_GROUPS_MISSING` liệt kê mã thiếu [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » tenant thiếu Group ⇒ SLOT_GROUPS_MISSING]

#### Yêu cầu: Quy trình mặc định của khe
Hub 0069 seed "Quy trình HĐ mặc định" (máy 2 bước cũ theo mã) đã xuất bản v1 làm mặc định khe `contracts.approval`; def đang gán hoặc là mặc định không xoá/tắt/đổi key được.
- Kịch bản: khi xoá hoặc tắt quy trình đang là mặc định hoặc đang gán thì nhận 409 `PROCESS_IN_USE` [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » xoá hoặc tắt quy trình đang dùng ⇒ PROCESS_IN_USE]
- Kịch bản: khi migrate hub 0069 thì def mặc định khớp đúng mẫu mặc định đã biên dịch [test: apps/hub-api/src/modules/processes/library/library-seed.rules.test.ts » def mặc định 0069 = defaultSlotBody + compileSlotStages, id/key cố định]

#### Yêu cầu: Nháp, xuất bản, lịch sử, quay lại, nhật ký
Xuất bản kiểm trước (luật khe, đủ nút hệ thống, không bước không tới được, mọi tenant đang dùng đủ phòng ban), tạo bản v+1, ghi audit; impact trả số tenant đang dùng và lượt đang chạy; hai lần xuất bản cùng `version` ⇒ một 409; quay lại tạo bản mới.
- Kịch bản: khi xuất bản thì tạo bản v+1, ghi một dòng audit, impact trả số tenant đang dùng và số lượt đang chạy [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » xuất bản tạo bản mới, ghi audit, impact đúng số]
- Kịch bản: khi hai admin xuất bản cùng lúc cùng version thì một thành công, một nhận 409 và chỉ có một bản [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » xuất bản đồng thời cùng version ⇒ một thành công, một 409]
- Kịch bản: khi quy trình thiếu nút `contracts-finalize` hoặc có bước không tới được thì xuất bản bị từ chối 422 chỉ rõ bước sai [test: apps/hub-api/src/modules/processes/library/library-publish.rules.test.ts » thiếu nút hệ thống hoặc bước không tới được ⇒ từ chối]
- Kịch bản: khi quay lại bản 2 từ bản 4 thì có bản 5 nội dung bằng bản 2 và nháp về bản 2 [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » quay lại tạo bản mới bằng bản cũ]

#### Yêu cầu: Nhân bản rồi gán
- Kịch bản: khi nhân bản A thành A′ và sửa A′ thì lượt mới của tenant đang gán A vẫn chạy A [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » nhân bản tạo nháp mới không ảnh hưởng tenant đang gán]

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Chuyển mẫu cũ sang thư viện
Script một lần (`--dry-run`, idempotent): tenant có mẫu riêng khác mặc định ⇒ quy trình thư viện "Quy trình HĐ – <tên tenant>" xuất bản v1 + gán, bước theo mã phòng ban; tenant khác chạy mặc định.
- Kịch bản: khi chạy script hai lần trên tenant có mẫu riêng thì có đúng một quy trình riêng, một gán, bước dùng mã phòng ban [test: apps/hub-api/scripts/process-library-backfill.int.test.ts » chạy hai lần: một quy trình riêng, một gán, bước theo mã]
- Kịch bản: khi tenant chưa lưu mẫu và cài đặt mặc định thì không có gán và lượt mới chạy quy trình mặc định [test: apps/hub-api/scripts/process-library-backfill.int.test.ts » tenant chưa lưu mẫu không gán, chạy mặc định]

## Việc còn lại
- Deploy: `db:migrate` (0069) + `bun --env-file=… apps/hub-api/scripts/process-library-backfill.ts --dry-run` rồi chạy thật — chờ người dùng.
- Ca Delta tổng chưa có test ở lát này: "đổi mặc định áp cho tenant chưa gán ở lượt kế", "sửa nháp chưa xuất bản không đổi lượt mới"
  (`approval-engine-slot.int.test.ts`) — route `PUT /process-slots/:slot/default` đã có, chưa có int riêng.
- Nối `fromStages` (L2b) vào `library-draft.slotDraft` để canvas lưu `stages` mà không gửi `slot_body`.
- Khớp shape với UI: xem báo cáo lát (danh sách lệch so với `cr105-contract-gaps.md`).
