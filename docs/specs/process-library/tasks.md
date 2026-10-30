---
id: process-library
lát: process-library
cr: CR-105
làn: đầy đủ (L1, L2a) / nhanh (L2b, L3, L4, L5)
migration: hub 0068 (`when` 1801000000000, L1) · hub 0069 (`when` 1801100000000, L2a) — journal khác: không
phụ thuộc: CR-103 (flow-node-registry) đã gộp
---
## Plan (ngắn)
Xem `proposal.md` (Quyết định ràng buộc) + `design.md`. Thứ tự: **L1 → (L2a ∥ L2b) → (L3 ∥ L4 ∥ L5)**. L3 bắt đầu khi L2a + L2b
đã merge; L4, L5 bắt đầu ngay khi L2a merge. Mỗi lát một agent, worktree riêng, merge tuần tự vào `platform/gd0` (Luật 0b).
Làn đầy đủ (L1, L2a — RLS/tenant, chỉ platform_admin ghi, chuyển dữ liệu khách): agent của lát viết test phần tenant/quyền/chuyển dữ
liệu **trước** code của phần đó; readiness tối đa 1 vòng (Cao có mặc định ⇒ áp luôn). Làn nhanh: code + test cùng lúc.
Test trong lát (Luật 0b): unit cho logic thuần; **một** int đường chính mỗi endpoint mới; **một** test chặn đọc chéo tenant mỗi bảng
mới; perf chỉ cho đường nóng `resolveSlot` lúc mở lượt (p95 ≤ 5 ms). Viết file e2e được, **không chạy** trong lát.
**Cuối đợt (một lần):** e2e + `test:all` + UAT (Haiku chạy, tóm tắt); **một** lượt review + security (Opus medium) trên diff gộp, lỗi
gửi lại đúng agent của lát (`SendMessage`); gộp Delta vào `docs/current` (Sonnet), `openspec:archive` + STATE (Haiku).
Tên test trong Delta là **tiêu đề chính xác** agent phải dùng (`openspec:check` tìm văn bản).

