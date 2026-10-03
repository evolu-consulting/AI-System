# Test plan · M4-ops · khối A + B (qc)

C + D: [test-plan-cd.md](test-plan-cd.md). Nguồn: spec §2, §8 · plan-contract §2 · plan §3–6 · plan-rules A1–A5 · plan-frontend §3, §6 · ms §1, §4.3, §7, §12.5. Hiệu năng: **đo ở `test:perf`, ngoài phạm vi khoá**.

## 1. Quy ước (kế thừa M3 test-plan §1; chỉ ghi phần khác)

| Mục | Quy ước |
|---|---|
| Thư mục | `tests/acceptance/M4/` (+ `rules/`), `e2e/m4-*.spec.ts`; helper `M4/_data|_fixtures|_modules.ts` của A+B, C+D chỉ thêm export |
| Tên | `it("ADM-FR-40 · M4-R02 · M4-AC… · …")`: mã FR/BR/NFR đầu, rồi M4-R/AC |
| Loại | `rules` · `int` (in-process, DB qc `.env.test-qc.local`) · `proc` (spawn `server.ts` như M2 `secrets-proc`; LISTEN + SMTP) · `e2e` |
| uuid | `id4(n)` = `…0000000004nn`; run_id: `01900000-0000-7000-8004-{index 12 số}` |
| Reset | `beforeEach` = reset M3 + `DELETE hub.usage_logs` (quota/alerts theo `TRUNCATE tenants CASCADE`). **`audit_log` không TRUNCATE được** (trigger) → mốc `mark = max(seq)` đầu ca, đếm `seq > mark`; API lọc `entity_id`/`q` hoặc khẳng định bất biến |
| Thời gian | `inMonth()` = `now() − 1 phút` (nếu < 10 phút từ đầu tháng VN thì đầu tháng + 1 s); ranh giới tháng: rules R1 + int U3, AL9 |
| Mail | int: `deps.mailer = createMemoryMailer()` hoặc stub ném `MailError`; proc: Mailpit `GET :8025/api/v1/search`, lọc theo tên tenant riêng của ca + mốc thời gian |
| Chờ | không `sleep`: `expect.poll` ≤ 5 s (PUT quota **không** chờ `evaluateTenant` → mọi khẳng định `quota_alerts`/mail ở AL1–AL6 dùng `expect.poll`); "không gửi thêm / không NOTIFY" = sentinel (M3 §1) |
| Strict | lỗi: `ErrorResponseSchema` + `API_ERRORS[code]`; 200: schema contract strict; rò `cost_usd`: quét **chuỗi** body |
| Bẫy | CONVENTIONS §2 "Bẫy đã gặp" (`sql.json` cho jsonb audit, mốc `from` listener, `waitForResponse` đặt trước click) |

## 2. Dữ liệu (`M4/_data.ts`, không import `bun:test`)

| Tên | Nội dung |
|---|---|
| Nền | fixture M1 (acme: binh, chi `tenant_admin` có email; an, lan… `member`; globex: hoa `tenant_admin`) + `seedCatalog` M2 (feature `ke-toan` "Kế toán", `dich-thuat`, `bao-cao`; command `/dich`…) + `seedPermissions` M3 |
| `insertUsage(sql, n, o)` | owner chèn n hàng `hub.usage_logs`, 1 `run_id`/hàng, `in 100/out 50`, `billable 0.10`, `cost 0.06`, `at ?? inMonth()`; tuỳ chọn `feature`, `overage`, `billable null` |
| `setQuota(sql, t, f, lim)` | owner chèn `tenant_quotas` (dựng nhanh khi không kiểm PUT) |
| `auditMark(sql)` / `auditSince(sql, mark)` | `max(seq)` / hàng `seq > mark` sắp seq |
| `seedAuditRows(sql, n, o)` | owner chèn n dòng audit (entity_name `m4-page-NN`, `tenant_id` tuỳ chọn) cho phân trang |

## 3. Ca kiểm

### R · Hàm thuần (`M4/rules/*.test.ts`, chữ ký plan-rules)

