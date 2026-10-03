---
spec: M4-ops
part: phụ lục khối C (Import/Export) của test-plan-cd.md
owner: qc
---

# Test-plan M4 · C · Integration Import/Export

Quy ước/fixture: `test-plan-cd.md` §0.

## 3. Integration C · Import / Export

### 3.1 `tests/acceptance/M4/export.int.test.ts` (T7)

| Mã | Dữ liệu / bước | Kỳ vọng |
|---|---|---|
| C-E01 · M4-AC09 | admin `GET /admin/export?types=workflows,commands,features,tenants,groups,grants` | 200; `Content-Type: application/yaml; charset=utf-8`; `Content-Disposition: attachment; filename="config-v{n}.yaml"` và `X-Config-Version: n` với n = `config_meta.version`; body không BOM; `yaml.parse` → `ConfigFileSchema.parse` qua; danh sách sắp theo key |
| C-E02 · AC-A06 · BR-04 | body C-E01 | `secrets` = `[DIFY_INVOICE_KEY, DIFY_TRANSLATE_KEY]`; `leaked({body}, leakForms(LEAK_1))` = `[]`; không chuỗi `last4` của secret fixture; không UUID (regex `[0-9a-f]{8}-[0-9a-f]{4}-`) |
| C-E03 · plan §3.2 | body C-E01 | không tenant `platform`; `grants` chỉ grant cho group (grant cho user của M3 fixture vắng); `groups[].tenant` là key |
| C-E04 | `types=commands` | chỉ khoá `commands` |
| C-E05 | `types=` rỗng; `users`; `commands,commands`; thiếu `types` | 400 `VALIDATION_ERROR` ×4 |
| C-E06 · plan §3 | binh (tenant_admin), an (member) → export và `/export/meta`; không token | 403 `FORBIDDEN` ×4; 401 |
| C-E07 | `GET /admin/export/meta` | `{config_version: n, counts}` khớp số phần tử C-E01 từng loại |
| C-E08 · chỉ đọc | trước/sau export | `config_meta.version`, số dòng `audit_log` không đổi; 0 NOTIFY |
| C-E09 · round-trip | import dry-run đúng body C-E01 | `valid true`, `summary.added 0, updated 0`, `items []` |

### 3.2 `tests/acceptance/M4/import-dry-run.int.test.ts` (T8)

| Mã | Dữ liệu / bước | Kỳ vọng |
|---|---|---|
| C-I01 · M4-AC09 | `baseFile()` = sửa `translate.description`, sửa `acme.name`, thêm workflow `report-new` (secret `DIFY_REPORT_KEY`), thêm command `/bao-cao-moi` vào `bao-cao.commands`; `?dry_run=1` | 200 `valid true`; `summary {added 2, updated 3, unchanged k}` (k đếm theo file); items đúng op; `missing_secrets [{DIFY_REPORT_KEY, [report-new]}]`; `base_config_version` = version hiện tại; `from_config_version` = giá trị file |
| C-I02 · R14 không ghi | so trước/sau C-I01: checksum mọi bảng `admin.*` (owner, `md5(string_agg(row::text))`), `config_meta.version`, `audit_log` | không đổi; 0 NOTIFY |
| C-I03 · plan §3.3 | không gửi `dry_run` | như dry-run, không ghi (C-I02 lặp lại) |
| C-I04 | yaml hỏng (thụt sai dòng 3) | `valid false`, `errors[0] {code: YAML_SYNTAX, line: 3}` có `col` |
| C-I05 | `commands[2]` thiếu `workflow`; `commands[0].workflow: translat` | `SCHEMA` path `commands[2].workflow`; `REF_NOT_FOUND` path `commands[0].workflow` |
| C-I06 · Q11 | tenant `newco` | `TENANT_NOT_FOUND`; dry-run không tạo tenant |
| C-I07 · BR-04 | `secrets: [{name: X, value: LEAK_1}]` | `valid false` `SCHEMA`; response không chứa `LEAK_1` (`leaked`) |
| C-I08 · R15 | body dry-run có `secrets: {DIFY_REPORT_KEY: LEAK_2}` | bỏ qua: không tạo secret; `LEAK_2` không có ở response, DB (`scanDatabase`), log (`captureLogs`) |
| C-I09 · D7 alias | 1 anchor + 1 alias (`&a`/`*a`); `bomAlias(9)` | 200 `valid false` `YAML_SYNTAX` cả hai; ca bom trả trong timeout mặc định 5 s; request kế (`GET /auth/me`) vẫn 200 |
| C-I10 · R14 413 | content 1 048 577 byte ASCII; đúng 1 048 576 byte (`padTo`); `multiByte` 1 048 578 byte (< 1 M ký tự); body thô > 2 MiB | 413 `PAYLOAD_TOO_LARGE {max_bytes:1048576}`; **không** 413 (200); 413; 413 |
| C-I11 | `file_name: "x.json"`; khoá lạ | 400 `VALIDATION_ERROR` |
| C-I12 · plan §3 | binh, an (dry-run và áp dụng) | 403 `FORBIDDEN` ×4; DB không đổi |
| C-I14 · R14 quotas | `tenants[0].quotas[0]` = `{feature:null}` (mọi giới hạn null) | `valid false`, `SCHEMA` path `tenants[0].quotas[0]` |
| C-I13 | yaml có khoá map trùng (`name:` 2 lần) | `valid false`, `YAML_SYNTAX` (uniqueKeys) |

