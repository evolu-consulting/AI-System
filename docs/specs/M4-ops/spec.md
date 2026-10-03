---
id: M4-ops
title: Chi phí & vận hành (Quota + cảnh báo, Chi phí & quota, Tổng quan, Audit + khôi phục, Import/Export, 2FA)
milestone: M4
status: draft                   # draft → ready → approved → in-progress → done
requirements: [ADM-FR-40, ADM-FR-41, ADM-FR-42, ADM-FR-51, ADM-FR-52, ADM-FR-54, ADM-FR-08, ADM-BR-04, ADM-BR-09, AC-A12, AC-A06, AC-A09]   # AC-A06: vế export; AC-A09: audit/usage/quota; AC-A12: phía Admin (ROADMAP M4)
design: [docs/ROADMAP.md#M4, docs/design/admin/ba-admin.md#56-quota--chi-phí, docs/design/admin/ba-admin.md#57-secret-audit-importexport, docs/design/admin/ba-admin.md#6-luật-nghiệp-vụ, docs/design/admin/ba-admin.md#7-mô-hình-dữ-liệu-schema-admin, docs/design/admin/ba-admin.md#8-api, docs/design/admin/ba-admin.md#11-tiêu-chí-nghiệm-thu-các-kịch-bản-chính, docs/design/admin/ui-admin.md#72-tổng-quan, docs/design/admin/ui-admin.md#710-nhật-ký-thay-đổi-audit, docs/design/admin/ui-admin.md#711-import--export, docs/design/admin/ui-admin.md#713-tenants, docs/design/admin/ui-admin.md#716-chi-phí--quota, docs/design/admin/ui-admin.md#f7-tenant-vượt-quota, docs/specs/_design/admin-missing-screens.md (mục 1 Tổng quan · 7 Nhật ký · 8 Import/Export · 10 2FA · 14 Cần backend-lead), docs/readiness/2026-10-01-admin-m1-m4.md, "canvas: TenantOverview · Main · TenantQuota · Usage · Audit · Enable2FA · ImportPreview · States"]
owner: backend-lead + frontend-lead
---

# M4 Chi phí & vận hành

Mốc: [ROADMAP M4](../../ROADMAP.md). Nền: [M1](../M1-foundation-identity/spec.md) (RLS scope, auth, `users.email/last_login_at`), [M2](../M2-catalog-command/spec.md) (secrets AES-GCM, catalog), [M3](../M3-permissions/spec.md) (`configWrite` + NOTIFY, `version`, `hub_ro`). Ưu tiên người dùng 2026-10-03: hoàn tất admin app đúng spec; đo hiệu năng **không chặn mốc** (ngân sách §6 là mục tiêu; test đo ở `test:perf`, ngoài Lệnh xong).

## 1. Phạm vi

**Làm** (4 khối; mỗi khối tách task riêng để có thể cắt M4a/M4b, xem §9 Q0):

| Khối | Nội dung | FR / BR | Artboard (chỉ trỏ) |
|---|---|---|---|
| A · Quota & chi phí | Tab Quota của tenant (đặt/sửa quota tháng), đánh giá ngưỡng 80/100%, email + banner, màn Chi phí & quota + CSV (đọc `hub.usage_logs`), Tổng quan (2 role) | FR-40, 41, 42 · AC-A12 | TenantQuota · Usage · TenantOverview · Main |
| B · Audit | Ghi audit cho **mọi** ghi cấu hình (kể cả module M1–M3), timeline + chi tiết diff, Khôi phục, `updated_by` cho users/tenants, vế "Lịch sử" của modal 409 | FR-51, 52 · TD #7, #9, #20 · CR-016 | Audit · States |
| C · Import/Export | Export yaml theo loại; Import dry-run + diff + "Cần tạo secret" + áp dụng | FR-54 · BR-04 · AC-A06 | ImportPreview |
| D · 2FA (TOTP) | Bật/tắt/mã dự phòng, bước nhập mã khi đăng nhập, tắt hộ user | FR-08 | Enable2FA (bước đăng nhập: không có artboard, mẫu D, Q10) |

**Không làm:**
- Chặn cứng khi vượt quota; kênh webhook/Slack (BA §12); `warn_pct` đổi được (cố định 80, RD#48).
- Phía Hub: đếm mức dùng, đánh dấu `overage`, menu/CMD_NOT_FOUND (M5). Admin chỉ **đọc** `usage_logs`.
- Card "Command lỗi nhiều nhất", "Agent Studio", số run lỗi (cần `hub.runs`): hiện "—" (Q5).
- Khôi phục user/tenant/secret/grant (Q7); import user, giá trị secret; xoá thực thể qua import; xoá tenant (CR-006).
- Giới hạn IP/VPN (RD#44); đo hiệu năng trong Lệnh xong; viết lại policy RLS InitPlan (TD #28).

## 2. Nghiệp vụ

Nguồn FR/BR/AC: [BA §5.6–5.7, §6, §11](../../design/admin/ba-admin.md). Bảng dưới chỉ ghi phần **cụ thể hoá** (`M4-Rnn`; mặc định từ readiness M1–M4 đã chấp nhận ở CR-001, hoặc đề xuất mới ở §9). `RD#n` = dòng n của [readiness](../../readiness/2026-10-01-admin-m1-m4.md).

| Mã | Nhóm | Một dòng yêu cầu BA |
|---|---|---|
| FR-40 | quota | `platform_admin` đặt quota tháng (run/token/USD), chung hoặc theo feature; mặc định không giới hạn |
| FR-41 | quota | Không chặn; cảnh báo 80% và 100% cho `tenant_admin` (email + banner); phần vượt do Hub đánh dấu `overage` |
| FR-42 | usage | Màn Chi phí & quota: KPI, QuotaBar, biểu đồ ngày, top feature, CSV; `cost_usd` chỉ `platform_admin` |
| FR-51 | audit | Audit mọi thay đổi cấu hình/user/group/quyền/quota: ai, lúc nào, tenant, thực thể, trước/sau; secret "đã đổi"; `tenant_admin` chỉ tenant mình |
| FR-52 | audit | Khôi phục thực thể về trạng thái "trước" của audit |
| FR-54 | transfer | Export/import yaml workflow, command, feature, tenant, group, grant; secret chỉ tên; import có diff trước khi áp dụng |
| FR-08 | 2FA | TOTP cho `platform_admin`, `tenant_admin` |
| BR-04 · BR-09 | chung | Secret không ra khỏi Admin (kể cả export, audit); `tenant_admin` truy cập tenant khác → 404 |

| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| M4-R01 | "Tháng" = `[ngày 1 00:00, ngày 1 tháng sau)` giờ `Asia/Ho_Chi_Minh`, trùng Hub | RD#31 |
| M4-R02 | `tenant_quotas`: unique (tenant_id, feature_id) NULLS NOT DISTINCT; `max_runs`/`max_tokens` nguyên > 0, `max_usd` numeric(12,2) > 0; trống = không giới hạn; `warn_pct` = 80 cố định | RD#16, 31, 48 |
| M4-R03 | Mức dùng: run = số `run_id` khác nhau, token = input + output, USD = `billable_usd` (hàng `NULL` bỏ qua, hiện "Chưa định giá"); quota theo feature đếm đúng `feature_id`, quota cả tenant đếm tất cả. % một quota = max các chiều có giới hạn | Q1 |
| M4-R04 | Ngưỡng 80 và 100: mỗi (tenant, feature\|null, level, month) cảnh báo **đúng một lần** (`quota_alerts` unique); không chặn, không đổi hành vi run | RD#10 |
| M4-R05 | Email tới mọi `tenant_admin` active có email của tenant; tiêu đề `[{tenant}] Đã dùng {pct}% quota tháng`; gửi **sau commit**; lỗi gửi chỉ log + giữ trạng thái để gửi lại, không làm hỏng ghi quota | RD#42, TD #13 |
| M4-R06 | Banner chỉ `tenant_admin`, tính từ mức dùng hiện tại (80–99 vàng, ≥ 100 cam); `platform_admin` không thấy; quota trống thì không banner | RD#42, missing §1 |
| M4-R07 | `overage` do Hub ghi; Admin chỉ hiển thị badge `Vượt quota` + tô vân chéo; không tự đánh dấu | BA FR-41 |
| M4-R08 | `GET /admin/usage`: `tenant_admin` bị ép tenant mình (tenant khác → 404); `cost_usd`/biên **vắng hẳn khỏi response và CSV** của `tenant_admin` (loại ở server); null: "Chưa định giá", "Không theo feature"; CSV UTF-8 BOM theo bộ lọc | RD#32, BR-09 |
| M4-R09 | Hub chưa có dữ liệu (`usage_logs` rỗng): KPI "—" + tooltip "Chưa có dữ liệu từ Agent Hub"; không báo lỗi | RD#33 |
| M4-R10 | Audit ghi **trong cùng transaction** với thay đổi (commit mới có audit, rollback thì không); `before/after` theo allowlist trường từng thực thể, **không bao giờ** có `password_hash`, `totp_secret`, `ciphertext`, hash token; secret chỉ "đã thay giá trị"; action ∈ create/update/delete/lock/unlock/grant/revoke/restore/import; thực thể toàn hệ thống `tenant_id = NULL`; kèm `config_version` | RD#36, BR-04 |
| M4-R11 | `audit_log` chỉ thêm: không UPDATE/DELETE (quyền DB + test); không backfill thay đổi trước M4 (TD #9, #20 đóng khi R10 phủ mọi module) | TD #20 |
| M4-R12 | Đọc audit: `tenant_admin` chỉ tenant mình, chỉ đọc; `platform_admin` lọc tenant + "Toàn hệ thống"; limit 50, phân trang con trỏ | missing §7 |
| M4-R13 | Khôi phục: chỉ `platform_admin`; tạo **phiên bản mới** (không sửa lịch sử), ghi audit `restore`; trùng tên → 409 `NAME_TAKEN`; thực thể đã đổi sau đó (version lệch) → 409 `VERSION_CONFLICT`; phạm vi: Q7 | RD#36, ui 7.10 |
| M4-R14 | Export: chọn loại, tham chiếu bằng **key** (không id), `config-v{config_version}.yaml`, secret chỉ tên. Import: zod `ConfigFileSchema`, upsert theo key, **không xoá**, `dry_run` không ghi gì, áp dụng trong **một transaction** + một audit `import` + một NOTIFY; file ≤ 1 MB | RD#37, BR-04 |
| M4-R15 | Import file tham chiếu secret chưa có → `missing_secrets[]`; áp dụng nhận `secrets:{NAME:value}`, thiếu thì từ chối | missing §14.7 |
| M4-R16 | 2FA tuỳ chọn, tự bật; `totp_secret` mã hoá AES-GCM (master key như secret); mã dự phòng 10 × 8 ký tự dùng một lần, lưu dạng hash; mã sai tính chung bộ đếm FR-07; mã đã dùng không dùng lại trong cùng bước 30 s; `totp_token` 5 phút | missing §10, §15.3 |
| M4-R17 | `users.updated_by`, `tenants.updated_by` (TD #7): modal 409 hiện `{user}` cho mọi editor và vế "Lịch sử vẫn giữ v{n}" khi có audit | CR-016 |

## 3. Contract (backend-lead)
File đề xuất: `packages/contracts/src/{quotas,usage,overview,audit,transfer,totp}.ts`. Điểm xuất phát: [BA §8](../../design/admin/ba-admin.md), [missing-screens §14](../_design/admin-missing-screens.md) (mục 1, 6, 7, 8). Mã lỗi mới liệt kê tại đây.
<!-- backend-lead -->

## 4. Dữ liệu (backend-lead)
Điểm xuất phát: [BA §7](../../design/admin/ba-admin.md) (`tenant_quotas`, `audit_log`), cột TOTP của `users`, `quota_alerts`, `updated_by`; quyền `hub_ro` đọc `usage_logs` đã có (M3). RLS: bảng mới theo mẫu M1/M3.
<!-- backend-lead -->

## 5. UI (frontend-lead)
Màn → nguồn (chỉ trỏ; trạng thái/câu chữ do frontend-lead điền ở `plan-frontend.md`):

| Màn | Route | Artboard | Nguồn |
|---|---|---|---|
| Tenant › tab Quota | `/tenants/:id` | TenantQuota | missing §4.3, ui 7.13 |
| Chi phí & quota | `/usage` | Usage | ui 7.16 |
| Tổng quan (2 role) + banner | `/` | Main · TenantOverview | ui 7.2, missing §1 |
| Nhật ký + chi tiết | `/audit`, `/audit/:id` | Audit · States | missing §7 |
| Import/Export | `/transfer` | ImportPreview (Export: không artboard, theo missing §8) | missing §8 |
| 2FA bật/tắt; bước đăng nhập | `/account/2fa`, `/login` | Enable2FA (đăng nhập: không artboard, mẫu D) | missing §10 |

<!-- frontend-lead -->

## 6. Hiệu năng
Mục tiêu (**không chặn mốc**, đo ở `test:perf`): báo cáo chi phí một tháng < 2 s (ADM-NFR-03); CRUD < 300 ms. Chỉ mục `usage_logs (tenant_id, at)` đã có. Audit list limit 50.

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| `hub.usage_logs` | migration `hub-stub` + seed mẫu; `bun run mock:quota` ghi hàng tới ngưỡng/`overage` (RD#10) |
| SMTP | Mailpit (`SMTP_URL=smtp://localhost:1025`), test đọc API Mailpit |
| Thư viện mới (QR, mail, biểu đồ) | Q3: ADR-0004 trước Gate |
<!-- backend-lead: env mới -->

## 8. Tiêu chí nghiệm thu (qc)

Nguyên văn BA ([§11](../../design/admin/ba-admin.md)):

> **AC-A12 · Vượt quota**
> Given `acme` có quota 1.000 run/tháng và đã dùng 999, When user chạy thêm 2 run, Then cả 2 run đều chạy; tenant admin nhận cảnh báo 100%; run thứ 1.001 được đánh dấu `overage` trong báo cáo.
> *Phía Admin ở M4 (ROADMAP): stub/`mock:quota` ghi 1.001 hàng, hàng thứ 1.001 mang `overage` do "Hub"; Admin kiểm cảnh báo 100% (email + banner) và `overage` trong báo cáo. Vế "2 run đều chạy" thuộc Hub, M5 (Q2).*

> **AC-A06 · Secret**
> When gọi `GET /admin/secrets` hoặc export, Then kết quả chỉ có tên và last4, tuyệt đối không có giá trị thật.
> *M4 kiểm vế export (`GET /admin/export`); `GET /admin/secrets` đã xanh ở M2.*

> **AC-A09 · Cách ly tenant**
> Given tenant admin của `acme`, When gọi `GET /admin/users/:id` với id của user thuộc tenant `globex`, Then nhận 404.
> *M4 mở rộng cho `usage`, `audit`, `quotas` của tenant khác (M4-R08, R12).*

AC bổ sung (đề xuất; qc chốt ở Q1, mã `M4-ACnn`):

| AC | Given / When / Then | Test |
|---|---|---|
| M4-AC01 | Quota cả tenant 1.000 run, dùng 800 (≥ 80%): đúng 1 email + banner vàng; chạy lại evaluator không gửi thêm (R04) | int |
| M4-AC02 | Quota trống: không email, không banner, QuotaBar "Không giới hạn" | int + e2e |
| M4-AC03 | `tenant_admin` gọi `/admin/usage`: không có khoá `cost_usd`/biên, CSV cũng không; `platform_admin` có (R08) | int |
| M4-AC04 | Tạo/sửa command (M2), cấp grant (M3), khoá user (M1), đổi quota: mỗi cái đúng 1 dòng audit cùng transaction; rollback thì 0 dòng (R10) | int |
| M4-AC05 | `before/after` của user/secret không chứa `password_hash`/`totp_secret`/`ciphertext`/giá trị secret (R10, BR-04) | int |
| M4-AC06 | `audit_log` không UPDATE/DELETE được bằng role app (R11) | int |
| M4-AC07 | `tenant_admin` thấy audit tenant mình, không có nút Khôi phục, `POST restore` → 403; audit tenant khác → 404 | int + e2e |
| M4-AC08 | Khôi phục command về trước v43: v44 mới có nội dung cũ, 1 dòng audit `restore`; tên bị chiếm → 409 `NAME_TAKEN` (R13) | int + e2e |
| M4-AC09 | Export: yaml có tên secret, không giá trị; import dry-run: `Thêm/Sửa/Không đổi` đúng, không ghi DB (R14) | int + e2e |
| M4-AC10 | Import thiếu secret: không áp dụng được tới khi nhập đủ `secrets{}`; áp dụng: 1 transaction, 1 audit `import`, 1 NOTIFY; không xoá thực thể ngoài file (R14, R15) | int + e2e |
| M4-AC11 | Bật 2FA: QR, mã đúng, 10 mã dự phòng hiện một lần; đăng nhập đòi mã; mã dự phòng dùng được 1 lần; sai 5 lần thì khoá tạm 15 phút (R16) | int + e2e |
| M4-AC12 | `member` không thấy/gọi được `/auth/totp/*`, `/audit`, `/usage` | int |
| M4-AC13 | Hub chưa có dữ liệu: Tổng quan và Chi phí hiện "—" + tooltip, không lỗi (R09) | e2e |
| M4-AC14 | Modal 409 của user/tenant hiện `{user}` và vế "Lịch sử" khi có audit (R17) | e2e |

Lệnh xong: `bun run typecheck && bun test && bunx playwright test M4` (+ Lệnh xong M0 mở rộng cho M4, **không** gồm `test:perf`).

## 9. Quyết định
### Trước Gate (đã chốt với người dùng)
- Mặc định readiness Admin M1–M4 đã chấp nhận (CR-001); 2FA + Import/Export vào M4 khi đủ artboard (CR-002): canvas có 6/8 màn (TenantQuota, Usage, TenantOverview/Main, Audit, ImportPreview, Enable2FA); thiếu bước đăng nhập 2FA và tab Export.
- Hiệu năng không chặn mốc (2026-10-03). Ưu tiên: hoàn tất admin để người dùng test service.
- RD#10, 16, 31, 32, 33, 36, 37, 42, 48 đã đưa vào §2 (tick trong readiness).

### Câu hỏi mở (chờ Gate; mặc định đề xuất, người dùng chấp nhận = "đồng ý")
| # | Mơ hồ / mâu thuẫn | Mặc định đề xuất |
|---|---|---|
| Q0 | M4 lớn (4 khối, nhiều task rủi ro cao). Tách? | **Giữ một spec**; task xếp theo khối A, B, C, D. Nếu quá hạn thì cắt **M4a = A + B** (chi phí + audit, dính nhau qua audit quota) và **M4b = C + D** (Import/Export + 2FA: độc lập, mỗi khối rủi ro bảo mật riêng) |
| Q1 | BA không nói "run" đếm gì, USD tính theo cột nào | R03: `run_id` khác nhau, `billable_usd` (giá thu, tenant thấy được) |
| Q2 | AC-A12 có vế Hub ("2 run đều chạy"), Hub chưa có | Admin kiểm phía Admin bằng `mock:quota`/stub; vế Hub ghi đầu vào M5 (như CR-015) |
| Q2b | Ai phát ngưỡng khi chưa có Hub? | Admin có hàm `evaluateQuota(tenant)` chạy: sau `PUT quotas`, khi nhận NOTIFY `quota_threshold` từ Hub/mock, và khi mở Tổng quan/banner (tính trực tiếp). Không job định kỳ |
| Q3 | Email/QR/biểu đồ cần thư viện mới | `nodemailer` (SMTP), `qrcode`, `recharts` (RD#40); TOTP tự viết bằng `node:crypto` (RFC 6238). **ADR-0004** liệt kê trước Gate (Luật 2b: thêm thư viện thì trình Gate) |
| Q5 | Tổng quan platform cần `hub.runs` (run lỗi, provider) không có | Chỉ dùng `usage_logs`: run 24 giờ, tenant sắp/đã vượt quota; card "Command lỗi nhiều nhất", "Agent Studio" hiện "—"/"Chưa khả dụng" |
| Q6 | FR-51 "mọi thay đổi" nhưng M1–M3 chưa ghi | Ghi qua điểm chung `configWrite` + thao tác user/tenant (khoá, reset, tắt 2FA hộ); login/refresh **không** ghi; không backfill |
| Q7 | FR-52 không nêu thực thể nào khôi phục được | Khôi phục: command, workflow, feature, group, quota (update/delete). **Không**: user, tenant (tránh khôi phục role/mật khẩu), secret, lock/unlock, grant/revoke (đảo bằng thao tác thường) |
| Q8 | `tenant_admin` có khôi phục trong tenant mình? (BA §8: chỉ đọc) | Không (missing §15.6) |
| Q9 | Quota có `version` (FR-55)? BA chỉ liệt kê command/workflow/feature/group/user | `PUT /admin/tenants/:id/quotas` thay cả bộ trong một transaction, gửi `version` của tenant; lệch thì 409 |
| Q10 | Bước đăng nhập 2FA chưa có artboard | Theo missing §10.2 (mẫu D; thứ tự mật khẩu, mã, đổi mật khẩu bắt buộc); 2FA tuỳ chọn; admin tắt hộ user trong phạm vi quản lý, ghi audit (missing §15.3–4) |
| Q11 | Import `tenants` có thể tạo tenant không có `tenant_admin` (vi phạm BR-08) | Import tenant chỉ **sửa** (tên, slot, quota); tenant chưa tồn tại thì lỗi dòng "tạo ở trang Tenants". Grants tham chiếu (tenant key, group key, feature key) |
| Q12 | Banner có đóng được? | Không; biến mất khi dưới 80% |
| Q13 | ROADMAP: "cần artboard trước Gate M4" nhưng thiếu Export + bước đăng nhập 2FA | Dùng mô tả missing-screens (như M1–M3); vẽ sau, không chặn |

### Trong lúc làm (agent tự quyết theo Luật 2)
- (chưa có)

## 10. Tranh chấp test
- (không)