| # | Mã | File | Dữ liệu → kỳ vọng |
|---|---|---|---|
| R1 | M4-R01 | `quotas.rules.test.ts` | `monthRange(2026-09-30T16:59:59Z)` → `"2026-09"`; `T17:00:00Z` → `"2026-10"`, `from 09-30T17:00Z`, `to 10-31T17:00Z`; tháng 12 → năm sau |
| R2 | M4-R03 | 〃 | `quotaPct`: 800/1000 → 80; 999 → 99 (floor); 1001 → 100; USD `"212.40"/"300.00"` → 70; run 50% + token 90% → 90; không giới hạn → null; USD `"0.29"/"0.30"` → 96 (không lỗi float) |
| R3 | M4-R04 | 〃 | `quotaLevel`: null/0/79 → none; 80/99 → warn; 100/250 → over |
| R4 | M4-R03 | 〃 | `evaluateQuota`: quota feature dùng `byFeature` (thiếu key = 0 → pct 0); quota null dùng `total`; trả đúng thứ tự đầu vào |
| R5 | M4-R04 | 〃 | `alertsDue`: warn → 80 pending; over mới → 100 pending + 80 skipped; over đã có 80 → chỉ 100; đã có 100 / none → `[]`; tách theo `featureId` |
| R6 | M4-R06 | 〃 | `bannerFor`: `platform_admin`/`member` → null; tenant_admin không quota/none → null; chọn pct lớn nhất; bằng nhau → `featureId null` trước |
| R7 | M4-R02 | 〃 | `normalizeQuotaItems` bỏ dòng 3 null; `duplicateFeatureIndex`: hai `null` → 1; hai uuid trùng → index dòng sau; không trùng → null |
| R8 | M4-R05 | 〃 | `alertMail` vi: subject `"[ACME] Đã dùng 80% quota tháng"`; en: `"[ACME] 80% of monthly quota used"`; `text` chứa `link`; không chứa email |
| R9 | M4-R08 · BR-09 | `usage.rules.test.ts` | `resolveUsageTenant`: tenant_admin undefined/own → own; khác → `"not_found"`; platform undefined → `{tenantId:null}`, uuid → uuid |
| R10 | FR-42 | 〃 | `usageRange`: mặc định = tháng hiện tại VN, `days` đủ mọi ngày; `from>to` → invalid; 367 ngày → invalid; 366 → ok; `prevFrom/prevTo` = khoảng liền trước cùng độ dài; `to` gồm cả ngày |
| R11 | M4-R08 | 〃 | `csvColumns`: tenant_admin = `date,tenant_key,feature_key,runs,input_tokens,output_tokens,billable_usd,overage_runs`; platform chèn `cost_usd` sau `billable_usd` |
| R12 | M4-R08 | 〃 | `toCsv`: BOM U+FEFF, CRLF; ô có `,` `"` xuống dòng → quote; ô bắt đầu `= + - @ 	 
` → tiền tố `'` (6 ca, vd `=HYPERLINK(…)`); null → `""` |
| R13 | M4-R08 | 〃 | `stripCost(tenant_admin, …)` xoá **đệ quy** `cost_usd`, `margin_usd`, `tenants` (cả trong `kpi`, `previous`, `daily[]`, `top_*[]`); platform giữ nguyên |
| R14 | M4-R10 · BR-04 | `audit-snapshot.rules.test.ts` | `auditSnapshot` đủ **12** entity: đúng allowlist plan §4.1 (dto thừa `password_hash`, `last4`, `updated_at` bị bỏ); secret chỉ `name, note`; `config` chỉ `from_config_version, added, updated, secrets_created, truncated` |
| R15 | M4-R10 | 〃 | `containsForbiddenKey`: 9 khoá cấm ở độ sâu 3 (trong mảng) → true; sạch → false; `auditSnapshot` **không ném** khi `command.input_map` có khoá `password`/`value`/`iv` (giữ nguyên trong snapshot; command lưu + khôi phục được) |
| R16 | M4-R12 | `audit.rules.test.ts` | `resolveAuditFilter`: tenant_admin undefined/own → tenant own; khác/`"system"` → not_found; platform undefined → all, `"system"` → system, uuid → tenant |
| R17 | M4-R13 · Q7 · Q8 | 〃 | `canRestore`: platform × 5 entity × {update, delete, restore} × snapshot → true (15 ca); snapshot false, entity khác (7), action khác (6), tenant_admin → false |
| R18 | M4-R13 | 〃 | `restoreCheck`: update + không tồn tại → NOT_RESTORABLE; update + version lệch → VERSION_CONFLICT; update khớp → ok; delete + còn → NOT_RESTORABLE; delete + không còn → ok |
| R19 | M4-R12 | 〃 | `encodeCursor/decodeCursor` khứ hồi `"1"`, `"9007199254740993"`; `"!!"`, `""`, base64 của `"abc"`/`"-1"` → null |
| R20 | contract | `contracts.test.ts` | 3 mã mới = 409; **chỉ ở đây** `Object.keys(API_ERRORS).length === 48`; `CONFIG_ENTITIES` có `quota` đứng trước `"batch"`, length 11; `AUDIT_ENTITIES` 12, `AUDIT_ACTIONS` 9; `QuotaSetRequestSchema` từ chối `max_runs 0`/`1.5`, `max_usd "0"`/`"1.234"`/`"-1"`, 101 items, khoá thừa; `UsageReportTenantSchema` từ chối `cost_usd`; `User`/`TenantSchema` có `updated_by` |