## Việc
| Lát | Làn | Model · effort | Phạm vi | File được sửa | Migration | Sau |
|---|---|---|---|---|---|---|
| L1 `pl-slot-core` | **đầy đủ** | **Opus medium** | Bảng + RLS; registry khe (`SlotSpec`, `contracts.approval` với `validate`/`compile` bọc `compileDef`); trường `*_key` Group + luật id/mã trong `def.rules`; port `resolveSlot`; `ensureDef` có `sourceRef`; `startEngineApproval`/`reopen` mở lượt theo khe (đường cũ `readFlow` làm dự phòng khi chưa có release); `process_name` vào snapshot lượt | `packages/db/src/schema/hub-processes.ts`, `packages/db/migrations-hub/0068_*.sql` + journal, `packages/contracts/src/**/process*` (stage schema `*_key`), `apps/hub-api/src/modules/processes/library/**` (mới: `slots.ts`, `slot-resolve.repo.ts`), `processes/defs/def.rules.ts`, `processes/runs/pack-runs.ts`, `packs/contracts/application/approval-engine.usecase.ts`, `packs/contracts/approval.mount.ts`, port type `PackRunsPort` | hub **0068** `when` 1801000000000 (`process_defs.slot/slot_body/published_version/source_ref`, `process_runs.is_test`, `process_def_releases`, `process_slots`, `process_slot_assignments` + RLS) | — |
| L2a `pl-library-api` | **đầy đủ** | **Opus medium** | Route `/process-library/*` + `/process-slots` (chỉ platform_admin, `withConfigWrite`, `dbHubAudit`): nháp có `slot`, publish (B2 + kiểm Group theo tập tenant), impact (B5), releases, rollback, clone, assign/unassign, set default, chặn xoá/tắt/đổi key khi đang dùng; seed mặc định; script chuyển dữ liệu | `apps/hub-api/src/modules/processes/library/**`, `processes/defs/defs.service.ts`, `defs.repo.ts` (lọc `kind`, ẩn def vật chất hoá), `processes/routes*.ts` (mount), `packages/db/migrations-hub/0069_*.sql` + journal, `apps/hub-api/scripts/process-library-backfill.ts` (+ test) | hub **0069** `when` 1801100000000 (seed def "Quy trình HĐ mặc định" + release v1 + `process_slots` `contracts.approval`) | L1 |
| L2b `pl-slot-shape` | nhanh | Sonnet | `fromStages` (nghịch `compileDef`, `stage.slot.when`, Ký số là nút đuôi) + `preview` cho `contracts.approval`; `POST /process-defs/:id/preview`; `is_test` khi start từ mẫu (showcase/RunDialog) + lọc danh sách lượt | `packs/contracts/domain/approval-flow-stages.rules.ts` (mới), `processes/library/preview.routes.ts` (mới), `processes/runs/start*.ts` (chỉ cờ `is_test`), `processes/runs/*list*` (lọc) | không | L1 |
| L3 `pl-editor-ui` | nhanh | **Sonnet high** | admin-web: nút Canvas/Form (Form = editor bước chuyển từ contracts-web `FlowPane` + `lib/flow-*`), khoá nút hệ thống, cột Dùng cho / Tenant đang dùng, nhãn "Mặc định · Sổ Hợp Tác · Duyệt hợp đồng" + đổi mặc định, Xuất bản (impact B5) / Lịch sử / Quay lại, Nhân bản, Gán cho tenant (+ trên trang tenant), Xem trước đường đi (B3), tab "Mẫu · chạy thử"; file e2e | `apps/admin-web/src/features/processes/**`, `apps/admin-web/src/features/tenants/**` (khối gán), `e2e/P-a/pf4/process-library.pa.ts` | không | L2a, L2b |
| L4 `pl-sht-settings` | nhanh | Sonnet | Gói: `GET /approval-flow` chỉ đọc (quy trình đang dùng), bỏ `PUT /approval-flow`, bỏ `engineFlowDefSync`/`engineSettingsSync` + dự phòng `readFlow`; contracts-web: bỏ `FlowPane`/`api-flow`/`lib/flow-*`, khối "Quy trình duyệt đang dùng: A · vN" (sơ đồ chỉ xem + xem trước) + link editor; nút "Chỉnh quy trình duyệt" trên thẻ duyệt trỏ link; file e2e | `packs/contracts/approval-flow.routes.ts`, `packs/contracts/application/approval-flow*.ts`, `approval-engine.usecase.ts` (xoá sync/dự phòng), `approval.mount.ts`, `apps/contracts-web/src/features/settings/**`, `features/contract-approval/**` (link), `e2e/contracts-web/approval-current.cw.ts` | không | L2a |
| L5 `pl-onboard-default` | nhanh | Sonnet | yaml `approval_process: <key>` ⇒ ghi assignment sau `enablePack('contracts')` (kiểm def thư viện đã xuất bản + Group đủ; sai ⇒ lỗi bước); không có ⇒ chạy mặc định | `apps/admin-api/src/modules/tenant-onboard/**`, `deploy/tenants/*.yaml` (ví dụ/README) | không | L2a |
| dò code trước lát Opus, chạy lại test, relock, STATE/CODEMAP | — | Haiku | | | | |

- [ ] L1 `pl-slot-core` · [ ] L2a `pl-library-api` · [ ] L2b `pl-slot-shape` · [ ] L3 `pl-editor-ui` · [ ] L4 `pl-sht-settings` · [ ] L5 `pl-onboard-default`
- [ ] Cuối đợt: e2e + `test:all` + UAT (Haiku) · review + security diff gộp (Opus medium) · gộp `docs/current` (Sonnet)

