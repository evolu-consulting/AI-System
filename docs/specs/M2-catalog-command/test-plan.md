# Test plan · M2-catalog-command (qc)

Chế độ WRITE (trước Gate) · 2026-10-01 · Chỉ có **kế hoạch**: chưa viết file test. File test viết ở task Q2 (sau Gate G1, sau T1), đỏ vì chưa có code, rồi khoá ở Q3.
"Đúng" = luật `M2-R01…R28` (`spec.md` §2), contract + bảng mã lỗi + thứ tự kiểm + quy tắc `version` (`spec.md` §3), dữ liệu + RLS/quyền (`spec.md` §4), 4 AC của BA (`AC-A03` phía Admin, `AC-A05`, `AC-A06`, `AC-A13`) và 9 AC do spec đề xuất (`M2-AC01…M2-AC09`, qc **xác nhận cả 9**, xem mục 7). Chữ ký hàm thuần: `plan.md` §4; định dạng mã hoá: `plan.md` §3.2; khoá hàng: `plan.md` §5.1; nhãn UI nguyên văn: `plan-frontend.md` §5 + `admin-missing-screens.md` §2, §3, §6. Không đọc code implementation.

## 1. Quy ước

Kế thừa M1 (`docs/specs/M1-foundation-identity/test-plan.md` §1) — chỉ ghi phần khác.

- **Thư mục:** `tests/acceptance/M2/` (hàm thuần ở `tests/acceptance/M2/rules/`), e2e ở `e2e/`. Helper: `tests/acceptance/M2/_fixtures.ts` (nạp `M1/_fixtures.ts` + khoá bí mật + dựng danh mục), `tests/acceptance/M2/_data.ts` (hằng/uuid/dữ liệu danh mục, không phụ thuộc `bun:test`, dùng chung cho int và `e2e/support`). Mã FR/BR/AC nằm ở **tên test** (`it("ADM-FR-50 · M2-R05 · …")`), mọi `it` bắt đầu bằng mã FR/BR/NFR; AC và `M2-Rnn` đi sau. Tên file đúng `plan.md` §10 (+ 3 file qc thêm, mục 4: `secrets-proc.int`, `concurrency.int`, `i18n-labels`).
- **Loại:** `rules` (`bun test`, không DB) · `int` (`*.int.test.ts`, in-process, DB `ai_system_test`) · `proc` (int có spawn server, cổng **3093**; M1 dùng 3092) · `e2e` (Playwright, chromium, `vi-VN`).
- **Fixture app:** như M1 `createApp(cfg, deps)` + `secretKey: parseMasterKey(<32 byte base64 sinh trong `_fixtures.ts` bằng `randomBytes(32)` một lần mỗi file>)` (nạp động qua `_modules.ts` như M1, để `bun run typecheck` không vỡ khi chưa có code). Request API **luôn** qua role `admin_api`; dựng dữ liệu chéo module và đọc bản mã bằng **owner** (`TEST_DATABASE_URL`).
- **Dữ liệu chéo module dựng bằng owner SQL** (bài học M1/`plan.md` §10): mỗi file chỉ gọi API của module đã xong ở task của nó (mục 8.1); phần còn lại `insert` bằng owner. `secrets.int` (T3) chèn workflow bằng SQL; `features.int` (T4) chèn command bằng SQL; `workflows.int` (T5) chèn command bằng SQL; `hub.agent_workflows` luôn bằng SQL.
- **`resetCatalog()`** (khác M1 `resetFixture()`): owner `TRUNCATE admin.refresh_tokens, admin.users, admin.tenants, admin.features, admin.secrets, admin.workflows, admin.commands CASCADE` + `TRUNCATE hub.agent_workflows` → `runSeed` → chèn fixture mục 3. Lý do liệt kê tường minh: sau M2 mọi bảng danh mục có FK `updated_by → users`, nên `TRUNCATE users CASCADE` của M1 `resetFixture()` đã tự cuốn theo `features/secrets/workflows/commands` (an toàn cho M1 vì `runSeed` tạo lại `core`; không phải sửa M1, ghi để người đọc không ngạc nhiên).
- **Bản mã giả:** owner chèn secret fixture với `iv = 12 byte`, `ciphertext = 24..40 byte` tuỳ ý (M2 không giải mã ở admin-api; `CHECK octet_length`).
- **Không `sleep`/`setTimeout` cố định.** Chờ theo điều kiện (`expect.poll`, `waitForResponse`, `toHaveURL`, `toBeVisible`) với hạn chót rõ. Hoàn tác 5 s (toast) chỉ kiểm **bấm trong 5 s** (không chờ hết 5 s).
- **Không `skip`/`only`**; dữ liệu cố định (uuid `01900000-0000-7000-8000-0000000002nn`); mọi file dưới `tests/acceptance/**`, `e2e/**` vào `tests/.lock`.
- Mọi response lỗi parse bằng `ErrorResponseSchema` + `status === API_ERRORS[code]` + `X-Request-Id`; `details` parse bằng `*DetailsSchema` tương ứng; thành công parse bằng schema contract (`SecretSchema`, `WorkflowSchema`, `CommandSchema`, `FeatureDetailSchema`…, schema strict nên **khoá thừa là đỏ**).
- **Hằng quét rò (AC-A06):** `LEAK_1 = "sk-LEAK-Q7Zp3XvR9mT2LwB5nJc8YdHa"` (ghi lần đầu), `LEAK_2 = "sk-LEAK-NEW-4Fh8KsD1yWq6ZoUe3PgM"` (thay giá trị), `LEAK_EMOJI = "😀😀😀😀"` (8 đơn vị UTF-16 = biên tối thiểu, `last4 = "😀😀😀😀"`), `LEAK_SHORT = "sk-LEAK"` (7 ký tự, bị 400). Quét theo cả dạng thô, base64 và hex của chuỗi.

## 2. Ma trận truy vết

Cột "Số test" = dự kiến (±10%). Ưu tiên theo `ba-admin.md`: **MUST** = FR-10, 11, 13, 14, 15, 20, 21, 22, 30, 31, 33, 50 (**12 mã**); **SHOULD** = FR-24, FR-34; **COULD** = FR-12 (không làm).

| Mã | Ưu tiên | Test chính (file ở mục 4) | Số test |
|---|---|---|---|
| ADM-FR-10 (CRUD workflow) | MUST | R1, R4 · W `workflows.int` · D1 · E-W `workflows.spec` · E-F `m2-flow` | 34 |
| ADM-FR-11 (input schema nhập tay) | MUST | R1, W · E-W (SchemaEditor, Model thấy gì) | 14 |
| ADM-FR-12 (Lấy schema từ Dify) | COULD, **không làm** | chỉ test âm: không có route (W) · xem G6 | 1 |
| ADM-FR-13 (chặn xoá/tắt đang dùng) | MUST | R4, W, K `concurrency`, E-W | 20 |
| ADM-FR-14 (Chưa gắn + bộ lọc) | MUST | R4, W, E-W | 8 |
| ADM-FR-15 (Đang được dùng bởi: command + agent) | MUST | R4, W (+ `agents_available`), E-W | 11 |
| ADM-FR-20 (CRUD command) | MUST | R1, R5, C `commands.int`, K, E-C `commands.spec`, `m2-flow` | 42 |
| ADM-FR-21 (input map 8 nguồn) | MUST | R1, R5, C, E-C | 12 |
| ADM-FR-22 (validate khi lưu) | MUST | R5, C, E-C, `m2-flow` | 16 |
| ADM-FR-24 (Ai dùng được: tenant) | SHOULD | A `access.int`, E-C | 11 |
| ADM-FR-30 (CRUD feature) | MUST | R1, R6, F `features.int`, E-F | 30 |
| ADM-FR-31 (entitlement cấp/thu hồi) | MUST | R6, F, D2, E-F, `m2-flow` | 20 |
| ADM-FR-33 (kill switch: lưu `status`) | MUST | R6, F, E-F | 7 |
| ADM-FR-34 (beta: lưu `status`, nhãn Beta) | SHOULD | F, E-F | 4 |
| ADM-FR-50 (CRUD secret, AES-256-GCM) | MUST | R1, R2, R3, S `secrets.int`, SP `secrets-proc`, D2, E-S `secrets.spec`, `m2-flow` | 58 |
| ADM-BR-01 (tên/alias chung không gian tên) | — | R5, C, K | 14 |
| ADM-BR-02 (command → đúng 1 workflow) | — | C, D1 | 5 |
| ADM-BR-04 (giá trị secret không rời Admin) | — | S, SP, W, C, D2, E-S | 22 (gộp trong FR-50) |
| ADM-BR-06 (tắt = vẫn lưu, không đổi `enabled` thực thể khác) | — | W, C, F | 6 |
| ADM-BR-10 (command ≥ 1 feature; `core` bảo vệ) | — | R5, R6, C, F, K | 15 |
| ADM-BR-13 (workflow không có quyền riêng) | — | W (không có route grant) | 2 |
| ADM-BR-14 (chỉ `platform_admin`) | — | X `forbidden`, E-S, D2 | 31 |
| ADM-NFR-01 (mã hoá at-rest, không log bí mật) | — | R2, S, SP | gộp FR-50 |
| ADM-NFR-06 (migration có version) | — | D1, M0 `migrate` (sửa) | 17 |
| ADM-NFR-07 (RLS + quyền cột) | — | D2, S | 16 |
| AC-A03 · A05 · A06 · A13 · M2-AC01…09 | — | mục 7 | gộp |
| M2-R28 (nhãn/i18n) | — | C1 `i18n-labels`, `i18n:check`, E2E | 3 + |