### D · DB / RLS (`M4/db-schema.int.test.ts`, `M4/db-rls.int.test.ts`; owner / `admin_api` / `hub_ro`)

| # | Mã | Kỳ vọng |
|---|---|---|
| D1 | M4-R02 | `tenant_quotas`: 2 hàng `feature_id NULL` cùng tenant → 23505; `warn_pct 90` → 23514; `max_runs 0`/`max_usd 0` → 23514; 3 giới hạn null → 23514; xoá feature → hàng quota feature biến mất (cascade) |
| D2 | M4-R04 | `quota_alerts`: trùng (tenant, NULL, 80, month) → 23505; `level 90` → 23514; `status 'x'` → 23514 |
| D3 | M4-R11 | `audit_log`: `seq` identity tăng; `action 'x'`/`entity 'x'` → 23514; không FK (chèn `tenant_id`, `actor_id` không tồn tại → ok) |
| D4 | M4-R17 | `users.updated_by`, `tenants.updated_by` có, FK `ON DELETE SET NULL`; `hub_ro` SELECT `users.updated_by` → 42501 |
| D5 | BR-09 · M4-AC17 | scope acme SELECT 3 bảng chỉ thấy hàng acme (có hàng globex + audit NULL); platform thấy cả NULL |
| D6 | BR-09 · M4-AC17 | scope acme INSERT `tenant_quotas` tenant globex → 42501; INSERT `audit_log` tenant globex/NULL → 42501; UPDATE quota globex → 0 hàng |
| D7 | M4-R11 · M4-AC06 | `admin_api` (cả platform) UPDATE/DELETE/TRUNCATE `audit_log` → 42501; owner UPDATE/DELETE/TRUNCATE → lỗi trigger (P0001), hàng còn nguyên |
| D8 | ADM-NFR-07 | `hub_ro`: SELECT `tenant_quotas` thấy mọi tenant; SELECT `quota_alerts`, `audit_log` → 42501; INSERT bất kỳ → 42501 |
| D9 | ADM-NFR-06 | `pg_policies` 3 bảng mới đúng tên/role |

### Q · Quota API (`M4/quotas.int.test.ts`) — FR-40, M4-R02, Q9

| # | Mã | Dữ liệu → kỳ vọng |
|---|---|---|
| Q1 | FR-40 · M4-AC02 | GET acme chưa đặt → 200, `items[0]` `feature_id null`, 3 giới hạn null, `pct null`, `level none`; `month` = tháng VN |
| Q2 | FR-40 | PUT `{version v, items: null→max_runs 1000, ke-toan→max_usd "300.00", bao-cao→max_tokens 5e6}` → 200; thứ tự null, `bao-cao`, `ke-toan`; tenant v+1, `updated_by admin` |
| Q3 | M4-R03 | (quota Q2) 800 run (400 `ke-toan`) → null: runs 800, pct 80, warn; `ke-toan`: billable 40 (`Money`), pct 13 |
| Q4 | M4-R02 | PUT dòng mọi giới hạn null → bị bỏ (DB không có hàng); PUT `items: []` → xoá hết, GET còn dòng null không giới hạn |
| Q5 | M4-R02 | PUT 2 dòng `feature_id null` / 2 dòng cùng feature / 101 dòng / `max_runs 0` / `max_usd "1.234"` → 400 `VALIDATION_ERROR`, DB không đổi |
| Q6 | FR-40 | feature uuid không tồn tại → 400 `INVALID_REFERENCE` |
| Q7 | Q9 · FR-55 | PUT `version` cũ → 409 `VERSION_CONFLICT`, `details.current` parse `QuotaSetResponseSchema` (đúng bộ đang lưu), `updated_at`; DB không đổi |
| Q8 | BR-09 · AC-A09 | binh GET globex 404, GET acme 200, PUT 403; an GET 403; tenant không tồn tại 404 |
| Q10 | AW9 | PUT cùng bộ đang lưu (no-op) → 200 bộ hiện tại; tenant `version`, `updated_by` không đổi; 0 audit, 0 NOTIFY, không evaluate (0 mail, sentinel) |
| Q9 | M4-R10 | PUT → 1 audit `update quota` acme, `entity_name acme`, snapshot, `entity_version v+1`, `before/after.items` đúng; 409 → 0 dòng |

### AL · Cảnh báo quota (`M4/quota-alerts.int.test.ts`; `proc`: `M4/quota-alerts-proc.int.test.ts`) — FR-41, M4-R04, R05, Q2b