Ghi chú tách theo Luật 0c: L1/L2a chỉ phần trạng thái/quyền/RLS/chuyển dữ liệu + int của chính phần đó; mọi UI/e2e/hiển thị ở L3/L4
(Sonnet). Trước L1 và L2a: Explore (Haiku) gom điểm chạm đã liệt kê ở cột "File được sửa" vào brief. Chạy script chuyển dữ liệu trên prod
(chỉ `demo` chạy engine) là bước deploy — chờ người dùng xác nhận.

## Quyết định trong lúc làm
- 2026-10-31 thiết kế: quy trình thư viện = `process_defs` `tenant_id NULL` + `slot`; nháp = hàng def, xuất bản = `process_def_releases` (quay lại = bản mới).
- 2026-10-31 thiết kế: chạy = vật chất hoá **lười lúc mở lượt** vào def tenant `contracts-approval` (`source_ref` so bằng), engine/route/finalize không đổi.
- 2026-10-31 người dùng (làm rõ): đúng một mặc định mỗi khe, nhãn "Mặc định · Sổ Hợp Tác · Duyệt hợp đồng"; tenant chưa gán chạy mặc định, tra mỗi lần mở lượt; mặc định không xoá/tắt, platform admin đổi được.
- 2026-10-31 thiết kế: khe `contracts.approval` chỉ nhận dạng tuần tự (route tính theo danh sách bước) ⇒ canvas dạng khác ⇒ 422 `SLOT_SHAPE_UNSUPPORTED`.
- 2026-10-31 thiết kế: xem trước đường đi (B3) v1 nhập loại HĐ + giá trị mẫu; chọn HĐ thật để CR sau.
- 2026-10-31 readiness (NOT READY 2 Chặn/8 Cao, áp mặc định theo Luật 1b — `readiness.md`):
  - Chặn 1: 0068 thu hẹp `process_defs_select` scope user về `tenant_id NULL AND slot IS NULL`; không phải platform_admin ⇒ 404 với def có `slot`; thêm ca này vào `library-rls.int.test`.
  - Chặn 2: mở rộng route `/process-defs…` hiện có (không tạo `/process-library`); mọi route mới + mọi ghi def có `slot` chỉ platform_admin (403).
  - Cao: `ensureDef` ghi `source_ref` trong cùng UPDATE có guard version, thua đua thử lại 1 lần rồi máy cũ; `start` kiểm `expectSourceRef`.
  - Cao: `source_ref` = sha256 (16 hex) của toàn bộ def đã biên dịch.
  - Cao: thiếu mã Group lúc chạy ⇒ `compiled()` null ⇒ máy cũ.
  - Cao: `slot` CHECK regex (registry kiểm ở app); FK `def_id` ON DELETE RESTRICT; index `assignments(def_id)`; REVOKE UPDATE/DELETE trên releases.
  - Cao: publish/rollback `FOR UPDATE` hàng def + tăng version nháp ⇒ gọi thứ hai 409.
  - Cao: backfill chạy lại bỏ qua tenant đã có key def; "khác mặc định" = so với def mặc định 0069; tenantkey = `admin.tenants.slug` (kiểm cột).
  - Cao: deploy chạy migrate 0069 + backfill cùng một bước.
  - Cao: schema response L2a (impact, releases, assignments, process-slots, chi tiết 422) đặt ở `packages/contracts`.
- 2026-10-31 L2b: `compileDef` thêm `stage.slot` (đủ để `fromStages` dựng lại) + dấu Ký số; schema stage engine thêm trường `slot` tuỳ chọn; hành vi engine không đổi.
- 2026-10-31 Gate: tự duyệt theo Luật 2b (mọi Chặn/Cao có mặc định nằm trong quyết định đã duyệt; không câu hỏi mới).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Quy trình thư viện gắn khe của app
Platform admin tạo quy trình cấp nền tảng gắn khe (v1 `contracts.approval` — "Sổ Hợp Tác · Duyệt hợp đồng"); bước trỏ phòng ban bằng mã, không id; mẫu chạy thử tách riêng.
- Kịch bản: khi def thư viện có khe chứa `group_id` thay vì mã thì lưu bị từ chối 422 `PROCESS_REF_INVALID` [test: apps/hub-api/src/modules/processes/defs/def-group-keys.rules.test.ts » def thư viện dùng id Group ⇒ PROCESS_REF_INVALID]
- Kịch bản: khi người không phải platform_admin gọi API thư viện thì nhận 403 [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » không phải platform_admin ⇒ 403]
- Kịch bản: khi lấy danh sách mặc định thì không có mẫu chạy thử và không có def vật chất hoá; tab "Mẫu · chạy thử" có mẫu [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » danh sách library không lẫn mẫu và def vật chất hoá]

