---
id: M2-catalog-command
title: Catalog & command (Secrets, Workflows, Commands, Features + entitlement)
milestone: M2
status: approved            # draft → ready → approved → in-progress → done
requirements: [ADM-FR-10, ADM-FR-11, ADM-FR-12, ADM-FR-13, ADM-FR-14, ADM-FR-15, ADM-FR-20, ADM-FR-21, ADM-FR-22, ADM-FR-24, ADM-FR-30, ADM-FR-31, ADM-FR-33, ADM-FR-34, ADM-FR-50, ADM-BR-01, ADM-BR-02, ADM-BR-04, ADM-BR-06, ADM-BR-10, ADM-BR-13, ADM-BR-14, AC-A03, AC-A05, AC-A06, AC-A13]   # ADM-FR-12: chỉ test âm (không có route), không làm ở M2 — CR-012; ADM-FR-24: chỉ phần tenant — CR-013
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
- **FR-12 "Lấy schema từ Dify" (COULD)**: ROADMAP gom vào dải 10–15 nhưng không làm ở M2 (Mơ hồ A8, [CR-012](../../CHANGE-REQUESTS.md); chỉ test âm). Nếu làm sau: gọi Dify **ngoài** `withScope`/sau commit.
- Grant, group, ma trận, `beta-testers`, Kiểm tra quyền (M3); NOTIFY `config_changed`/`config_version` (FR-53 = M3, Mơ hồ A1); chống ghi đè UI/modal 409 (FR-55 = M3; backend `version` + 409 đã có); audit và nút "Lịch sử"/Khôi phục (FR-51/52 = M4, ẩn menu "Lịch sử"); Import/Export (FR-54 = M4); Quota (M4).
- Hub đọc catalog / chạy command / lấy app key (Hub chưa có; Mơ hồ A7). Tab "Feature" trong chi tiết Tenant: giữ "Chưa khả dụng" (Mơ hồ A10).

**Ràng buộc bắt buộc (hard rule, không tự nới):**
- **TECH-DEBT #13:** `withScope` chạy lại cả callback khi 40P01/40001 (≤ 3 lần), chỉ an toàn khi callback chỉ làm việc DB. M2 **không** NOTIFY, gọi Dify, gọi mock Hub hay gửi mail trong callback. Cần gì ra ngoài (kể cả FR-12 nếu làm) thì đặt **sau commit** (trả kết quả từ `withScope` rồi mới gửi).
- **CONVENTIONS §8:** không sửa migration đã commit (kể cả `0002_admin_rls.sql`, `0000_hub_stub.sql`); M2 chỉ thêm `0003_…`, `0004_…` (kể cả quyền/RLS/REVOKE cho bảng mới). Ghi `docs/PRODUCTION-NOTES.md` khi có quyết định vận hành.
- **Secrets chạm bảo mật** (M2-R01…R06): mã hoá at-rest, không trả lại giá trị, chỉ `platform_admin`, `hub_ro` không đọc được. **Trình Gate (không tự duyệt Luật 2b) nếu** phải thêm thư viện hoặc dịch vụ mới (mã hoá dùng `node:crypto` có sẵn trong Bun, không cần thư viện), hoặc cần secret thật (khoá master dev sinh cục bộ bằng `keys:dev` không tính là secret thật).

## 2. Nghiệp vụ

Luật gốc: [BA §5.3–5.5, §5.7, §6](../../design/admin/ba-admin.md); UI: [ui-admin 7.3, 7.4, 7.6, 7.8, 7.12](../../design/admin/ui-admin.md) + [missing-screens §2, 3, 6](../_design/admin-missing-screens.md). Bảng dưới là phần **cụ thể hoá**. Nhãn nguồn: `[RD#n]` = [readiness](../../readiness/2026-10-01-admin-m1-m4.md) (người dùng **đã chấp nhận**); `ĐX` = đề xuất của docs-architect, **đã chấp nhận (Gate 2026-10-01**, xem §9 và [readiness.md](readiness.md)).

| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| M2-R01 | Tên secret `^[A-Z0-9_]{2,64}$` (UI tự chuẩn hoá HOA, dấu cách/`-` → `_`), unique, bất biến (API `PUT/DELETE /admin/secrets/:name` gọi theo tên). Ghi chú ≤ 200 ký tự. Giá trị 8–2048 ký tự, không trim | RD#25, RD#20, RD#28, ĐX |
| M2-R02 | Mã hoá AES-256-GCM: khoá = `SECRET_MASTER_KEY` (32 byte base64, thiếu/sai độ dài → admin-api exit 1 nêu tên biến, không in giá trị); IV 12 byte CSPRNG **mới mỗi lần ghi**; AAD = UTF-8 `admin.secrets:<id>:<key_version>` (plan §3.2); lưu `ciphertext` (kèm tag), `iv`, `last4` (4 ký tự cuối giá trị), `key_version` (=1, chuẩn bị xoay khoá; xoay khoá chưa làm → TECH-DEBT) | FR-50, NFR-01, ĐX |
| M2-R03 | **Giá trị không bao giờ rời Admin** (BR-04, AC-A06): mọi response chỉ có `name`, `last4`, `note`, `used_by`, `updated_at`, `updated_by`, `created_at`; không có `ciphertext`/`iv`. `GET /admin/secrets` không có tham số trả giá trị; không log body/header của `/admin/secrets*`; thông điệp `VALIDATION_ERROR` của secret không chứa giá trị (không echo input). Export (M4) chỉ tên. Test kiểm bằng cách quét response, log và HTML trang | BR-04, AC-A06, ĐX |
| M2-R04 | Tạo secret trùng tên → 409 `SECRET_NAME_TAKEN`. Thay giá trị (`PUT`) đổi `ciphertext/iv/last4/updated_by/updated_at`, giữ `id`, không đổi `used_by`; sửa ghi chú không đụng ciphertext | RD#28, ĐX |
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
| M2-R17 | Validate khi lưu (cả tạo, sửa, đổi workflow): mọi input `required` của workflow phải có trong `input_map` (thiếu → 400 `INPUT_MAP_INVALID`, `details.missing:[tên]`, `message` cố định "Invalid input map"; câu AC-A03 "thiếu input bắt buộc: target_lang" do FE dựng từ `details.missing`); khoá không tồn tại trong workflow → `details.unknown:[tên]`; `source=arg` trỏ tới tham số chưa khai báo → `details.unknown_args`. **Map sai kiểu chỉ cảnh báo**, không chặn (`warnings` trong response, không lưu) | FR-22, AC-A03, RD#51, ĐX (mã lỗi) |
| M2-R18 | Đổi workflow của command: giữ các map còn hợp lệ, báo map bị bỏ ở UI (ui-admin 7.4); server vẫn áp M2-R17 trên kết quả cuối. **Sửa input_schema của workflow làm hỏng command đang dùng** (xoá/đổi tên biến đang được map, thêm biến bắt buộc chưa map) → 409 `SCHEMA_BREAKS_COMMANDS {commands[]}`, không lưu | ui-admin 7.6, ĐX |
| M2-R19 | Command ≥ 1 feature (BR-10), `feature_ids` mặc định `[core]`; rỗng → 400 `COMMAND_NEEDS_FEATURE`. Bỏ command khỏi feature cuối cùng của nó (từ editor Feature) → cùng mã lỗi, **chặn lưu** | BR-10, missing-screens §3.2 |
| M2-R20 | Feature: `key` `^[a-z0-9-]{2,32}$` unique, bất biến (đã seed `core`); `name {vi, en?}` (vi bắt buộc ≤ 64), `description {vi?,en?}` ≤ 400, `icon` (tên lucide, mặc định `package`), `status` ∈ `on\|off\|beta`. `core`: **không xoá/tắt/đổi key/đổi sang beta** (409 `CORE_FEATURE_PROTECTED`), vẫn sửa được tên/mô tả/icon. (`beta-testers` là group M3, không có ở M2) | FR-30, BR-10, RD#29 |
| M2-R21 | Xoá feature: chặn khi có command **chỉ** thuộc feature đó → 409 `FEATURE_HAS_EXCLUSIVE_COMMANDS {commands[]}`; ngược lại xoá, kéo theo `feature_commands`, `feature_entitlements` của nó (grant M3 cũng cascade) | RD#29, missing-screens §14.4 |
| M2-R22 | Entitlement: `PUT /admin/features/:id/entitlements/:tenant_id` cấp (idempotent), `DELETE` thu hồi = **đặt `revoked_at`** (không xoá hàng; BR-12 để grant M3 được giữ). Cấp lại xoá `revoked_at`, cập nhật `granted_by/granted_at`. `core` tự hiệu lực với mọi tenant **không cần hàng** (RD#7); PUT/DELETE trên `core` → 409 `CORE_FEATURE_PROTECTED`. Tenant bị khoá vẫn cấp được. Danh sách trả `active_user_count` = số user `active && !locked_by_tenant` của tenant (= `status` "active" M1; test-plan G4) (grant chưa có ở M2, M3 tinh chỉnh) | FR-31, BR-10, BR-12, RD#7, ĐX (active_user_count) |
| M2-R23 | FR-24 ở M2 = tab "Ai dùng được" của command chỉ phần **tenant**: các tenant có ≥ 1 feature của command được hiệu lực (`on|beta`, entitlement hoặc `core`), kèm feature và số user active; phần group/grant hiện "Chưa khả dụng" (M3). Không có endpoint Hub | FR-24, BR-11 một phần, ĐX (Mơ hồ A9) |
| M2-R24 | Kill switch (FR-33) và `beta` (FR-34) ở Admin = **chỉ lưu `status` đúng** và hiển thị (nhãn Beta, xác nhận mức vừa khi tắt, đếm command/người bị ảnh hưởng). Hiệu lực "≤ 5 s" và lọc theo `beta-testers` do Hub/M3 (NOTIFY). Tắt feature **không** sửa `enabled` của command; BR-06: thực thể tắt vẫn lưu, Hub coi như không tồn tại | FR-33, FR-34, BR-06, ĐX (Mơ hồ A1) |
| M2-R25 | Mọi `PATCH` workflow/command/feature nhận `version` (≥ 1), lệch → 409 `VERSION_CONFLICT {current, updated_at}` (M1-R19, CR-008); tăng `version` chỉ khi trường người dùng sửa được hoặc `enabled/status` đổi; không đổi gì → trả bản hiện tại, không tăng. Secrets không có `version` (ghi sau thắng, có `updated_by`) | FR-55 (BE), M1-R19, ĐX (secret) |
| M2-R26 | Danh sách dùng quy ước M1 (`{items,total,counts}`, `?q&limit=50&offset`, limit ≤ 200, `counts` tính trừ bộ lọc `status`): Secrets `?used=`; Workflows `?attached=&status=on|off&secret=&q`; Commands `?status=&feature=&workflow=&q`; Features `?status=&q`. Lỗi `{error:{code,message,details?}}`; `:id`/`:name` lạ → 404 `NOT_FOUND` | M1-R19, ui-admin 7.3, 7.6 |
| M2-R27 | Mọi ghi nhiều bảng (command + `command_names` + `feature_commands`; workflow + kiểm tham chiếu) chạy **một** transaction `withScope`, khoá thứ tự cố định `workflows → commands → features` bằng `FOR NO KEY UPDATE` (bài học deadlock M1 N1); callback chỉ làm việc DB (TECH-DEBT #13) | TECH-DEBT #13, M1 review N1 |
| M2-R28 | Nhãn UI nguyên văn lấy từ missing-screens §2, §3, §6 và artboard Workflows; bỏ nút "Kiểm tra kết nối", "Lấy từ Dify", "Lịch sử", Test. Chuỗi VI/EN đủ (`bun run i18n:check`); `core` hiển thị "Mặc định" / "Mọi tenant" | UI 15, RD#35, RD#41 |

## 3. Contract (backend-lead)
<!-- backend-lead -->
File: `packages/contracts/src/{secrets,workflows,commands,features}.ts` (mới) + `common.ts` (hằng, kiểu chung, mã lỗi, schema `details`), export qua `index.ts`. Chi tiết hiện thực: [plan.md](plan.md). Đã đối chiếu yêu cầu FE Y1–Y10 ([plan-frontend.md §9](plan-frontend.md)); trả lời từng mục ở plan.md §11.

**Quy ước** (kế thừa M1 §3, không nhắc lại): body/query strict, `:id` không phải uuid → 404, lỗi `{error:{code,message,details?}}` với `message` tiếng Anh **cố định theo mã** (không chứa dữ liệu người dùng; FE dựng câu từ `code` + `details`), ISO UTC, id uuid v7. Mọi route M2 = `requireAuth` + `requireRole("platform_admin")` (kiểm role **trước** khi tra/parse body) → `tenant_admin`/`member` 403 `FORBIDDEN`; scope DB `platform`.
- `updated_by` trong mọi response M2 = **username** của người ghi gần nhất (`string | null`; `null` = seed/không rõ) (Y10).
- Query bool: chỉ nhận `"true"`/`"false"`. List: `ListQueryBase` (`q` trim ≤ 100, `limit` 1–200 = 50, `offset` 0–100000) + bộ lọc riêng; `counts` tính theo cùng bộ lọc **trừ** các bộ lọc chip (cột "chip" dưới). List không có `counts` (entitlement, access) trả `{items, total}`.
- `PATCH` nhận `version` (M1-R19); trường vắng = giữ nguyên; không trường nào đổi → 200 bản hiện tại, không tăng `version`. `DELETE` không nhận `version`. Không endpoint nào ở M2 gửi NOTIFY/sự kiện (A1).

**Hằng/regex export** (`common.ts`, dùng được ở trình duyệt): `SECRET_NAME_RE = /^[A-Z0-9_]{2,64}$/`, `SECRET_VALUE_MIN = 8`, `SECRET_VALUE_MAX = 2048`, `SECRET_NOTE_MAX = 200`, `CATALOG_KEY_RE = /^[a-z0-9-]{2,32}$/` (workflow key, feature key, tên + alias command; = `COMPANY_KEY_RE`), `WORKFLOW_DESC_MIN = 20`, `WORKFLOW_DESC_MAX = 400`, `INPUT_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/`, `INPUT_SCHEMA_MAX = 50`, `INPUT_DESC_MAX = 400`, `SELECT_OPTIONS_MAX = 50`, `ARG_NAME_RE = /^[a-z][a-z0-9_]{0,31}$/`, `ARGS_MAX = 20`, `ALIASES_MAX = 5`, `COMMAND_DESC_MAX = 200`, `CONST_VALUE_MAX = 4000`, `ARG_DEFAULT_MAX = 1000`, `TIMEOUT_MIN_S = 1`, `TIMEOUT_MAX_S = 600`, `TIMEOUT_DEFAULT_S = {sync: 30, async: 120}`, `FEATURE_NAME_MAX = 64`, `FEATURE_DESC_MAX = 400`, `FEATURE_ICON_RE = /^[a-z0-9-]{1,40}$/`, `FEATURE_ICON_DEFAULT = "package"`, `CORE_FEATURE_KEY = "core"`, `BASE_URL_MAX = 2048`, `OUTPUT_FIELD_MAX = 128`. Enum: `APP_TYPES = [workflow, chat, agent]`, `INPUT_TYPES = [text, number, boolean, select, file]`, `COMMAND_MODES = [sync, async]`, `OUTPUT_RENDERS = [markdown, text, json]`, `MAP_SOURCES = [arg, selection, page_url, page_text, attachment, user_id, tenant_id, const]`, `ARG_FALLBACKS = [selection, page_url, page_text]`, `FEATURE_STATUSES = [on, off, beta]`, `ON_OFF = [on, off]`.

**Kiểu dùng chung**
- `LocalizedText(max)` = strict `{vi: trim 1–max, en?: trim ≤ max}` (`en` rỗng sau trim → bỏ khoá). `LocalizedOptional(max)` = strict `{vi?: trim ≤ max, en?: trim ≤ max}` (rỗng → bỏ khoá).
- `listResponseSchema(item, counts = ListCountsSchema)` (mở rộng không phá M1) · `pageResponseSchema(item)` = `{items, total}`.
- `versionConflictDetailsSchema(<schema>)` cho `Workflow`, `Command`, `FeatureDetail` (dạng M1, `{current, updated_at}`).

**Secrets** (`secrets.ts`) — M2-R01…R06
- `Secret = {id, name, last4: string(4), note: string|null, used_by: string[] (key workflow tham chiếu, sắp tăng dần), created_at, updated_at, updated_by}`. **Không bao giờ** có `value`, `ciphertext`, `iv`, `key_version` (R03, AC-A06). `id` có trong response (Y1) để workflow tham chiếu; `id` không phải bí mật.
- `SecretName` = trim → `toUpperCase()` → `SECRET_NAME_RE`. `SecretValue` = string 8–2048 (đếm UTF-16 như `String.length`), **không trim**, không chuẩn hoá. `SecretNote` = trim ≤ 200, `""` → `null`.
- `SecretCreateRequest {name, value, note?}` · `SecretReplaceRequest {value}` · `SecretNoteRequest {note: SecretNote | null}` · `SecretListQuery = ListQueryBase + {used?: bool}` (`q` khớp `name`/`note` ILIKE) · `SecretListResponse` counts `{all, used, unused}` (chip: `used`), sắp `name`.
- `:name` trong path phải khớp `SECRET_NAME_RE` nguyên văn (không chuẩn hoá); sai dạng hoặc không có → 404.

**Workflows** (`workflows.ts`) — M2-R07…R12, R18
- `WorkflowInput = strict {name: INPUT_NAME_RE, type: INPUT_TYPES, required: boolean, description: trim 1–400, options?: string trim 1–100 [] (1–50, không trùng; **bắt buộc khi** `type=select`, **cấm** khi khác)}`. `InputSchema = WorkflowInput[]` 0–50, `name` không trùng (superRefine → `VALIDATION_ERROR` có `path`).
- `WorkflowRef = {id, key, name, enabled}` · `SecretRef = {id, name}`.
- `WorkflowListItem = {id, key, name, app_type, description, enabled, secret: SecretRef, command_count, agent_count, unattached, version, updated_at, updated_by}` (Y5). `Workflow = WorkflowListItem & {base_url, input_schema: InputSchema, output_field: string|null, created_at}`.
- `WorkflowCreateRequest {key: CATALOG_KEY_RE (trim+lower), name: trim 1–128, description: trim 20–400, app_type, base_url, secret_id: uuid, input_schema? = [], output_field?: trim 1–128 | null = null, enabled? = true}`. `base_url` = `z.url()` giao thức `http`/`https`, ≤ 2048, **không** có `username`/`password` (refine). `WorkflowUpdateRequest {version, name?, description?, app_type?, base_url?, secret_id?, input_schema?, output_field?, enabled?}` (không có `key` → 400).
- `WorkflowListQuery = ListQueryBase + {status?: on|off, attached?: bool, secret?: SecretName}` (`q` khớp `key`/`name`/`description`; `secret` lạ → list rỗng). Counts `{all, on, off, unattached}` (chip: `status`, `attached`), sắp `key`.
- `WorkflowUsages = {commands: [{id, name, enabled}] (≤ 200, sắp `name`), agents: [{id}] (≤ 200, sắp `id`), command_count, agent_count, agents_available: boolean}` — `agents_available=false` khi DB không có `hub.agent_workflows` đọc được (R12; khi đó `agents=[]`, `agent_count=0`).

**Commands** (`commands.ts`) — M2-R13…R19, R23
- `CommandName` = trim → lower → `CATALOG_KEY_RE` (dùng cho `name` và từng alias). `CommandArg = strict {name: ARG_NAME_RE, description: LocalizedText(200), default?: trim ≤ 1000 | null = null, fallback?: ARG_FALLBACKS | null = null, rest?: boolean = false}` (Y8). `Args` 0–20: `name` không trùng; ≤ 1 `rest=true` và phải là phần tử cuối (superRefine).
- `InputMapEntry` = discriminatedUnion `source`: `{source:"arg", value: ARG_NAME_RE}` · `{source:"const", value: string ≤ 4000}` · `{source: selection|page_url|page_text|attachment|user_id|tenant_id}` (không có `value`). `InputMap = record<INPUT_NAME_RE, InputMapEntry>` ≤ 50 khoá. Cú pháp BA (`$args.x`, `$page.url`…) chỉ là hiển thị FE (R16).
- `CommandOutput = strict {field: trim 1–128, render: OUTPUT_RENDERS}` (`field` **bắt buộc**; FE điền sẵn từ `workflow.output_field`, Y8).
- `FeatureRef = {id, key, name: LocalizedText, status}`.
- `CommandListItem = {id, name, aliases: string[], description: LocalizedText, workflow: WorkflowRef, features: FeatureRef[] (sắp `key`, `core` đầu), mode, enabled, version, updated_at, updated_by}` (Y3). `Command = CommandListItem & {args, input_map, output, timeout_s, feature_ids: uuid[], warnings: InputMapWarning[], created_at}` (Y4).
- `InputMapWarning = {var, type: INPUT_TYPES, source: MAP_SOURCES, reason: "type_mismatch" | "const_invalid"}` — tính lại mỗi lần đọc/ghi từ `input_schema` hiện tại của workflow, **không lưu** (R17, RD#51). Luật cảnh báo: plan.md §4 `inputMapWarnings`.
- `CommandCreateRequest {name, aliases? = [] (0–5, không trùng nhau, không trùng `name`), description, workflow_id, args? = [], input_map? = {}, output, mode? = "sync", timeout_s?: int 1–600 (vắng → theo `mode`), enabled? = true, feature_ids?: uuid[] ≤ 50 không trùng (vắng → `[id của core]`; `[]` → 400 `COMMAND_NEEDS_FEATURE`)}`. `CommandUpdateRequest = {version} + mọi trường trên đều tuỳ chọn` (đổi `mode` không tự đổi `timeout_s`).
- `CommandListQuery = ListQueryBase + {status?: on|off, feature?: uuid, workflow?: uuid}` (`q` khớp `name`, mọi alias, `description.vi/en`; Y3 lọc theo **id**). Counts `{all, on, off}` (chip: `status`), sắp `name`.
- `CommandAccessItem = {tenant_id, tenant_key, tenant_name, tenant_active, features: [{id, key, name}], active_user_count}` · `CommandAccessResponse = {items, total, command_active: boolean}` (`command_active = command.enabled && workflow.enabled`) · query `ListQueryBase` (`q` khớp key/tên tenant), sắp `tenant_key` (R23, Y7 — dạng phẳng như entitlement; có phân trang theo CONVENTIONS §6).
- Nhân bản (ui-admin 7.4): **không có endpoint**; FE đọc `GET /admin/commands/:id` rồi `POST` với tên mới, `enabled=false`.

**Features** (`features.ts`) — M2-R19…R22, R24
- `FeatureListItem = {id, key, name: LocalizedText(64), description: LocalizedOptional(400), icon: FEATURE_ICON_RE, status, is_core: boolean, command_count, tenant_count (entitlement chưa thu hồi; `core` = 0, FE hiện "Mọi tenant" theo `is_core`), version, updated_at, updated_by}` (Y9; `icon` null trong DB → trả `"package"`).
- `FeatureDetail = FeatureListItem & {created_at, commands: [{id, name, description: LocalizedText, enabled, feature_count}] (sắp `name`), affected_user_count}` (Y2). `affected_user_count` = Σ user active (`active && !locked_by_tenant`) của các tenant đang được entitlement (`core`: mọi tenant) — số "{users} người" trong hộp thoại Tắt.
- `FeatureCreateRequest {key, name: LocalizedText(64), description?: LocalizedOptional(400) = {}, icon?: FEATURE_ICON_RE = "package", status? = "on", command_ids?: uuid[] ≤ 500 không trùng = []}` · `FeatureUpdateRequest {version, name?, description?, icon?, status?, command_ids?}` (`command_ids` = **thay cả tập** trong cùng transaction, Y2; không có `key` → 400).
- `FeatureListQuery = ListQueryBase + {status?: on|off|beta}` (`q` khớp `key`, `name.vi/en`). Counts `{all, on, beta, off}` (chip: `status`), sắp: `core` đầu rồi `key`.
- `Entitlement = {tenant_id, tenant_key, tenant_name, tenant_active, active_user_count, granted_at, granted_by: string|null}` (chỉ hàng **chưa thu hồi**, Y1) · `EntitlementListResponse = {items, total}` · query `ListQueryBase` (`q` khớp key/tên tenant), sắp `tenant_key`; `core` → `{items: [], total: 0}`.

| Method | Path | Request | Response | Lỗi (HTTP · code) |
|---|---|---|---|---|
| GET | `/admin/secrets` | `SecretListQuery` | 200 `SecretListResponse` | 400 · 401 · 403 |
| POST | `/admin/secrets` | `SecretCreateRequest` | 201 `Secret` | 400 `VALIDATION_ERROR` · 409 `SECRET_NAME_TAKEN` |
| PUT | `/admin/secrets/:name` | `SecretReplaceRequest` (thay giá trị: IV mới, `last4` mới, giữ `id`, RD#28) | 200 `Secret` | 400 · 404 |
| PATCH | `/admin/secrets/:name` | `SecretNoteRequest` (không đụng ciphertext, Y6) | 200 `Secret` | 400 · 404 |
| DELETE | `/admin/secrets/:name` | — | 204 (xoá thật) | 404 · 409 `SECRET_IN_USE {used_by}` |
| GET | `/admin/workflows` | `WorkflowListQuery` | 200 `{items: WorkflowListItem[], total, counts}` | 400 |
| POST | `/admin/workflows` | `WorkflowCreateRequest` | 201 `Workflow` | 400 `VALIDATION_ERROR` / `INVALID_REFERENCE {field:"secret_id"}` · 409 `KEY_TAKEN` |
| GET | `/admin/workflows/:id` | — | 200 `Workflow` | 404 |
| GET | `/admin/workflows/:id/usages` | — | 200 `WorkflowUsages` | 404 |
| PATCH | `/admin/workflows/:id` | `WorkflowUpdateRequest` | 200 `Workflow` | 400 / `INVALID_REFERENCE` · 404 · 409 `VERSION_CONFLICT {current: Workflow, updated_at}` / `WORKFLOW_IN_USE {action:"disable",…}` / `SCHEMA_BREAKS_COMMANDS` |
| DELETE | `/admin/workflows/:id` | — | 204 | 404 · 409 `WORKFLOW_IN_USE {action:"delete",…}` |
| GET | `/admin/commands` | `CommandListQuery` | 200 `{items: CommandListItem[], total, counts}` | 400 |
| POST | `/admin/commands` | `CommandCreateRequest` | 201 `Command` | 400 `VALIDATION_ERROR` / `COMMAND_NEEDS_FEATURE` / `INVALID_REFERENCE {field:"workflow_id"\|"feature_ids"}` / `INPUT_MAP_INVALID` · 409 `COMMAND_NAME_TAKEN {name}` / `WORKFLOW_DISABLED` |
| GET | `/admin/commands/:id` | — | 200 `Command` | 404 |
| PATCH | `/admin/commands/:id` | `CommandUpdateRequest` | 200 `Command` | như POST + 404 + 409 `VERSION_CONFLICT {current: Command, updated_at}` |
| DELETE | `/admin/commands/:id` | — | 204 (cascade `command_names`, `feature_commands`) | 404 |
| GET | `/admin/commands/:id/access` | `ListQueryBase` | 200 `CommandAccessResponse` | 404 |
| GET | `/admin/features` | `FeatureListQuery` | 200 `{items: FeatureListItem[], total, counts}` | 400 |
| POST | `/admin/features` | `FeatureCreateRequest` | 201 `FeatureDetail` | 400 / `INVALID_REFERENCE {field:"command_ids"}` · 409 `KEY_TAKEN` |
| GET | `/admin/features/:id` | — | 200 `FeatureDetail` | 404 |
| PATCH | `/admin/features/:id` | `FeatureUpdateRequest` | 200 `FeatureDetail` | 400 / `INVALID_REFERENCE` / `COMMAND_NEEDS_FEATURE {commands}` · 404 · 409 `VERSION_CONFLICT {current: FeatureDetail, updated_at}` / `CORE_FEATURE_PROTECTED` |
| DELETE | `/admin/features/:id` | — | 204 (cascade `feature_commands`, `feature_entitlements`) | 404 · 409 `CORE_FEATURE_PROTECTED` / `FEATURE_HAS_EXCLUSIVE_COMMANDS {commands}` |
| GET | `/admin/features/:id/entitlements` | `ListQueryBase` | 200 `EntitlementListResponse` | 404 |
| PUT | `/admin/features/:id/entitlements/:tenant_id` | body rỗng | 200 `Entitlement` (idempotent; đã có → không ghi; đã thu hồi → `revoked_at=null`, `granted_by/at` mới; tenant khoá vẫn cấp được) | 404 (feature/tenant) · 409 `CORE_FEATURE_PROTECTED` |
| DELETE | `/admin/features/:id/entitlements/:tenant_id` | — | 204 (đặt `revoked_at=now()`, không xoá hàng; chưa cấp/đã thu hồi → 204 không ghi) | 404 (feature/tenant) · 409 `CORE_FEATURE_PROTECTED` |

Không có: `POST /admin/commands/:id/test` (M5), "Kiểm tra kết nối", "Lấy schema từ Dify" (A8), `GET /admin/secrets/:name` (list đủ cho drawer).

**Mã lỗi mới** (A4 chốt; vào `API_ERRORS`; `details` export schema strict cùng tên + `DetailsSchema`):

| Code | HTTP | `details` | Khi nào |
|---|---|---|---|
| `SECRET_NAME_TAKEN` | 409 | — | tên secret trùng (`secrets_name_uq`) |
| `SECRET_IN_USE` | 409 | `{used_by: string[]}` (key workflow) | xoá secret còn workflow tham chiếu |
| `INVALID_REFERENCE` | 400 | `{field: "secret_id"\|"workflow_id"\|"feature_ids"\|"command_ids", ids: uuid[]}` | id tham chiếu trong body không tồn tại |
| `WORKFLOW_IN_USE` | 409 | `{action: "delete"\|"disable", commands: [{id,name,enabled}], agents: [{id}]}` | R11: `delete` liệt kê mọi command + agent; `disable` chỉ command đang bật + mọi agent |
| `SCHEMA_BREAKS_COMMANDS` | 409 | `{commands: [{id, name, missing: string[], unknown: string[]}]}` | R18: `input_schema` mới làm command (bật hay tắt) thiếu biến bắt buộc / map vào biến đã bỏ |
| `WORKFLOW_DISABLED` | 409 | `{workflow: {id, key}}` | R14: command sau khi ghi có `enabled=true` mà workflow đang tắt |
| `COMMAND_NAME_TAKEN` | 409 | `{name}` (tên/alias đầu tiên bị trùng) | R13 |
| `INPUT_MAP_INVALID` | 400 | `{missing: string[], unknown: string[], unknown_args: string[]}` (đủ 3 khoá, có thể rỗng) | R17. AC-A03: FE hiện "thiếu input bắt buộc: {missing}" từ `details`; `message` server cố định "Invalid input map" |
| `COMMAND_NEEDS_FEATURE` | 400 | từ `/admin/commands*`: không có · từ `PATCH /admin/features/:id`: `{commands: [{id, name}]}` | R19 |
| `CORE_FEATURE_PROTECTED` | 409 | — | R20/R22: xoá `core`, `status≠on` cho `core`, PUT/DELETE entitlement của `core` |
| `FEATURE_HAS_EXCLUSIVE_COMMANDS` | 409 | `{commands: [{id, name}]}` | R21 |

Dùng lại mã M1: `KEY_TAKEN` (409) cho key workflow (`workflows_key_uq`) và key feature (`features_key_uq`) — message đổi thành "Key is already taken" (chung, không nêu "company code"); FE dịch theo màn (plan-frontend §8). `API_ERRORS` sau M2: 23 + 11 = **34** mã.

**Thứ tự kiểm** (qc dựa vào để chọn mã khi nhiều lỗi cùng lúc): role → parse (`VALIDATION_ERROR`) → 404 thực thể → `version` → không đổi gì → luật theo thứ tự cột "Khi nào" dưới:
- Workflow PATCH: `INVALID_REFERENCE` → `WORKFLOW_IN_USE` (khi `enabled` true→false) → `SCHEMA_BREAKS_COMMANDS` → ghi. Workflow DELETE: `WORKFLOW_IN_USE`.
- Command POST/PATCH (trên **trạng thái sau khi ghép**): `COMMAND_NEEDS_FEATURE` → `INVALID_REFERENCE` (workflow, rồi features) → `COMMAND_NAME_TAKEN` → `INPUT_MAP_INVALID` → `WORKFLOW_DISABLED` → ghi.
- Feature PATCH: `CORE_FEATURE_PROTECTED` → `INVALID_REFERENCE` → `COMMAND_NEEDS_FEATURE` → ghi. Feature DELETE: `CORE_FEATURE_PROTECTED` → `FEATURE_HAS_EXCLUSIVE_COMMANDS`.
- Secret DELETE: 404 → `SECRET_IN_USE`.

**`version`** (R25): Workflow tăng khi đổi `name, description, app_type, base_url, secret_id, input_schema, output_field, enabled`. Command tăng khi đổi `name, aliases (so theo thứ tự), description, workflow_id, args, input_map, output, mode, timeout_s, enabled` hoặc **tập feature** — kể cả khi tập feature đổi từ `PATCH /admin/features/:id` (`command_ids`). Feature tăng khi đổi `name, description, icon, status` hoặc **tập command** — kể cả khi đổi từ `POST/PATCH /admin/commands` (`feature_ids`), để editor bên kia nhận 409 thay vì ghi đè. Tạo/xoá command cũng tăng `version` các feature chứa nó. Entitlement không tăng `version` feature (không thuộc `FeatureDetail`). `updated_by/updated_at` đổi cùng `version`. Secret không có `version`.

**Bảo mật Secrets ở biên** (R03, AC-A06): body `/admin/secrets*` không bao giờ được log (M1 đã không log body; giữ); `VALIDATION_ERROR.details.issues` chỉ có `path/code/message` của zod (không có `input`); không response nào (kể cả 409/400/500) chứa giá trị; giá trị chỉ tồn tại trong bộ nhớ tới khi mã hoá xong, không gửi xuống DB dạng rõ.

Sự kiện / NOTIFY: **không có ở M2** (A1).

## 4. Dữ liệu (backend-lead)
<!-- backend-lead -->
Kiểu chung như M1 §4 (`id uuid PK DEFAULT gen_random_uuid()`, app truyền v7; `timestamptz`; `version integer NOT NULL DEFAULT 1 CHECK (version >= 1)`; `created_at`/`updated_at NOT NULL DEFAULT now()`; CHECK đặt tên `<bảng>_<cột>_check`). Cột mới dùng chung: `updated_by uuid NULL` FK `users(id) ON DELETE SET NULL` (username trả ra bằng join; FK lấy `FOR KEY SHARE` trên hàng user, không xung đột `FOR NO KEY UPDATE` của M1). jsonb luôn parse bằng zod khi đọc (CONVENTIONS §5).

| Bảng | Cột | Kiểu | Null | Default | Ràng buộc / index | RLS |
|---|---|---|---|---|---|---|
| `secrets` | `id` | uuid | không | | PK; là một phần AAD | **bật**: chỉ `app.scope='platform'` (USING = WITH CHECK); `hub_ro`: REVOKE ALL; `admin_rw`: **không** SELECT `ciphertext`, `iv` (chỉ cấp SELECT theo cột) |
| | `name` | text | không | | UNIQUE `secrets_name_uq`; CHECK `~ '^[A-Z0-9_]{2,64}$'`; bất biến (app) | |
| | `ciphertext` | bytea | không | | AES-256-GCM, = bản mã ‖ tag 16 byte; CHECK `octet_length BETWEEN 24 AND 6160` (8 ký tự + 16 … 2048 UTF-16 ≤ 6144 byte UTF-8 + 16) | |
| | `iv` | bytea | không | | CHECK `octet_length = 12`; CSPRNG mới mỗi lần ghi | |
| | `key_version` | smallint | không | `1` | CHECK `>= 1` | |
| | `last4` | text | không | | 4 code point cuối của giá trị; CHECK `char_length = 4` | |
| | `note` | text | có | null | CHECK `char_length <= 200` | |
| | `created_at`, `updated_at`, `updated_by` | | | | không có `version` (R25) | |
| `workflows` | `id` | uuid | không | | PK | không (catalog toàn hệ thống, như `features`) |
| | `key` | text | không | | UNIQUE `workflows_key_uq`; CHECK `~ '^[a-z0-9-]{2,32}$'`; bất biến | |
| | `name` | text | không | | CHECK `char_length BETWEEN 1 AND 128` | |
| | `description` | text | không | | lưu đã trim; CHECK `char_length BETWEEN 20 AND 400` | |
| | `app_type` | text | không | | CHECK `IN ('workflow','chat','agent')` | |
| | `base_url` | text | không | | CHECK `char_length <= 2048 AND base_url ~ '^https?://'` | |
| | `secret_id` | uuid | không | | FK `secrets(id) ON DELETE RESTRICT`; INDEX `workflows_secret_idx (secret_id)` | |
| | `input_schema` | jsonb | không | `'[]'` | CHECK `jsonb_typeof = 'array'` (chi tiết: zod) | |
| | `output_field` | text | có | null | CHECK `char_length BETWEEN 1 AND 128` | |
| | `enabled` | boolean | không | `true` | | |
| | `version`, `created_at`, `updated_at`, `updated_by` | | | | | |
| `commands` | `id` | uuid | không | | PK | không |
| | `name` | text | không | | UNIQUE `commands_name_uq`; CHECK `~ '^[a-z0-9-]{2,32}$'` | |
| | `aliases` | text[] | không | `'{}'` | CHECK `cardinality(aliases) <= 5` (Hub đọc trực tiếp; unique qua `command_names`) | |
| | `description` | jsonb | không | | `{vi, en?}`; CHECK `jsonb_typeof = 'object' AND description ? 'vi'` | |
| | `workflow_id` | uuid | không | | FK `workflows(id) ON DELETE RESTRICT` (BR-02); INDEX `commands_workflow_idx (workflow_id)` | |
| | `args` | jsonb | không | `'[]'` | CHECK `jsonb_typeof = 'array'` | |
| | `input_map` | jsonb | không | `'{}'` | CHECK `jsonb_typeof = 'object'` | |
| | `output` | jsonb | không | | `{field, render}`; CHECK `jsonb_typeof = 'object'` | |
| | `mode` | text | không | `'sync'` | CHECK `IN ('sync','async')` | |
| | `timeout_s` | integer | không | `30` | CHECK `BETWEEN 1 AND 600` | |
| | `enabled` | boolean | không | `true` | | |
| | `version`, `created_at`, `updated_at`, `updated_by` | | | | | |
| `command_names` | `name` | text | không | | PK `command_names_pkey` (không gian tên chung tên + alias, R13, RD#18); CHECK `~ '^[a-z0-9-]{2,32}$'` | không |
| | `command_id` | uuid | không | | FK `commands(id) ON DELETE CASCADE`; INDEX `command_names_command_idx (command_id)` | |
| `feature_commands` | `feature_id` | uuid | không | | PK `(feature_id, command_id)`; FK `features(id) ON DELETE CASCADE` | không |
| | `command_id` | uuid | không | | FK `commands(id) ON DELETE CASCADE`; INDEX `feature_commands_command_idx (command_id)` | |
| `feature_entitlements` | `feature_id` | uuid | không | | PK `(feature_id, tenant_id)`; FK `features(id) ON DELETE CASCADE` | **bật**: như `users` M1 (`scope='platform'` hoặc `scope='tenant'` ∧ `tenant_id = app.tenant_id`); `hub_ro` SELECT `USING (true)` |
| | `tenant_id` | uuid | không | | FK `tenants(id) ON DELETE CASCADE`; INDEX `feature_entitlements_tenant_active_idx (tenant_id, feature_id) WHERE revoked_at IS NULL` (Ai dùng được, M3 effective-access) | |
| | `granted_by` | uuid | có | null | FK `users(id) ON DELETE SET NULL` | |
| | `granted_at` | timestamptz | không | `now()` | | |
| | `revoked_at` | timestamptz | có | null | thu hồi = đặt giá trị; cấp lại = `null` (BR-12) | |
| `features` (M1, sửa) | `updated_by` | uuid | có | null | **thêm cột** (FK như trên); `core` seed giữ `null`. `icon` null → API trả `"package"` | không (giữ M1) |

**Không** tạo ở M2: `config_meta` (M3), `feature_grants`, `groups` (M3), `audit_log` (M4). Không thêm cột `tenant_id` vào catalog. Không có trigger.

**Migration** (CONVENTIONS §8 — không sửa `0000`–`0002`):
1. `0003_admin_catalog.sql` — drizzle-kit sinh từ `packages/db/src/schema/admin.ts` (6 bảng mới + `features.updated_by`). `db:generate` lần 2 phải "No schema changes".
2. `0004_catalog_rls.sql` — `drizzle-kit generate --custom --name catalog_rls`, SQL nguyên văn ở [plan.md §3.1](plan.md): RLS + policy `secrets_admin_rw`, `feature_entitlements_admin_rw`, `feature_entitlements_hub_ro`; `REVOKE ALL ON admin.secrets FROM hub_ro, PUBLIC`; `REVOKE SELECT ON admin.secrets FROM admin_rw` + `GRANT SELECT (id, name, key_version, last4, note, created_at, updated_at, updated_by) ON admin.secrets TO admin_rw`.
3. Không có migration dev mới (stub `hub.agent_workflows` + `GRANT SELECT … TO admin_rw` đã có ở `migrations-dev/0000`). Kết quả `runMigrations`: development/test `{main: 5, dev: 2}`, production `{main: 5, dev: 0}`.

Bảng `admin.*` sau M2 (10): `command_names, commands, feature_commands, feature_entitlements, features, refresh_tokens, secrets, tenants, users, workflows`. RLS bật (không FORCE): `feature_entitlements, refresh_tokens, secrets, tenants, users`; không bật: `command_names, commands, feature_commands, features, workflows`.

**Quyền `hub_ro`:** SELECT mọi bảng catalog mới theo default privileges M0 (Hub đọc catalog, HUB-FR-02), **trừ** `secrets` (REVOKE ALL; A7). **Quyền `admin_rw` trên `secrets`:** INSERT/UPDATE/DELETE theo default privileges; SELECT chỉ các cột không mật → admin-api (kể cả khi có lỗi SQL injection/bug) **không đọc được** `ciphertext`/`iv`; M2 không có luồng nào cần giải mã ở admin-api.

**Đọc `hub.agent_workflows`** (R12, A5): schema `hub` luôn có (migration chính `0000`), bảng thì chỉ có khi Hub (hoặc stub dev) đã tạo. Mỗi transaction cần dữ liệu agent chạy trước `select coalesce(has_table_privilege(to_regclass('hub.agent_workflows'), 'SELECT'), false) as ok` (`to_regclass` trả `NULL` khi thiếu bảng/schema, không lỗi) rồi mới truy vấn bảng; `false` → `agents=[]`, `agent_count=0`, `agents_available=false`. Không cache (Hub có thể lên sau Admin). Admin không khoá được hàng `hub.*` → hàng Hub thêm cùng lúc với xoá workflow có thể mồ côi; Hub phải tự kiểm workflow tồn tại (ghi TECH-DEBT).

**Seed:** giữ nguyên M1 (`platform`, `core`, admin); không seed secret/workflow/command. **Env:** `SECRET_MASTER_KEY` bắt buộc ở admin-api (`config/env.ts`): đúng `^[A-Za-z0-9+/]{43}=$` và giải mã base64 ra đúng 32 byte; sai/thiếu → exit 1 "Env không hợp lệ: SECRET_MASTER_KEY" (không in giá trị).

## 5. UI (frontend-lead)
<!-- frontend-lead -->
Chi tiết: [plan-frontend.md](plan-frontend.md) (bố cục, trạng thái, validate, nhãn e2e, câu chữ VI/EN, đối chiếu contract Y1–Y10). Artboard: `Secrets`, `Workflows`, `Commands` (`docs/design/canvas/`); Features và danh sách Commands dùng mẫu A/B theo [missing-screens §2, §3](../_design/admin-missing-screens.md); `Access` chỉ để đối chiếu (ma trận = M3). Câu chữ nguyên văn ở missing-screens §2, §3, §6 và artboard Workflows; chuỗi mới ở plan-frontend §7.

| Route | Màn | Mẫu |
|---|---|---|
| `/secrets` (`?drawer=new\|replace\|note&secret=`) | Danh sách + drawer thêm / Thay giá trị / Sửa ghi chú; giá trị chỉ nhập, chỉ hiện `last4` | A + C |
| `/workflows`, `/workflows/new`, `/workflows/:id` | Catalog (chip "Chưa gắn", "Đang được dùng bởi"), editor 4 tab (Thông tin · Input nhập tay · Model thấy gì · Đang được dùng bởi) | A, B |
| `/commands`, `/commands/new`, `/commands/:id` | Danh sách (Switch + Hoàn tác 5 s), editor 5 bước, input map 8 nguồn + validate, tab "Ai dùng được" (tenant); **không** Test, **không** Lịch sử | A, canvas `Commands` |
| `/features`, `/features/new`, `/features/:id` | Danh sách + kill switch, editor 3 tab (Thông tin · Commands · Tenant), cấp/thu hồi entitlement | A, B |

Component mới dùng chung: `PlatformOnly`, `DependencyList`, `RefPicker`, `LocalizedInput`, `notifySuccess(message, action?)`; trong feature: `SecretField`, `SchemaEditor`, `ArgsEditor`, `InputMapEditor`. Không thêm thư viện, không ADR (D1). Menu M2: nhóm `CHỨC NĂNG` (Features, Commands, Workflows) và `BẢO MẬT` (Secrets), chỉ `platform_admin`; `tenant_admin`/`member` mở URL → `ForbiddenState`, không gọi API. Tab "Feature" của Tenant giữ "Chưa khả dụng" (A10).

**Contract:** các yêu cầu Y1–Y10 đã được backend-lead chốt ở §3 (plan-frontend §9); FE không còn yêu cầu mở. **409 `VERSION_CONFLICT` (G14):** UI chỉ hiện `errors.versionConflict` kèm nút `Tải lại`, không modal diff, không ghi đè (M3 làm modal).

## 6. Hiệu năng
Mặc định `CONVENTIONS.md` §6, ADM-NFR-03 (CRUD < 300 ms, 5.000 bản ghi/bảng ở mức M1; catalog thực tế vài trăm). Riêng: `GET /admin/workflows` kèm `command_count`/`agent_count` và `GET /admin/features` kèm `command_count`/`tenant_count` phải gộp bằng `GROUP BY`, không N+1; ghi secret (mã hoá) < 50 ms. Bundle: giữ ngân sách M1 (JS ≤ 150 KB gzip ban đầu), route-split 4 màn mới. **Frontend:** JS ban đầu hiện 106,9 KB, ước ≤ 112 KB sau M2 (i18n + nav); mỗi chunk route ≤ 50 KB gzip (FE7 đo, thêm kiểm trong `check-bundle`); bảng phân trang server 50 dòng nên không virtualize; danh sách chọn lấy `limit=200` và render ≤ 50 mục; hàng/dòng editor `memo` + `useWatch` đúng trường (plan-frontend §6).

**Backend — ngân sách siết** (p95, máy dev, in-process; dữ liệu: 1.000 workflow, 5.000 command × 2 feature, 5.000 hàng `hub.agent_workflows`, 200 feature, 500 tenant × 20 user, 100 entitlement/feature): `GET /admin/commands` (mọi bộ lọc) < 150 ms · `GET /admin/workflows` (kèm đếm, `attached=false`) < 150 ms · `GET /admin/features` < 100 ms · `GET /admin/commands/:id/access` < 150 ms · `POST/PATCH /admin/commands` < 100 ms · `POST/PUT /admin/secrets` < 50 ms (AES-GCM đo 2026-10-01: ~0,01 ms/lần với 2.048 ký tự, Bun 1.3.14) · mọi CRUD còn lại < 300 ms. Kiểm: `commands.perf.int.test.ts` (T6, không khoá). Không N+1: đếm/gộp bằng subquery `GROUP BY` hoặc `json_agg` trong **một** câu cho cả trang.

| Truy vấn | Index dùng |
|---|---|
| Secrets list sắp `name`; `used` / `used_by` | `secrets_name_uq`; `workflows_secret_idx` |
| Workflows list sắp `key`; `command_count`; `agent_count`; `attached=false`; `?secret=` | `workflows_key_uq`; `commands_workflow_idx`; `agent_workflows_workflow_id_idx` (hub); như trên; `secrets_name_uq` → `workflows_secret_idx` |
| Usages / chặn xoá-tắt / `SCHEMA_BREAKS_COMMANDS` | `commands_workflow_idx`; `agent_workflows_workflow_id_idx` |
| Commands list sắp `name`; `?workflow=`; `?feature=`; feature của mỗi command | `commands_name_uq`; `commands_workflow_idx`; PK `feature_commands (feature_id, command_id)`; `feature_commands_command_idx` |
| `?q` (ILIKE name/alias/mô tả, ≤ 5.000 hàng) | quét tuần tự có lọc (ước < 20 ms); không `pg_trgm` ở M2 |
| Trùng tên/alias | PK `command_names_pkey` |
| Features list; `command_count`; `tenant_count` | `features_key_uq`; PK `feature_commands`; PK `feature_entitlements` (`feature_id` đứng đầu) |
| Entitlement list; `active_user_count` | PK `feature_entitlements`; `tenants` PK; `users_tenant_role_active_idx` (M1, `WHERE active`) |
| Access (Ai dùng được) | `feature_commands_command_idx` → `feature_entitlements_tenant_active_idx`/PK → `tenants_key_uq` |
| Command độc quyền của feature (xoá feature, bỏ khỏi feature) | PK `feature_commands` + `feature_commands_command_idx` |

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| Postgres 16 | Như M1 (`ai_system_test`); migration mới chạy bởi owner, app bằng `admin_api` |
| `hub.agent_workflows` | Bảng stub `migrations-dev/0000_hub_stub.sql` (test tự `INSERT` để dựng agent "Trợ lý dịch" cho AC-A05); production không có (M2-R12) |
| Dify / Hub / Redis / SMTP | Không dùng ở M2 (không NOTIFY, không gọi mock Dify/Hub) |

Env: `SECRET_MASTER_KEY` (32 byte base64): dev/test sinh cục bộ bằng `bun run keys:dev` — **script đã sinh biến này từ M0** (`tools/scripts/src/keys-dev.ts`, test `keys-dev.test.ts` kiểm 32 byte), `.env.local` hiện có đã điền; CI đã chạy `keys:dev` trước Install nên **không cần sửa script hay `ci.yml`**. `.env.example` giữ trống. Cần thêm (không thuộc backend): `playwright.config.ts` `webServer[0].env` thêm `SECRET_MASTER_KEY: need("SECRET_MASTER_KEY")` (task FE0b), vì admin-api từ T3 không khởi động khi thiếu biến. `test:int` dùng `--env-file=.env.local` và test spawn server dùng `...process.env` nên đã có biến. Production: vận hành sinh 32 byte ngẫu nhiên, giữ trong secret store, **dùng chung với Hub** (architecture §"Đã chốt"); mất khoá = mất mọi secret → ghi `PRODUCTION-NOTES.md` (docs-architect, D1). Không thêm thư viện (mã hoá = `node:crypto`/Web Crypto của Bun); nếu cần thư viện mới (vd bộ soạn JSON/kéo-thả) → ADR + trình Gate.

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
### Đề xuất của docs-architect — **đã chấp nhận (Gate 2026-10-01)**, xem [readiness.md](readiness.md)
- **A1** FR-33/AC-A03 "≤ 5 s" cần `config_changed` nhưng FR-53 thuộc M3: M2 không NOTIFY, tăng `version` bản ghi nhưng chưa `config_version` (M2-R24). — **đã chấp nhận (Gate 2026-10-01)** ([CR-011](../../CHANGE-REQUESTS.md))
- **A2** Mô hình bảo mật Secrets: `key_version`, AAD = `id`, giá trị 8–2048, RLS riêng + REVOKE `hub_ro` (R02, R06). Cần backend-lead xác nhận; **trình Gate** nếu thay đổi cách mã hoá hoặc cần secret thật. — **đã chấp nhận (Gate 2026-10-01)**
- **A3** Tên không gian chung command/alias, độ dài 2–32, ≤ 5 alias; `timeout_s` 1–600 (R13, R15). — **đã chấp nhận (Gate 2026-10-01)** (mặc định kỹ thuật đi kèm)
- **A4** `WORKFLOW_DISABLED`, `SCHEMA_BREAKS_COMMANDS`, `CORE_FEATURE_PROTECTED`, `COMMAND_NEEDS_FEATURE`, `INPUT_MAP_INVALID`… là mã đề xuất; backend-lead chốt tên ở §3 (không đổi nghĩa). — **đã chấp nhận (Gate 2026-10-01)** (mặc định kỹ thuật đi kèm)
- **A5** Production chưa có schema `hub`: `usages` trả rỗng phần agent (R12), không phải lỗi. — **đã chấp nhận (Gate 2026-10-01)** (mặc định kỹ thuật đi kèm)
- **A6** Admin chỉ biết `agent_id` (tên agent ở Hub): UI hiện id ngắn đến khi có API Hub. — **đã chấp nhận (Gate 2026-10-01)** (mặc định kỹ thuật đi kèm)
- **A7** Hub lấy app key Dify bằng cách nào (giải mã ở đâu, ai giữ master key) **chưa quyết**, ngoài M2; M2 không cấp quyền nào cho `hub_ro` trên `secrets`. — **đã chấp nhận (Gate 2026-10-01)** (mặc định kỹ thuật đi kèm)
- **A8** FR-12 (COULD) không làm ở M2 dù nằm trong dải ROADMAP. — **đã chấp nhận (Gate 2026-10-01)** ([CR-012](../../CHANGE-REQUESTS.md))
- **A9** FR-24 (SHOULD) chỉ làm phần tenant ở M2; phần group/grant sau M3 (R23). — **đã chấp nhận (Gate 2026-10-01)** ([CR-013](../../CHANGE-REQUESTS.md))
- **A10** Tab "Feature" trong chi tiết Tenant giữ "Chưa khả dụng"; entitlement làm ở editor Feature (tab Tenant). `active_user_count` = user active của tenant (R22). — **đã chấp nhận (Gate 2026-10-01)**
- **A11** Không ghi audit ở M2 → TECH-DEBT "thay đổi catalog trước M4 không có trong Nhật ký" (điều phối/docs-architect ghi khi đóng mốc); ẩn menu "Lịch sử". — **đã chấp nhận (Gate 2026-10-01)**
- **A12** Test khoá M0/M1 đếm migration (`{main:3,dev:2}` trong `tests/acceptance/ADM-NFR-06/migrate.int.test.ts` và `packages/db/src/migrate.int.test.ts`) và danh sách bảng sẽ lệch khi thêm migration M2: qc sửa (như Q2 M1), ghi ở "Quyết định trong lúc làm". — **đã chấp nhận (Gate 2026-10-01)** (mặc định kỹ thuật đi kèm)

### Backend-lead PLAN (2026-10-01; theo thứ tự nguồn Luật 2; chi tiết [plan.md](plan.md))
Mục bảo mật A2 đã được người dùng chấp nhận (Gate 2026-10-01); còn lại backend-lead chốt theo Luật 2, không đổi phạm vi đã duyệt, không thêm thư viện.
- **A1 — xác nhận.** Không NOTIFY, không `config_meta`; chỉ tăng `version` bản ghi (§3 "`version`"). AC-A03 vế "≤ 5 s" không kiểm ở M2.
- **A2 — xác nhận, siết thêm. Đã chấp nhận (Gate 2026-10-01):**
  - AES-256-GCM bằng `node:crypto` (không thư viện), khoá = 32 byte của `SECRET_MASTER_KEY` dùng trực tiếp (không HKDF: tách miền bằng AAD; Hub chỉ cần cùng khoá + cùng công thức AAD), IV 12 byte `randomBytes` mỗi lần ghi, tag 16 byte nối cuối `ciphertext`, `key_version = 1`.
  - **AAD = UTF-8 `"admin.secrets:" + id + ":" + key_version`** (sửa từ "AAD = `id`": thêm tiền tố bảng để khoá dùng cho mục đích khác ở M4 (vd TOTP) không tráo được bản mã, thêm `key_version` để chuẩn bị xoay khoá). Định dạng này là **contract với Hub** (plan.md §3.2).
  - RLS `secrets` chỉ scope `platform`; `REVOKE ALL … FROM hub_ro, PUBLIC` (default privileges M0 cấp SELECT nên bắt buộc); **mới:** `admin_rw` mất SELECT trên `ciphertext`/`iv` (chỉ cấp SELECT theo cột) — admin-api không có luồng giải mã ở M2 nên không cần đọc bản mã; bug/SQL injection ở admin-api cũng không lấy được bản mã. M5 (FR-23) hoặc Hub cần đọc → migration GRANT mới.
  - Giá trị 8–2048, không trim; `last4` = 4 code point cuối (BA §7 có `last4`, RD#25). Response/log/lỗi không bao giờ có giá trị (§3 "Bảo mật Secrets ở biên").
  - Mã hoá chạy **trong** callback `withScope` sau khi biết `id` (AAD cần `id`): đây là tính toán cục bộ, không gửi gì ra ngoài, chạy lại khi 40P01 chỉ sinh IV mới → không vi phạm TECH-DEBT #13.
  - `keys:dev` **không cần mở rộng**: đã sinh `SECRET_MASTER_KEY` từ M0; CI đã chạy `keys:dev`. Chỉ thiếu biến trong `playwright.config.ts` (FE0b).
  - Xoay khoá (nhiều `key_version`) chưa làm → TECH-DEBT (D1).
- **A3 — xác nhận** 2–32, ≤ 5 alias, `timeout_s` 1–600 (mặc định sync 30 / async 120); thêm `args` ≤ 20, `input_schema` ≤ 50, `const` ≤ 4000, `default` ≤ 1000, `options` ≤ 50.
- **A4 — chốt** 11 mã mới (§3 bảng "Mã lỗi mới"). Khác đề xuất: dùng `SECRET_NAME_TAKEN` (không `NAME_TAKEN`); key workflow/feature trùng dùng lại `KEY_TAKEN` của M1 (FE plan §8 đã dựa vào; message đổi thành "Key is already taken"); thêm `INVALID_REFERENCE` (id tham chiếu không tồn tại — trước đây không có mã). `INPUT_MAP_INVALID.message` **cố định** tiếng Anh như mọi mã M1; chuỗi AC-A03 "thiếu input bắt buộc: target_lang" do FE dựng từ `details.missing` (sửa cách đọc M2-R17 "message gồm đúng chuỗi").
- **A5 — chốt cách phát hiện:** `has_table_privilege(to_regclass('hub.agent_workflows'), 'SELECT')` mỗi transaction cần dữ liệu agent, không cache (§4). Schema `hub` luôn tồn tại (migration `0000`), chỉ bảng là có thể thiếu.
- **A6 — xác nhận** (`agents:[{id}]`).
- **A7 — sửa:** [architecture.md](../../design/architecture.md) đã chốt "Hub đọc workflow **và secret** từ schema `admin`; master key dùng chung giữa Admin và Hub". M2 vẫn REVOKE `hub_ro` (Hub chưa có); khi làm Hub: migration mới `GRANT SELECT (id, name, ciphertext, iv, key_version) ON admin.secrets TO hub_ro`, Hub giải mã theo plan.md §3.2. Không phải câu hỏi mới.
- **A8, A9, A10, A11 — xác nhận.** A9: `GET /admin/commands/:id/access` (§3). A10: `active_user_count` = user `active && !locked_by_tenant` (= `status` "active" của M1).
- **A12 — chốt số cho qc** (Q2; chi tiết plan.md §10): `runMigrations` development/test `{main:5, dev:2}` (lần 2 `{0,0}`), production `{main:5, dev:0}`; 10 bảng `admin.*` + 3 bảng `hub.*` (production: 10 + 0); RLS bật `feature_entitlements, refresh_tokens, secrets, tenants, users`; `API_ERRORS` 34 mã. File khoá phải sửa: `tests/acceptance/ADM-NFR-06/migrate.int.test.ts`, `tests/acceptance/M1/db-schema.int.test.ts` (đếm, danh sách bảng, danh sách "bảng mốc sau" bỏ `secrets/workflows/commands`), `tests/acceptance/M1/db-rls.int.test.ts:242` (danh sách RLS), `tests/acceptance/M1/rules/contracts.test.ts:29-55` (23 mã → giữ đúng 23 mã M1 bằng `toMatchObject`, đếm 34), `tests/acceptance/M1/error-codes.int.test.ts:145` (chỉ so tập mã M1). `packages/db/src/migrate.int.test.ts` là test backend, backend-lead sửa ở T2.
- **Sửa/làm rõ luật §2 (không đổi nghĩa nghiệp vụ):** R03 response secret có thêm `id` (Y1); R04 mã `SECRET_NAME_TAKEN`, sửa ghi chú = `PATCH /admin/secrets/:name` (Y6); R10 `usages` thêm `command_count/agent_count/agents_available`; R15 `output.field` bắt buộc, `fallback ∈ {selection, page_url, page_text} | null` (Y8); R20 `icon` `^[a-z0-9-]{1,40}$` (Y9); R26 bộ lọc: Workflows `?status=on|off&attached=&secret=<NAME>&q`, Commands `?status=on|off&feature=<uuid>&workflow=<uuid>&q` (Y3), counts `{all,on,off(,unattached)}`; R22 thêm `GET …/entitlements` (Y1); R13 bảng `command_names` + unique `commands_name_uq` (cả hai trong một transaction).
- **Thêm (cần cho UI, không đổi phạm vi):** cột `updated_by` cho `secrets`, `workflows`, `commands`, `features` (UI "Cập nhật … · minh.pham", Y10); tập feature/command đổi từ phía bên kia tăng `version` cả hai thực thể (chống ghi đè giữa editor Command và tab Commands của Feature).
- **Khoá hàng** (R27, bài học M1 N1): chỉ `FOR NO KEY UPDATE` (ghi) và `FOR SHARE` (giữ tham chiếu ổn định), **không bao giờ** `FOR UPDATE` tường minh; thứ tự cố định `workflows → commands (id tăng) → features (id tăng) → secrets`; chi tiết + bảng xung đột ở plan.md §5.1, test `lib/lock-order.int.test.ts` mở rộng ở T6.
- **Áp mặc định lỗ hổng test-plan §10 (2026-10-01):**
  - G1: giữ nguyên định dạng mã hoá plan §3.2 (contract với Hub; A2 đã chấp nhận (Gate 2026-10-01)).
  - G4: `active_user_count` = `active && !locked_by_tenant` (đã sửa câu R22).
  - G5: `PATCH /admin/features/:id` của `core` **được** nhận `command_ids` (thêm/bớt); luật mồ côi áp như mọi feature (bỏ command chỉ thuộc `core` → 400 `COMMAND_NEEDS_FEATURE {commands}`). Chỉ `status ≠ on`, xoá, entitlement của `core` mới bị `CORE_FEATURE_PROTECTED`.
  - G7: request log của `/admin/secrets*` ghi `path` thuần, **không** query string (các route khác giữ như M1: cũng chỉ `path`).
  - G12: `VALIDATION_ERROR` của `/admin/secrets*` có `details.issues[].message` **tĩnh theo `code`** (vd `"invalid"`), không dùng message zod; issue `unrecognized_keys` không liệt kê tên khoá (`path: []`). `code`/`path` của trường hợp lệ giữ nguyên để FE gắn lỗi theo ô.
  - G8: `AppDeps.testHooks?` (chỉ nhận khi `appEnv="test"`, ngược lại bỏ qua) để chèn điểm dừng tất định giữa khoá và ghi; 3 ca xen kẽ plan §5.1 viết tất định trong `apps/admin-api/src/lib/lock-order.int.test.ts` (test backend, không khoá) — plan §6.
- **Phụ thuộc module (không vòng):** `commands → workflows → secrets`, `commands → features`. Đọc chéo bảng qua repo của chính module (như `auth-middleware` M1); `feature_commands` do module `features` sở hữu ghi.
### UI đã chấp nhận (Gate 2026-10-01, [CR-014](../../CHANGE-REQUESTS.md))
- Editor Workflows và Commands là trang riêng; bỏ panel "Chạy thử"; giữ câu toast "có hiệu lực sau vài giây" của design (hiệu lực thật do Hub/M3).
### Trong lúc làm (agent tự quyết theo Luật 2)
- T1 (backend-lead): hằng mới đặt tên cho các số đã có ở §3: `SELECT_OPTION_MAX = 100` (độ dài một option), `COMMAND_FEATURES_MAX = 50`, `FEATURE_COMMANDS_MAX = 500`, `USAGES_MAX = 200`, `REFERENCE_FIELDS`; helper mới `CatalogKeySchema`, `SecretNameSchema`, `uniqueArray(item, max)` trong `common.ts`.
- T1: `CommandArg.default` rỗng sau trim → `null` (như `SecretNote`), tránh lưu `""` lẫn với "không có mặc định".
- T1: `BaseUrlSchema` = trim → ≤ 2048 → regex `^https?://` (phân biệt hoa thường, khớp CHECK DB; chặn `HTTPS://…`, `http:host`) → `z.url({protocol: /^https?$/})` → refine không userinfo.
- T1: response có refine bất biến: `Workflow*.unattached ⇔ command_count = 0 ∧ agent_count = 0`; `WorkflowUsages.agents_available = false ⇒ agents = [] ∧ agent_count = 0`; `Feature*.is_core ⇔ key = "core"`.
- T1: `aliases` không trùng `name` chỉ kiểm được ở biên khi body có cả hai; `PATCH` chỉ gửi một bên → T6 kiểm trên trạng thái ghép, trả `VALIDATION_ERROR` (path `aliases`), không phải `COMMAND_NAME_TAKEN`.
- T1: `details` có mảng `min(1)` khi mã chỉ phát sinh lúc có phần tử (`SECRET_IN_USE.used_by`, `INVALID_REFERENCE.ids`, `SCHEMA_BREAKS_COMMANDS/COMMAND_NEEDS_FEATURE/FEATURE_HAS_EXCLUSIVE_COMMANDS.commands`); `WORKFLOW_IN_USE.commands/agents` từng mảng có thể rỗng.
- T1: `CommandRefSchema`, `UsageCommandSchema`, `AgentRefSchema` ở `common.ts` (dùng chung cho `details` và `WorkflowUsages`); `FeatureRefSchema` ở `features.ts`; `commands.ts` import `features.ts` + `workflows.ts` (một chiều, không vòng). `versionConflictDetailsSchema` giữ nguyên, dùng dạng truyền schema (`WorkflowSchema`, `CommandSchema`, `FeatureDetailSchema`).
- T1: message cố định 11 mã mới (`apps/admin-api/src/lib/errors.ts`): `INVALID_REFERENCE` "Referenced item does not exist", `INPUT_MAP_INVALID` "Invalid input map", `COMMAND_NEEDS_FEATURE` "A command must belong to at least one feature", `SECRET_NAME_TAKEN` "Secret name is already taken", `SECRET_IN_USE` "Secret is in use by workflows", `WORKFLOW_IN_USE` "Workflow is in use", `SCHEMA_BREAKS_COMMANDS` "Input schema change breaks commands", `WORKFLOW_DISABLED` "Workflow is disabled", `COMMAND_NAME_TAKEN` "Command name is already taken", `CORE_FEATURE_PROTECTED` "The core feature cannot be changed this way", `FEATURE_HAS_EXCLUSIVE_COMMANDS` "Feature has commands that belong only to it"; `KEY_TAKEN` → "Key is already taken".
- T1: `common.ts` sau M2 = 342 dòng (≤ 400); mốc sau thêm hằng/mã thì tách phần catalog sang file riêng.
- T2 (backend-lead): PK ghép đặt tên tường minh `feature_commands_pkey`, `feature_entitlements_pkey` (như `command_names_pkey`; drizzle-kit mặc định là `…_pk`). FK theo tên drizzle-kit sinh: `workflows_secret_id_secrets_id_fk`, `commands_workflow_id_workflows_id_fk`, `command_names_command_id_commands_id_fk`, `feature_commands_{feature_id_features,command_id_commands}_id_fk`, `feature_entitlements_{feature_id_features,tenant_id_tenants,granted_by_users}_id_fk`, `<bảng>_updated_by_users_id_fk` (secrets, workflows, commands, features).
- T2: `0003_admin_catalog.sql` drizzle-kit không sinh `CREATE SCHEMA` (schema có trong snapshot 0001) nên không phải sửa; chỉ thêm một dòng comment mã FR đầu file. `0004_catalog_rls.sql` = SQL nguyên văn plan §3.1, mỗi lệnh một `--> statement-breakpoint`.
- T3 (backend-lead): `SecretValueSchema` đếm độ dài bằng `String.length` qua `superRefine` (issue `too_small`/`too_big`), vì `.min/.max` của zod 4 đếm code point — 4 emoji (8 đơn vị UTF-16) bị từ chối, sai với M2-R01 "đếm UTF-16". Sửa hiện thực cho khớp contract, không đổi contract.
- T3: mã hoá khi tạo chạy **trước** `withScope` (id v7 sinh trước, AAD cần id); khi `PUT` chạy trong callback sau khi khoá hàng (cần id đã có) — chỉ tính toán cục bộ (TECH-DEBT #13).
- T3: `VALIDATION_ERROR` của `/admin/secrets*`: `message` = `code` thay `_` bằng dấu cách (vd `"too small"`); `unrecognized_keys` → `{path: [], message: "unrecognized keys"}`. Request log M1 đã chỉ ghi `c.req.path` (không query) nên G7 không cần đổi code log.
- T3: `foreignKeyViolation(err)` thêm vào `lib/pg-errors.ts` (dùng lại ở T5). Khởi động: `parseMasterKey` + `selfTestSecretKey` (mã hoá/giải mã thử id nil), lỗi → `fail("secret-key")` exit 1; env thiếu/sai → "Env không hợp lệ: SECRET_MASTER_KEY".
- T4 (backend-lead): `DELETE /admin/features/:id` khoá thêm các command của feature (`FOR NO KEY UPDATE`, id tăng) **trước** khoá feature (đúng thứ tự commands → features) để luật không mồ côi không bị đua với `PATCH` feature khác bỏ cùng command; không tăng version command (readiness lần 2 #2).
- T4: `PATCH` có `command_ids`: tập command của feature đọc lại sau khi khoá feature; nếu có command mới chen vào giữa lúc đọc và khoá thì khoá thêm (hiếm; `withScope` chạy lại 40P01 làm lưới an toàn). `details.commands` của `COMMAND_NEEDS_FEATURE` sắp theo `name`; `INVALID_REFERENCE.ids` theo thứ tự id tăng của phần thêm.
- T4: `affected_user_count` = số user `active ∧ ¬locked_by_tenant` (mọi tenant, kể cả `platform`, cho `core`; tenant có entitlement chưa thu hồi cho feature khác). Không lọc `tenants.active` (user của tenant khoá đã có `locked_by_tenant`).
- T4: `testHooks` (`lib/test-hooks.ts`, `afterLock(op)`) — `createApp` chỉ truyền khi `appEnv === "test"`. Helper `lib/json.ts` (`sameJson`, `sameIdSet`) dùng chung cho `changed*Fields`.
- T5 (backend-lead): list/detail workflow ghép SQL theo cờ `readable` (`hubAgentsReadable`): cờ false → `agent_count = 0`, điều kiện "Chưa gắn" chỉ dựa trên command, câu SQL không nhắc tới `hub.agent_workflows`. `counts.unattached` dùng cùng biểu thức. `GET …/usages` chỉ đọc (không khoá).
- T5: PATCH khoá workflow `FOR NO KEY UPDATE` rồi mới đọc lại + so `version`; `secret_id` đổi → `lockSecretRef` (`FOR SHARE`, `INVALID_REFERENCE {field:"secret_id"}`); tắt (true→false) → usages; đổi `input_schema` → `mappedCommands` (mọi command, bật hay tắt). `testHooks.afterLock("workflow.save")` gọi sau khoá ở POST/PATCH.
- Q2 (qc): sửa test khoá M0/M1 vì M2 đổi phạm vi (số liệu backend-lead, §9 A12), **không phải tranh chấp**; thứ tự T1 → Q2 → T2: `tests/acceptance/M1/rules/contracts.test.ts` (bảng mã: giữ đúng 23 mã M1 bằng `toMatchObject`, tổng 34 vì T1 thêm 11 mã) và `tests/acceptance/M1/error-codes.int.test.ts` (kiểu `ErrorCode` + tập đã phủ so với hằng 22 mã M1; 11 mã M2 do `M2/error-codes.int.test.ts` phủ) — xanh ngay; `tests/acceptance/ADM-NFR-06/migrate.int.test.ts` (`{main:5,dev:2}`/`{main:5,dev:0}`, 10 bảng `admin.*`), `tests/acceptance/M1/db-schema.int.test.ts` (đếm, 10 bảng, bỏ `secrets/workflows/commands` khỏi "bảng mốc sau", thêm `feature_grants`) và `tests/acceptance/M1/db-rls.int.test.ts` (10 dòng `relrowsecurity`, RLS bật trên 5 bảng) — đỏ tới T2 vì migration `0003`/`0004` chưa có.
- Q2: tách ca `commands` thành `commands.int.test.ts` (tạo/validate/tên/workflow/feature/thứ tự kiểm) và `commands-read.int.test.ts` (đọc/danh sách/version hai phía/tham số/xoá/nhân bản) vì giới hạn 600 dòng/file test; thêm file qc `secrets-proc.int.test.ts` (T3), `concurrency.int.test.ts` (T6), `i18n-labels.test.ts` (FE2). Lệnh xong T3, T6, FE2 trong `tasks.md` đã bổ sung.
- Q2: `e2e/support/prepare-db.ts` dựng thêm fixture danh mục (`tests/acceptance/M2/_data.ts`) và `--reset-only` dùng `truncateCatalog` tường minh (sau M2 mọi bảng danh mục có FK `updated_by → users` nên `truncateAll` của M1 sẽ cuốn theo chúng qua CASCADE). e2e chỉ chạy được sau T2 (cần migration `0003`/`0004`).
- Q2: nhãn nút xác nhận xoá secret/feature và tiêu đề heading editor Workflows/Features chưa có trong spec/plan-frontend: test dùng regex `/^Xoá( secret)?$/`, `/^Xoá/`, `/^Thu hồi/` cho nút xác nhận và chờ ô `Key` thay vì heading ở editor — frontend-lead nên chốt nhãn nguyên văn (ghi vào plan-frontend §5) rồi qc siết test ở lần Gate sau nếu cần.
- FE2: đã chốt nhãn xoá/thu hồi, H1 editor, tooltip, câu tên trùng, cách đổi ngôn ngữ ở [plan-frontend §12](plan-frontend.md); khớp regex test, không tranh chấp. `commands.empty`/`workflows.empty` đổi thành `.empty.text` (đụng cấu trúc JSON). `describeError(err, {keyTaken})` nhận key `KEY_TAKEN` theo màn; `describeInputMapErrors(details)` dựng 3 câu `INPUT_MAP_INVALID`.
- FE0 (frontend-lead): `switch`, `textarea`, `popover` viết tay theo style new-york (không chạy CLI, cùng `radix-ui`); `Textarea` dùng `forwardRef` (React 18, để `react-hook-form` `register` gắn được ref; phát hiện ở FE3).
- FE1a: nhóm menu CHỨC NĂNG (Features, Commands, Workflows) đứng **trên** TRUY CẬP, BẢO MẬT (Secrets) dưới cùng (plan D3); chỉ `platform_admin`. `notifySuccess(message, action?, durationMs?)`.
- FE1b: `RefPicker` dùng `div role=listbox/option` (biome a11y không cho role tương tác trên `ul/li`); `LocalizedInput` dùng kiểu `{vi, en}` đều là string (nơi gọi đổi EN rỗng thành `undefined` khi gửi).
- FE3: `used` ở URL Secrets là **boolean** thật (`?used=false`; chuỗi bị TanStack bọc thành `"false"` mà e2e chờ `used=false`), `validateSearch` nhận cả `"true"/"false"`. Nút Hiện/Ẩn không dùng `aria-pressed` (nhãn đã đổi theo trạng thái). `useSecretByName` tìm `q=<tên>` rồi khớp chính xác (API không có `GET /admin/secrets/:name`). Thêm `BlockedDialog` dùng chung (Secrets/Workflows/Features) và `DependencyItem.search`.
- FE3: `routes/_authed/workflows/index.tsx` và `commands/new.tsx` có `validateSearch` từ FE3 (toast "Xem các workflow dùng secret này" và "Tạo command" điều hướng kèm `?secret=` / `?workflow=`).
- FE4a: bảng Workflows chèn khoảng trắng (`{" "}`) giữa tên, key và các ô liền kề để `textContent` của hàng tách được từ (e2e lọc hàng bằng regex có `(?<![\w-])key(?![\w-])`). Xoá khi còn dùng: lấy `usages` mới (`staleTime: 0`) rồi mở dialog chặn; tắt: gọi `PATCH` và dùng `details` của 409 `WORKFLOW_IN_USE`.
- FE4b: tạo mới (`/workflows/new`) hiện Thông tin **và** Input trên cùng một tab (e2e và m2-flow bấm `+ Thêm tham số` ngay mà không đổi tab); chỉ có tab "Model thấy gì"; đủ 4 tab khi sửa. Sau POST thành công chờ cờ "chưa lưu" tắt (effect) rồi mới chuyển sang `/workflows/$id` để `UnsavedGuard` không chặn.

## 10. Tranh chấp test
- **#1 (T4, backend-lead, 2026-10-01)** `tests/acceptance/M2/features.int.test.ts` › "ADM-BR-10 · M2-R19 · bỏ command còn feature khác → được; version command bị bỏ +1": test `PATCH core {command_ids:[dich]}` và chờ 200, nhưng theo fixture `_data.ts` `tom-tat` chỉ thuộc `core` (`features: ["core"]`) → bỏ nó khỏi `core` làm nó mồ côi → theo M2-R19 và G5 (test-plan §10: "luật mồ côi áp như feature khác; bỏ command độc quyền khỏi core → 400") server trả 400 `COMMAND_NEEDS_FEATURE {commands:[{id: tom-tat, name:"tom-tat"}]}`. Code giữ đúng luật. Đề xuất qc: thêm `tom-tat` vào một feature khác trong test (owner SQL) trước khi PATCH, hoặc đổi kỳ vọng sang 400.
- **#2 (T5, backend-lead, 2026-10-01)** `tests/acceptance/M2/workflows.int.test.ts` › `afterAll` của describe "ADM-FR-15 · hub.agent_workflows vắng/không đọc được": kiểm `to_regclass('hub.agent_workflows')` (đọc bằng owner) bằng chuỗi `"agent_workflows"`, nhưng `regclass::text` chỉ bỏ tên schema khi schema nằm trong `search_path`; role owner không có `hub` trong `search_path` nên Postgres trả `"hub.agent_workflows"`. Không liên quan tới code (bảng đã được khôi phục đúng, `p: true`). Đề xuất qc: so `t` với `"hub.agent_workflows"` hoặc dùng `to_regclass(...) is not null`. Mọi test chức năng trong file đều xanh.
- **#3 (FE3, frontend-lead, 2026-10-01)** `e2e/secrets.spec.ts` › "locale EN của user": `loginAdmin` (`e2e/support/helpers.ts`) chờ H1 "Tổng quan" sau khi đăng nhập, nhưng test đặt `users.locale='en'` trước khi đăng nhập; từ M1 `LoginPage` gọi `i18n.changeLanguage(user.locale)` nên H1 là "Overview" và helper hết giờ trước các bước kiểm EN. Đề nghị qc dùng bước đăng nhập không phụ thuộc ngôn ngữ cho test này (vd `loginUI` rồi chờ URL `/`). FE giữ hành vi M1.