| # | Mã | Dữ liệu → kỳ vọng |
|---|---|---|
| AL1 | FR-41 · M4-AC01 | 800 run, PUT quota 1000 → `quota_alerts` 1 hàng (80, NULL, `sent`); đúng 2 `send`, mỗi lần **1** người nhận (binh, chi), subject `[{tên acme}] Đã dùng 80% quota tháng`, link `…/usage` |
| AL2 | M4-R04 | tiếp AL1: +200 run, PUT đổi `max_tokens` → mail 100 ×2; mail 80 vẫn đúng 2 (sentinel = mail 100); 2 hàng alert |
| AL3 | M4-R04 | 1000 run (chưa có alert), PUT → chỉ mail 100 (2 người); hàng 80 `skipped`, không mail 80 về sau |
| AL4 | M4-R05 | chi `active=false` hoặc `email NULL`; lan (member, có email) → chỉ binh nhận; chi locale `en` → subject EN |
| AL5 | M4-R05 · TD #13 | mailer ném `MAIL_SEND_FAILED` → PUT 200, quota lưu; alert `pending`, `attempts 1`, `last_error` = mã; mailer tốt + PUT lại → `sent` |
| AL6 | M4-R05 | `MAIL_DISABLED` → `pending` như lỗi gửi |
| AL7 | FR-41 · M4-AC02 | không quota, 5000 run → 0 alert, 0 mail |
| AL8 | M4-R04 | quota feature `ke-toan` 100 run, 85 run `ke-toan` + 500 run khác → alert (`ke-toan`, 80); quota null không có → không alert tenant |
| AL9 | M4-R01 | 900 run `at` = đầu tháng − 1 s + 100 run trong tháng, quota 1000 → pct 10, không alert |
| AL10 | FR-41 · AC-A12 | **proc + Mailpit**: quota 1000, 999 run, spawn server; owner chèn 2 run (hàng 1001 `overage`) + `NOTIFY quota_threshold {tenant_id: acme}` → đúng 1 mail 100% cho binh, 1 cho chi; NOTIFY hỏng `'x'` rồi globex hợp lệ (sentinel) → server sống, acme không thêm mail |
| AL11 | M4-R06 · M4-AC01 | `quota-banner`: binh 800/1000 → `{warn, 80, null}`; 1000 → over; admin → null; an → 403; không quota → null; usage giảm 700 → null (Q12) |

### U · Usage (`M4/usage.int.test.ts`, `M4/usage-csv.int.test.ts`) — FR-42, M4-R03, R07–R09

Dữ liệu U: acme tháng này 3 run `ke-toan` (run 3 có **2 hàng**), 1 run feature NULL, 1 hàng billable NULL, 1 hàng `overage`; globex 2 run; acme tháng trước 4 run.

| # | Mã | Kỳ vọng |
|---|---|---|
| U1 | M4-R03 | admin acme: `runs` = run_id khác nhau, `tokens` Σ(in+out), `billable_usd` bỏ NULL, `unpriced_rows 1`, `overage_runs 1`, `margin = billable − cost`; `previous.runs 4`; `has_data true` |
| U2 | FR-42 | `daily` đủ mọi ngày khoảng (ngày trống 0); `top_features` ≤10 giảm theo billable, có dòng `feature_id null`; `overage` đúng dòng; `quotas` có khi chọn tenant |
| U3 | M4-R01 | hàng `at` = đầu tháng VN − 1 s không vào tháng này; = đầu tháng → vào |
| U4 | FR-42 | `feature_id=none` → chỉ hàng NULL; `feature_id=<ke-toan>` → chỉ ke-toan; admin không `tenant_id` → `tenant_id null`, `tenants[]` có acme, globex, `quotas []` |
| U5 | M4-R08 · BR-09 · M4-AC03 | binh (không `tenant_id`) → acme; body **chuỗi** không chứa `cost_usd`, `margin_usd`, `"tenants"`; parse `UsageReportTenantSchema` strict; số liệu không có globex |
| U6 | BR-09 · AC-A09 | binh `?tenant_id=globex` → 404; admin `tenant_id` không tồn tại → 404; an → 403 |
| U7 | FR-42 | `from>to`, 367 ngày, `from=2026-13-01`, `feature_id=abc` → 400 `VALIDATION_ERROR` |
| U8 | M4-R09 · M4-AC13 | `usage_logs` rỗng → 200, `has_data false`, kpi 0; không lỗi |
| U9 | M4-R03 | hàng `usage_logs.run_id` NULL (acme, tháng này, in 100/out 50, billable 0.10, cost 0.06, `overage`): **không** vào `runs`, `overage_runs`, `quotas[].used_runs`; **có** vào `tokens`, `billable_usd`, `cost_usd`, quota token/USD |
| C1 | M4-R08 | CSV admin acme: BOM, CRLF, header platform, `text/csv; charset=utf-8`, file `usage-acme-{from}-{to}.csv`; Σ runs = `kpi.runs`; NULL → `""` |
| C2 | M4-R08 · M4-AC03 | CSV binh: header **không** `cost_usd`; toàn văn không chứa `cost_usd` hay giá trị cost `0.06`; không tenant `all` → filename `usage-acme-…` |
| C3 | BR-09 | CSV binh `tenant_id=globex` → 404; admin không tenant → `usage-all-…`, có dòng globex |