#### Yêu cầu: Gán tenant × khe = đúng một quy trình
Bảng gán có khoá chính (tenant, khe); gán quy trình khác thay thế; chỉ platform admin gán; tenant thiếu phòng ban theo mã thì không gán được.
- Kịch bản: khi gán X → A rồi gán X → B thì chỉ còn một hàng X → B [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » gán lại thay thế, một tenant một khe một quy trình]
- Kịch bản: khi tenant thiếu Group theo mã mà quy trình dùng thì gán bị từ chối 422 `SLOT_GROUPS_MISSING` liệt kê mã thiếu [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » tenant thiếu Group ⇒ SLOT_GROUPS_MISSING]
- Kịch bản: khi tenant Y đọc bảng gán, bản phát hành, khe thì không thấy hàng của tenant X [test: apps/hub-api/src/modules/processes/library/library-rls.int.test.ts » chặn đọc chéo tenant bảng gán, release, khe]

#### Yêu cầu: Quy trình mặc định của khe
Mỗi khe đúng một quy trình mặc định, nhãn "Mặc định · Sổ Hợp Tác · Duyệt hợp đồng"; tenant chưa gán chạy mặc định; không xoá/tắt được; platform admin đổi mặc định sang quy trình đã xuất bản khác.
- Kịch bản: khi xoá hoặc tắt quy trình đang là mặc định hoặc đang gán thì nhận 409 `PROCESS_IN_USE` [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » xoá hoặc tắt quy trình đang dùng ⇒ PROCESS_IN_USE]
- Kịch bản: khi đổi mặc định sang B thì tenant chưa gán mở lượt duyệt kế tiếp chạy B, tenant đã gán A vẫn chạy A [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine-slot.int.test.ts » đổi mặc định áp cho tenant chưa gán ở lượt kế]

#### Yêu cầu: Nháp, xuất bản, lịch sử, quay lại, nhật ký
Sửa trên nháp; chỉ bản xuất bản được chạy; xuất bản kiểm trước (đủ nút hệ thống, không bước không tới được, điều kiện hợp lệ, mọi tenant đang dùng đủ phòng ban) và hiện tác động; quay lại tạo bản mới; mọi xuất bản/gán/quay lại/đổi mặc định ghi audit.
- Kịch bản: khi sửa nháp mà chưa xuất bản thì lượt mới vẫn chạy bản xuất bản cũ [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine-slot.int.test.ts » sửa nháp chưa xuất bản không đổi lượt mới]
- Kịch bản: khi xuất bản thì tạo bản v+1, ghi một dòng audit, impact trả số tenant đang dùng và số lượt đang chạy [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » xuất bản tạo bản mới, ghi audit, impact đúng số]
- Kịch bản: khi quy trình thiếu nút `contracts-finalize` hoặc có bước không tới được thì xuất bản bị từ chối 422 chỉ rõ bước sai [test: apps/hub-api/src/modules/processes/library/library-publish.rules.test.ts » thiếu nút hệ thống hoặc bước không tới được ⇒ từ chối]
- Kịch bản: khi quay lại bản 2 từ bản 4 thì có bản 5 nội dung bằng bản 2 và nháp về bản 2 [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » quay lại tạo bản mới bằng bản cũ]