`FR-23` (Test), "Kiểm tra kết nối" (RD#35), FR-12 (Lấy từ Dify), FR-53 (NOTIFY), FR-51/52/54, grant/group/ma trận (M3), Hub đọc/chạy (không có Hub): **ngoài phạm vi M2** — chỉ có test **âm** (không có route/nút), mục 4 (W, C, E-C). Hiệu năng spec §6 do backend-lead đo (`commands.perf.int.test.ts`), qc chỉ chạy lại ở VERIFY và báo số (không khoá).

## 3. Dữ liệu seed / fixture

Tenant/user: **như M1 §3** (`platform` 2 user, `acme` 7 user [6 active, `em` `active=false`], `globex` 3, `zeta` khoá, 2 user `locked_by_tenant=true`) — dùng `tests/acceptance/M1/_data.ts`. Từ đó: `active_user_count` (user `active ∧ ¬locked_by_tenant`, backend A10): platform 2 · acme **6** · globex **3** · zeta **0**.

Danh mục (chèn bằng owner SQL; `updated_by` null trừ khi ghi chú):

| Bảng | Dữ liệu |
|---|---|
| secrets | `DIFY_TRANSLATE_KEY` (last4 `7f3a`, note "App Translate trên Dify prod") · `DIFY_INVOICE_KEY` (`91c2`) · `DIFY_OLD_KEY` (`44aa`, note "Key cũ, chờ xoá", **chưa dùng**) |
| workflows | `translate` (secret DIFY_TRANSLATE_KEY, bật; `input_schema`: `source_text` text **bắt buộc**, `target_lang` text **bắt buộc**, `tone` select tuỳ chọn options `formal`,`casual`; `output_field` `text`; mô tả 40 ký tự) · `invoice-check` (DIFY_INVOICE_KEY, bật; input `invoice_file` file bắt buộc) · `summarize` (DIFY_INVOICE_KEY, bật) · `report-export` (DIFY_INVOICE_KEY, **tắt**) · `report-tax` (DIFY_INVOICE_KEY, **Chưa gắn**: không command, không agent). Hệ quả: `used_by` của `DIFY_TRANSLATE_KEY` = `["translate"]`; `DIFY_INVOICE_KEY` = `["invoice-check","report-export","report-tax","summarize"]`; `DIFY_OLD_KEY` = `[]` |
| features | `core` (do seed) · `ke-toan` (on) · `dich-thuat` (on) · `bao-cao` (beta) · `thu-nghiem` (off) |
| commands | `dich` (alias `tr`; translate; feature `core`; map `source_text←arg text`, `target_lang←arg lang`; bật; sync) · `tom-tat` (workflow `summarize` tạo kèm; `core`) · `kiemtra-hoadon` (invoice-check; `ke-toan`; async; map `invoice_file←attachment`) · `tr-nhanh` (translate; `dich-thuat`; **tắt**) · `xuat-bao-cao` (report-export tắt; `bao-cao`; tắt) — mỗi tên + alias có hàng `command_names` |
| feature_entitlements | `ke-toan→acme` (chưa thu hồi) · `ke-toan→globex` (**đã thu hồi**) · `dich-thuat→acme` · `bao-cao→acme` · `thu-nghiem→acme` |
| hub.agent_workflows | `agent 01900000-0000-7000-8000-0000000002a1 → translate` (agent "Trợ lý dịch", AC-A05) |

Mỗi file int chỉ chèn **phần cần** (`seedCatalog(owner, {secrets?, workflows?, features?, commands?, entitlements?, agents?})`) để file chạy được ở task của nó. e2e dùng bản đầy đủ qua `e2e/support/prepare-db.ts` (mở rộng ở Q2, vẫn đọc `SEED_ADMIN_*` từ `process.env`).

## 4. Danh sách file và ca kiểm

Ký hiệu: **R** = rules, **D** = DB, **S/F/W/C/A/X/E/K** = int theo module, **SP** = proc, **E-*** = e2e.

### R. Hàm thuần (rules; không DB)

**R1 `rules/contracts.test.ts`** (≈ 18; ADM-FR-10/11/20/21/30/50, ADM-BR-01/02/04)
1. `API_ERRORS` bằng đúng bảng spec: 23 mã M1 giữ nguyên status + 11 mã mới `SECRET_NAME_TAKEN 409 · SECRET_IN_USE 409 · INVALID_REFERENCE 400 · WORKFLOW_IN_USE 409 · SCHEMA_BREAKS_COMMANDS 409 · WORKFLOW_DISABLED 409 · COMMAND_NAME_TAKEN 409 · INPUT_MAP_INVALID 400 · COMMAND_NEEDS_FEATURE 400 · CORE_FEATURE_PROTECTED 409 · FEATURE_HAS_EXCLUSIVE_COMMANDS 409`; tổng **34**.
2. Hằng/regex/enum `common.ts` đúng spec §3 (mọi hằng đã liệt kê, `TIMEOUT_DEFAULT_S = {sync:30, async:120}`, `CORE_FEATURE_KEY`, `FEATURE_ICON_DEFAULT`, các enum).
3. Secret: `SecretName` trim + HOA (`" dify_key "` → `DIFY_KEY`; `"a"`, 65 ký tự, `"DIFY-KEY"` → fail); `SecretValue` 7 fail / 8 ok / 2048 ok / 2049 fail, **không trim** (`"  1234567 "` giữ nguyên, tính 10), `SecretNote` `""` → `null`, 200 ok, 201 fail; request strict (khoá lạ fail; `PUT` chỉ `{value}`).
4. `SecretSchema` (response) strict: có `id,name,last4,note,used_by,created_at,updated_at,updated_by`; thêm `value`/`ciphertext`/`iv`/`key_version` → **fail**; `last4` đúng 4 ký tự.
5. Workflow create: `key` trim+lower; mô tả **19 fail / 20 ok / 400 ok / 401 fail**, đếm sau trim (`"  "+19 ký tự+"  "` fail; `"  "+20 ký tự+"  "` ok và đầu ra đã trim); `name` 128/129; `app_type` ngoài enum fail; `secret_id` không uuid fail; `enabled` mặc định `true`.
6. `base_url`: `https://dify.example.com/v1` ok; `ftp://x`, `javascript:alert(1)`, `https://user:pw@x.com`, `https://u@x.com`, 2049 ký tự → fail.
7. `WorkflowInput`/`InputSchema`: `select` bắt buộc `options` ≥ 1; kiểu khác mà có `options` fail; `options` trùng / 51 / phần tử rỗng fail; `description` rỗng hoặc toàn dấu cách fail; `name` regex (`1a`, `a-b` fail; `_x`, `A1` ok; 65 ký tự fail); trùng `name` fail với `path` trỏ đúng chỉ số; 50 ok / 51 fail.
8. `WorkflowUpdateRequest`: bắt buộc `version ≥ 1`; có `key` → fail; mọi trường khác tuỳ chọn; `WorkflowListQuery`: bool chỉ `"true"/"false"` (`attached=1` fail), `status` ∈ `on|off`, `secret` chuẩn hoá HOA, `limit` 0/201, `offset` -1 fail.
9. `WorkflowUsagesSchema` có `command_count`, `agent_count`, `agents_available`; `agents:[{id}]` strict.
10. `CommandName`: `"  DICH "` → `dich`; `d`, `a_b`, `có-dấu`, 33 ký tự fail. `aliases` ≤ 5 (6 fail), trùng nhau fail, trùng `name` fail.
11. `CommandArg`/`Args`: `name` regex (`Lang`, `1a` fail), trùng fail, ≤ 1 `rest`, `rest` phải ở cuối (hai `rest` fail; `rest` giữa fail; cuối ok), `default` 1001 fail, `fallback` ngoài `{selection,page_url,page_text}` fail, 21 tham số fail.
12. `InputMapEntry` (discriminated union): `arg` cần `value` đúng `ARG_NAME_RE`; `const` value 4000 ok / 4001 fail; `selection|page_url|page_text|attachment|user_id|tenant_id` mà có `value` → fail (strict); nguồn lạ (`$args.x`, `page`) fail; khoá map sai `INPUT_NAME_RE` fail; 51 khoá fail.
13. `CommandOutput`: `field` bắt buộc (thiếu/rỗng fail), `render ∈ markdown|text|json`.
14. `CommandCreateRequest`: `timeout_s` 0 fail / 1 ok / 600 ok / 601 fail / 1.5 fail; `mode` ngoài enum fail; `feature_ids: []` **parse được** (lỗi nghiệp vụ `COMMAND_NEEDS_FEATURE` do service, không phải `VALIDATION_ERROR`), trùng id fail, 51 fail; `description.vi` thiếu/201 ký tự fail, `en: ""` bị bỏ khỏi đầu ra; `CommandUpdateRequest` cần `version`, mọi trường khác tuỳ chọn.
15. `InputMapWarningSchema`: `reason ∈ type_mismatch|const_invalid`; `CommandSchema` có `warnings`, `feature_ids`, `args`, `input_map`, `output`, `timeout_s`; `updated_by: string | null`.
16. Feature: `key` regex; `name.vi` 65 ký tự fail, `name.en` rỗng bị bỏ; `description` `{}` ok, `vi` 401 fail; `icon` (`Package`, 41 ký tự, `a_b` fail; mặc định `package`); `status` ∈ `on|off|beta`; `command_ids` trùng / 501 fail; `FeatureUpdateRequest` có `key` → fail, cần `version`.
17. `listResponseSchema(item, counts)` (tham số thứ 2 mới; mặc định giữ M1) và `pageResponseSchema` `{items,total}` (không `counts`); counts từng danh sách: Secrets `{all,used,unused}`, Workflows `{all,on,off,unattached}`, Commands `{all,on,off}`, Features `{all,on,beta,off}`.
18. `*DetailsSchema` (strict): `INPUT_MAP_INVALID` đủ **3 khoá** `missing, unknown, unknown_args`; `WORKFLOW_IN_USE.action ∈ delete|disable`; `INVALID_REFERENCE.field ∈ secret_id|workflow_id|feature_ids|command_ids`; `SCHEMA_BREAKS_COMMANDS.commands[].missing/unknown`; `versionConflictDetailsSchema` dùng được cho `Workflow`, `Command`, `FeatureDetail`.

**R2 `rules/secret-crypto.test.ts`** (≈ 12; ADM-FR-50, NFR-01, M2-R02, M2-AC02) — nạp `apps/admin-api/src/lib/secret-crypto.ts` qua `_modules.ts`; **hiện thực độc lập** trong test bằng `node:crypto` (không import `decryptSecret` của sản phẩm cho các ca đối chiếu)
1. Khứ hồi: `decryptSecret(encryptSecret(k, id, v)) === v` với ASCII, tiếng Việt, emoji, đúng 8 ký tự, đúng 2048 ký tự.
2. `ciphertext.length === Buffer.byteLength(v,"utf8") + 16`; `iv.length === 12`; `keyVersion === 1`.
3. Hai lần mã hoá cùng giá trị/cùng id (RNG mặc định) cho `iv` **và** `ciphertext` khác nhau.
4. `rand` giả (12 byte cố định `0x01…0x0c`) → `iv` đúng dãy đó, kết quả tất định.
5. **Vector vàng:** với khoá 32 byte cố định, `id = 01900000-0000-7000-8000-0000000002f1`, `v = LEAK_1`, `iv` cố định: `ciphertext` bằng byte đầu ra của bản hiện thực độc lập (AES-256-GCM, khoá **dùng trực tiếp** — không HKDF; AAD = UTF-8 `admin.secrets:<id>:1`; tag 16 byte nối cuối). Đây là contract với Hub (A7).
6. Bản độc lập giải mã được đầu ra của sản phẩm (chiều ngược lại): iv = `iv`, tag = 16 byte cuối, AAD như trên.
7. Sai khoá (đổi 1 byte) → ném.
8. **AAD sai** → ném, mỗi biến thể một assert: id khác; `key_version` 2 (`SecretKey.version` ≠ `keyVersion` của bản mã); AAD **không có tiền tố** `admin.secrets:` (chỉ `id`, kiểu cũ); đổi chỗ id giữa hai secret.
9. Sửa 1 byte của tag / của bản mã / của `iv` → ném (mỗi cái một assert).
10. `secretAad(id, kv)` = UTF-8 `admin.secrets:${id}:${kv}`.
11. `isMasterKeyB64`: 43 ký tự + `=` giải ra 32 byte → true; 31 byte, 33 byte, thiếu `=`, ký tự url-safe (`-`, `_`), có xuống dòng cuối, rỗng, `"="` → false. `parseMasterKey` trả `{version:1, key: 32 byte}`; `parseMasterKey("x", 2).version === 2`.
12. Thông điệp lỗi của `parseMasterKey`/`decryptSecret` **không chứa** chuỗi đầu vào (khoá, plaintext, bản mã) — quét `message` bằng chuỗi marker.

**R3 `rules/secrets.rules.test.ts`** (5; M2-R05, M2-R02)
`secretLast4`: `"sk-LEAK-…a91d"` → `"a91d"`; `"12345678"` → `"5678"`; emoji `LEAK_EMOJI` → 4 code point nguyên vẹn (không cắt cặp thay thế); `"éabc…"`-kiểu ký tự tổ hợp đếm theo code point (`Array.from`). `checkSecretDelete([])` → null; `checkSecretDelete(["summarize","translate"])` → `{code:"SECRET_IN_USE", details:{used_by:["summarize","translate"]}}` (giữ thứ tự).

**R4 `rules/workflows.rules.test.ts`** (≈ 16; FR-13/14/15, FR-22, M2-R09/R11/R18)
- `isUnattached`: `(0,0)` true; `(1,0)`, `(0,1)`, `(2,3)` false.
- `checkWorkflowDelete`: không dùng → null; chỉ command **tắt** → lỗi (liệt kê); chỉ agent → lỗi; cả hai → `details {action:"delete", commands:[…đủ], agents:[…]}`.
- `checkWorkflowDisable`: chỉ command tắt, không agent → **null**; có command bật → `details.commands` **chỉ command bật**, `agents` đủ; chỉ agent → lỗi (`commands: []`); thứ tự đầu vào được giữ.
- `inputMapGaps`: `missing` theo thứ tự schema chỉ gồm `required`; input `required:false` thiếu không tính; `unknown` theo thứ tự khoá map; schema rỗng + map rỗng → `{[],[]}`.
- `findBrokenCommands`: bỏ command lành; sắp theo `name`; mỗi mục có `missing`/`unknown`.
- `checkSchemaChange`: không command hỏng → null; có → `SCHEMA_BREAKS_COMMANDS {commands}`; command **tắt** vẫn được tính.
- `changedWorkflowFields`: giống hệt → `[]`; mỗi trường đổi → đúng khoá đó (so tập, không phụ thuộc thứ tự mảng trả về); `input_schema` cùng nội dung mảng mới → `[]`; **đổi thứ tự** tham số → có `inputSchema`; `outputField` null ↔ chuỗi.

**R5 `rules/commands.rules.test.ts`** (≈ 26; FR-20/21/22, BR-01/02/06/10, M2-R13…R19)
- `commandNames` = `[name, ...aliases]`; `defaultTimeout` sync 30 / async 120.
- `checkInputMap`: đủ → rỗng; thiếu `target_lang` → `missing:["target_lang"]`; khoá `foo` không có trong schema → `unknown:["foo"]`; `arg` trỏ `lang` chưa khai báo → `unknown_args:["lang"]`, **không trùng lặp** (hai khoá cùng trỏ một tham số lạ → một phần tử), thứ tự theo khoá map; `source=const` không bị kiểm `unknown_args`; nhiều lỗi cùng lúc → đủ ba mảng.
- `inputMapError`: ba mảng rỗng → null; mỗi mảng riêng ≠ rỗng → `INPUT_MAP_INVALID` với đủ 3 khoá.
- **`inputMapWarnings`** (bảng, theo thứ tự schema; chỉ khoá có trong schema):
  | kiểu input | nguồn | cảnh báo |
  |---|---|---|
  | file | selection / page_text / const / arg | `type_mismatch` (trừ `arg`: không bao giờ cảnh báo) |
  | file | attachment | không |
  | text | attachment | `type_mismatch` |
  | number / boolean / select | selection, page_url, page_text, user_id, tenant_id | `type_mismatch` |
  | number | const `""`, `" "`, `"abc"`, `"Infinity"` | `const_invalid` |
  | number | const `"3"`, `"1e3"`, `"-2.5"` | không |
  | boolean | const `"True"`, `"1"` | `const_invalid`; `"true"`, `"false"` không |
  | select (options formal,casual) | const `"polite"` | `const_invalid`; `"formal"` không |
  | text | selection / page_url / const bất kỳ / user_id | không |
  | bất kỳ | arg | không |
  Khoá map không có trong schema → không cảnh báo (đó là `unknown`); thứ tự kết quả = thứ tự schema.
- `checkCommandFeatures([])` → `COMMAND_NEEDS_FEATURE` **không có `details`**; `["x"]` → null.
- `checkCommandEnable`: `(true, wf tắt)` → `WORKFLOW_DISABLED {workflow:{id,key}}`; `(false, wf tắt)` null; `(true, wf bật)` null; `(false, wf bật)` null.
- `changedCommandFields`: giống hệt → `[]`; `featureIds` cùng tập khác thứ tự → `[]`; `aliases` **đổi thứ tự** → có `aliases`; jsonb (`args`, `inputMap`, `description`, `output`) so sâu: khoá map đổi chỗ → `[]`; đổi `mode` không kéo theo `timeoutS`; mỗi trường đổi → đúng khoá đó.

**R6 `rules/features.rules.test.ts`** (≈ 20; FR-30/31/33/34, BR-10/12, M2-R19…R24)
- `CORE_FEATURE_KEY === "core"`, `isCore`.
- `checkFeatureStatus`: core × `undefined`/`"on"` → null; core × `"off"`/`"beta"` → `CORE_FEATURE_PROTECTED`; không phải core × cả ba trạng thái → null.
- `checkFeatureDelete`: core (kể cả có `exclusive`) → `CORE_FEATURE_PROTECTED` (ưu tiên trước); không core + `exclusive ≠ []` → `FEATURE_HAS_EXCLUSIVE_COMMANDS {commands}`; không core + `[]` → null.
- `checkEntitlementTarget`: core → `CORE_FEATURE_PROTECTED`; khác → null.
- `orphanedByRemoval`: `featureCount 1` → mồ côi; `2` → không; `0` → mồ côi; giữ thứ tự; `membershipError([])` null, `[x]` → `COMMAND_NEEDS_FEATURE {commands:[{id,name}]}`.
- `isFeatureEffective`: on, beta true; off false (R23).
- `diffIds`: thêm/bớt, sắp tăng dần, id trùng trong đầu vào không sinh trùng, hai tập bằng nhau → `{[],[]}`.
- `changedFeatureFields`: `commandIds` so như tập; `name` `{vi}` ↔ `{vi,en}` có đổi; `description` `{}` ↔ `{vi:""}`: **không** đổi (rỗng = vắng, theo `LocalizedOptional`); đổi `icon`/`status` → đúng khoá; giống hệt → `[]`.

**C1 `i18n-labels.test.ts`** (3; M2-R28, không DB; thêm mới — xanh ở FE2)
`vi.json` và `en.json` cùng tập key; mọi key trong `plan-frontend.md` §7 và `admin-missing-screens.md` §2, §3, §6 có giá trị VI **và** EN nguyên văn (bảng cố định trong test, kể cả `commands.error.mapMissing` = "thiếu input bắt buộc: {names}" dạng đã nội suy `target_lang`, `secrets.toast.replaced`, `features.revoke.title`, `workflows.delete.blocked`…); mọi nhãn e2e ở `plan-frontend.md` §5 xuất hiện làm giá trị đầy đủ trong `vi.json` ("+ Thêm secret", "+ Khai báo workflow", "+ Tạo command", "+ Tạo feature", "Hiện giá trị đang gõ"…; chú ý khớp từng ký tự). Không có key `*.test`, `*.history`, `workflows.checkConnection`, `workflows.fromDify` (nút bị bỏ: R28). Kèm `bun run i18n:check` exit 0.

### D. DB / RLS / mã hoá (owner + `admin_api`)

**D1 `db-schema.int.test.ts`** (≈ 17; ADM-NFR-06, ADM-FR-10/20/30/31/50, BR-01/02/10; ngoại lệ như M1-D2: chỉ owner + `resetTestDb` + `runMigrations`, **không** seed/app)
1. `runMigrations` development `{main:5, dev:2}`; lần 2 `{0,0}`.
2. Đúng **10** bảng `admin.*` (`command_names, commands, feature_commands, feature_entitlements, features, refresh_tokens, secrets, tenants, users, workflows`) + 3 bảng `hub.*` (`agent_grants, agent_workflows, usage_logs`); **không** có `config_meta, feature_grants, groups, group_members, audit_log, tenant_quotas`.
3. Production: `runMigrations({appEnv:"production"})` → `{main:5, dev:0}`; 10 bảng `admin.*`, **0** bảng `hub.*`.
4. **Migration cũ bất biến (CONVENTIONS §8):** sha256 của `migrations/0000*.sql`, `0001*.sql`, `0002*.sql` và `migrations-dev/0000_hub_stub.sql` bằng băm của chính các file đó ở **HEAD hiện tại** (qc tính và ghi hằng ở Q2; không dùng `a07984c`); tồn tại đúng `0003_admin_catalog.sql` và `0004_catalog_rls.sql`.
5. `secrets`: `secrets_name_uq` (`23505`); CHECK `name` (`dify_x`, `A`, 65 ký tự → `23514`); `iv` 11 byte → `23514`; `ciphertext` 23 byte và 6161 byte → `23514`, 24 và 6160 ok; `last4` 3 ký tự → `23514`, `LEAK_EMOJI` (4 code point) ok; `note` 201 ký tự; `key_version` 0; mặc định `key_version = 1`; **không có cột** `value`/`version`.
6. `workflows`: `workflows_key_uq`; CHECK `key`; `name` rỗng/129; `description` 19/401 ký tự → `23514` (20, 400 ok); `app_type='x'`; `base_url='ftp://x'`; `input_schema` không phải mảng; `output_field` rỗng/129; FK `secret_id` RESTRICT (xoá secret đang dùng → `23503`); mặc định `enabled true`, `input_schema '[]'`, `version 1`.
7. `commands`: `commands_name_uq`; CHECK `name`; `cardinality(aliases) = 6` → `23514` (5 ok); `description` thiếu khoá `vi` → `23514`; `mode='x'`; `timeout_s` 0/601; `args` không phải mảng; `input_map` không phải object; FK `workflow_id` RESTRICT (xoá workflow có command → `23503`); mặc định `mode 'sync'`, `timeout_s 30`, `aliases '{}'`, `enabled true`.
8. `command_names`: PK trùng `23505` (kể cả tên của command này trùng alias của command kia); CHECK regex; xoá command → CASCADE xoá hàng `command_names`.
9. `feature_commands`: PK `(feature_id, command_id)` `23505`; xoá feature **hoặc** command → CASCADE xoá hàng.
10. `feature_entitlements`: PK `23505`; xoá feature hoặc tenant → CASCADE; mặc định `granted_at` ≈ now, `revoked_at` null; FK `granted_by` `ON DELETE SET NULL` (xoá user → null).
11. `features.updated_by` tồn tại (FK `SET NULL`), `core` seed `updated_by` null; `workflows/commands/secrets.updated_by` FK `SET NULL` (xoá user không xoá hàng).
12. Chỉ mục (`pg_indexes`): `secrets_name_uq, workflows_key_uq, workflows_secret_idx, commands_name_uq, commands_workflow_idx, command_names_command_idx, feature_commands_command_idx, feature_entitlements_tenant_active_idx` (định nghĩa chứa `WHERE (revoked_at IS NULL)`).
13. Kiểu cột: `secrets.ciphertext/iv` là `bytea`; `last4` text; `commands.aliases` `text[]`; `description/args/input_map/output` jsonb.
14. `db:generate` không sinh gì thêm: kiểm bằng **lệnh** (mục 8), không bằng `it`.
15–17. Bất biến M1 còn nguyên trong schema mới: `tenants/users/refresh_tokens` không đổi cột; `hub.agent_workflows` có `agent_id`, `workflow_id` + chỉ mục `agent_workflows_workflow_id_idx`; `admin_rw` có `GRANT SELECT ON hub.agent_workflows` (stub dev) — để `usages` đọc được.

**D2 `db-rls.int.test.ts`** (≈ 13; ADM-NFR-07, ADM-BR-14, ADM-BR-04, ADM-FR-50/31; **M2-AC01 (phần DB), M2-AC02**) — owner chèn dữ liệu; truy vấn trực tiếp bằng `postgres` (`max:1`) với `admin_api`; scope đặt bằng `set_config(..., true)` trong `sql.begin`.
1. `admin_api`, **không đặt scope**: `count(*)` `admin.secrets` = 0; `admin.feature_entitlements` = 0.
2. scope `tenant` (acme): `secrets` **0 hàng**; `insert into admin.secrets` → `42501`; `update`/`delete` → 0 hàng (không lỗi).
3. scope `platform`: `insert … returning id, name`, `select id, name … for no key update`, `update … set ciphertext=…, iv=…, last4=…, note=… where name=…`, `delete … where name=…` đều chạy được.
4. scope `platform`: `select ciphertext from admin.secrets` → **`42501`**; `select iv` → `42501`; `select *` → `42501`; `select id,name,key_version,last4,note,created_at,updated_at,updated_by` ok; `returning ciphertext` → `42501`.
5. `has_column_privilege('admin_rw','admin.secrets','ciphertext','SELECT')` false, cùng với `iv`; `…'name'…` true; `has_table_privilege('admin_rw','admin.secrets','INSERT'/'UPDATE'/'DELETE')` true.
6. **`hub_ro` bị REVOKE:** `SET ROLE hub_ro` (từ owner) `select name from admin.secrets` → `42501`; `select id` → `42501`; `has_table_privilege('hub_ro','admin.secrets','SELECT')` false; `has_column_privilege('hub_ro','admin.secrets','last4','SELECT')` false; `insert/update/delete` → `42501`.
7. **PUBLIC bị REVOKE:** `relacl` của `admin.secrets` không có grantee `0` (`aclexplode`); role thăm dò `qc_probe_nologin` (owner tạo `NOLOGIN`, dọn ở `finally`) `SET ROLE` → `select name from admin.secrets` → `42501`.
8. **Quyền `hub_ro` trên catalog:** `select * from admin.workflows/commands/command_names/feature_commands/features` được (kể cả `base_url`, `input_schema`, `secret_id`); `insert/update/delete` các bảng đó → `42501`; Hub thấy `/dich` hiệu lực: join `commands ⨝ feature_commands ⨝ features(status in on,beta) ⨝ workflows(enabled)` trả đúng hàng `dich` (AC-A03 phía dữ liệu Hub, M2-R24).
9. `feature_entitlements` (RLS): scope `tenant` acme → chỉ hàng acme; `insert` cho globex → `42501`; scope `platform` thấy hết, ghi được; `tenant_id` rỗng/`'abc'` → 0 hàng hoặc lỗi, **không rò**; `SET ROLE hub_ro` → thấy **cả** tenant (`USING (true)`), `insert` → `42501`.
10. `relrowsecurity` đúng 5 bảng: `feature_entitlements, refresh_tokens, secrets, tenants, users` = true; `command_names, commands, feature_commands, features, workflows` = false; **không** bảng nào `relforcerowsecurity`.
11. Chính sách: `pg_policies` có `secrets_admin_rw`, `feature_entitlements_admin_rw`, `feature_entitlements_hub_ro` (đúng tên, đúng role áp dụng).
12. Không rò giữa hai transaction trên một kết nối: tx1 scope `platform` đọc được `secrets`; tx2 không scope → 0 hàng.
13. **M2-AC02 (đọc bằng owner):** ghi secret qua `INSERT` của `admin_api`, rồi owner `select ciphertext, iv` → `ciphertext` (hex, base64, utf8) **không chứa** plaintext; hai hàng cùng plaintext → `iv` khác, `ciphertext` khác. (Phần qua API: S.)

> Quét "không có bản sao giá trị ở bảng khác" cần API secrets nên **không** nằm ở D2 (xanh ở T2) mà ở `secrets-proc.int.test.ts` (SP.7, T3), để mỗi file xanh đúng task (mục 8.1). D2 ≈ 13 test.

### S. Secrets API (`secrets.int.test.ts`, int; ≈ 36; ADM-FR-50, BR-04, BR-14, NFR-01; AC-A06; M2-R01…R06)

Tạo secret bằng API; workflow tham chiếu dựng bằng owner SQL.
- **Tạo:** `POST {name:"DIFY_TRANSLATE_KEY", value: LEAK_1, note:"App Translate trên Dify prod"}` → 201 `SecretSchema`: có `id` (uuid v7), `last4 = LEAK_1.slice(-4)`, `used_by []`, `updated_by = "admin"`; response **không có** `value`/`ciphertext`/`iv`/`key_version`; `name` gửi chữ thường/dư khoảng (`" dify_x "`) → lưu `DIFY_X`; `note` rỗng → `null`.
- **Validate (400 `VALIDATION_ERROR`, không echo):** value 7 ký tự (`LEAK_SHORT`) · 2049 · thiếu · `name` `A`/`DIFY-KEY`/65 ký tự · `note` 201 · khoá lạ · JSON hỏng; `details.issues[]` chỉ có `path/code/message` (không có `input`/`received`); toàn bộ `text` response không chứa `LEAK_SHORT`.
- **Biên giá trị:** 8 ký tự ok; 2048 ok (`ciphertext` DB = 2048 + 16 byte ASCII); 2049 → 400; giá trị có khoảng trắng đầu/cuối **không bị trim** (owner giải mã bằng bản độc lập → đúng từng ký tự); `LEAK_EMOJI` ok, `last4 === "😀😀😀😀"`.
- **Trùng:** tạo lại cùng `name` (kể cả `dify_translate_key` viết thường) → 409 `SECRET_NAME_TAKEN`; DB vẫn 1 hàng, `ciphertext` không đổi.
- **PUT thay giá trị** `{value: LEAK_2}` → 200: `last4` mới, `id` **giữ nguyên**, `updated_at` đổi, `updated_by` đổi, `iv` và `ciphertext` mới; `used_by` giữ nguyên; `note` giữ nguyên; trường lạ (`note`) → 400; `:name` không tồn tại → 404; `:name` sai dạng (`dify_x`, `A`, `A B`) → 404 (không chuẩn hoá path).
- **PATCH ghi chú** `{note}` → 200: `ciphertext` và `iv` **byte-bằng** trước (owner so); `last4` giữ; `note:null` xoá ghi chú; 201 ký tự → 400; `value` trong body → 400; không `version`.
- **Xoá:** secret không dùng → 204, hàng biến mất (xoá thật); lấy lại `GET` không còn; không tồn tại → 404; đang có workflow tham chiếu → 409 `SECRET_IN_USE {used_by:["translate"]}` (sắp tăng dần khi nhiều workflow), DB giữ nguyên; thứ tự kiểm 404 → `SECRET_IN_USE`.
- **List:** `{items,total,counts}` sắp `name` tăng dần; `counts {all,used,unused}` **không đổi theo `?used=`**; `?used=true|false` lọc đúng; `?used=1` → 400; `q` khớp `name`/`note` ILIKE; `limit/offset/total`; `limit=201` → 400; mọi item parse `SecretSchema` strict; không có tham số nào (`?reveal=1`, `?include=value`, `?q=…`) làm xuất hiện giá trị (khoá lạ → 400).
- **M2-AC02 qua API:** sau `POST` bằng `LEAK_1`, owner đọc `ciphertext, iv, key_version, id`: (a) `ciphertext` không chứa plaintext; (b) **giải mã bằng bản độc lập** theo `plan.md` §3.2 (`iv` cột; tag = 16 byte cuối; AAD `admin.secrets:<id>:<key_version>`; khoá = base64-decode khoá của fixture) → đúng `LEAK_1`; (c) hai secret cùng giá trị → `iv`, `ciphertext` khác nhau; (d) PUT cùng giá trị cũ → `iv` đổi; (e) **khoá khác** → `createDecipheriv` ném; (f) **AAD sai** (id khác / `key_version` 2 / thiếu tiền tố) → ném; (g) `key_version = 1`.
- **`admin_api` không đọc được bản mã:** kết nối `admin_api` scope `platform` `select ciphertext` → `42501` (kể cả sau khi tạo qua app).
- **Rò secret qua API (AC-A06, BR-04)** — sau chuỗi tạo → thay → sửa ghi chú → xoá lỗi (400, 404, 409, trùng): mỗi response (200/201/204/400/404/409) `text` + `headers` **không chứa** `LEAK_1`, `LEAK_2` (thô/base64/hex); `GET /admin/secrets?…` mọi biến thể; ghép với workflow: `GET /admin/workflows`, `GET /admin/workflows/:id` (T5, kiểm ở W) chỉ có `secret:{id,name}`.
- **Không dùng khoá khác ngoài fixture:** app dựng **không** có `secretKey` (`createApp` không truyền) → `POST /admin/secrets` → 500 `INTERNAL_ERROR` (body không có giá trị, không có stack) — đúng `plan.md` §3.2; **`GET` vẫn 200** (đọc không cần khoá).
- **Đồng thời:** hai `POST` cùng `name` song song ×10 vòng → đúng 1×201 + 1×409 `SECRET_NAME_TAKEN`; PUT ∥ PATCH ghi chú cùng secret → cả hai 200, kết quả cuối có **cả** giá trị mới (`last4`) **và** ghi chú mới (hai thao tác không giẫm nhau); DELETE ∥ `POST workflow` (owner SQL) tham chiếu → chỉ khẳng định **bất biến: không có workflow mồ côi** (không workflow nào trỏ secret đã xoá); không khẳng định mã lỗi của bên thua.

### SP. Secrets · tiến trình (`secrets-proc.int.test.ts`, proc, cổng 3093; ≈ 9; ADM-FR-50, NFR-01, NFR-06, AC-A06)
Spawn `bun apps/admin-api/src/server.ts`, env như M1-A8 + `SECRET_MASTER_KEY` sinh trong test (khoá `KEY_TEST`).
1. **Thiếu `SECRET_MASTER_KEY`** → thoát ≠ 0 trong hạn chót; đầu ra nêu đúng tên `SECRET_MASTER_KEY`; không lắng nghe cổng.
2. **Sai định dạng** (mỗi lần một lần spawn): 31 byte base64, 33 byte, 44 ký tự có `=`, url-safe (`-_`), có khoảng trắng, chuỗi `"abc"` → thoát ≠ 0; đầu ra nêu tên biến và **không chứa** giá trị đã đặt (marker).
3. Khoá hợp lệ → `/health` 200; đăng nhập `admin` (seed) + `POST /admin/secrets` qua HTTP thật → 201.
4. **Log không rò (AC-A06):** sau tạo (`LEAK_1`), thay (`LEAK_2`), sửa ghi chú, xoá, 400 (`LEAK_SHORT`), 409 trùng, 404 `:name` lạ, 403 (`tenant_admin`) → gộp **stdout + stderr** của tiến trình không chứa: `LEAK_*` (thô/base64/hex), giá trị `SECRET_MASTER_KEY`, token truy cập, header `Authorization`, `ciphertext`.
5. Dòng log request của `/admin/secrets*` chỉ có method/path/status/`X-Request-Id` (không body, không header). Test gửi `GET /admin/secrets?q=QUERY-MARKER-91` và kiểm `QUERY-MARKER-91` **không** xuất hiện trong log (mặc định: log path không kèm query, G7).
6. Khoá của tiến trình ≠ khoá đã mã hoá (restart với khoá khác `KEY_OTHER`, cùng DB): `GET /admin/secrets` vẫn 200 (không giải mã); `PUT` vẫn tạo bản mã mới bằng khoá mới — **không** có route giải mã nào (`GET /admin/secrets/:name` → 404; `/admin/secrets/:name/value`, `/reveal`, `/export` → 404).
7. **Quét toàn DB (AC-A06, BR-04):** sau toàn bộ luồng trên, owner `select row_to_json(t)::text` cho **mọi** bảng `admin.*` + `hub.*` không chứa `LEAK_1`/`LEAK_2` dạng thô, base64, hex (bản mã không chứa plaintext).
8. Không có route `POST /admin/commands/:id/test`, `/admin/workflows/:id/test-connection`, `/admin/workflows/:id/dify-schema` (platform_admin → 404 `NOT_FOUND`) — M2 không làm FR-12/FR-23 (tag `ADM-FR-12`, `ADM-FR-20`).
9. Nhắc lại đồng bộ: SIGTERM → thoát sạch, không treo kết nối.

### F. Features API (`features.int.test.ts`, int; ≈ 40; ADM-FR-30/31/33/34, BR-06, BR-10; M2-AC04/05; M2-R19…R22, R24, R25)
Command dựng bằng owner SQL (+ `command_names`, `feature_commands`).
- **Tạo:** `POST {key:"ke-toan", name:{vi:"Kế toán"}, status:"on", command_ids:[dich, tom-tat]}` → 201 `FeatureDetailSchema`; `icon:"package"` mặc định; `description:{}`; `commands` sắp `name`, mỗi mục có `feature_count`, `enabled`; `tenant_count 0`; `is_core false`; `version 1`; **`version` của `dich`, `tom-tat` tăng 1** (đọc `GET /admin/commands/:id` ở T6; ở T4 đọc bằng owner); `key` hoa/dấu/1 ký tự/33 ký tự → 400; `name.vi` 65 ký tự / rỗng → 400; `icon` `Package` → 400; `command_ids` chứa uuid lạ → 400 `INVALID_REFERENCE {field:"command_ids", ids:[…]}` và **không** tạo feature; trùng key (`CORE`, `Ke-Toan` sau chuẩn hoá) → 409 `KEY_TAKEN` message "Key is already taken".
- **Đọc:** `GET /:id` → `FeatureDetail` với `affected_user_count` đúng (core: mọi tenant = 11 user active theo fixture M1; `ke-toan` entitled acme → 6; thu hồi → trừ); `:id` lạ/`abc` → 404 `NOT_FOUND` (body giống byte).
- **List:** sắp `core` đầu rồi `key`; `command_count`, `tenant_count` (entitlement chưa thu hồi; core = 0), `is_core`; `counts {all,on,beta,off}` **không đổi theo `?status=`**; `?status=beta`; `q` khớp `key`/`name.vi`/`name.en`; `status=disabled` → 400; `icon` null trong DB → trả `"package"`.
- **PATCH & `version`:** `{version:1, name:{vi:"Kế toán 2"}}` → 200 `version 2`; `version` cũ → 409 `VERSION_CONFLICT` (parse bằng `versionConflictDetailsSchema(FeatureDetail)`, `details.updated_at === details.current.updated_at`); không đổi gì → 200 bản hiện tại, **`version` không tăng**, `updated_at` không đổi; body có `key` → 400; thiếu `version` → 400; `name.en` rỗng → bỏ khoá; `status` `on→off→beta→on` lần lượt 200, mỗi lần `version+1`; **tắt feature không sửa `enabled` của command** (BR-06, M2-R24: command trong feature vẫn `enabled` như cũ, hàng không bị xoá).
- **`core` được bảo vệ (M2-R20):** `PATCH core {status:"off"}` / `{status:"beta"}` → 409 `CORE_FEATURE_PROTECTED`; `{status:"on"}` → 200 không đổi; `PATCH core {name:{vi:"Cơ bản 2"}, icon:"home", description:{vi:"…"}}` → 200 (sửa được tên/mô tả/icon); `DELETE core` → 409 `CORE_FEATURE_PROTECTED` (kể cả khi `core` rỗng), DB còn `core`; thứ tự `CORE_FEATURE_PROTECTED` thắng `INVALID_REFERENCE` (core + `command_ids` lạ → 409).
- **`command_ids` thay cả tập (Y2):** feature chứa {A,B} `PATCH command_ids:[B,C]` → có {B,C}; A bị bỏ; `version` command A, C **tăng**, B không; `feature.version` tăng; id lạ → 400 `INVALID_REFERENCE`; không đổi tập → không tăng.
- **BR-10 không mồ côi:** `PATCH command_ids` bỏ command chỉ thuộc feature này → **400** `COMMAND_NEEDS_FEATURE {commands:[{id,name}]}` (đủ các command mồ côi), **DB không đổi** (không ghi nửa chừng); command còn feature khác → bỏ được; thứ tự `INVALID_REFERENCE` → `COMMAND_NEEDS_FEATURE` (id lạ + mồ côi cùng lúc → `INVALID_REFERENCE`).
- **Xoá (M2-R21):** feature có command **chỉ** thuộc nó → 409 `FEATURE_HAS_EXCLUSIVE_COMMANDS {commands:[{id,name}]}`, DB giữ nguyên; feature mà mọi command còn feature khác → 204, `feature_commands` + `feature_entitlements` của nó **bị xoá theo**, command còn nguyên; `core` xem trên; xoá `thu-nghiem` rỗng → 204; `:id` lạ → 404.
- **Entitlement (M2-AC05, M2-R22):** `PUT /features/:id/entitlements/:tenant_id` → 200 `Entitlement` (`granted_by = "admin"`, `tenant_active`, `active_user_count`); gọi lần 2 → 200 **không ghi** (`granted_at` không đổi); `GET …/entitlements` → `{items,total}` chỉ hàng chưa thu hồi, sắp `tenant_key`, phân trang, `q` khớp key/tên; **DELETE** → 204 và hàng **còn trong DB** với `revoked_at` ≠ null (owner kiểm, không xoá); list không còn tenant đó; DELETE lần 2 / DELETE khi chưa cấp → 204 không ghi (`revoked_at` giữ nguyên); **cấp lại** → **cùng hàng** (PK không đổi, đúng 1 hàng cho `(feature,tenant)`), `revoked_at null`, `granted_at` mới ≥ trước, `granted_by` mới; tenant khoá (`zeta`) vẫn cấp được; feature lạ/tenant lạ → 404 (feature lạ ưu tiên, body y hệt); **core**: `PUT`/`DELETE` → 409 `CORE_FEATURE_PROTECTED`; `GET …/entitlements` của core → `{items:[], total:0}`; entitlement **không** tăng `version` feature.
- **Hiệu lực và đếm:** `tenant_count` tăng/giảm theo cấp/thu hồi (bằng `GET /admin/features`); thu hồi không làm mất grant M3 (kiểm: hàng còn, chỉ `revoked_at`).
- **Version hai chiều:** tạo/xoá command (owner SQL + gọi service không có ở T4 → kiểm bằng `features.int` ở phần "command_ids" và ở `commands.int` T6).
- **Không có route** `grant`/`groups`/`beta-testers` (M3): `POST /admin/features/:id/grants` → 404.
- **Đồng thời (bất biến, không tất định về thứ tự — G8):** 15 PATCH song song cùng `version` → 1×200, 14×409 `VERSION_CONFLICT`; `PUT` entitlement song song ×10 → tất cả 200, đúng **1 hàng**; `PUT` ∥ `DELETE` cùng cặp → 1 hàng, `revoked_at` null hoặc ≠ null (cả hai hợp lệ), không lỗi 500.

### W. Workflows API (`workflows.int.test.ts`, int; ≈ 40; ADM-FR-10/11/13/14/15, BR-06, BR-13, AC-A05, AC-A13, M2-AC06/07/08; M2-R07…R12, R18, R25)
Secret/command/agent dựng bằng owner SQL.
- **Tạo:** `POST` đầy đủ (`key:"translate"`, `name`, mô tả 40 ký tự, `app_type:"workflow"`, `base_url:"https://dify.example.com/v1"`, `secret_id`, `input_schema` 3 tham số, `output_field:"text"`) → 201 `WorkflowSchema`; `enabled true`, `unattached true`, `command_count 0`, `agent_count 0`, `secret:{id,name}`, `updated_by "admin"`, `version 1`; response **không** có khoá `ciphertext/value/iv` ở bất cứ chỗ nào (quét `LEAK`).
- **M2-AC07 (R07/R08):** mô tả **19 ký tự → 400**, **20 → 201** (đã trim), **400 → 201**, **401 → 400**; mô tả 20 ký tự gồm dấu cách đầu/cuối → tính sau trim; tham số **thiếu mô tả** → 400 `VALIDATION_ERROR` (`path` `input_schema.0.description`); `select` thiếu `options` → 400; `options` ở kiểu `text` → 400; tên tham số trùng → 400; 51 tham số → 400; `name` tham số `a-b` → 400.
- **Khác:** `key` sai/trùng (`KEY_TAKEN` "Key is already taken", cả `TRANSLATE` viết hoa); `base_url` `ftp://`, có userinfo → 400; `secret_id` không tồn tại → 400 `INVALID_REFERENCE {field:"secret_id", ids}` **không tạo**; `secret_id` không phải uuid → 400 `VALIDATION_ERROR`; không có `secret_id` → 400; `app_type` lạ → 400.
- **AC-A13 / R09:** `report-tax` (không command, không agent) tạo được; `unattached true`; `GET ?attached=false` có `report-tax`, **không** có `translate` (có command); `attached=true` ngược lại; `counts.unattached` đúng và **không đổi theo `?status=`/`?attached=`**; workflow có **chỉ command tắt** vẫn `unattached=false`; workflow có **chỉ agent** (owner chèn `hub.agent_workflows`) `unattached=false`; không tồn tại route cấp quyền cho workflow (`POST /admin/workflows/:id/grants` → 404; BR-13); `usages` của `report-tax` = rỗng.
- **R10 / FR-15 (usages):** `GET /:id/usages` → `commands:[{id,name,enabled}]` sắp `name`, `agents:[{id}]` sắp `id`, `command_count`, `agent_count`, `agents_available true`; list trả `command_count/agent_count/unattached` đúng và gộp trong **một** câu cho trang (kiểm không N+1 bằng đếm số truy vấn của lần gọi list ≤ hằng nhỏ nếu `deps` có hook đếm; nếu không có hook → backend-lead giữ `perf` — G9).
- **AC-A05 / M2-R11 / M2-AC06:** `translate` có command `dich` (bật) và agent `…02a1`: `DELETE` → **409 `WORKFLOW_IN_USE`**, `details {action:"delete", commands:[{id,name:"dich",enabled:true}], agents:[{id:"…02a1"}]}` — **cả command lẫn agent** — và workflow còn nguyên; chỉ command tắt → `DELETE` vẫn 409 (xoá chặn cả command tắt); không command, không agent → 204 (xoá thật, `GET` → 404); `PATCH {enabled:false}` khi còn command **bật** → 409 `WORKFLOW_IN_USE {action:"disable", commands:[chỉ command bật], agents}`; chỉ có command **tắt** và không agent → `PATCH {enabled:false}` → **200** (sau khi tắt command trước, tắt workflow thành công); có agent (command đều tắt) → vẫn 409 `disable` với `agents`; `PATCH {enabled:true}` luôn 200; thứ tự: `INVALID_REFERENCE` → `WORKFLOW_IN_USE` → `SCHEMA_BREAKS_COMMANDS`; **BR-06:** workflow tắt vẫn còn hàng, `GET` được, `enabled=false`, command trỏ vào giữ nguyên.
- **`agents_available` (R12, A5)** — 3 ca với **bảng hub vắng/không đọc được** (mỗi ca khôi phục trong `finally`; afterAll kiểm bảng + GRANT còn nguyên; không `DROP`):
  1. owner `ALTER TABLE hub.agent_workflows RENAME TO agent_workflows_qc` (`to_regclass` NULL) → `GET /:id/usages` → 200 `{agents:[], agent_count:0, agents_available:false}`, `commands` vẫn đúng; list vẫn 200, `agent_count 0`; `DELETE` workflow không command → 204 (không 500); `PATCH enabled:false` không command → 200.
  2. owner `REVOKE SELECT ON hub.agent_workflows FROM admin_rw` (bảng còn nhưng không đọc được) → như 1.
  3. Khôi phục xong → `agents_available:true` và `agents` lại có `…02a1` (**không cache**: đổi trạng thái giữa hai request liên tiếp, kết quả đổi theo).
- **R18 / M2-AC08 (`SCHEMA_BREAKS_COMMANDS`):** `translate` input `source_text`,`target_lang` bắt buộc; `dich` map đủ. `PATCH input_schema` **xoá** `target_lang` → 409 `{commands:[{id,name:"dich",missing:[],unknown:["target_lang"]}]}`, DB không đổi (`version` giữ); **đổi tên** `target_lang→lang` → 409 (`missing:["lang"]`, `unknown:["target_lang"]`); **thêm** biến **bắt buộc** `style` chưa map → 409 `missing:["style"]`; thêm biến **không bắt buộc** → 200; đổi `type`/`description` của biến đang map → 200; command **tắt** vẫn bị tính; nhiều command hỏng → liệt kê đủ, sắp `name`; không command nào → 200.
- **PATCH & `version`:** `version` cũ → 409 `VERSION_CONFLICT` (`versionConflictDetailsSchema(Workflow)`); không đổi gì → 200 không tăng; `key` trong body → 400; đổi `secret_id` sang secret lạ → `INVALID_REFERENCE`; `output_field:null` xoá; `version` tăng với mỗi trường trong danh sách spec §3 (`name, description, app_type, base_url, secret_id, input_schema, output_field, enabled`) — mỗi trường một assert; đổi `input_schema` chỉ thứ tự → tăng.
- **List:** `{items,total,counts {all,on,off,unattached}}` sắp `key`; `?status=on|off`, `?secret=DIFY_TRANSLATE_KEY` (viết thường `dify_translate_key` cũng khớp), `?secret=KHONG_CO` → rỗng; `?attached=` bool strict; `q` khớp `key/name/description`; `limit=201` → 400; mỗi item parse `WorkflowListItemSchema`.
- **Không rò secret:** `GET /admin/workflows`, `GET /:id`, `GET /:id/usages` quét `LEAK_1` (secret đã tạo với giá trị đó qua owner-SQL **không** thể có plaintext; nên test dùng secret tạo bằng **API** `POST /admin/secrets` ở file này cho ca quét) → không xuất hiện.
- **Không có route** "Kiểm tra kết nối"/"Lấy từ Dify" (404, tag `ADM-FR-12`).
- **Đồng thời:** 15 PATCH cùng `version` → 1×200 + 14×`VERSION_CONFLICT`; `DELETE` ∥ `POST` workflow cùng `key` không xảy ra (khác key) — xem K cho workflow ∥ command.

### C. Commands API (`commands.int.test.ts`, int; ≈ 50; ADM-FR-20/21/22, BR-01/02/06/10, AC-A03, M2-AC03/04/06; M2-R13…R19, R25)
Workflow/feature dựng bằng owner SQL **hoặc** API (T4, T5 đã xong) — chỉ dùng API khi chính hành vi đó được kiểm (version hai chiều).
- **Tạo hợp lệ:** `POST {name:"dich", aliases:["tr"], description:{vi:"Dịch văn bản"}, workflow_id: translate, args:[{name:"text",description:{vi:"Văn bản"},rest:true}…], input_map:{source_text:{source:"arg",value:"text"}, target_lang:{source:"const",value:"vi"}}, output:{field:"text",render:"markdown"}}` → 201 `CommandSchema`: **`feature_ids` mặc định `[id của core]`**, `features:[{key:"core",…}]` (core đầu), `mode:"sync"`, `timeout_s:30` (async → 120), `enabled true`, `warnings []`, `version 1`, `updated_by "admin"`; `command_names` có đúng 2 hàng (`dich`, `tr`).
- **AC-A03 (vế Admin) / M2-R17:** workflow `translate` bắt buộc `source_text`, `target_lang`: `POST /dich` với `input_map` **thiếu `target_lang`** → **400 `INPUT_MAP_INVALID`**, `details = {missing:["target_lang"], unknown:[], unknown_args:[]}` (đủ 3 khoá), `message === "Invalid input map"`, **không tạo command** (DB không có `dich`, không có `command_names`); map **đủ** + `feature_ids` mặc định `core` → 201; `GET /admin/commands` có `/dich` bật, trong feature `core`; dữ liệu Hub đọc (`hub_ro`) có `dich` (D2.8). Ghi chú: "≤ 5 giây trong menu `/`" **không kiểm** (Hub/M3, M2-R24); chuỗi "thiếu input bắt buộc: target_lang" kiểm ở e2e.
  - khoá map `foo` không có trong workflow → `unknown:["foo"]` (400); `arg` trỏ `lang` chưa khai báo → `unknown_args:["lang"]` (400); cả ba cùng lúc → đủ ba mảng; input **không bắt buộc** (`tone`) thiếu → ok; **map sai kiểu chỉ cảnh báo, vẫn lưu:** `invoice_file` (file) ← `selection` → 201 + `warnings:[{var:"invoice_file",type:"file",source:"selection",reason:"type_mismatch"}]`, command **được lưu**; `GET /:id` trả lại cùng `warnings` (tính lại, không lưu: đổi `input_schema` bằng owner làm cảnh báo đổi theo ở lần `GET` sau); `const` `"abc"` cho input `number` → `const_invalid`; `PATCH` sửa vẫn nhận cảnh báo.
- **Tên/alias chung không gian tên (BR-01, M2-AC03, R13):** tạo `dich` khi `dich` là **alias** của command khác (alias `dich`, tên `translate-x`) → 409 `COMMAND_NAME_TAKEN {name:"dich"}`; alias mới trùng **tên** command khác → 409; alias trùng alias command khác → 409; `name` trùng alias **của chính nó** (`name:"tr", aliases:["tr"]`) → 400 `VALIDATION_ERROR`; 6 alias → 400; alias trùng nhau → 400; `Dich`/`  DICH ` → chuẩn hoá `dich`; `có-dấu`, `a_b`, `d` → 400; tên trùng khác loại (tên ↔ alias) cả hai chiều; `details.name` = tên **đầu tiên** bị trùng theo thứ tự `[name, ...aliases]`; `message` cố định không chứa tên; `PATCH` đổi alias giải phóng tên cũ (tạo command khác dùng được tên cũ ngay) và đồng bộ `command_names` (xoá cái bỏ, thêm cái mới, trong một giao dịch: lỗi trùng giữa chừng → `command_names` **không đổi**); `DELETE` command giải phóng cả tên và alias; sửa lại về chính tên mình không tự xung đột.
- **Workflow (BR-02, R14):** `workflow_id` bắt buộc; không tồn tại → 400 `INVALID_REFERENCE {field:"workflow_id"}`; đổi sang workflow khác (map còn khớp) → 200; **workflow tắt:** `POST enabled:true` → 409 `WORKFLOW_DISABLED {workflow:{id,key}}`; `POST enabled:false` → 201; `PATCH enabled:true` khi workflow tắt → 409; command **tắt** sửa mô tả khi workflow tắt → 200; workflow bật lại → `PATCH enabled:true` 200; nhiều command dùng chung một workflow ok.
- **Feature (BR-10, M2-AC04, R19):** `feature_ids:[]` → **400 `COMMAND_NEEDS_FEATURE`** (không `details`), không tạo; `PATCH feature_ids:[]` → 400, DB không đổi; `feature_ids` có uuid lạ → 400 `INVALID_REFERENCE {field:"feature_ids", ids}`; `feature_ids` trùng → 400 `VALIDATION_ERROR`; gán hai feature (`core`,`ke-toan`) → `features` đủ, `core` đầu; bỏ `ke-toan` còn `core` → ok; feature `off` vẫn gán được (command không đổi `enabled`).
- **Thứ tự kiểm (spec §3)** — mỗi ca đưa nhiều lỗi cùng lúc, kiểm đúng mã: `feature_ids:[]` + workflow lạ → `COMMAND_NEEDS_FEATURE`; workflow lạ + tên trùng → `INVALID_REFERENCE`; feature lạ + tên trùng → `INVALID_REFERENCE`; tên trùng + map thiếu → `COMMAND_NAME_TAKEN`; map thiếu + workflow tắt (`enabled:true`) → `INPUT_MAP_INVALID`; role/parse/404/`version`: `PATCH` với body sai + `:id` lạ → **404 hay 400?** → theo spec "parse → 404": body sai ⇒ `VALIDATION_ERROR` trước; id lạ + body đúng → 404; `version` cũ + luật vi phạm → `VERSION_CONFLICT`; không đổi gì (body trùng hiện trạng) → 200 **dù** workflow hiện đã tắt.
- **`version` & hai chiều (R25):** `POST` command với `feature_ids:[core, ke-toan]` → `GET /admin/features/:id` của cả hai có **`version` +1**; `PATCH` command đổi **chỉ** `description` → features **không đổi** `version`; `PATCH` đổi `feature_ids` (bỏ `ke-toan`) → `ke-toan` +1 (`version` feature `core` không đổi); `DELETE` command → mọi feature chứa nó +1; `version` command tăng với mỗi trường trong danh sách (`name, aliases, description, workflow_id, args, input_map, output, mode, timeout_s, enabled`, **tập feature**) — mỗi trường một assert; đổi chỉ thứ tự `aliases` → tăng; đổi thứ tự khoá `input_map` → **không** tăng; cùng tập `feature_ids` thứ tự khác → không tăng; không đổi gì → không tăng, `updated_at` giữ; `version` cũ → 409 `VERSION_CONFLICT {current: Command, updated_at}`; **editor Feature mở trước → command được tạo trong feature → `PATCH feature` bằng `version` cũ → 409** (chống ghi đè hai phía: ca chuẩn của "tăng `version` cả hai phía, gây 409").
- **Đọc/list:** `GET /:id` đủ `args`, `input_map`, `output`, `timeout_s`, `feature_ids`, `warnings`; list `{items,total,counts {all,on,off}}` sắp `name`; `?status=on|off`, `?feature=<uuid>`, `?workflow=<uuid>` (theo **id**), `?feature=abc` → 400, `?workflow=<uuid lạ>` → rỗng; `counts` **không đổi theo `?status=`**; `q` khớp `name`, **mọi alias**, `description.vi`/`description.en`; `limit=201` → 400; item parse `CommandListItemSchema` (có `workflow:{id,key,name,enabled}`, `features:[{id,key,name,status}]`).
- **Timeout/mode/args (R15):** `timeout_s` 0/601 → 400; 1 và 600 ok; vắng + `mode:"async"` → 120; đổi `mode` không tự đổi `timeout_s`; `args` hai `rest`/`rest` không cuối/tên trùng → 400; 21 tham số → 400; `description.vi` rỗng/201 → 400; `en` rỗng bỏ khoá; `output.field` thiếu → 400; `const` 4001 → 400.
- **Xoá:** `DELETE` → 204, cascade `command_names` + `feature_commands`; `GET` → 404; lần 2 → 404; workflow và feature không bị xoá; `usages` của workflow sau xoá không còn command.
- **Nhân bản:** không có endpoint; luồng `GET` rồi `POST` với `name:"dich-copy"`, `enabled:false` → 201, `aliases` rỗng (alias trùng sẽ 409).
- **BR-06 / A8 (âm):** `POST /admin/commands/:id/test` → 404 (platform_admin); không có `/admin/commands/:id/history`.
- **Phụ thuộc không bị rò secret:** `GET /admin/commands*` không chứa `LEAK_1` (workflow trỏ secret tạo bằng API).

### A. "Ai dùng được" (`access.int.test.ts`, int; ≈ 9; ADM-FR-24, ADM-BR-10/12; M2-R22/R23/R24) — T6
Fixture mục 3 đầy đủ. `GET /admin/commands/:id/access`:
1. `dich` (feature `core`) → **mọi tenant** (`total 4`: platform, acme, globex, zeta) sắp `tenant_key`; mỗi item `features:[{key:"core"}]`; `active_user_count` platform 2 · acme 6 · globex 3 · zeta **0** (`locked_by_tenant`); `tenant_active` zeta `false`; `command_active true`.
2. `tr-nhanh` (feature `dich-thuat`, entitlement acme; command **tắt**) → chỉ acme; `command_active false`.
3. `kiemtra-hoadon` (`ke-toan`: acme còn, globex **thu hồi**) → chỉ acme (không globex).
4. `xuat-bao-cao` (`bao-cao` = **beta**, ent acme; workflow tắt) → acme (beta tính hiệu lực) với `command_active false` (command tắt ∨ workflow tắt).
5. Command chỉ thuộc `thu-nghiem` (**off**, ent acme) → `items []`, `total 0`.
6. Command trong `core` và `ke-toan` → acme có **cả hai** feature; globex chỉ `core`.
7. Thu hồi entitlement (qua API T4) → tenant biến mất khỏi access; cấp lại → xuất hiện lại; tắt feature `ke-toan` (`status:"off"`) → biến mất, bật lại → trở lại; **không đổi `enabled` của command**.
8. Phân trang/lọc: `limit=2&offset=2`, `total` đúng; `q=ac` khớp `acme` theo key/tên (ILIKE); `limit=201`/`offset=-1` → 400; `:id` lạ/`abc` → 404; không có phần group/grant (M3: không có khoá `groups`, `grants` trong response — schema strict).
9. Không có endpoint Hub: `GET /admin/commands/:id/effective` → 404.

### X. Phân quyền (`forbidden.int.test.ts`, int; ≈ 30; ADM-BR-14, ADM-NFR-07; **M2-AC01**) — T6 (cần mọi route)
Bảng **25 route** M2 (secrets 5 · workflows 6 · commands 6 · features 8), mỗi route một `it` (`it.each`-style liệt kê tường minh, mỗi dòng tên `ADM-BR-14 · M2-AC01 · <METHOD> <path>`):
- không Bearer → 401 `UNAUTHORIZED`; `member` (`an`) → 403 `FORBIDDEN`; `tenant_admin` (`binh`) → 403 `FORBIDDEN`, **với** (a) body hợp lệ, (b) body **sai** (role kiểm trước parse → vẫn 403 không phải 400), (c) `:id`/`:name`/`:tenant_id` **không tồn tại** hoặc không phải uuid (kiểm role trước tra thực thể → 403 không phải 404); DB không đổi sau các lần thử ghi; body 403 giống byte giữa id có thật và id lạ (không lộ tồn tại).
- Thêm (≈ 5): `tenant_admin` của tenant **khoá** (`zoe`, 401 do tenant khoá) → 401 không phải dữ liệu; token ký đúng nhưng claim `role:"platform_admin"` của user `member`/`tenant_admin` (DB đọc lại mỗi request) → 403; `platform_admin` bị hạ role bằng owner ngay giữa hai request → request sau 403; `platform_admin` → mọi route trả 2xx/4xx **nghiệp vụ** (không 403) — chỉ 1 ca đại diện/nhóm; `GET /admin/secrets` bằng `tenant_admin` → body không có tên secret nào (kiểm không rò dù lỗi).
- `tenant_admin` mở `/admin/features` v.v. không thấy catalog dù `features/commands/workflows` **không có RLS** (cách ly dựa vào role guard) — kiểm ghi chú: cách ly bảo đảm bằng `requireRole`, không bằng RLS (spec §4); nên mọi nhóm route phải có ca 403 riêng (đã có theo từng route).

### E. Mã lỗi M2 ↔ `API_ERRORS` (`error-codes.int.test.ts`, int; ≈ 14; FR-10/20/30/50, NFR-06) — T6
Bảng kịch bản `code → hàm gây lỗi` cho **11 mã mới** + 3 ca:
- Mỗi mã: HTTP == `API_ERRORS[code]`, body parse `ErrorResponseSchema`, `message` tiếng Anh in được (`^[\x20-\x7e]+$`) **cố định theo mã** (không chứa tên command/secret/key/giá trị: kiểm bằng chuỗi marker trong dữ liệu gây lỗi), `details` parse bằng schema strict tương ứng (`SECRET_IN_USE.used_by`, `INVALID_REFERENCE{field,ids}`, `WORKFLOW_IN_USE{action,commands,agents}`, `SCHEMA_BREAKS_COMMANDS`, `WORKFLOW_DISABLED{workflow}`, `COMMAND_NAME_TAKEN{name}`, `INPUT_MAP_INVALID` (đủ 3 khoá; `message === "Invalid input map"`), `COMMAND_NEEDS_FEATURE` (từ `/admin/commands*`: **không** có `details`; từ `PATCH /admin/features/:id`: `{commands:[{id,name}]}`), `FEATURE_HAS_EXCLUSIVE_COMMANDS{commands}`, `CORE_FEATURE_PROTECTED`, `SECRET_NAME_TAKEN`).
- `KEY_TAKEN` (workflow và feature): message `"Key is already taken"` (đổi từ M1), 409.
- `VERSION_CONFLICT` cho `Workflow`/`Command`/`FeatureDetail`: `versionConflictDetailsSchema(...)`, `updated_at === current.updated_at`.
- Test cuối: tập mã M2 đã chạy == `Object.keys(API_ERRORS)` trừ **23 mã M1** (hằng cố định trong test) — thêm mã vào contract mà thiếu kịch bản → đỏ.

### K. Đồng thời & khoá hàng (`concurrency.int.test.ts`, int; ≈ 10; ADM-FR-13/20/30, BR-01/10; M2-AC03; M2-R13, R19, R27; TECH-DEBT #13) — T6
Mỗi ca lặp **10 vòng** (reset dữ liệu mỗi vòng), chạy `Promise.all` qua `createApp` + `admin_api`. **Giới hạn không tất định:** thứ tự đến của request song song không điều khiển được từ test, nên mỗi ca chỉ khẳng định **bất biến sau loạt** và tập kết quả hợp lệ; ca có thể xanh dù lỗi còn (race không xảy ra mọi lần). Lỗi thật phải được backend-lead bắt bằng test dùng **hook** chèn độ trễ giữa "đọc/khoá" và "ghi" trong `apps/admin-api/src/lib/lock-order.int.test.ts` (như M1 review vòng 2) — **đề xuất G8**.
1. **M2-AC03:** hai `POST /admin/commands` cùng `name` → đúng 1×201, 1×409 `COMMAND_NAME_TAKEN`; DB: đúng 1 command, `command_names` đúng 1 hàng.
2. `POST` command A (tên `x`) ∥ `POST` command B (alias `x`) → đúng 1×201, 1×409; `command_names.name = x` thuộc về đúng command tạo thành công.
3. Command `C` ∈ {G,H}: `PATCH C feature_ids:[G]` ∥ `PATCH feature G command_ids` bỏ `C` (plan §5.1a) → tối đa 1 thành công; bất biến: **C còn ≥ 1 feature**; kẻ thua ∈ {409 `VERSION_CONFLICT`, 400 `COMMAND_NEEDS_FEATURE`}; không 500.
4. `POST` command `enabled:true` ∥ `PATCH workflow enabled:false` (plan §5.1b) → bất biến: **không có command bật trỏ workflow tắt**; kết quả hợp lệ ∈ {(201, 409 `WORKFLOW_IN_USE`), (409 `WORKFLOW_DISABLED`, 200)}.
5. `DELETE feature G` ∥ `PATCH C feature_ids:[G]` (C ∈ {G,H}) (plan §5.1c) → bất biến: C còn ≥ 1 feature; kết quả ∈ {(204, 400 `INVALID_REFERENCE`), (409 `FEATURE_HAS_EXCLUSIVE_COMMANDS`, 200)}.
6. `DELETE workflow` ∥ `POST command` trỏ vào → không command nào dangling; không cả hai cùng thành công; kẻ thua ∈ {409 `WORKFLOW_IN_USE`, 400 `INVALID_REFERENCE`}.
7. `DELETE secret` ∥ `POST workflow` trỏ vào → không workflow mồ côi; kẻ thua ∈ {409 `SECRET_IN_USE`, 400 `INVALID_REFERENCE`}.
8. 15 `PATCH` cùng `version` lên cùng command → 1×200, 14×409 `VERSION_CONFLICT`.
9. `PUT entitlement` ∥ `DELETE feature` → không hàng `feature_entitlements` thuộc feature đã xoá; phản hồi ∈ {200, 404}.
10. **Không deadlock:** chạy lẫn 3–7 mỗi vòng 20 lần; **không** response 500; `pg_stat_database.deadlocks` không tăng (owner `select pg_stat_force_next_flush()` rồi đọc `deadlocks` trước/sau); mỗi vòng xong < 900 ms (đo bằng điều kiện hoàn thành, không `sleep`).

### E-*. E2E (Playwright; nhãn nguyên văn; locale `vi-VN`, `Asia/Ho_Chi_Minh`)

Hạ tầng như M1 (mục E của M1 test-plan, G1): `workers:1`, mỗi file `beforeAll` gọi `resetCatalog()` qua `e2e/support/prepare-db.ts --reset-only`, spec `serial`; đăng nhập qua `loginUI`. **Không race điều hướng (bài học M1):** mọi lần bấm dẫn tới đổi route đều bọc `await Promise.all([page.waitForURL(...), click])` hoặc `await expect(page).toHaveURL(...)` **trước** khi tương tác tiếp; chờ API bằng `page.waitForResponse` đặt **trước** `click`; toast kiểm bằng `expect(page.getByRole("status")).toContainText(...)` (không `waitForTimeout`); hộp thoại mở bằng `expect(dialog).toBeVisible()`. Ca cần phiên: dùng `storageState` đã đăng nhập một lần/file để không tranh `refresh`.

**E-S `e2e/secrets.spec.ts`** (≈ 9; FR-50, BR-04, BR-14; AC-A06; M2-R03/R05) — `admin` (platform)
1. Menu: `admin` thấy `link "Secrets"`, `link "Workflows"`, `link "Commands"`, `link "Features"`; **`tenant_admin` (`binh`) count 0 cho cả bốn**; `binh` mở `/secrets` → `ForbiddenState`, và **không có request nào** tới `/admin/secrets` (lắng nghe `request`).
2. `/secrets`: `heading "Secrets"`, `table "Secrets"`, hàng `DIFY_TRANSLATE_KEY` hiện `•••• 7f3a`; chip `Tất cả 3` · `Đang dùng 2` · `Chưa dùng 1` (fixture: TRANSLATE và INVOICE đang dùng, OLD chưa dùng); lọc chip đổi URL `?used=`.
3. `+ Thêm secret` → `getByLabel("Tên")` gõ `dify new key` → hiện `DIFY_NEW_KEY` (chuẩn hoá HOA, dấu cách → `_`); `getByLabel("Giá trị")` điền `LEAK_1`; `button "Hiện giá trị đang gõ"` (`aria-pressed`) bật/tắt; `button "Lưu"` → toast `status` "Đã thêm DIFY_NEW_KEY"; hàng mới hiện `•••• ` + 4 ký tự cuối.
4. **Quét rò (AC-A06):** sau bước 3: `page.content()`, `localStorage`, `sessionStorage`, `document.cookie`, `location.href`, title, mọi toast đã thấy, `console` messages, và **mọi body response** của mọi request (`page.on("response")`) **không chứa `LEAK_1`**; request body chỉ chứa nó ở đúng `POST /admin/secrets`; tải HTML `/` và mọi `<script src>` (asset tĩnh) không chứa chuỗi rò (kiểm tĩnh).
5. Tên sai (`ab-`→ chuẩn hoá hợp lệ; `a` → lỗi "Chỉ dùng chữ HOA, số và _ (2–64 ký tự)"); giá trị rỗng → "Nhập giá trị secret"; tên trùng `DIFY_TRANSLATE_KEY` → inline "Tên secret đã tồn tại".
6. `menuitem "Thay giá trị"` → `dialog "DIFY_TRANSLATE_KEY"`, dòng "Giá trị hiện tại: •••• 7f3a …", `getByLabel("Giá trị mới")` **trống**, DependencyList "translate"; điền `LEAK_2` → `button "Lưu giá trị mới"` → toast "Đã thay giá trị DIFY_TRANSLATE_KEY · •••• " + `button "Xem các workflow dùng secret này"` → bấm → `toHaveURL` `/workflows?secret=DIFY_TRANSLATE_KEY`; quét rò lại với `LEAK_2`.
7. `menuitem "Sửa ghi chú"` → chỉ có `Ghi chú` (không có ô giá trị) → lưu → hàng đổi ghi chú, `•••• 7f3a` giữ nguyên.
8. Xoá: `DIFY_TRANSLATE_KEY` (đang dùng) → `alertdialog "Không xoá được DIFY_TRANSLATE_KEY"` liệt kê `translate` + `button "Đóng"`; `DIFY_OLD_KEY` → `alertdialog "Xoá DIFY_OLD_KEY?"` + `textbox "Gõ DIFY_OLD_KEY để xác nhận"` (nút Xoá disabled tới khi khớp) → toast "Đã xoá DIFY_OLD_KEY"; hàng biến mất.
9. EN: `button "English"` đổi tiêu đề/nhãn drawer sang EN ("Secrets", "+ Add secret"); không còn khoá i18n thô trên màn.

**E-W `e2e/workflows.spec.ts`** (≈ 10; FR-10/11/13/14/15; AC-A05, AC-A13, M2-AC07)
1. `/workflows`: `heading "Workflows"`, `table "Workflows"`, chip `radio "Tất cả"/"Bật"/"Tắt"/"Chưa gắn"` có số, hàng `report-tax` có `text "Chưa gắn"`; chip "Chưa gắn" lọc đúng (URL web **`/workflows?status=unattached`** theo plan-frontend D13; FE gọi API với `attached=false`, kiểm bằng `waitForResponse` URL chứa `attached=false`); `searchbox "Tìm theo tên, key, mô tả…"`.
2. `link "+ Khai báo workflow"` → form: bỏ trống → lỗi hiện khi bấm `button "Lưu"` và focus lỗi đầu; `textbox "Mô tả"` **19 ký tự → lỗi, 20 → hết lỗi, 400 ok, 401 lỗi** (câu `workflows.error.descLength`); Base URL `ftp://x` lỗi.
3. **AC-A13:** tạo `report-tax-2` (secret chọn bằng `combobox "Secret"`, `radiogroup "Loại"`, 1 tham số với `+ Thêm tham số`) → `waitForURL /workflows/<uuid>` → badge "Chưa gắn" ở header; quay lại danh sách thấy nhãn "Chưa gắn".
4. SchemaEditor: `textbox "Tên tham số 1"`, `combobox "Kiểu 1"` = `select` → xuất hiện `textbox "Lựa chọn 1"`; `checkbox "Bắt buộc 1"`; mô tả tham số rỗng → lỗi; `↑↓` đổi thứ tự (aria "Chuyển tham số 2 lên"); `button "Xoá tham số 1"`; thêm tới 50 → `+ Thêm tham số` disabled kèm câu giới hạn.
5. `tab "Model thấy gì"`: hiển thị preview đúng (tên = key, `required` đúng, select → enum), chỉ đọc; không có request nào.
6. **AC-A05:** `translate` có command `dich` + agent `…02a1` (owner SQL): `Thao tác khác` → `menuitem "Xoá"` → `alertdialog` "Không xoá được translate" liệt kê `link "/dich"` **và** "Agent …02a1" + `button "Đóng"`; workflow vẫn trong bảng; DB còn.
7. Xoá workflow không dùng (`report-tax`): `alertdialog "Xoá report-tax?"` + `textbox "Gõ report-tax để xác nhận"` + `button "Xoá workflow"` → biến mất; `tab "Đang được dùng bởi"` của `translate` hiện command + agent.
8. Tắt `translate` bằng `switch "Bật workflow"`/`menuitem "Tắt"` khi còn command bật → dialog chặn `workflows.blocked.disable`, công tắc quay lại **Bật**; `report-export` (không command bật) bật/tắt được.
9. `SCHEMA_BREAKS_COMMANDS`: xoá tham số `target_lang` ở editor `translate` + Lưu → Alert đỏ + DependencyList `/dich`; DB không đổi.
10. Không có nút "Kiểm tra kết nối" / "Lấy từ Dify" (`getByRole("button", {name: /Kiểm tra kết nối|Lấy từ Dify/})` count 0); `link "Tạo command từ workflow này"` → `toHaveURL` `/commands/new?workflow=<id>`.

**E-C `e2e/commands.spec.ts`** (≈ 12; FR-20/21/22/24; AC-A03; M2-R17/R19)
1. `/commands`: `heading "Commands"`, `table "Commands"`, hàng `/dich` có alias `tr`, `switch "Bật command /dich"`, `combobox "Feature"`, `combobox "Workflow"`, chip `Tất cả 5` `Bật 3` `Tắt 2`.
2. `switch` tắt `/dich` → toast "Đã tắt /dich" + `button "Hoàn tác"` (bấm trong 5 s → `/dich` bật lại, request `PATCH` kèm `version` mới); `switch "Bật command /xuat-bao-cao"` **disabled** khi workflow tắt (tooltip "Bật workflow report-export trước").
3. **Không có nút Test / Lịch sử:** `getByRole("button", {name: /Chạy thử|Test/})` count 0; `menuitem "Lịch sử"` count 0 (mở menu `Thao tác khác` kiểm) — M2 không làm FR-23.
4. `link "+ Tạo command"` → bước 1: `textbox "Tên command"` gõ `/Dịch` → hiện `dich` (bỏ `/`, thường, bỏ dấu); `textbox "Alias"` + `button "Thêm alias"`; `button "Bỏ alias tr"`; `combobox "Thêm feature"`, `button "Bỏ feature core"` (mặc định có `core`), bỏ hết → lỗi "Command phải thuộc ít nhất một feature"; tên trùng `dich` (đã có ở fixture) → "tên đã được dùng" (kiểm D7 và 409); sau đó đổi sang `dich-moi`.
5. **AC-A03 (UI):** (command đang tạo ở bước 4 với tên **`dich-moi`**) chọn `combobox "Workflow"` = `translate`; ở bước input map để `combobox "Nguồn của target_lang"` chưa chọn → bấm `button "Lưu"` → **không gửi request** (không có `POST` — `waitForRequest` bị từ chối trong hạn chót), `alert` chứa **"thiếu input bắt buộc: target_lang"**; hàng `target_lang` `aria-invalid`; map đủ → `Lưu` → `waitForURL /commands/<uuid>`, toast "Đã lưu".
6. 8 nguồn: `combobox "Nguồn của target_lang"` liệt kê "Tham số", "Đoạn bôi đen", "URL trang", "Nội dung trang", "File đính kèm", "ID người dùng", "ID tenant", "Giá trị cố định"; chọn "Tham số" → `combobox "Tham số của target_lang"` chỉ liệt kê tham số đã khai báo ở bước 3; "Giá trị cố định" → `textbox "Giá trị của tone"`; cú pháp BA `$args.lang` hiển thị cạnh.
7. **Sai kiểu chỉ cảnh báo:** `invoice-check` (`invoice_file` kiểu file) nguồn "Đoạn bôi đen" → biểu tượng cảnh báo + `aria-describedby`, `button "Lưu"` **vẫn lưu được** (201).
8. Đổi workflow ở command đã có map → Alert info liệt kê map bị bỏ (`commands.map.dropped`); input trùng tên tham số tự map `arg`.
9. Bước 5: `textbox "Output field"` điền sẵn `text` từ workflow; `radio "async"` → `spinbutton "Timeout (giây)"` đổi mặc định 120; nhập 601 → lỗi; `combobox "Hiển thị"`.
10. Nhân bản: `menuitem "Nhân bản"` → `/commands/new?from=` với tên `dich-copy`, **Tắt**, cùng feature, `button "Lưu"` → 201 (`enabled=false`); `button "Nhân bản"` trong editor tương tự.
11. Xoá: `menuitem "Xoá"` (`/tr-nhanh`) → `alertdialog "Xoá /tr-nhanh?"` + `textbox "Gõ tr-nhanh để xác nhận"` + `button "Xoá command"` → toast "Đã xoá /tr-nhanh".
12. `tab "Ai dùng được"` của `/dich`: bảng tenant (Mã công ty · Tên · Feature · số user) có `acme` 6 user, `globex` 3, `zeta` 0 (tổng "4 tenant · 11 user" ở trigger tab); khối nhóm/grant hiện "Chưa khả dụng"; tab khoá khi tạo mới; `INPUT_MAP_INVALID`/`COMMAND_NAME_TAKEN` từ server (chèn trùng bằng owner giữa lúc điền) hiển thị đúng câu.

**E-F `e2e/features.spec.ts`** (≈ 10; FR-30/31/33/34; BR-10; M2-AC04/05)
1. `/features`: `heading "Features"`, `table "Features"`; `core` có badge "Mặc định" + "Mọi tenant"; chip `Tất cả 5` `Bật 3` `Beta 1` `Tắt 1`; menu `⋯` của `core` **chỉ có "Sửa"**.
2. `link "+ Tạo feature"` → `textbox "Key"` (sai `Ke Toan` → lỗi), tên VI/EN (`tab "VI"`/`"EN"`), `radio "Bật"/"Beta"/"Tắt"`, `button "Lưu"` → `waitForURL`; sau khi lưu `textbox "Key"` `readOnly` + gợi ý "Key không đổi được sau khi tạo".
3. **Kill switch (FR-33):** `menuitem "Tắt"` của `ke-toan` → `alertdialog "Tắt Kế toán?"` nêu số command + số user ("… biến khỏi menu của 6 người …"), `button "Tắt feature"` → badge "Tắt"; command trong feature vẫn **Bật** ở `/commands`; `menuitem "Chuyển sang Beta"` → badge "Beta" (FR-34) + `radio "Beta"` hint "Chỉ group beta-testers thấy".
4. `core`: `radio` trạng thái disabled + hint `features.core.hint`; sửa tên lưu được.
5. Tab "Commands": `combobox "Thêm command"` thêm `/tom-tat`; `button "Bỏ /dich khỏi feature"` với command chỉ thuộc feature này → hàng đỏ "/dich sẽ không thuộc feature nào và biến khỏi menu" và **`button "Lưu"` bị chặn** (BR-10) với "Command phải thuộc ít nhất một feature"; command còn feature khác → bỏ được → lưu.
6. Xoá feature có command độc quyền (`dich-thuat` chứa `/tr-nhanh`) → dialog "Không xoá được Dịch thuật…" liệt kê `/tr-nhanh`; `thu-nghiem` (rỗng) → `alertdialog` gõ key → xoá.
7. Tab "Tenant": `+ Cấp cho tenant` → chọn `globex` → toast "Đã cấp Kế toán cho globex …" + hàng; **thu hồi** `button "Thu hồi"` (hàng acme) → `alertdialog "Thu hồi Kế toán của acme?"` + `textbox "Gõ acme để xác nhận"` → toast "Đã thu hồi … · Hoàn tác" → bấm `Hoàn tác` (trong 5 s) → hàng trở lại (cấp lại cùng hàng, kiểm DB: 1 hàng, `revoked_at` null).
8. `core` ở tab Tenant: không có nút, có "Feature core được cấp cho mọi tenant."; tenant khoá (`zeta`) vẫn chọn cấp được kèm ghi chú.
9. `tenant_admin` mở `/features` → `ForbiddenState`, không request `/admin/features`.
10. Xung đột: hai tab; sửa feature ở tab 1; ở tab 2 tạo command thuộc feature **bằng API** (`POST /admin/commands` với `feature_ids` chứa feature đó, để `version` feature thật sự tăng — không có trigger DB nào làm việc này) rồi lưu tab 1 → thông báo xung đột/`VERSION_CONFLICT` (modal chi tiết là M3; kiểm chỉ **không ghi đè** và có thông báo `errors.versionConflict`).

**E-M `e2e/m2-flow.spec.ts`** (**M2-AC09**; 1 test, `ADM-FR-50 · M2-AC09 · …`): đăng nhập `SEED_ADMIN_USERNAME`/`SEED_ADMIN_PASSWORD` (đọc `process.env`, cùng nguồn `prepare-db`) + mã `platform` → `link "Secrets"` → thêm `DIFY_E2E_KEY` (+ quét rò) → `link "Workflows"` → khai báo `translate-e2e` (2 tham số bắt buộc `source_text`, `target_lang`) → danh sách có "Chưa gắn" → `link "Commands"` → tạo `/dich-e2e` với `translate-e2e`: thiếu map → **"thiếu input bắt buộc: target_lang"** (không lưu) → map đủ, feature `core` mặc định → lưu → `link "Features"` → tạo `e2e-pack` (chứa `/dich-e2e`, `/dich`…), tab Tenant cấp cho `acme` → quay `Workflows` → **xoá `translate-e2e` bị chặn**, dialog liệt kê `/dich-e2e` → `Đóng`. Mỗi chuyển route bọc `waitForURL`.

### M0/M1 (sửa test khoá — thay đổi phạm vi dự kiến, **không** phải tranh chấp)

Lý do chung: M2 thêm `0003_admin_catalog` + `0004_catalog_rls` (số liệu do backend-lead chốt, `plan.md` §10, spec §9 A12) và 11 mã lỗi. Thứ tự task bắt buộc **T1 → Q2 → T2**: sau T1 (34 mã) hai file mã lỗi đỏ cho tới khi Q2 sửa; sau T2 (migration) ba file DB đỏ cho tới khi Q2 đã sửa số kỳ vọng (sửa trước ⇒ đỏ vì chưa có code, rồi xanh ở T2).

| File (dòng hiện tại) | Sửa gì | Xanh sau |
|---|---|---|
| `tests/acceptance/ADM-NFR-06/migrate.int.test.ts` (18, 33, 127, 132, 150, 154) | `ADMIN_TABLES` → 10 bảng (`admin.command_names, admin.commands, admin.feature_commands, admin.feature_entitlements, admin.features, admin.refresh_tokens, admin.secrets, admin.tenants, admin.users, admin.workflows`); `{main:3,dev:2}` → `{main:5,dev:2}` (3 chỗ), `[3,2]` → `[5,2]`; production `{main:3,dev:0}` → `{main:5,dev:0}` và 10 bảng `admin.*` (0 `hub.*`). Giữ nguyên các kiểm vai trò `admin_rw`/`hub_ro`/default privileges | T2 |
| `tests/acceptance/M1/db-schema.int.test.ts` (69-90, 273-280) | đếm `{main:5,dev:2}`; "đúng 4 bảng" → đúng **10** bảng `admin.*` + 3 `hub.*`; danh sách "bảng mốc sau" bỏ `secrets`, `workflows`, `commands` (giữ `groups, group_members, config_meta, tenant_quotas, audit_log`, **thêm** `feature_grants`); production `{main:5,dev:0}`, 10 bảng `admin.*`, 0 `hub.*`; đổi tiêu đề test tương ứng | T2 |
| `tests/acceptance/M1/db-rls.int.test.ts` (242-250) | danh sách `relrowsecurity` thành 10 dòng: `command_names f · commands f · feature_commands f · feature_entitlements t · features f · refresh_tokens t · secrets t · tenants t · users t · workflows f` (đều `relforcerowsecurity=false`); tiêu đề "RLS bật cho tenants/users/refresh_tokens/secrets/feature_entitlements" | T2 |
| `tests/acceptance/M1/rules/contracts.test.ts` (29-55) | test "bảng mã" đổi thành: `API_ERRORS` **chứa đúng 23 mã M1 với status không đổi** (`toMatchObject` trên bảng hiện có) **và** `Object.keys(API_ERRORS).length === 34`; bảng đầy đủ 34 mã ở R1 của M2 | T1 |
| `tests/acceptance/M1/error-codes.int.test.ts` (145) | `want` = **hằng 22 mã M1** (23 trừ `INTERNAL_ERROR`) thay cho `Object.keys(API_ERRORS)`; tiêu đề "tập mã M1 đã chạy kịch bản == 22 mã M1" (11 mã mới do `M2/error-codes.int.test.ts` phụ trách) | T1 (xanh ngay sau Q2; chạy trong lệnh T6) |
| `e2e/support/prepare-db.ts` + `e2e/support/helpers.ts` | thêm `resetCatalog()` + dựng fixture danh mục (mục 3) cho e2e M2; `--reset-only` cũng truncate các bảng danh mục | FE3 (e2e đầu tiên dùng) |

`packages/db/src/migrate.int.test.ts` là test của backend-lead (T2), không thuộc qc. Test M0 khác (`health`, `server.int`, `ci-workflow`, `mocks`…) và `e2e/smoke.spec.ts`, `m1-flow.spec.ts` giữ nguyên.

## 5. Cách kiểm các hành vi đặc biệt

| Chủ đề | Cách kiểm |
|---|---|
| **Giá trị secret không rò (AC-A06, BR-04)** | Marker cố định `LEAK_1/2/EMOJI/SHORT`, quét dạng thô + base64 + hex ở **7 nơi**: (1) mọi response `/admin/secrets*` kể cả 400/404/409/500 (S); (2) response `GET /admin/workflows*`, `GET /admin/commands*` (W, C); (3) stdout+stderr của server thật sau mọi luồng (SP.4); (4) mọi bảng `admin.*`/`hub.*` bằng `row_to_json` (SP.7) và cột `ciphertext`/`iv` bằng owner (S, D2.13); (5) header response; (6) DOM `page.content()`, `localStorage`, `sessionStorage`, cookie, URL, title, toast, console, mọi body response mạng (E-S.4); (7) HTML + asset JS tĩnh của web (E-S.4). Body **request** chỉ được chứa giá trị ở `POST/PUT /admin/secrets` |
| **Quyền cột `admin_rw`** | D2.4–5, S: `select ciphertext/iv/*` và `returning ciphertext` → `42501`; `select` danh sách cột an toàn, `insert/update/delete` được; `has_column_privilege` |
| **`hub_ro` và PUBLIC** | D2.6–7: `SET ROLE hub_ro` → `42501`; `has_table_privilege`/`has_column_privilege` false; `relacl` không có PUBLIC; role `qc_probe_nologin` → `42501` |
| **Khứ hồi giải mã đúng format `plan.md` §3.2** | R2.5–6 (vector vàng + bản hiện thực độc lập) và S "M2-AC02 qua API": owner đọc `iv, ciphertext, key_version, id`, tự giải mã (tag 16 byte cuối, AAD `admin.secrets:<id>:<kv>`, khoá base64 → 32 byte) |
| **AAD sai / khoá sai bị từ chối** | R2.7–9 (id khác, `key_version` khác, thiếu tiền tố, sửa 1 byte tag/ciphertext/iv, khoá khác) và S (e)(f) bằng `createDecipheriv` độc lập |
| **Khởi động với khoá sai** | SP.1–2: thiếu/sai định dạng `SECRET_MASTER_KEY` → thoát ≠ 0, nêu **tên** biến, không in giá trị |
| **Bảng `hub.agent_workflows` vắng/không đọc được** | W "agents_available": `RENAME` (to_regclass NULL) và `REVOKE SELECT` → `agents=[]`, `agent_count=0`, `agents_available=false`, **không 500**; khôi phục → lại có agent (không cache); khôi phục trong `finally`, afterAll kiểm nguyên trạng |
| **Chặn xoá/tắt đang dùng (AC-A05)** | W: 409 `WORKFLOW_IN_USE` có **cả** `commands` và `agents`; tắt chỉ chặn command **bật**/agent; sau khi tắt command → tắt workflow được; E-W.6 thấy cả `/dich` lẫn "Agent …02a1" |
| **`INPUT_MAP_INVALID` / cảnh báo** | R5 (hàm thuần) + C: thiếu bắt buộc → 400 chặn lưu, `details.missing`; sai kiểu → 201 + `warnings`, **vẫn lưu**; E-C.5/7 kiểm câu "thiếu input bắt buộc: target_lang" và icon cảnh báo |
| **Tên + alias chung không gian tên** | R5, C (4 hướng trùng: tên↔tên, tên↔alias, alias↔tên, alias↔alias), D1.8 (PK `command_names`), K.1–2 song song |
| **`core` bảo vệ / kill switch / entitlement** | R6, F: `core` không xoá/tắt/beta; PATCH tên ok; entitlement cấp idempotent, thu hồi **đặt `revoked_at`** (hàng còn), cấp lại **cùng hàng**; `core` PUT/DELETE → 409; tắt feature không đổi `enabled` command (BR-06) |
| **`version` hai phía → 409** | C: tạo/sửa/xoá command → `version` feature chứa nó +1; F: `command_ids` → `version` command bị đổi tập +1; chuỗi "mở editor Feature → đổi command → lưu bằng version cũ → 409" |
| **Đồng thời, thứ tự khoá, không deadlock** | K.1–10 (bất biến sau loạt; `pg_stat_database.deadlocks`; không 500) + test hook của backend (lock-order); G8 ghi giới hạn không tất định |
| **Chỉ `platform_admin`; role trước lookup** | X: 25 route × {401, member 403, tenant_admin 403 với body hợp lệ/sai/id lạ}; body 403 giống byte; D2: scope tenant thấy 0 hàng `secrets`, `42501` khi ghi |
| **RLS scope tenant thấy 0 hàng** | D2.2 (`secrets`), D2.9 (`feature_entitlements` chỉ hàng của tenant) |
| **Mã lỗi M2** | E: 11 mã mới + `KEY_TAKEN` message mới + tập mã đã phủ == 11 mã mới; R1 khoá bảng 34 mã |
| **Không có Test/Lịch sử/Kiểm tra kết nối/Lấy từ Dify** | SP.8, W, C (route 404), E-W.10, E-C.3 (count 0) |

## 6. Việc ngoài test của qc (nhắc để không thiếu)

Backend-lead giữ: `packages/contracts/src/*.test.ts`, `catalog-rls.int.test.ts` (plan §3.4), `migrate.int.test.ts` (sửa ở T2), `secret-crypto.test.ts`, `env.test.ts`, `*.rules.test.ts` của module, `*.service.int.test.ts` (kể cả ca `log bắt được (spy console)`), `commands.perf.int.test.ts` (ngân sách spec §6), `lib/lock-order.int.test.ts` (3 ca xen kẽ **dùng hook**). Frontend-lead giữ: unit hàm thuần FE (`normalizeSecretName`, `normalizeCommandName`, `validateInputMap`, `reconcileMap`, `buildSyntax`, `toToolPreview`, `workflowSchema` biên 19/20/400/401, `formatUpdated`, `describeError`, `navGroups`…), `check-bundle` chunk ≤ 50 KB. qc chạy lại tất cả ở VERIFY nhưng không khoá. Ngân sách hiệu năng: qc chỉ báo số p95 chạy lại.

## 7. Ánh xạ AC → test

| AC | Loại | File → ca | Dữ liệu | Kỳ vọng chính |
|---|---|---|---|---|
| AC-A03 (phía Admin) | int + e2e | C "AC-A03"; R5 (`checkInputMap`, `inputMapError`); D2.8 (Hub đọc được `dich`); E-C.5; `m2-flow` | workflow `translate` (`source_text`,`target_lang` bắt buộc); `/dich` | thiếu `target_lang` → 400 `INPUT_MAP_INVALID {missing:["target_lang"]}`, không lưu; UI "thiếu input bắt buộc: target_lang"; map đủ + `core` → 201 và `/dich` có trong danh sách bật của `core` và dữ liệu Hub. **"≤ 5 s trong menu `/`" không kiểm** (Hub/M3, M2-R24) |
| AC-A05 | int + e2e | W "AC-A05/R11/M2-AC06"; K.6; E-W.6; `m2-flow` | `translate` + `/dich` + agent `…02a1` | `DELETE` → 409 `WORKFLOW_IN_USE` liệt kê **command và agent**; UI dialog thấy cả hai |
| AC-A06 | int + proc + e2e | S "rò secret"; SP.4, SP.7; D2.13; E-S.4 | `LEAK_1/2` | `GET /admin/secrets` chỉ `name`/`last4`/…; giá trị không có trong response, log, DB, DOM/JS. **"export"**: M4 — M2 kiểm response mọi phương thức, log, nội dung trang |
| AC-A13 | int + e2e | W "AC-A13/R09"; E-W.3 | `report-tax` | lưu được, `unattached true`, nhãn "Chưa gắn", không route/grant dẫn tới người dùng; lọc `?attached=false` |
| M2-AC01 | int + DB + e2e | X (25 route); D2.6; E-S.1 | `binh`, `an` | 403 `FORBIDDEN` trước mọi lookup/parse; `hub_ro` `SELECT admin.secrets` → `42501`; menu ẩn |
| M2-AC02 | rules + int + DB | R2; S "M2-AC02 qua API"; D2.13 | `LEAK_1` | `ciphertext` không chứa plaintext; 2 lần ghi `iv`/`ciphertext` khác; sai khoá/AAD không giải mã |
| M2-AC03 | int | C "tên/alias"; K.1–2; D1.8 | `dich` là alias của command khác | 409 `COMMAND_NAME_TAKEN`; hai request song song cùng tên → đúng một thành công |
| M2-AC04 | int + e2e | C "feature"; F "BR-10", "Xoá"; K.3,5; E-F.5–6 | `feature_ids:[]`; `/tr-nhanh` độc quyền `dich-thuat` | 400 `COMMAND_NEEDS_FEATURE`; bỏ khỏi feature cuối → 400; xoá feature có command độc quyền → 409 |
| M2-AC05 | int + e2e | F "Entitlement"; E-F.7 | `ke-toan→acme`; `core` | thu hồi rồi cấp lại → **cùng hàng**, `revoked_at` null; `core` PUT/DELETE → 409 |
| M2-AC06 | int | W "R11"; C "R14" | `translate` có/không command bật | tắt khi còn command bật → 409; tắt command trước → tắt workflow 200; bật command khi workflow tắt → 409 `WORKFLOW_DISABLED` |
| M2-AC07 | int + e2e | W "M2-AC07"; R1.5; E-W.2 | mô tả 19/20/400/401 | 19 → 400, 20 → lưu, 401 → 400; tham số thiếu mô tả → 400 |
| M2-AC08 | int + e2e | W "R18/M2-AC08"; E-W.9 | `dich` map `target_lang` | xoá/đổi tên biến đang map → 409 `SCHEMA_BREAKS_COMMANDS`, không lưu |
| M2-AC09 (e2e) | e2e | `e2e/m2-flow.spec.ts` | seed `admin` | Secrets → Workflows (Chưa gắn) → Commands (chặn thiếu map, map đủ lưu) → Features (cấp tenant) → xoá workflow bị chặn kèm danh sách |

**Xác nhận AC bổ sung:** qc xác nhận cả 9 `M2-AC01…09`, không sửa. Ghi chú đọc: AC-A03 xem cột "Kỳ vọng chính" (đúng đọc của spec §8: vế "≤ 5 s" thuộc Hub/M3, M2 chỉ kiểm dữ liệu). AC-A06 "export" kiểm bằng cách quét mọi nơi giá trị có thể xuất hiện (Export là M4). M2-AC06 "command `enabled` lên khi workflow tắt → 409" = `WORKFLOW_DISABLED` (không phải `WORKFLOW_IN_USE`).

## 8. Lệnh kiểm / CI

Lệnh xong M2 (chép nguyên văn spec §8): `docker compose up -d --wait && bun run db:migrate && bun run db:seed && bun run check && bun run typecheck && bun test && bun run test:int && bun run i18n:check && bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web check:bundle && bunx playwright test && bun run test:lock:verify && bun run trace --check` (+ `check:size --all`, `depcruise --all`). Thêm bước qc ở VERIFY: `bun run db:generate` (không sinh gì), `bun run trace ADM-FR-10` … `ADM-FR-50`, báo p95 của `commands.perf.int.test.ts`.
Chạy int từng task: `bun --env-file=.env.local --config=bunfig.int.toml test --timeout 30000 <file…>` (như `tasks.md`). Chạy e2e cần `SECRET_MASTER_KEY` trong `playwright.config.ts` (FE0b) **trước** lần chạy e2e đầu sau T3.
Cập nhật `tasks.md` (qc, theo quyền "đổi tên thì sửa Lệnh xong"): T3 thêm `tests/acceptance/M2/secrets-proc.int.test.ts`; T6 thêm `tests/acceptance/M2/concurrency.int.test.ts`; FE2 thêm `tests/acceptance/M2/i18n-labels.test.ts`.

### 8.1 Mỗi file test chạy được (xanh) ở task nào

Khớp `tasks.md`. Q2 viết tất cả (đỏ); cột dưới là task sau đó file được kỳ vọng xanh. Mỗi file chỉ phụ thuộc module đã xong ở task đó (dữ liệu chéo bằng owner SQL).

| File | Xanh sau |
|---|---|
| `M1/rules/contracts.test.ts` (sửa), `M1/error-codes.int.test.ts` (sửa), `M2/rules/contracts.test.ts` (R1) | T1 (R1 nằm trong lệnh xong T2 theo `tasks.md`; thực tế xanh từ khi Q2 viết vì T1 đã xong) |
| `M2/db-schema.int.test.ts` (D1), `M2/db-rls.int.test.ts` (D2, ca 1–13), `ADM-NFR-06/migrate.int.test.ts` (sửa), `M1/db-schema.int.test.ts` (sửa), `M1/db-rls.int.test.ts` (sửa) | T2 |
| `M2/rules/secret-crypto.test.ts` (R2), `M2/rules/secrets.rules.test.ts` (R3), `M2/secrets.int.test.ts` (S), `M2/secrets-proc.int.test.ts` (SP; ca 8 chỉ cần 404 nên không đợi T5/T6; ca 7 quét toàn DB sau luồng secrets) | T3 |
| `M2/rules/features.rules.test.ts` (R6), `M2/features.int.test.ts` (F) | T4 |
| `M2/rules/workflows.rules.test.ts` (R4), `M2/workflows.int.test.ts` (W) | T5 |
| `M2/rules/commands.rules.test.ts` (R5), `M2/commands.int.test.ts` + `M2/commands-read.int.test.ts` (C, tách 2 file vì giới hạn 600 dòng), `M2/access.int.test.ts` (A), `M2/forbidden.int.test.ts` (X), `M2/error-codes.int.test.ts` (E), `M2/concurrency.int.test.ts` (K) | T6 |
| `M2/i18n-labels.test.ts` (C1) | FE2 |
| `e2e/secrets.spec.ts` (E-S) | FE3 |
| `e2e/workflows.spec.ts` (E-W) | FE4b |
| `e2e/features.spec.ts` (E-F) | FE5c |
| `e2e/commands.spec.ts` (E-C) | FE6d |
| `e2e/m2-flow.spec.ts` (E-M) | FE7 |

Ràng buộc đã rà để không đỏ sai task:
- `features.int` (T4) dựng command bằng owner SQL; `GET /admin/commands/:id` (T6) **không** dùng — `version` command đọc bằng owner. Ca "version hai chiều từ phía command" nằm ở `commands.int` (T6).
- `workflows.int` (T5): command, agent, secret (trừ ca quét rò — tạo secret bằng API T3, đã xong) bằng owner SQL.
- `secrets.int` (T3): workflow bằng owner SQL. `forbidden`/`access`/`error-codes` (cần mọi route/mọi mã) ở T6.
- `concurrency` ca 7 (secret ∥ workflow POST) dùng API workflows (T5 đã xong ở T6).
- e2e: dữ liệu chéo màn bằng owner SQL (vd `workflows.spec` dựng command/agent; `commands.spec` dựng workflow/feature/entitlement; `features.spec` dựng command) nên không chờ màn khác.

## 9. Độ phủ kế hoạch

| Loại | Số file | Số test dự kiến |
|---|---|---|
| rules (R1–R6) | 6 | ≈ 97 |
| i18n (C1) | 1 | 3 |
| int DB (D1, D2) | 2 | ≈ 30 |
| int API (S, F, W, C, A, X, E) | 7 | ≈ 220 |
| int đồng thời (K) | 1 | ≈ 10 |
| proc (SP) | 1 | ≈ 9 |
| e2e (E-S, E-W, E-C, E-F, E-M) | 5 | ≈ 42 |
| **Tổng** | **23** (+5 file M0/M1 sửa + `e2e/support/*` mở rộng) | **≈ 411** |

FR MUST (12 mã): FR-10, 11, 13, 14, 15, 20, 21, 22, 30, 31, 33, 50 đều có ≥ 1 test acceptance + API (và e2e với FR-10/11/13/20/22/30/31/33/50); FR-24, FR-34 (SHOULD) có test; BR-01/02/04/06/10/13/14, NFR-01/06/07 có test; AC-A03/A05/A06/A13 + M2-AC01…09 đều có ca (mục 7). FR-12 (COULD, không làm) chỉ có test âm. Độ phủ FR MUST kế hoạch: **12/12**.

## 10. Lỗ hổng cho spec-readiness (kèm mặc định đề xuất)

| # | Mức | Agent | Vấn đề | Mặc định qc áp dụng nếu không trả lời |
|---|---|---|---|---|
| G1 | **Cao** (đóng) | backend-lead | Bản độc lập giải mã trong test (R2, S) cố định format `plan.md` §3.2 (AAD `admin.secrets:<id>:<key_version>`, `id` dạng uuid chữ thường, tag 16 byte cuối, khoá dùng trực tiếp) — là contract với Hub. Nếu Gate đổi (vd HKDF, AAD khác) test đỏ **đúng chủ ý**. Spec §9 A2 đã đánh dấu **[NGƯỜI DÙNG]** — **đã chấp nhận (Gate 2026-10-01)** | Giữ đúng `plan.md` §3.2 (đã chấp nhận, đóng) |
| G2 | Cao | điều phối | `tasks.md` T2 chạy `M2/rules/contracts.test.ts` nhưng file chỉ đỏ/xanh theo contract T1 (T1 xong **trước** Q2), nên R1 xanh ngay khi Q2 viết, không đợi T2. Không sai nhưng "xanh sau T2" gây hiểu nhầm | Giữ lệnh xong như `tasks.md` (an toàn); ghi ở 8.1 "xanh từ T1" |
| G3 | Trung bình | backend-lead | M1 `error-codes.int` hiện kiểm `KEY_TAKEN` bằng kịch bản tenant; message đổi "Key is already taken" — M1 chỉ kiểm tiếng Anh in được, không khớp chuỗi, nên không vỡ. Nhưng e2e M1 `tenants.spec` chờ text "Mã công ty đã được dùng" (do FE dịch theo màn, plan-frontend §8) | FE giữ câu theo màn; qc không sửa e2e M1 |
| G4 | Trung bình | backend-lead | `active_user_count`: spec R22 viết "user `active`", contract/§9 A10 viết "`active && !locked_by_tenant`" | Theo A10 (qc: acme 6, globex 3, platform 2, **zeta 0**) |
| G5 | Trung bình | backend-lead | Chưa nói rõ `PATCH /admin/features/:id` với `command_ids` cho **core** (thêm/bớt command khỏi `core`) có được không, và bớt khỏi `core` khi command chỉ có `core` → `COMMAND_NEEDS_FEATURE` | Được phép; luật mồ côi áp như feature khác; qc test "bỏ command độc quyền khỏi core → 400" |
| G6 | Thấp (đóng) | docs-architect | `ADM-FR-12` có trong frontmatter `requirements` của spec nhưng **không làm** (A8). `trace --check` có thể báo thiếu test | **Đóng:** giữ FR-12 trong frontmatter; chỉ có test âm gắn tag `ADM-FR-12` (SP.8, W) để `trace` có dấu vết |
| G7 | Trung bình | backend-lead | Log request có kèm **query string** của `/admin/secrets?q=…` không? M2-R03 chỉ cấm log body/header. `?q=` có thể chứa tên secret (không phải giá trị) | Không log query của route `/admin/secrets*` (log path thuần); SP.5 kiểm. Nếu backend log query → báo, qc đổi ca chỉ còn cấm marker giá trị |
| G8 | **Cao** | backend-lead | **Ca song song không tất định:** K (và mọi "đồng thời" trong S/F/W) chỉ khẳng định bất biến sau loạt và có thể xanh dù lỗi còn (không điều khiển được thứ tự đến). Bài học M1: lỗi thật chỉ bắt được khi chèn độ trễ giữa "đọc/khoá" và "ghi" | **Đề xuất backend-lead thêm hook thử nghiệm** (tuỳ chọn trong `AppDeps`, ví dụ `testHooks?.afterLock?(op: "command.save" \| "feature.save" \| "workflow.save", step: string): Promise<void>`, chỉ dùng khi `appEnv="test"`) và viết 3 ca xen kẽ plan §5.1 (a)(b)(c) **tất định** ở `lock-order.int.test.ts` (backend giữ, không khoá). qc giữ K như bất biến + không 500 + `deadlocks` không tăng |
| G9 | Thấp | backend-lead | "Không N+1" (spec §6) không kiểm được từ acceptance nếu app không có hook đếm truy vấn | Giao `commands.perf.int.test.ts` (backend); qc chỉ chạy lại và báo p95; W không khẳng định số truy vấn |
| G10 | Trung bình | backend-lead | Ca `agents_available=false` cần đổi quyền/tên bảng `hub.agent_workflows` bằng owner (mutate DB dùng chung; Bun chạy file int **tuần tự**). Nếu CI chạy song song file int, rò sang file khác | qc khôi phục trong `finally` + afterAll kiểm nguyên trạng; giả định file int chạy tuần tự (như M1) |
| G11 | Thấp | backend-lead | Production không có role `admin_api` LOGIN (chỉ dev/test), nên **không** dựng được app trên DB đã `runMigrations({appEnv:"production"})` để thử "không có schema hub" thật sự | Thay bằng `RENAME`/`REVOKE` trên DB test (W); D1 chỉ kiểm production có 0 bảng `hub.*` |
| G12 | Trung bình | backend-lead | `VALIDATION_ERROR` cho `/admin/secrets*` có thể liệt kê **tên khoá lạ** (`unrecognized_keys`) trong `message` zod — nếu client dùng giá trị secret làm tên khoá thì rò. M2-R03 cấm echo input | qc chỉ quét **giá trị** trường (không quét tên khoá); khuyến nghị backend thay `message` của issue bằng chuỗi tĩnh theo `code` ở `/admin/secrets*` |
| G13 | Thấp | frontend-lead | Hoàn tác 5 s (toast): hết 5 s thì mất nút — không kiểm được tất định nếu không `sleep` | Chỉ kiểm bấm `Hoàn tác` trong hạn; không kiểm hết hạn |
| G14 | Trung bình | frontend-lead | E-F.10 (xung đột 409 giữa hai tab) — modal xung đột là M3 (FR-55); M2 chỉ có thông báo `errors.versionConflict`. Chưa rõ UI M2 hiển thị gì | qc kiểm: không ghi đè dữ liệu (DB giữ giá trị tab 2) và có thông báo chứa nội dung `errors.versionConflict`; không kiểm modal |
| G15 | Thấp | frontend-lead | e2e cần `playwright.config.ts` `webServer[0].env` có `SECRET_MASTER_KEY` (FE0b), và `check-bundle` chunk ≤ 50 KB do FE7 | FE0b trước e2e đầu tiên sau T3 (đã có trong `tasks.md`) |
| G16 | Thấp | điều phối | `M1/_fixtures.resetFixture()` giờ cuốn theo bảng danh mục qua FK `updated_by` (TRUNCATE CASCADE). An toàn cho M1 (seed lại `core`), nhưng nếu thêm bảng M3 có FK tới `users` thì M1 test cũng xoá bảng đó | Không sửa M1; M2 dùng `resetCatalog()` tường minh. Ghi ở "Quyết định trong lúc làm" khi Q2 |

Không chặn (đã có đáp án trong spec/plan): 9 AC bổ sung (xác nhận 9/9), tên file `tests/acceptance/M2/` (theo `plan.md` §10), `INPUT_MAP_INVALID.message` cố định (kiểm `details`, câu tiếng Việt ở e2e), quy tắc `KEY_TAKEN` dùng chung (message mới), `COMMAND_NEEDS_FEATURE` có/không `details` theo nơi gọi.

## 11. Nhật ký

- 2026-10-01 · qc · WRITE (test-plan) · chưa có file test; Q2/Q3 sau Gate G1. Q1 xong. Áp bài học M1: mỗi file gán task xanh (8.1); e2e bọc điều hướng bằng `waitForURL`/`waitForResponse`, không `waitForTimeout`; ca song song không tất định ghi rõ (K, G8) và đề xuất backend dùng hook.
- 2026-10-01 · qc · WRITE (Q2) · đã viết test vào `tests/acceptance/M2/**`, `e2e/{secrets,workflows,features,commands,m2-flow}.spec.ts`, mở rộng `e2e/support/{prepare-db,helpers}.ts`, sửa 5 file khoá M0/M1 (lý do ở `spec.md` §9 "Trong lúc làm"). Khác kế hoạch: (1) `commands.int` tách thêm `commands-read.int`; (2) `M2/_fixtures.ts` nạp `secret-crypto`/app lười trong hàm dựng app; `_data.ts` không phụ thuộc `bun:test` (dùng chung cho e2e); (3) D1/D2 đã được kiểm với một migration thử viết tay từ spec §4 (DB tạm, đã xoá) nên logic ràng buộc/RLS/quyền cột của test đã chạy xanh một lần; (4) test dùng `Bun.sleep` chỉ trong vòng thăm dò `/health` có hạn chót (như M1/A8), không có chờ cố định.