### O · Tổng quan (`M4/overview.int.test.ts`) — ui 7.2, M4-R06, R09, Q5

| # | Mã | Kỳ vọng |
|---|---|---|
| O1 | ui 7.2 | binh → `tenant` acme; `active_users`, `groups` đúng; `never_logged_in` ≤5, `created_at` giảm, không ai đã đăng nhập; `_total` đúng |
| O2 | M4-R06 | binh 850/1000 → `banner {warn,85}`, `quotas[0].level warn`; `runs_month 850`, `runs_prev_month` từ tháng trước |
| O3 | M4-R09 | `usage_logs` rỗng → `runs_month null`, `runs_prev_month null`, `has_usage_data false` |
| O4 | M4-R12 | `recent_changes` ≤8, chỉ `tenant_id` acme (sau khi admin sửa command + globex group) |
| O5 | Q5 | admin → `platform`: đếm khớp seed; `unavailable` đủ 2; `quota_tenants` level ≠ none, `pct` tenant = **max** các quota của tenant (2 quota 40%/90% → 90), giảm dần; `runs_24h` không tính hàng 25 giờ trước; `recent_changes` có hàng NULL |
| O6 | M4-AC12 | an → 403 |

### AW · Ghi audit (`M4/audit-write.int.test.ts`, `M4/audit-secrets.int.test.ts`) — FR-51, M4-R10, Q6

| # | Mã | Thao tác (API) → đúng 1 dòng (`seq > mark`): action · entity · tenant_id · snapshot |
|---|---|---|
| AW1 | M4-AC04 | tenant POST → `create tenant` + `create user`; PATCH/lock/unlock → update/lock/unlock · tenant_id = tenant |
| AW2 | M4-AC04 | users POST/PATCH/lock/unlock → create/update/lock/unlock · acme; reset → `update`, `summary.password_reset`, `config_version NULL` |
| AW3 | M4-AC04 | groups POST/PATCH/DELETE · snapshot true; member thêm/bớt → `update`, `summary.added/removed`, before/after null |
| AW4 | M4-AC04 | grant POST/DELETE → grant/revoke, `summary.subject_*`, `feature_key`; batch 3 cặp đổi + 1 có sẵn → 3 dòng |
| AW5 | M4-AC04 | entitlement PUT/DELETE → grant/revoke · entitlement · tenant được cấp |
| AW6 | M4-AC04 | (thêm: POST command `input_map` có khoá `password`/`value`/`iv` → 201, 1 dòng audit, không 500) workflow/command/feature POST/PATCH/DELETE → create/update/delete · NULL · snapshot true; command `entity_name '/dich'`; `entity_version` = version sau; delete `after null` |
| AW7 | M4-AC04 | secret POST/PUT giá trị/PATCH note/DELETE → create/update/update/delete · secret · NULL; PUT giá trị: `summary.value_changed true` |
| AW8 | M4-R10 | mỗi dòng: `actor_id`, `actor_username` = người gọi; `config_version` = `v` của NOTIFY cùng thao tác (listener từ mốc) |
| AW9 | M4-R10 | no-op (PATCH không đổi, grant đã có, entitlement đã có, PUT quota cùng bộ: Q10) → 0 dòng (sentinel `POST group globex`) |
| AW10 | M4-R10 · M4-AC04 | `testHooks.afterLock` ném ở bước `bump` khi PATCH `/dich` → 500, `/dich` không đổi, 0 dòng audit |
| AW11 | Q6 | login, refresh, logout, tự đổi mật khẩu, sai mật khẩu → 0 dòng |
| AW12 | M4-R10 | 409 `VERSION_CONFLICT`, 400 validate, 404 → 0 dòng |
| AS1 | BR-04 · M4-AC05 | tạo user pw `Leak-M4-Pw-1`, reset, secret `LEAK_1` → `LEAK_2`: `row_to_json` dòng `seq > mark` không chứa mật khẩu, `leakForms(LEAK_1/2)`, khoá `password_hash/totp_secret/ciphertext/iv/last4/token_hash` |
| AS2 | BR-04 | detail audit secret: `before/after` chỉ `name`, `note` |