#### Yêu cầu: Nhân bản rồi gán
Nhân bản mọi quy trình (kể cả đang dùng) thành nháp mới cùng khe, chưa gán; sửa bản nhân bản không ảnh hưởng tenant nào.
- Kịch bản: khi nhân bản A thành A′ và sửa A′ thì lượt mới của tenant đang gán A vẫn chạy A [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » nhân bản tạo nháp mới không ảnh hưởng tenant đang gán]

#### Yêu cầu: Editor một chỗ, hai cách xem, xem trước đường đi
Editor ai-admin có nút Canvas/Form; nút hệ thống khoá; khe `contracts.approval` chỉ nhận dạng tuần tự; xem trước tô bước chạy/bỏ qua theo loại HĐ + giá trị mẫu.
- Kịch bản: khi canvas gửi hai bước song song cho quy trình khe `contracts.approval` thì lưu bị từ chối 422 `SLOT_SHAPE_UNSUPPORTED` [test: apps/hub-api/src/modules/packs/contracts/domain/approval-flow-stages.rules.test.ts » dạng song song ⇒ SLOT_SHAPE_UNSUPPORTED]
- Kịch bản: khi `fromStages(compileDef(flow))` thì ra đúng `flow` ban đầu kể cả `when` và bước Ký số [test: apps/hub-api/src/modules/packs/contracts/domain/approval-flow-stages.rules.test.ts » fromStages nghịch compileDef]
- Kịch bản: khi xem trước với loại "mua" giá trị 50.000.000 thì bước cấp 2 bị bỏ qua và không ghi gì [test: apps/hub-api/src/modules/processes/library/library-preview.int.test.ts » xem trước tô bước bỏ qua, không ghi]
- Kịch bản: khi platform admin sửa ở Form, xuất bản, gán cho tenant thì cột "Tenant đang dùng" tăng và Canvas hiện nút hệ thống khoá [test: e2e/P-a/pf4/process-library.pa.ts » sửa Form, xuất bản, gán tenant, canvas khoá nút hệ thống]

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Engine mở lượt theo quy trình gán cho tenant
Mỗi lần mở lượt duyệt (kể cả mở lại), gói tra quy trình theo tenant của HĐ: gán của khe `contracts.approval`, không có ⇒ mặc định; lấy bản xuất bản, phân giải mã phòng ban theo tenant, đồng bộ def tenant `contracts-approval` khi `source_ref` khác; lượt đang chạy giữ snapshot. Không còn đọc `contracts.approval_flows`.
- Kịch bản: khi X gán A, Y gán B thì HĐ của X chạy các bước của A, HĐ của Y chạy các bước của B [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine-slot.int.test.ts » X gán A, Y gán B chạy đúng quy trình]
- Kịch bản: khi đổi gán X từ A sang B lúc một HĐ đang duyệt thì lượt đó chạy hết theo A, HĐ vào duyệt sau chạy B [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine-slot.int.test.ts » đổi gán: lượt dở giữ snapshot, lượt mới chạy quy trình mới]
- Kịch bản: khi Group theo mã đã bị xoá khỏi tenant thì lượt chạy máy 2 bước và log `contract-engine-flow-invalid` [test: apps/hub-api/src/modules/packs/contracts/application/approval-engine-slot.int.test.ts » thiếu Group lúc chạy ⇒ máy cũ]
- Kịch bản: khi mở lượt với 10.000 tenant và 500 bản phát hành thì `resolveSlot` p95 ≤ 5 ms với số câu SQL cố định [test: apps/hub-api/src/modules/processes/library/slot-resolve.perf.int.test.ts » resolveSlot p95 ≤ 5 ms]

#### Yêu cầu: Chuyển mẫu cũ sang thư viện
Tenant có `contracts.approval_flows` (hoặc cài đặt duyệt khác mặc định) ⇒ quy trình thư viện riêng "Quy trình HĐ – <tên tenant>" đã xuất bản + gán; tenant khác chạy mặc định; id phòng ban đổi sang mã; chạy lại không tạo trùng.
- Kịch bản: khi chạy script hai lần trên tenant có mẫu riêng thì có đúng một quy trình riêng, một gán, bước dùng mã phòng ban [test: apps/hub-api/scripts/process-library-backfill.int.test.ts » chạy hai lần: một quy trình riêng, một gán, bước theo mã]
- Kịch bản: khi tenant chưa lưu mẫu và cài đặt mặc định thì không có gán và lượt mới chạy quy trình mặc định [test: apps/hub-api/scripts/process-library-backfill.int.test.ts » tenant chưa lưu mẫu không gán, chạy mặc định]

