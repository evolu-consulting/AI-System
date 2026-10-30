---
id: process-library
cr: CR-105
ngày: 2026-10-31
nguồn: proposal.md (đã duyệt — mục "Quyết định" ràng buộc) + làm rõ người dùng 31/10 (mặc định của khe)
---
# Thiết kế: Thư viện quy trình + gán tenant × khe

## 1. Mô hình dữ liệu (hub migration 0068 — L1; seed 0069 — L2)
- **Quy trình thư viện = `hub.process_defs` với `tenant_id NULL` và `slot NOT NULL`** (cột mới `slot text`, check theo registry khe).
  `tenant_id NULL` + `slot NULL` = mẫu chạy thử (showcase, AISDLC, "Duyệt đề nghị chi"). Hàng `process_defs` là **bản nháp** (sửa như
  nay, `version` tăng mỗi lần lưu, khoá lạc quan giữ nguyên). Vì sao: tái dùng editor/validator/copy sẵn có, không thêm bảng def thứ hai.
- Cột mới trên `process_defs`: `slot text`, `slot_body jsonb` (dạng Form của khe — với `contracts.approval` là `Flow` của gói, phòng
  ban theo **mã**), `published_version int` (NULL = chưa xuất bản), `source_ref text` (chỉ trên def tenant được vật chất hoá, xem §3).
- **`hub.process_def_releases`** `(def_id, rel_version)` PK · `name, stages, slot_body, published_by, published_at, note`. Bất biến
  (không UPDATE/DELETE). Xuất bản = chụp nháp thành `rel_version = max+1`; **quay lại** = chụp lại bản cũ thành bản mới + đưa nháp về bản
  đó ⇒ số bản luôn tăng, cache theo `source_ref` không bao giờ nhầm (B1). Vì sao: lịch sử đơn giản nhất, không cần cờ "đang dùng".
- **`hub.process_slots`** `(slot PK, default_def_id NOT NULL)` — đúng **một mặc định mỗi khe** (làm rõ 31/10). Hàng `contracts.approval`
  seed ở 0069 cùng def "Quy trình HĐ mặc định" (từ `defaultFlowFromSettings` với mã Group mặc định của gói).
- **`hub.process_slot_assignments`** `(tenant_id, slot)` **PK** · `def_id, assigned_by, assigned_at` ⇒ 1 tenant × 1 khe = đúng 1 quy
  trình; gán lại = `upsert` thay thế. Không có hàng ⇒ tenant chạy mặc định của khe.
- `hub.process_runs.is_test boolean not null default false` (lượt từ "Mẫu · chạy thử").
- Bước trỏ Group bằng **mã** trong def thư viện: thêm các trường song song `group_key`, `department_group_key`, `escalate.group_key`,
  `also_group_keys`, `answerer.group_key`, `run_group_keys` vào `ProcessStageDef` (packages/contracts). Luật: def `tenant_id NULL` +
  `slot` ⇒ chỉ được dùng `*_key` (id ⇒ 422 `PROCESS_REF_INVALID`); def tenant ⇒ chỉ id (như nay).

## 2. Registry khe (L1 — ranh giới module, Opus)
`processes/library/slots.ts`: `SlotSpec = { key, label, packKey, requiredInputs, systemTools, validate(body), compile(body) → stages,
fromStages(stages) → body | {error}, preview(body, facts) }`. Gói đăng ký khe lúc mount (`approval.mount.ts` đăng ký
`contracts.approval`, nhãn **"Sổ Hợp Tác · Duyệt hợp đồng"**, input `contract-id`, tool hệ thống `contracts-route`/`contracts-finalize`;
`compile` = `compileDef` hiện có trên `Flow` theo mã). Khe chưa đăng ký (gói tắt) ⇒ def thư viện vẫn đọc được, không gán/xuất bản được.

## 3. Luồng chạy — "vật chất hoá lười lúc mở lượt" (L1)
Chọn **vật chất hoá vào def tenant `contracts-approval` lúc mở lượt** (không phải lúc xuất bản/gán, không phải chạy thẳng def thư viện):
1. `startEngineApproval`/`reopen` gọi port mới `resolveSlot(tenantId, "contracts.approval")` — **một câu SQL** scope system:
   `coalesce(assignment.def_id, slots.default_def_id)` join `process_def_releases` bản `published_version` ⇒ `{defId, name, relVersion,
   slotBody}`. Đây là "tra quy trình theo tenant mỗi lần mở lượt": đổi gán / xuất bản / đổi mặc định có hiệu lực ngay lượt kế, kể cả
   mọi tenant chưa gán khi đổi/xuất bản mặc định — **không fan-out** khi xuất bản.