### AR · Đọc audit (`M4/audit-read.int.test.ts`) — FR-51, M4-R12, AC-A09

Dữ liệu: owner chèn 6 dòng acme, 3 globex, 3 NULL, `entity_name` tiền tố `ar-{mark}-` (audit tích luỹ giữa các lần chạy), lọc `q` theo tiền tố.

| # | Mã | Kỳ vọng |
|---|---|---|
| AR1 | M4-R12 · M4-AC07 | binh không `tenant_id` → chỉ 6 dòng acme; mọi item `restorable false` |
| AR2 | BR-09 · AC-A09 | binh `tenant_id=globex` / `system` → 404; binh `GET /audit/:id` dòng globex/NULL → 404 |
| AR3 | M4-R12 | admin: không lọc → 12; `system` → 3 (tenant_id null); `acme` → 6 |
| AR4 | M4-R12 | `limit 5` → 5 + `next_cursor`; trang 2 cursor → 5, trang 3 → 2, `next_cursor null`; không trùng, `seq` giảm liên tục; `cursor "!!"` → 400 |
| AR5 | M4-R12 | lọc `entity`, `action`, `actor_id`, `entity_id`, `q`, `from/to` (dòng 31 ngày trước chỉ hiện khi lùi `from`) |
| AR6 | FR-51 | detail parse strict (`before/after`, `summary`, `tenant_key`); admin `restorable` = `canRestore` (update command true, lock user false) |
| AR7 | M4-AC12 | an `GET /audit`, `/audit/:id` → 403; `limit 201` → 400 |

### RS · Khôi phục (`M4/restore.int.test.ts`) — FR-52, M4-R13, Q7, Q8

Dữ liệu: owner đặt `/dich` version 42, admin PATCH `description` "B" (→ v43, audit E43).

| # | Mã | Kỳ vọng |
|---|---|---|
| RS1 | FR-52 · M4-AC08 | restore E43 → 200 `{command, version 44}`; nội dung = trước; 1 audit `restore` (`restored_from` E43, `restored_version 43`, snapshot); 1 NOTIFY; E43 không đổi |
| RS2 | M4-R13 | sau RS1 PATCH (v45), restore E43 → 409 `VERSION_CONFLICT`, `current` parse `CommandSchema`; 0 audit |
| RS3 | M4-R13 · M4-AC08 | PATCH tên `dich`→`dich2` (Er); tạo command mới `dich`; restore Er → 409 `NAME_TAKEN` `{command, dich}` |
| RS4 | M4-R13 | DELETE `tom-tat` (Ed) → restore → **cùng id**, version = before + 1; lần 2 → 409 `NOT_RESTORABLE` |
| RS5 | M4-R13 | DELETE command rồi DELETE workflow của nó → restore command → 409 `RESTORE_REF_MISSING` `details.missing [{workflow, id}]` |
| RS6 | M4-R13 | feature xoá kèm `command_ids` có command đã xoá → khôi phục bỏ id mất; group xoá có member → khôi phục **không** member/grant |
| RS7 | Q9 | quota PUT 2 lần → restore dòng mới nhất → items = bản trước, tenant version +1, 1 NOTIFY `quota` tenant acme |
| RS8 | Q7 | restore dòng user update / tenant update / secret / grant / lock / create command → 409 `NOT_RESTORABLE` |
| RS9 | Q8 · M4-AC07 | binh restore dòng acme / uuid lạ → 403 (trước tra); an → 403; admin uuid lạ → 404; body `{"x":1}` → 400 |
| RS10 | M4-R13 | workflow, feature, group update → restore được (1 ca/entity, version +1) |

### UB · `updated_by` (`M4/updated-by.int.test.ts`) — M4-R17, TD #7, CR-016

| # | Mã | Kỳ vọng |
|---|---|---|
| UB1 | M4-R17 | chi PATCH `lan` → `updated_by "chi"` (API + DB) |
| UB2 | M4-R17 | admin PATCH tenant acme → `updated_by "admin"`; khoá/mở tenant cũng ghi |
| UB3 | M4-R17 · FR-55 | PATCH user/tenant version cũ → 409, `details.current.updated_by` = username người sửa trước |
| UB4 | M4-R17 | admin sửa `lan`; binh xem → `updated_by null` (RLS), không lỗi |

### N · NOTIFY / `config_version` (`M4/notify.int.test.ts`)

