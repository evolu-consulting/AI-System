---
id: M2-catalog-command
title: Catalog & command (Secrets, Workflows, Commands, Features + entitlement)
milestone: M2
status: draft            # draft → ready → approved → in-progress → done
requirements: [ADM-FR-10, ADM-FR-11, ADM-FR-12, ADM-FR-13, ADM-FR-14, ADM-FR-15, ADM-FR-20, ADM-FR-21, ADM-FR-22, ADM-FR-24, ADM-FR-30, ADM-FR-31, ADM-FR-33, ADM-FR-34, ADM-FR-50, ADM-BR-01, ADM-BR-02, ADM-BR-04, ADM-BR-06, ADM-BR-10, ADM-BR-13, ADM-BR-14, AC-A03, AC-A05, AC-A06, AC-A13]
design: [docs/ROADMAP.md#M2, docs/design/admin/ba-admin.md#53-catalog-workflow, docs/design/admin/ba-admin.md#54-command, docs/design/admin/ba-admin.md#55-feature--phân-quyền, docs/design/admin/ba-admin.md#57-secret-audit-importexport, docs/design/admin/ba-admin.md#6-luật-nghiệp-vụ, docs/design/admin/ba-admin.md#7-mô-hình-dữ-liệu-schema-admin, docs/design/admin/ba-admin.md#8-api, docs/design/admin/ba-admin.md#11-tiêu-chí-nghiệm-thu-các-kịch-bản-chính, docs/design/admin/ui-admin.md#73-commands--danh-sách, docs/design/admin/ui-admin.md#74-command--editor-màn-hình-quan-trọng-nhất, docs/design/admin/ui-admin.md#76-workflows-catalog-dùng-chung, docs/design/admin/ui-admin.md#78-secrets, docs/design/admin/ui-admin.md#712-features, docs/specs/_design/admin-missing-screens.md#2-commands--danh-sách-commands, docs/specs/_design/admin-missing-screens.md#3-features--danh-sách-features--editor-featuresid, docs/specs/_design/admin-missing-screens.md#6-secrets--secrets--drawer, docs/adr/0001-stack.md, docs/readiness/2026-10-01-admin-m1-m4.md, docs/TECH-DEBT.md#13, docs/CONVENTIONS.md#8-migration-db, canvas: Commands · Workflows · Secrets · Access]
owner: backend-lead + frontend-lead
---

# M2 Catalog & command

Mốc: [ROADMAP M2](../../ROADMAP.md). Nền: [M1-foundation-identity](../M1-foundation-identity/spec.md) (contract `packages/contracts`, `withScope` + RLS, module pattern `apps/admin-api/src/modules`, shell/shared `apps/admin-web`, `VERSION_CONFLICT`, bảng `features` + seed `core`) và migration dev `0000_hub_stub.sql` (`hub.agent_workflows` cho FR-13/15). Không chép BA; chỉ ghi phần cụ thể hoá.

## 1. Phạm vi

**Làm** (chỉ `platform_admin`, BR-14):
- **Secrets** (FR-50, BR-04): list/tạo/thay giá trị/sửa ghi chú/xoá; mã hoá AES-256-GCM, không bao giờ trả giá trị.
- **Workflows** (FR-10, 11, 13, 14, 15): CRUD catalog, mô tả bắt buộc 20–400 ký tự, input schema nhập tay (mô tả tham số bắt buộc), nhãn + bộ lọc "Chưa gắn", cột/endpoint "Đang được dùng bởi" (command Admin + agent đọc `hub.agent_workflows`), chặn xoá/tắt khi đang dùng.
- **Commands** (FR-20, 21, 22, BR-01, 02, 06, 10): CRUD, alias, tham số, input map (8 nguồn), output, sync/async, timeout, bật/tắt, ≥ 1 feature (mặc định `core`), validate input map khi lưu, nhân bản, **không có nút Test**.
- **Features + entitlement** (FR-30, 31, 33, 34): CRUD feature (key bất biến), trạng thái `on|off|beta`, command trong feature, cấp/thu hồi cho tenant, `core` tự hiệu lực, tab "Ai dùng được" phần tenant (FR-24, xem M2-R23).
- **Web:** 4 nhóm màn (Secrets, Workflows, Commands, Features) dùng shell/shared M1; i18n VI/EN; menu thêm 4 mục (chỉ `platform_admin`).
- **Dữ liệu:** migration mới `secrets`, `workflows`, `commands`, `command_names`, `feature_commands`, `feature_entitlements` (§4).

**Không làm (mốc khác):**
- **Nút Test, `POST /admin/commands/:id/test`, "Chạy với tư cách user…" (FR-23 = M5)**; "Kiểm tra kết nối" của workflow (RD#35): không có route, ẩn nút.
- **FR-12 "Lấy schema từ Dify" (COULD)**: ROADMAP gom vào dải 10–15 nhưng không làm ở M2 (Mơ hồ A8). Nếu làm sau: gọi Dify **ngoài** `withScope`/sau commit.
- Grant, group, ma trận, `beta-testers`, Kiểm tra quyền (M3); NOTIFY `config_changed`/`config_version` (FR-53 = M3, Mơ hồ A1); chống ghi đè UI/modal 409 (FR-55 = M3; backend `version` + 409 đã có); audit và nút "Lịch sử"/Khôi phục (FR-51/52 = M4, ẩn menu "Lịch sử"); Import/Export (FR-54 = M4); Quota (M4).
- Hub đọc catalog / chạy command / lấy app key (Hub chưa có; Mơ hồ A7). Tab "Feature" trong chi tiết Tenant: giữ "Chưa khả dụng" (Mơ hồ A10).

**Ràng buộc bắt buộc (hard rule, không tự nới):**
- **TECH-DEBT #13:** `withScope` chạy lại cả callback khi 40P01/40001 (≤ 3 lần), chỉ an toàn khi callback chỉ làm việc DB. M2 **không** NOTIFY, gọi Dify, gọi mock Hub hay gửi mail trong callback. Cần gì ra ngoài (kể cả FR-12 nếu làm) thì đặt **sau commit** (trả kết quả từ `withScope` rồi mới gửi).
- **CONVENTIONS §8:** không sửa migration đã commit (kể cả `0002_admin_rls.sql`, `0000_hub_stub.sql`); M2 chỉ thêm `0003_…`, `0004_…` (kể cả quyền/RLS/REVOKE cho bảng mới). Ghi `docs/PRODUCTION-NOTES.md` khi có quyết định vận hành.
- **Secrets chạm bảo mật** (M2-R01…R06): mã hoá at-rest, không trả lại giá trị, chỉ `platform_admin`, `hub_ro` không đọc được. **Trình Gate (không tự duyệt Luật 2b) nếu** phải thêm thư viện hoặc dịch vụ mới (mã hoá dùng `node:crypto` có sẵn trong Bun, không cần thư viện), hoặc cần secret thật (khoá master dev sinh cục bộ bằng `keys:dev` không tính là secret thật).

## 2. Nghiệp vụ

Luật gốc: [BA §5.3–5.5, §5.7, §6](../../design/admin/ba-admin.md); UI: [ui-admin 7.3, 7.4, 7.6, 7.8, 7.12](../../design/admin/ui-admin.md) + [missing-screens §2, 3, 6](../_design/admin-missing-screens.md). Bảng dưới là phần **cụ thể hoá**. Nhãn nguồn: `[RD#n]` = [readiness](../../readiness/2026-10-01-admin-m1-m4.md) (người dùng **đã chấp nhận**); `ĐX` = đề xuất mới của docs-architect, **chưa chấp nhận** (xem §9, qc/spec-readiness xác nhận; đổi thì sửa tại đây).

| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| M2-R01 | Tên secret `^[A-Z0-9_]{2,64}$` (UI tự chuẩn hoá HOA, dấu cách/`-` → `_`), unique, bất biến (API `PUT/DELETE /admin/secrets/:name` gọi theo tên). Ghi chú ≤ 200 ký tự. Giá trị 8–2048 ký tự, không trim | RD#25, RD#20, RD#28, ĐX |
| M2-R02 | Mã hoá AES-256-GCM: khoá = `SECRET_MASTER_KEY` (32 byte base64, thiếu/sai độ dài → admin-api exit 1 nêu tên biến, không in giá trị); IV 12 byte CSPRNG **mới mỗi lần ghi**; AAD = `id` secret; lưu `ciphertext` (kèm tag), `iv`, `last4` (4 ký tự cuối giá trị), `key_version` (=1, chuẩn bị xoay khoá; xoay khoá chưa làm → TECH-DEBT) | FR-50, NFR-01, ĐX |
| M2-R03 | **Giá trị không bao giờ rời Admin** (BR-04, AC-A06): mọi response chỉ có `name`, `last4`, `note`, `used_by`, `updated_at`, `updated_by`, `created_at`; không có `ciphertext`/`iv`. `GET /admin/secrets` không có tham số trả giá trị; không log body/header của `/admin/secrets*`; thông điệp `VALIDATION_ERROR` của secret không chứa giá trị (không echo input). Export (M4) chỉ tên. Test kiểm bằng cách quét response, log và HTML trang | BR-04, AC-A06, ĐX |
| M2-R04 | Tạo secret trùng tên → 409 `NAME_TAKEN`/`SECRET_NAME_TAKEN` (backend-lead chốt mã ở §3). Thay giá trị (`PUT`) đổi `ciphertext/iv/last4/updated_by/updated_at`, giữ `id`, không đổi `used_by`; sửa ghi chú không đụng ciphertext | RD#28, ĐX |
| M2-R05 | Xoá secret đang có workflow tham chiếu → 409 `SECRET_IN_USE {used_by:[workflow key]}`; không dùng → xoá thật (không soft-delete) | UI 7.8, missing-screens §14.5 |
| M2-R06 | Chỉ `platform_admin` (`tenant_admin`/`member` → 403 `FORBIDDEN`, kiểm role trước khi tra). Bảng `secrets`: RLS bật, policy chỉ `app.scope='platform'`; `REVOKE ALL ON admin.secrets FROM hub_ro` (default privileges M0 mặc định cấp SELECT cho `hub_ro` nên **bắt buộc** thu hồi tường minh) | BR-14, NFR-07, ĐX (bảo mật → backend-lead xác nhận, có test) |
| M2-R07 | Workflow: `key` `^[a-z0-9-]{2,32}$` unique, bất biến; `name` ≤ 128; **mô tả bắt buộc 20–400 ký tự (đếm sau trim), một bản (không song ngữ)**; `app_type` ∈ `workflow\|chat\|agent`; `base_url` http/https hợp lệ, không chứa userinfo; `secret_id` tham chiếu secret tồn tại (bắt buộc); `output_field` tuỳ chọn; `enabled` mặc định `true` | FR-10, RD#25, RD#27, ĐX (base_url) |
| M2-R08 | `input_schema` = mảng `[{name, type: text\|number\|boolean\|select\|file, required, description (bắt buộc, không rỗng sau trim), options? (chỉ khi select, ≥ 1)}]`; `name` unique trong workflow, `^[A-Za-z_][A-Za-z0-9_]*$`, ≤ 64; tối đa 50 tham số. Mô tả workflow + mô tả tham số được Hub dùng nguyên văn làm tool (không chuẩn hoá thêm khi lưu) | FR-11, RD#26, ĐX (giới hạn) |
| M2-R09 | Workflow "Chưa gắn" = không có command nào **và** không có dòng `hub.agent_workflows` nào. Hợp lệ, lưu được (AC-A13); lọc `?attached=false`; cờ `unattached` tính ở server. Workflow không có quyền riêng (BR-13): không có endpoint grant/quyền | FR-14, BR-13, AC-A13 |
| M2-R10 | `usages` của workflow = `{commands:[{id,name,enabled}], agents:[{id}]}` (tên agent ở Hub, Admin chỉ có `agent_id`; UI hiện "Agent …{id ngắn}" tới khi Hub có API tên — Mơ hồ A6). Danh sách workflow trả `command_count`, `agent_count`, `unattached` | FR-15, RD#11 |
| M2-R11 | Chặn **xoá** workflow khi còn bất kỳ command hoặc agent tham chiếu; chặn **tắt** (`enabled=false`) khi còn command **đang bật** hoặc bất kỳ agent dùng. Cả hai → 409 `WORKFLOW_IN_USE {commands[], agents[]}`. Không có command/agent → xoá/tắt được | FR-13, AC-A05, RD#8 |
| M2-R12 | Môi trường không có schema `hub` (production trước khi Hub tồn tại): phần agent của `usages` = rỗng, **không** lỗi 500. Cách phát hiện (vd `to_regclass('hub.agent_workflows')`) do backend-lead chọn; tuyệt đối không tạo bảng hub trong migration chính | RD#11, ĐX (Mơ hồ A5) |
| M2-R13 | Command: `name` và mỗi `alias` thuộc **một không gian tên chung toàn hệ thống**, `^[a-z0-9-]{2,32}$`, không dấu (UI tự bỏ dấu); trùng với tên hoặc alias của command khác (kể cả khác loại) → 409 `COMMAND_NAME_TAKEN {name}`; tối đa 5 alias, không trùng nhau/không trùng tên chính. Bảng `command_names(name PK, command_id FK cascade)` đảm bảo unique, ghi cùng transaction | BR-01, RD#18, ĐX (độ dài, ≤ 5 alias) |
| M2-R14 | Command trỏ **đúng một** `workflow_id` (BR-02, bắt buộc, FK RESTRICT). Nhiều command dùng chung workflow. Lưu/bật command mà workflow đang tắt → 409 `WORKFLOW_DISABLED` (UI cũng khoá công tắc, ui-admin 7.3) | BR-02, UI 7.3, ĐX |
| M2-R15 | `description` `{vi, en?}` (vi bắt buộc ≤ 200; en trống = dùng vi). `args = [{name, description {vi,en?}, default?, fallback?, rest}]` (`name` `^[a-z][a-z0-9_]*$`, unique; tối đa 1 tham số `rest=true` và phải là tham số cuối). `output = {field, render: markdown\|text\|json}`. `mode` ∈ `sync\|async`; `timeout_s` int 1–600 (mặc định sync 30, async 120). `enabled` mặc định `false` khi nhân bản, `true` khi tạo mới | FR-20, RD#6, RD#27, ĐX (khoảng timeout) |
| M2-R16 | `input_map = {<biến workflow>: {source, value?}}`, `source` ∈ `arg` (value = tên tham số), `selection`, `page_url`, `page_text`, `attachment`, `user_id`, `tenant_id`, `const` (value = chuỗi hằng, ≤ 4000). Ánh xạ cú pháp BA: `$args.<tên>`→`arg`, `$selection`→`selection`, `$page.url`→`page_url`, `$page.text`→`page_text`, `$attachment`→`attachment`, `$user.id`→`user_id`, `$tenant.id`→`tenant_id`. Nguồn lạ → 400 | FR-21, RD#6, ĐX (tên mã nguồn) |
| M2-R17 | Validate khi lưu (cả tạo, sửa, đổi workflow): mọi input `required` của workflow phải có trong `input_map` (thiếu → 400 `INPUT_MAP_INVALID`, `details.missing:[tên]`, message gồm đúng chuỗi `thiếu input bắt buộc: target_lang` theo AC-A03 — dạng i18n do FE dựng từ `details`); khoá không tồn tại trong workflow → `details.unknown:[tên]`; `source=arg` trỏ tới tham số chưa khai báo → `details.unknown_args`. **Map sai kiểu chỉ cảnh báo**, không chặn (`warnings` trong response, không lưu) | FR-22, AC-A03, RD#51, ĐX (mã lỗi) |
| M2-R18 | Đổi workflow của command: giữ các map còn hợp lệ, báo map bị bỏ ở UI (ui-admin 7.4); server vẫn áp M2-R17 trên kết quả cuối. **Sửa input_schema của workflow làm hỏng command đang dùng** (xoá/đổi tên biến đang được map, thêm biến bắt buộc chưa map) → 409 `SCHEMA_BREAKS_COMMANDS {commands[]}`, không lưu | ui-admin 7.6, ĐX |
| M2-R19 | Command ≥ 1 feature (BR-10), `feature_ids` mặc định `[core]`; rỗng → 400 `COMMAND_NEEDS_FEATURE`. Bỏ command khỏi feature cuối cùng của nó (từ editor Feature) → cùng mã lỗi, **chặn lưu** | BR-10, missing-screens §3.2 |
| M2-R20 | Feature: `key` `^[a-z0-9-]{2,32}$` unique, bất biến (đã seed `core`); `name {vi, en?}` (vi bắt buộc ≤ 64), `description {vi?,en?}` ≤ 400, `icon` (tên lucide, mặc định `package`), `status` ∈ `on\|off\|beta`. `core`: **không xoá/tắt/đổi key/đổi sang beta** (409 `CORE_FEATURE_PROTECTED`), vẫn sửa được tên/mô tả/icon. (`beta-testers` là group M3, không có ở M2) | FR-30, BR-10, RD#29 |
| M2-R21 | Xoá feature: chặn khi có command **chỉ** thuộc feature đó → 409 `FEATURE_HAS_EXCLUSIVE_COMMANDS {commands[]}`; ngược lại xoá, kéo theo `feature_commands`, `feature_entitlements` của nó (grant M3 cũng cascade) | RD#29, missing-screens §14.4 |
| M2-R22 | Entitlement: `PUT /admin/features/:id/entitlements/:tenant_id` cấp (idempotent), `DELETE` thu hồi = **đặt `revoked_at`** (không xoá hàng; BR-12 để grant M3 được giữ). Cấp lại xoá `revoked_at`, cập nhật `granted_by/granted_at`. `core` tự hiệu lực với mọi tenant **không cần hàng** (RD#7); PUT/DELETE trên `core` → 409 `CORE_FEATURE_PROTECTED`. Tenant bị khoá vẫn cấp được. Danh sách trả `active_user_count` = số user `active` của tenant (grant chưa có ở M2, M3 tinh chỉnh) | FR-31, BR-10, BR-12, RD#7, ĐX (active_user_count) |
| M2-R23 | FR-24 ở M2 = tab "Ai dùng được" của command chỉ phần **tenant**: các tenant có ≥ 1 feature của command được hiệu lực (`on|beta`, entitlement hoặc `core`), kèm feature và số user active; phần group/grant hiện "Chưa khả dụng" (M3). Không có endpoint Hub | FR-24, BR-11 một phần, ĐX (Mơ hồ A9) |
| M2-R24 | Kill switch (FR-33) và `beta` (FR-34) ở Admin = **chỉ lưu `status` đúng** và hiển thị (nhãn Beta, xác nhận mức vừa khi tắt, đếm command/người bị ảnh hưởng). Hiệu lực "≤ 5 s" và lọc theo `beta-testers` do Hub/M3 (NOTIFY). Tắt feature **không** sửa `enabled` của command; BR-06: thực thể tắt vẫn lưu, Hub coi như không tồn tại | FR-33, FR-34, BR-06, ĐX (Mơ hồ A1) |
| M2-R25 | Mọi `PATCH` workflow/command/feature nhận `version` (≥ 1), lệch → 409 `VERSION_CONFLICT {current, updated_at}` (M1-R19, CR-008); tăng `version` chỉ khi trường người dùng sửa được hoặc `enabled/status` đổi; không đổi gì → trả bản hiện tại, không tăng. Secrets không có `version` (ghi sau thắng, có `updated_by`) | FR-55 (BE), M1-R19, ĐX (secret) |
| M2-R26 | Danh sách dùng quy ước M1 (`{items,total,counts}`, `?q&limit=50&offset`, limit ≤ 200, `counts` tính trừ bộ lọc `status`): Secrets `?used=`; Workflows `?attached=&enabled=&secret=&q`; Commands `?status=&feature=&workflow=&q`; Features `?status=&q`. Lỗi `{error:{code,message,details?}}`; `:id`/`:name` lạ → 404 `NOT_FOUND` | M1-R19, ui-admin 7.3, 7.6 |
| M2-R27 | Mọi ghi nhiều bảng (command + `command_names` + `feature_commands`; workflow + kiểm tham chiếu) chạy **một** transaction `withScope`, khoá thứ tự cố định `workflows → commands → features` bằng `FOR NO KEY UPDATE` (bài học deadlock M1 N1); callback chỉ làm việc DB (TECH-DEBT #13) | TECH-DEBT #13, M1 review N1 |
| M2-R28 | Nhãn UI nguyên văn lấy từ missing-screens §2, §3, §6 và artboard Workflows; bỏ nút "Kiểm tra kết nối", "Lấy từ Dify", "Lịch sử", Test. Chuỗi VI/EN đủ (`bun run i18n:check`); `core` hiển thị "Mặc định" / "Mọi tenant" | UI 15, RD#35, RD#41 |

## 3. Contract (backend-lead)
<!-- backend-lead -->
File dự kiến: `packages/contracts/src/{secrets,workflows,commands,features}.ts` (+ mở rộng `common.ts`/`errors.ts`). Nghĩa vụ: dùng lại `ListQueryBase`, `listResponseSchema`, `versionConflictDetailsSchema`, `API_ERRORS`; endpoint theo [BA §8](../../design/admin/ba-admin.md) (Secret, Catalog, Command, Feature) **trừ** `/commands/:id/test`; thêm `DELETE /admin/secrets/:name` (RD#20), `GET /admin/workflows/:id/usages`. Mã lỗi mới phải vào `API_ERRORS` (tên ở M2-R04…R22 là đề xuất). Sự kiện / NOTIFY: **không có ở M2**.

## 4. Dữ liệu (backend-lead)
<!-- backend-lead -->
Bảng: `secrets` (BA §7 + `key_version`), `workflows`, `commands`, `command_names`, `feature_commands`, `feature_entitlements` (đã có `features`). Migration mới `0003_…` (drizzle sinh) + `0004_…` (custom: RLS `secrets`, RLS `feature_entitlements` theo `tenant_id`, `REVOKE … hub_ro` trên `secrets`, GRANT `admin_rw`), không sửa migration cũ. `workflows`/`commands`/`feature_commands`/`command_names` không có `tenant_id` → không RLS (như `features` M1), chặn bằng role ở route. Seed: giữ nguyên M1 (`core`); không seed secret/workflow. Env: `SECRET_MASTER_KEY` bắt đầu được validate (M1 chỉ khai báo).

## 5. UI (frontend-lead)
<!-- frontend-lead -->
Artboard: `Secrets`, `Workflows`, `Commands` (`docs/design/canvas/`); Features và editor Command dùng mẫu A/B theo [missing-screens §2, §3](../_design/admin-missing-screens.md); `Access` chỉ để đối chiếu (ma trận = M3). Câu chữ nguyên văn ở missing-screens §2, §3, §6 và artboard Workflows. Menu M2: Commands, Workflows, Features, Secrets (chỉ `platform_admin`; `tenant_admin`/`member` → 403 `ForbiddenState`).

## 6. Hiệu năng
Mặc định `CONVENTIONS.md` §6, ADM-NFR-03 (CRUD < 300 ms, 5.000 bản ghi/bảng ở mức M1; catalog thực tế vài trăm). Riêng: `GET /admin/workflows` kèm `command_count`/`agent_count` và `GET /admin/features` kèm `command_count`/`tenant_count` phải gộp bằng `GROUP BY`, không N+1; ghi secret (mã hoá) < 50 ms. Bundle: giữ ngân sách M1 (JS ≤ 150 KB gzip ban đầu), route-split 4 màn mới.

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| Postgres 16 | Như M1 (`ai_system_test`); migration mới chạy bởi owner, app bằng `admin_api` |
| `hub.agent_workflows` | Bảng stub `migrations-dev/0000_hub_stub.sql` (test tự `INSERT` để dựng agent "Trợ lý dịch" cho AC-A05); production không có (M2-R12) |
| Dify / Hub / Redis / SMTP | Không dùng ở M2 (không NOTIFY, không gọi mock Dify/Hub) |

Env: `SECRET_MASTER_KEY` (32 byte base64): dev/test sinh cục bộ bằng `bun run keys:dev` (backend-lead mở rộng script ghi dòng này vào `.env.local`) và CI sinh trong job; `.env.example` giữ trống. Không thêm thư viện (mã hoá = `node:crypto`/Web Crypto của Bun); nếu cần thư viện mới (vd bộ soạn JSON/kéo-thả) → ADR + trình Gate.

## 8. Tiêu chí nghiệm thu (qc)

Bốn AC trích nguyên văn [BA §11](../../design/admin/ba-admin.md). qc điền cột Test và dữ liệu cụ thể trong `test-plan.md`.

| AC | Given / When / Then (nguyên văn BA) | Test |
|---|---|---|
| AC-A03 (phía Admin) | **Tạo command.** Given workflow `translate` có input bắt buộc `source_text`, `target_lang`, When tạo `/dich` mà chưa map `target_lang`, Then không lưu được và báo "thiếu input bắt buộc: target_lang". When map đủ, chọn feature `core` và lưu, Then trong ≤ 5 giây `/dich` xuất hiện trong menu `/` của mọi user. | `tests/acceptance/M2/…` (qc) |
| AC-A05 | **Xoá workflow đang dùng.** Given `/dich` và agent "Trợ lý dịch" đang dùng workflow `translate`, When xoá `translate`, Then bị chặn và hiện danh sách gồm cả command lẫn agent đang dùng. | (qc) |
| AC-A06 | **Secret.** When gọi `GET /admin/secrets` hoặc export, Then kết quả chỉ có tên và last4, tuyệt đối không có giá trị thật. | (qc) |
| AC-A13 | **Workflow chưa gắn.** When builder khai báo workflow `report-tax` mà không tạo command hay gắn agent nào, Then lưu được, workflow có nhãn "Chưa gắn", và không user nào thấy hay chạy được nó. | (qc) |

Ghi chú đọc AC (đề xuất, qc xác nhận): **A03** phía Admin = vế 1 (không lưu, đúng thông điệp) + vế 2 chỉ kiểm "lưu được, `/dich` có trong danh sách command bật của feature `core`, đọc được qua `GET /admin/commands` và dữ liệu mà Hub sẽ đọc"; "≤ 5 giây trong menu `/`" đo ở Hub, và NOTIFY là M3 (M2-R24, Mơ hồ A1). **A06** "export": Export là M4; ở M2 kiểm `GET /admin/secrets` (mọi tham số), response tạo/thay/xoá, log server và nội dung trang web. **A13** "không user nào thấy hay chạy được": không tồn tại endpoint nào dẫn workflow tới người dùng; kiểm bằng `unattached=true` và command/entitlement không liên quan.

**AC bổ sung do spec đề xuất** (mã `M2-ACnn`, không phải AC của BA; qc xác nhận hoặc sửa):

| AC | Given / When / Then | Luật |
|---|---|---|
| M2-AC01 | `tenant_admin`/`member` gọi bất kỳ `/admin/{secrets,workflows,commands,features}*` → 403; `hub_ro` `SELECT` `admin.secrets` → permission denied | R06, BR-14 |
| M2-AC02 | Ghi secret rồi đọc thẳng cột `ciphertext` bằng owner: không chứa giá trị gốc; hai lần ghi cùng giá trị cho `iv`/`ciphertext` khác nhau; sai `SECRET_MASTER_KEY` không giải mã được | R02 |
| M2-AC03 | Tên `dich` đã là alias của command khác → tạo command `dich` bị 409; hai request song song cùng tên → đúng một thành công | R13 |
| M2-AC04 | Command không có feature → 400; bỏ command khỏi feature cuối cùng → 400; xoá feature có command độc quyền → 409 | R19, R21 |
| M2-AC05 | Thu hồi entitlement rồi cấp lại → cùng hàng, `revoked_at` null; `core` PUT/DELETE → 409 | R22 |
| M2-AC06 | Tắt workflow khi còn command bật → 409; tắt command trước rồi tắt workflow → 200; command `enabled` lên khi workflow tắt → 409 | R11, R14 |
| M2-AC07 | Mô tả workflow 19 ký tự → 400; 20 → lưu; 401 ký tự → 400; tham số thiếu mô tả → 400 | R07, R08 |
| M2-AC08 | Schema workflow đổi làm mất biến đang được command map → 409 `SCHEMA_BREAKS_COMMANDS` | R18 |
| M2-AC09 (e2e) | Đăng nhập seed → Secrets (thêm) → Workflows (tạo, thấy "Chưa gắn") → Commands (tạo `/dich`, thiếu map bị chặn, map đủ lưu) → Features (cấp cho tenant) → xoá workflow bị chặn kèm danh sách | FR-10, 20, 22, 31, 50 |

Lệnh xong: `docker compose up -d --wait && bun run db:migrate && bun run db:seed && bun run check && bun run typecheck && bun test && bun run test:int && bun run i18n:check && bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web check:bundle && bunx playwright test && bun run test:lock:verify && bun run trace --check` (cộng `check:size --all` và `depcruise --all`, TECH-DEBT #10).

## 9. Quyết định
### Trước Gate (đã chốt với người dùng)
- Mọi mặc định trong [readiness 2026-10-01](../../readiness/2026-10-01-admin-m1-m4.md) được chấp nhận; áp dụng ở M2: #6 (cấu trúc `args/input_map/output`), #7 (`core` tự hiệu lực), #8 (chặn tắt/xoá workflow), #11 (hub-stub), #18 (`command_names`), #20 (`DELETE /admin/secrets/:name`), #25 (regex secret/workflow key), #26 (`input_schema`), #27 (mô tả jsonb), #28 (Thay giá trị = `PUT`), #29 (luật xoá feature, key bất biến), #35 (ẩn Kiểm tra kết nối), #39 (`SECRET_MASTER_KEY` 32 byte base64; chưa tick vì env/thư viện còn M3–M4), #51 (dòng Thấp, không có ô tick); cộng [CR-006…010](../../CHANGE-REQUESTS.md) (M1, `VERSION_CONFLICT` dạng CR-008). Đã tick `[x]` trong readiness các dòng #6, 7, 8, 11, 18, 20, 25, 26, 27, 28, 29, 35 (đã vào spec M2).
- Mốc xong: AC-A03 (phía Admin), A05, A06, A13 xanh (ROADMAP).
### Đề xuất mới chờ xác nhận (docs-architect, nhãn `ĐX`; chưa chấp nhận)
- **A1** FR-33/AC-A03 "≤ 5 s" cần `config_changed` nhưng FR-53 thuộc M3: M2 không NOTIFY, tăng `version` bản ghi nhưng chưa `config_version` (M2-R24).
- **A2** Mô hình bảo mật Secrets: `key_version`, AAD = `id`, giá trị 8–2048, RLS riêng + REVOKE `hub_ro` (R02, R06). Cần backend-lead xác nhận; **trình Gate** nếu thay đổi cách mã hoá hoặc cần secret thật.
- **A3** Tên không gian chung command/alias, độ dài 2–32, ≤ 5 alias; `timeout_s` 1–600 (R13, R15).
- **A4** `WORKFLOW_DISABLED`, `SCHEMA_BREAKS_COMMANDS`, `CORE_FEATURE_PROTECTED`, `COMMAND_NEEDS_FEATURE`, `INPUT_MAP_INVALID`… là mã đề xuất; backend-lead chốt tên ở §3 (không đổi nghĩa).
- **A5** Production chưa có schema `hub`: `usages` trả rỗng phần agent (R12), không phải lỗi.
- **A6** Admin chỉ biết `agent_id` (tên agent ở Hub): UI hiện id ngắn đến khi có API Hub.
- **A7** Hub lấy app key Dify bằng cách nào (giải mã ở đâu, ai giữ master key) **chưa quyết**, ngoài M2; M2 không cấp quyền nào cho `hub_ro` trên `secrets`.
- **A8** FR-12 (COULD) không làm ở M2 dù nằm trong dải ROADMAP.
- **A9** FR-24 (SHOULD) chỉ làm phần tenant ở M2; phần group/grant sau M3 (R23).
- **A10** Tab "Feature" trong chi tiết Tenant giữ "Chưa khả dụng"; entitlement làm ở editor Feature (tab Tenant). `active_user_count` = user active của tenant (R22).
- **A11** Không ghi audit ở M2 → TECH-DEBT "thay đổi catalog trước M4 không có trong Nhật ký" (điều phối/docs-architect ghi khi đóng mốc); ẩn menu "Lịch sử".
- **A12** Test khoá M0/M1 đếm migration (`{main:3,dev:2}` trong `tests/acceptance/ADM-NFR-06/migrate.int.test.ts` và `packages/db/src/migrate.int.test.ts`) và danh sách bảng sẽ lệch khi thêm migration M2: qc sửa (như Q2 M1), ghi ở "Quyết định trong lúc làm".
### Trong lúc làm (agent tự quyết theo Luật 2)
- (chưa có)

## 10. Tranh chấp test
- (không)