### 3.3 `tests/acceptance/M4/import-apply.int.test.ts` (T8)

| Mã | Dữ liệu / bước | Kỳ vọng |
|---|---|---|
| C-A01 · M4-AC10 · R15 | `baseFile()` `?dry_run=0` có `base_config_version`, không `secrets` | 400 `SECRETS_REQUIRED {missing:[DIFY_REPORT_KEY]}`; DB không đổi |
| C-A02 · R15 | `secrets` có `DIFY_TRANSLATE_KEY` (đã có) + đủ `DIFY_REPORT_KEY` | 400 `VALIDATION_ERROR`, `details.fields.secrets = [DIFY_TRANSLATE_KEY]`; `ciphertext` của `DIFY_TRANSLATE_KEY` không đổi |
| C-A03 | áp dụng thiếu `base_config_version` | 400 `VALIDATION_ERROR` |
| C-A04 · M4-AC10 | áp dụng đủ `{DIFY_REPORT_KEY: LEAK_2}`, base = n | 200 `{config_version: n+1, summary, secrets_created: 1}`; DB: `translate` version +1, `updated_by` = admin; `report-new` trỏ secret mới (`last4` = 4 ký tự cuối LEAK_2); `/bao-cao-moi` ∈ `bao-cao`; `config_meta.version = n+1` (một bump) |
| C-A05 · R14 một audit | sau C-A04 | đúng **1** dòng audit mới: `action import`, `entity config`, `entity_id null`, `entity_name` = file_name, `tenant_id null`, `config_version n+1`, `after.added`/`after.updated` = `{type,key}` đúng, `after.secrets_created [DIFY_REPORT_KEY]`; `Object.keys(after)` ⊆ `from_config_version, added, updated, secrets_created, truncated`; không dòng audit `secret`/`workflow` riêng; `scanDatabase([LEAK_2])` = `[]` |
| C-A06 · R14 một NOTIFY | listener quanh C-A04 | đúng 1 thông điệp từ mốc ca, `v = n+1`, sau commit |
| C-A07 · R14 không xoá | sau C-A04 | `summarize`, `report-tax` còn; feature ngoài file giữ tập command; entitlement/grant/quota ngoài file còn |
| C-A08 · plan D8 409 | dry-run (base n) → `PATCH` command qua API (n+1) → áp dụng base n | 409 `VERSION_CONFLICT {current: n+1}`; không có thay đổi nào của file (rollback toàn bộ: `translate.description` cũ, `DIFY_REPORT_KEY` không tồn tại, 0 audit `import`, 0 NOTIFY của import) |
| C-A09 | 2 áp dụng song song cùng base n | 1 × 200, 1 × 409 |
| C-A10 | file không có thay đổi (body C-E01), áp dụng | 200 `config_version` = hiện tại; 0 audit, 0 NOTIFY |
| C-A11 | file lỗi (`REF_NOT_FOUND`) áp dụng | 400 `IMPORT_INVALID {errors:[…REF_NOT_FOUND]}`; DB không đổi |
| C-A12 · Q11 | `tenants: [{key: acme, name: "Acme Mới", max_concurrent_sub: 3, quotas:[{feature:null, max_runs:1000…}]}]` | `tenants` acme đổi tên/slot, version +1; `tenant_quotas` có hàng; số tenant không đổi |
| C-A13 | grant mới + entitlement cùng file; ca 2 không entitlement | 200, grant tồn tại; 400 `IMPORT_INVALID` `NOT_ENTITLED` |
| C-A15 · R14 upsert quota | áp dụng `tenants[acme].quotas` = `[{feature:null,max_runs:1000},{feature:ke-toan,max_usd:"300.00"}]` hai lần liên tiếp (lần 2 đổi `max_runs 2000`, base mới) | `tenant_quotas` acme đúng 2 hàng (upsert theo (tenant, feature), không trùng 23505); lần 2: hàng null `max_runs 2000`; hàng `ke-toan` giữ |
| C-A14 · AC-A09 | grant/group tenant `globex` trong file của platform admin | áp dụng đúng `tenant_id` globex; RLS: binh `GET /admin/groups` không thấy group globex mới |