| # | Mã | Kỳ vọng |
|---|---|---|
| N1 | Q9 · M4-R10 | PUT quota → đúng 1 `config_changed` `{v, entity "quota", tenant_id acme}` parse strict; `v` = `audit.config_version` |
| N2 | M4-R13 | restore → 1 NOTIFY entity gốc; restore lỗi (409) → 0 (sentinel) |
| N3 | Q2b | evaluator gửi mail → 0 `config_changed` (sentinel) |

### F · Quyền chéo (`M4/forbidden.int.test.ts`) — M4-AC12, BR-09

| # | Kỳ vọng |
|---|---|
| F1 | an (member) → 403 cho: GET/PUT quotas, `quota-banner`, `usage`, `usage.csv`, `overview`, `audit`, `audit/:id`, `restore` |
| F2 | binh → 403: PUT quotas, restore; 404: quotas/usage/usage.csv/audit của globex |
| F3 | không token → 401 |

### E · e2e — phụ lục [test-plan-ab-e2e.md](test-plan-ab-e2e.md) (E1–E22; chạy `bunx playwright test e2e/m4-`)

## 4. AC → test (chốt M4-AC01–14; sửa/thêm)

| AC | Chốt | Test |
|---|---|---|
| AC-A12 | vế Admin (mail + banner + `overage` báo cáo) | AL10, AL11, U1, E10 |
| AC-A09 | + quotas, usage, csv, audit | Q8, U6, C3, AR2, F2 |
| M4-AC01 / 02 | giữ | AL1, AL2, AL11 / Q1, AL7, E3, E11 |
| M4-AC03 | **sửa**: quét chuỗi, + khoá `tenants` | U5, C2, E6 |
| M4-AC04 | **sửa**: mọi thao tác plan §4.2; rollback qua hook | AW1–AW12 |
| M4-AC05 | **sửa**: + `iv`, `last4`, `token_hash`; secret chỉ `name`,`note` | AS1, AS2, R14, R15 |
| M4-AC06 | **sửa**: + TRUNCATE, owner bị trigger chặn | D7 |
| M4-AC07 / 08 | giữ | AR1, AR2, RS9, E18 / RS1, RS3, E15, E16 |
| M4-AC09–11 | khối C/D | test-plan-cd |
| M4-AC12 | **tách**: A+B ở đây, `/auth/totp/*` ở cd | F1, AR7, O6, E20 |
| M4-AC13 / 14 | **sửa** AC13: int + e2e / giữ | U8, O3, E9, E13 / UB3, E21 |
| M4-AC15 (mới) | Quota PUT: version tenant, 409 `current`, 1 NOTIFY, 1 audit | Q2, Q7, Q9, N1 |
| M4-AC16 (mới) | CSV BOM/CRLF/chống formula/cột theo role | R11, R12, C1, C2 |
| M4-AC17 (mới) | RLS 3 bảng mới; `hub_ro` chỉ đọc `tenant_quotas` | D5, D6, D8 |
| M4-AC18 (mới) | mail lỗi không hỏng ghi quota, giữ `pending` | AL5, AL6 |

Độ phủ A+B: FR MUST 40, 41, 42, 51 ✓ → **4/4 MUST**; FR-52 (SHOULD) ✓ → **+1 SHOULD**; BR-04 (vế audit), BR-09 ✓.

## 5. Sửa test đã khoá (phạm vi đã duyệt, không phải tranh chấp; Q2 sửa, Q3 khoá lại)

Tổng sau M4 (A+B+C+D): migration main **9** (`0007_m4_ops`, `0008_admin_totp`), dev **3** (`0002_usage_at_idx`); bảng admin **19** (+ `audit_log`, `quota_alerts`, `tenant_quotas`, `user_backup_codes`, `user_totp`); RLS bật **13**; `API_ERRORS` **48** (+3 A+B, +9 C+D). A+B sửa file đếm, qc C+D kiểm.