2. Gói phân giải mã → id bằng `groups.idsOf` sẵn có (1 SQL), dựng `Flow` theo id, `compileDef`, rồi `port.ensureDef(key
   "contracts-approval", def, {sourceRef})` với `sourceRef = "<defId>@<relVersion>#<hash(id đã phân giải)>"`. `ensureDef` mở rộng: có
   `sourceRef` ⇒ so **bằng** với cột `source_ref` (không so `pack_version` đơn điệu — đổi A→B có thể "lùi" số bản); khác ⇒ update def tenant
   (version tăng). Giống thì 0 ghi.
3. `openRun` như cũ (`process_key` vẫn là def tenant `contracts-approval`) ⇒ engine, pinning `def_version`+`snapshot`, route/finalize,
   ký số, thẻ duyệt **không đổi**. `attach` ghi `version = relVersion` + `steps` đã phân giải (như nay) và thêm `process_name` vào snapshot
   lượt để thẻ hiện "A · v4".
4. Thiếu mã Group lúc chạy (Group bị xoá sau khi gán) ⇒ `compiled()` null ⇒ hành vi sẵn có: log `contract-engine-flow-invalid`, lượt
   chạy máy cũ. Không có release nào (chưa seed) ⇒ L1 tạm rơi về đường cũ `readFlow`; L4 xoá đường cũ.
Vì sao không xuất bản-đẩy: mặc định áp cho N tenant chưa gán ⇒ đẩy N def + đua với gán; lười chỉ thêm ~2 SQL nhỏ/lượt, tự lành.
**Perf (Luật 4c):** `resolveSlot` p95 ≤ 5 ms (10.000 tenant, 50 def, 500 release), SQL cố định theo PK/index, không theo hàng.

## 4. API (hub-api, `/process-library/*`, chỉ `platform_admin`; ghi qua `withConfigWrite` + `dbHubAudit` — B6)
| Việc | Endpoint | Ghi chú |
|---|---|---|
| Khe | `GET /process-slots`, `PUT /process-slots/:slot/default {def_id}` | def phải đã xuất bản, cùng khe |
| Danh sách | `GET /process-defs?kind=library\|template` | thêm `slot_label`, `tenant_count`, `is_default`; def vật chất hoá (`source_ref`) ẩn |
| Nháp | `POST/PUT /process-defs` (có `slot`, `slot_body` hoặc `stages`) | `stages` ⇒ `fromStages` (sai dạng ⇒ 422 `SLOT_SHAPE_UNSUPPORTED` kèm stage) |
| Xuất bản | `GET /process-defs/:id/impact` (B5), `POST …/publish {version, note}` | B2 trước; trả `{rel_version}` |
| Lịch sử | `GET …/releases`, `GET …/releases/:v`, `POST …/rollback {rel_version}` | quay lại = bản mới |
| Nhân bản | `POST …/clone` | bản nháp mới cùng khe, key mới, chưa gán |
| Gán | `GET …/assignments`, `PUT /tenants/:tid/process-slots/:slot {def_id}`, `DELETE` (về mặc định) | kiểm Group của tenant |
| Xem trước | `POST …/preview {deal, total_value}` (B3) | thuần (`SlotSpec.preview`), không ghi |
- **B2** (`publish`, `assign`, `set default`): `SlotSpec.validate` (đủ nút hệ thống, không bước không tới được, điều kiện chỉ `deal`/
  `total_value`) + **thiếu Group theo tenant** bằng một SQL tập: mã cần ⊆ `admin.groups.key` cho mọi tenant đang dùng (gán; nếu là mặc
  định: mọi tenant bật gói `contracts` chưa gán). Lỗi ⇒ 422 `PROCESS_PUBLISH_INVALID` / `SLOT_GROUPS_MISSING {tenant, keys[]}`.
- Def đang gán hoặc là mặc định: `DELETE`/tắt ⇒ 409 `PROCESS_IN_USE`; đổi `key`/`slot` ⇒ 409. Nhân bản luôn được.
- Gói `contracts`: `GET /approval-flow` thành **chỉ đọc** = quy trình đang dùng `{name, rel_version, is_default, steps (tên phòng ban)}`;
  **bỏ `PUT /approval-flow`** (route không còn ⇒ 404) và bỏ `engineFlowDefSync`/`engineSettingsSync` (L4). `approval_settings` giữ cho máy 2 bước.