### MODIFIED sht/cai-dat-va-quyen.md
#### Yêu cầu: Cài đặt › Quy trình duyệt chỉ hiện quy trình đang dùng
Bỏ form thiết kế luồng; mục hiện "Quy trình duyệt đang dùng: <tên> · v<N>" (sơ đồ chỉ xem + xem trước đường đi) và link sang editor ai-admin; `GET /approval-flow` chỉ đọc; `PUT /approval-flow` bỏ. Ô bật ký số và `PUT /approval-settings` (máy 2 bước) giữ.
- Kịch bản: khi owner mở Cài đặt › Quy trình duyệt thì thấy tên + phiên bản quy trình đang dùng và không có nút lưu luồng [test: e2e/contracts-web/approval-current.cw.ts » Cài đặt hiện quy trình đang dùng, không có form sửa]
- Kịch bản: khi gọi `GET /approval-flow` thì nhận tên, bản, cờ mặc định và các bước có tên phòng ban; `PUT /approval-flow` trả 404 [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-flow-current.int.test.ts » GET chỉ đọc quy trình đang dùng, PUT không còn]

#### Yêu cầu: Gán quy trình khi onboarding tenant
Yaml tenant có `approval_process: <ký hiệu>` ⇒ gán khe `contracts.approval` sau khi bật gói; không có ⇒ chạy mặc định.
- Kịch bản: khi yaml có `approval_process` hợp lệ thì tenant mới có một gán tới quy trình đó [test: apps/admin-api/src/modules/tenant-onboard/application/onboard-approval-process.int.test.ts » approval_process trong yaml ⇒ gán khe]
- Kịch bản: khi yaml ghi ký hiệu không tồn tại hoặc chưa xuất bản thì báo lỗi bước gán, tenant vẫn tạo xong [test: apps/admin-api/src/modules/tenant-onboard/application/onboard-approval-process.int.test.ts » ký hiệu sai ⇒ lỗi bước, tenant vẫn tạo]

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Lượt chạy thử tách khỏi lượt thật
Lượt mở từ trang "Mẫu · chạy thử" (showcase, chạy mẫu) có `is_test = true`; danh sách lượt mặc định chỉ lượt thật.
- Kịch bản: khi chạy thử một mẫu thì lượt có `is_test` và không hiện trong danh sách lượt mặc định [test: apps/hub-api/src/modules/processes/runs/run-is-test.int.test.ts » lượt chạy thử đánh dấu is_test, ẩn khỏi danh sách mặc định]

## Việc còn lại
- L5 (slice/pl-onboard-default 6076a15b): adapter gọi hub bằng env tự đặt `ADMIN_HUB_URL` + `ONBOARD_HUB_ACCESS_TOKEN` (Bearer platform_admin) — security review cuối đợt xét lại (ưu tiên ghi qua cơ chế service sẵn có thay token tĩnh); khớp shape list/assign với L2a; bỏ comment ví dụ khỏi `nitigroup.yaml` (chỉ giữ ở `demo.yaml`).
- L4 (slice/pl-sht-settings fdf1a9b1): chốt shape `steps` + `def_id` của `GET /approval-flow` ở L2a/L4-backend; e2e cũ `esign-flow.cw.ts`, `contract-flow.cw.ts` test form đã bỏ ⇒ qc sửa ở bước e2e cuối đợt.
Đã duyệt 2026-10-31 (`proposal.md` "Quyết định"). Không câu hỏi mở. Chạy script chuyển dữ liệu trên prod + deploy: chờ người dùng xác nhận.