| # | File (dòng HEAD) | Sửa | Xanh |
|---|---|---|---|
| K1 | `ADM-NFR-06/migrate.int` (l.17–48, 147–165) | `ADMIN_TABLES` 19; `{main:9,dev:3}`, prod `{9,0}`; tiêu đề | T0, T0m, T9a |
| K2 | `M1/db-schema.int` (l.69–98, 282–285) | như K1; bỏ "không có `tenant_quotas`/`audit_log`"; giữ "users không `totp_secret`" | 〃 |
| K3 | `M2/db-schema.int` (l.53, 138–146, 460–464), `M3/db-schema.int` (l.51, 95–105, 437–440) | `ADMIN19`, `{9,3}`/`{9,0}`, bỏ "không có audit_log, tenant_quotas" | 〃 |
| K4 | `M1/db-rls`, `M2/db-rls` (l.275–293), `M3/db-rls` (l.290–307) | RLS bật 13 / tắt 6 | 〃 |
| K5 | `M1|M2|M3/rules/contracts` (l.55, 116, 70) | `toMatchObject` tập mã cũ (cách test-plan-cd §8), không đếm; đếm 48 chỉ ở R20 | T0b + T7 |
| K6 | `M3/rules/contracts` (l.118–129) | `CONFIG_ENTITIES` = `arrayContaining([...10 cũ,"quota"])` + length 11 (quota trước `"batch"`) | T0b |
| K7 | `M2/error-codes.int` (l.81–82) | lọc 12 mã M4 khỏi `M2_CODES`, giữ 11 | T0b/T7 |
| K8 | `M3/i18n-conflict` (l.106–116) | bỏ "không có 'Lịch sử'"; kiểm `conflict.overwrite.history` "Lịch sử vẫn giữ v{n}." | FE0a |
| K9 | `e2e/conflict-users`, `conflict-tenants` (ca 1) + `support/conflict.ts` | `user: "admin"` (R17), "Ghi đè thay đổi của admin?" | FE0a, T1b |
| K10 | `e2e/auth.spec.ts` (l.60–65) | `/Xin chào/` → `region "Users đang hoạt động"`; binh có `link "Chi phí & quota"`, `"Nhật ký"`, không `"Import / Export"` | FE3 |
| K11 | `M1/i18n-labels` (l.117–127) | xoá 4 hàng `overview.welcome/soon/platform.body/tenant.body` | FE3 |
| K12 | `e2e/support/prepare-db.ts`, `helpers.ts` | `DELETE hub.usage_logs` khi reset; re-export helper M4 | Q2 |
| K13 | không sửa | `M1/users*`, `tenants.int` parse `UserSchema`/`TenantSchema` strict: đỏ giữa T0b–T1b là dự kiến | — |

## 6. Danh sách file test sẽ tạo (Q2)

| Loại | File |
|---|---|
| helper | `M4/_data.ts`, `_fixtures.ts` (`createM4Env` = M3 env + mailer + listener), `_modules.ts` (nạp lười rules + `lib/mailer`) |
| rules | `M4/rules/quotas.rules.test.ts` (R1–R8), `usage.rules.test.ts` (R9–R13), `audit-snapshot.rules.test.ts` (R14–R15), `audit.rules.test.ts` (R16–R19), `contracts.test.ts` (R20) |
| int | `M4/db-schema.int`, `db-rls.int`, `quotas.int`, `quota-alerts.int`, `quota-alerts-proc.int`, `usage.int`, `usage-csv.int`, `overview.int`, `audit-write.int`, `audit-secrets.int`, `audit-read.int`, `restore.int`, `updated-by.int`, `notify.int`, `forbidden.int` (`.test.ts`) |
| i18n | `M4/i18n-ab.test.ts`: mọi nhãn e2e §3-E có làm giá trị trong `vi.json` |
| e2e (xem phụ lục) | `e2e/m4-quota.spec.ts`, `m4-usage.spec.ts`, `m4-overview.spec.ts`, `m4-audit.spec.ts`, `m4-conflict.spec.ts` |

Số ca dự kiến: rules ≈ 75 · int ≈ 105 · i18n 1 · e2e 22.

Xanh: rules/contracts T0b · db-* T0 · audit-write/secrets T1–T1c · updated-by T1b · audit-read T2 · quotas T3 · quota-alerts* T4 · restore T2b · usage* T5 · overview, forbidden T6 · e2e: quota FE1, usage FE2, overview FE3, audit FE4b, conflict FE0a.

## 7. Đỏ đúng lý do (điền ở Q2)

| File | Lệnh | Kết quả | Lý do đỏ |
|---|---|---|---|
| (Q2 điền) | `bun --env-file=.env.test-qc.local test tests/acceptance/M4/<file>` | | |

## 8. Đã chốt (spec-readiness lần 1, người dùng chấp nhận 2026-10-03)

PUT quota không chờ evaluate (AL dùng `expect.poll`); no-op → 200 không bump (Q10); `quota` trước `"batch"`; tooltip KPI `role=tooltip`; lệnh `bunx playwright test e2e/m4-`. proc AL10: env cổng/`SMTP_URL` theo plan §6 (backend-lead ghi vào plan nếu thiếu).

Cần bổ sung: backend-lead: `auditSnapshot` có còn ném ở chỗ nào khác ngoài `containsForbiddenKey` trực tiếp (R15)? qc đã bỏ ca ném trên `workflow.input_schema`.