## 5. Form ↔ Canvas (khe `contracts.approval`)
Nguồn thật là `slot_body` (`Flow` theo mã); `stages` = `compile(slot_body)` ghi kèm mỗi lần lưu. Canvas hiện `stages`; nút `contracts-route`/
`contracts-finalize` khoá (không xoá/đổi). Sửa trên canvas gửi `stages` ⇒ `fromStages` (nghịch `compileDef`): nhận chuỗi tuần tự
review/dify giữa route và finalize, `when` (FlowWhen: `deal ∈ […]`, `total_value ge|gt|le|lt`, and/or) nằm ở `stage.slot.when`, bước
Ký số là nút đuôi khoá loại (không là stage engine, như nay). Dạng khác (song song, If, nhánh) ⇒ 422 `SLOT_SHAPE_UNSUPPORTED` — vì
`contracts-route` tính bước theo danh sách tuần tự. Form = editor bước (chuyển từ `FlowPane` của contracts-web sang admin-web). Quy
trình không có khe biểu diễn bằng Form chỉ khi toàn review tuần tự; khác ⇒ Form chỉ xem + "Sửa ở Canvas".

## 6. Chuyển dữ liệu (L2, script một lần, idempotent, có `--dry-run`)
`apps/hub-api/scripts/process-library-backfill.ts`: với mỗi tenant có hàng `contracts.approval_flows` ⇒ đổi mọi id phòng ban/Group
sang `admin.groups.key` (id không còn ⇒ dừng tenant đó, báo), tạo def thư viện "Quy trình HĐ – <tên tenant>" (key
`contracts-approval-<tenantkey>`), xuất bản v1, gán. Tenant chưa lưu mẫu mà `approval_settings` khác mặc định (ngưỡng/mã Group) ⇒ cũng tạo
riêng (giữ hành vi); còn lại ⇒ không gán (chạy mặc định). Người dùng cụ thể (`approver_user_id`, người ký) ⇒ giữ id (thuộc tenant, chỉ
hợp lệ trong def riêng tenant đó; validate từ chối nếu def đó gán cho tenant khác). Def tenant `contracts-approval` cũ giữ nguyên cho run
đang chạy; lượt mới vật chất hoá đè (version tăng). Không xoá `contracts.approval_flows` đợt này (để quay lui), chỉ ngừng đọc.

## 7. Mẫu chạy thử, mặc định, onboarding
- Danh sách ai-admin mặc định chỉ quy trình thật (thư viện + def tenant không vật chất hoá); tab **"Mẫu · chạy thử"** cho `slot NULL,
  tenant_id NULL`. Lượt mở từ Showcase/RunDialog của mẫu ⇒ `is_test = true`; danh sách lượt lọc `is_test=false` mặc định.
- Dòng mặc định hiện nhãn **"Mặc định · Sổ Hợp Tác · Duyệt hợp đồng"**; không xoá/tắt; platform admin đổi mặc định bằng chọn quy trình
  đã xuất bản khác.
- Onboarding yaml: `approval_process: <key>` (tuỳ chọn) ⇒ sau `enablePack('contracts')` ghi assignment (key phải là def thư viện đã xuất
  bản của khe, Group đủ — sai ⇒ báo lỗi bước, không dừng tenant). Không có ⇒ không ghi gì (chạy mặc định).

## 8. Bảo mật / RLS
- `process_slot_assignments`: RLS bật; policy tenant chỉ `SELECT` hàng `tenant_id = app.tenant_id`; không policy ghi cho vai tenant ⇒ ghi
  chỉ qua scope system sau kiểm `platform_admin` (route + `withConfigWrite`). `process_slots`, `process_def_releases`: không có cột
  tenant, RLS bật, chỉ scope system đọc/ghi (tenant đọc gián tiếp qua `resolveSlot`/`GET /approval-flow` của gói, chỉ hàng của mình).
- `resolveSlot(tenantId)` nhận tenant từ ngữ cảnh gói (`who.tenantId`), không từ client. Test chặn đọc chéo mỗi bảng mới.
- `slot_body`/`stages` thư viện không chứa id Group (ngăn rò id tenant A sang B); `approver_user_id` chỉ cho def chỉ gán một tenant.

## 9. Ca biên
Gán def chưa xuất bản ⇒ 422 `PROCESS_NOT_PUBLISHED` · đổi gán khi HĐ đang duyệt ⇒ lượt dở chạy snapshot cũ · hai admin xuất bản cùng lúc
⇒ khoá lạc quan nháp `version` (409) · gói `contracts` tắt ⇒ khe ẩn khỏi "Dùng cho", gán còn giữ · tenant mới chưa có Group mặc định ⇒
lượt rơi máy cũ (như nay) và B2 báo khi đổi mặc định · engine tắt cho tenant ⇒ không gọi `resolveSlot`.
