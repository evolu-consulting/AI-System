---
id: N5-identity
title: Định danh chung — chuyển tài khoản user mgmt-app sang admin-api
milestone: GĐ1 · đợt 2 CR-094
cr: CR-094
status: review
requirements: [N5-FR-01, N5-FR-02, N5-FR-03, N5-FR-04, N5-FR-05, N5-FR-06, N5-FR-07, N5-NFR-01, N5-NFR-02]
design: [docs/adr/0018-single-identity-sso.md, docs/platform/intake-hd.md (N5, câu 11), docs/specs/N1-pack-frame/spec.md (PK-FR-05)]
owner: backend-lead (một agent một lát, làn đầy đủ: auth/mật khẩu/tenant)
---

# N5 · Chuyển tài khoản user mgmt-app

ADR-0018 §1–2: admin-api là nguồn đăng nhập duy nhất; tổ chức mgmt-app → tenant; owner/editor/viewer → 3 Group gói `contracts` (N1 PK-FR-05, câu 11). Lát này dựng **công cụ admin chạy một lần** (CLI), không phải route HTTP.

## 1. Phạm vi
| Làm | Không làm |
|---|---|
| Schema file export (JSON `mgmt-app-users/v1`), CLI dry-run mặc định, nhập theo lô, báo cáo đối soát | SSO OIDC (ADR-0018 §3, GĐ2) |
| Tạo tenant (nếu chưa có) + bật gói `contracts` (3 entitlement, 3 Group vai, 6 grant) | Gửi link đặt lại mật khẩu (N3 — chỉ để cờ) |
| Tạo user, gán Group vai; mật khẩu: nhập hash nếu tương thích, không thì buộc đặt lại | Đổi luồng đăng nhập/contract auth (dùng cờ sẵn có `must_change_password`) |
| Audit mỗi tenant/user tạo mới | Bỏ bảng user của mgmt-app, ghi kép (HD10) |

## 2. Yêu cầu
| Mã | Yêu cầu |
|---|---|
| N5-FR-01 | **Schema đầu vào** `{format:"mgmt-app-users/v1", orgs:[{id, name, tenant_key?}], users:[{email, name, org_id, org_role: owner\|editor\|viewer, password_hash: string\|null, locale?}]}`; file sai cấu trúc ⇒ dừng, không ghi gì; hàng sai ⇒ lỗi theo hàng, hàng khác vẫn chạy. Chỉ JSON (CSV không cần: export mgmt-app là Python, xuất JSON dễ nhất). |
| N5-FR-02 | **Org → tenant**: khớp theo `tenants.settings.mgmt_org_id`; chưa có ⇒ tạo với `key` = `tenant_key` hoặc slug tên (bỏ dấu, `[a-z0-9-]{2,32}`), không ra slug ⇒ `org-<fnv8(id)>`. Key đã thuộc tenant khác (không cùng `mgmt_org_id`) ⇒ lỗi `ORG_KEY_TAKEN`, user của org đó ⇒ `ORG_FAILED`. Tenant mới/cũ đều được bật gói `contracts` (idempotent như PUT packs). |
| N5-FR-03 | **User**: khớp theo `(tenant_id, lower(email))`; đã có ⇒ không đổi gì của user (mật khẩu, vai), chỉ đảm bảo thuộc Group vai (`existing`). Mới ⇒ `username` = phần trước `@` chuẩn hoá `[a-z0-9._-]{2,32}`; trùng trong tenant ⇒ `<≤23 ký tự>-<fnv8(email)>`; vẫn trùng ⇒ lỗi `USERNAME_TAKEN`. Vai admin-api: owner ⇒ `tenant_admin`, editor/viewer ⇒ `member`; không bao giờ `platform_admin`. User không org/vai lạ ⇒ lỗi hàng. |
| N5-FR-04 | **Mật khẩu**: hash là PHC `argon2id` (v=19) với `m ≥ 19456`, `t ≥ 2` (≥ tham số admin-api, `packages/db/src/password.ts`) ⇒ nhập nguyên hash, `must_change_password=false`. Khác (scrypt của mgmt-app, bcrypt, rỗng, user chỉ Google) ⇒ **buộc đặt lại**: hash argon2id của bí mật ngẫu nhiên đã huỷ (một hash mỗi lần chạy, không ai biết mật khẩu ⇒ không đăng nhập được, thời gian verify như user thường) + `must_change_password=true` + audit `summary.reset_required=true` (cờ cho N3 gửi link). |
| N5-FR-05 | **Báo cáo đối soát** JSON: `orgs/users` × `read/created/existing/errors`, `users.hash_imported/reset_required`, `issues[{kind, ref, code}]` (ref = org id hoặc email), `accounts`, `batches`, `ms` (số câu mỗi lô đo ở test perf). Mã thoát 0 khi không lỗi, 2 khi có lỗi hàng, 1 khi lỗi file/hệ thống. |
| N5-FR-06 | **Dry-run mặc định**: không cờ `--apply` ⇒ chỉ đọc (cùng câu đọc), báo cáo số *sẽ* tạo; không ghi, không bump, không NOTIFY. |
| N5-FR-07 | **Idempotent + cách ly tenant**: chạy lại cùng file ⇒ 0 tạo mới, không nhân đôi Group/thành viên/audit; mọi câu ghi có `tenant_id` tường minh; user chỉ vào Group của **tenant của org mình**; tenant khác không bị đụng. Ghi qua role `admin_api` scope `platform` (RLS bật), `actor` = platform admin còn hoạt động (bắt buộc, kiểm trước khi chạy). |
| N5-NFR-01 | **Theo lô (Luật 4c)**: lô user 500 (tối đa 1000); mỗi lô số câu SQL cố định (đọc 1 · chèn user 1 · chèn thành viên 1 · bump 1 · audit 1 + đặt scope), dữ liệu lô qua **một** tham số JSON; không truy vấn từng hàng. 10.000 user ≤ 30 s trên máy dev (ghi số thật). |
| N5-NFR-02 | **Không lộ hash**: không log/báo cáo/audit chứa hash hoặc mật khẩu; lỗi Postgres chỉ ghi SQLSTATE (không message — 23514 "Failing row contains" chứa giá trị hàng). |

## 3. Luồng
`bun --env-file=.env.local apps/admin-api/src/modules/identity-import/identity-import.cli.ts --file export.json --actor <uuid> [--apply] [--batch 500]` → đọc + zod → kiểm actor → lô org (một tx `configWrite`) → lô user (mỗi lô một tx) → in báo cáo JSON ra stdout.

## 4. Dữ liệu
Không migration. Dùng: `admin.tenants.settings.mgmt_org_id` (jsonb sẵn có, chưa ai dùng), `admin.users` (chỉ mục `users_tenant_email_uq`), `admin.groups/group_members/feature_grants/feature_entitlements`, `admin.audit_log` (enum sẵn `create` tenant, `import` user).

## 6. Bảo mật
Role `admin_api` NOBYPASSRLS, scope platform. Actor phải `platform_admin` active. Không nhập `platform_admin`. Hash chỉ đi vào câu chèn (tham số JSON), không vào log/report/audit.

## 7. Quyết định trong lúc làm
- Q-hash: mgmt-app dùng scrypt (ADR-0018 bối cảnh) — Bun.password không verify scrypt ⇒ thực tế mọi user mgmt-app ⇒ buộc đặt lại; nhánh nhập hash chỉ cho argon2id đủ mạnh (không nhận bcrypt để không hạ chuẩn M1 §6).
- Cờ đặt lại = `must_change_password` sẵn có + audit `reset_required` — không thêm cột/migration (tránh đụng contract auth đã khoá và journal migration của lát song song). N3 cần bảng/cột riêng thì N3 thêm.
- Owner ⇒ `tenant_admin` (owner mgmt-app mời thành viên ≈ quản trị tenant); mgmt-app `role=admin` toàn app bỏ qua.
- Mã lỗi CLI là chuỗi trong báo cáo, không thêm vào `@ai/contracts` (không phải API).

### Áp mặc định readiness vòng 1 (9 Cao, không vòng 2 — Luật 1b)
| # | Chốt |
|---|---|
| R1 | Domain kiểm trước mọi CHECK (username regex, email ≤ 254, display_name 1..64, tenant name 1..128). Lỗi DB còn sót ⇒ rollback lô đó, mọi hàng của lô ⇒ `BATCH_FAILED` (chỉ SQLSTATE), lô sau vẫn chạy, exit 2. File sai cấu trúc / actor sai / gói chưa cài ⇒ exit 1, không ghi gì. |
| R2 | Hàng: email `^[^@\s]+@[^@\s]+$` ≤ 254 (sai ⇒ `INVALID_EMAIL`); hàng không đúng kiểu ⇒ `BAD_ROW` (ref = `users[i]`/`orgs[i]`, không chép giá trị); `name` rỗng ⇒ phần trước `@`, cắt 64; `locale` thiếu ⇒ `vi`; org trùng id ⇒ `DUP_ORG` (giữ hàng đầu); email trùng (không phân biệt hoa thường) ⇒ hàng sau `DUPLICATE_EMAIL`; `org_id` null ⇒ `NO_ORG`, lạ ⇒ `UNKNOWN_ORG`, org lỗi ⇒ `ORG_FAILED`; vai lạ ⇒ `BAD_ROLE`; org không user vẫn tạo tenant. |
| R3 | `fnv8` = FNV-1a 32-bit trên mã UTF-16 (domain không dùng `TextEncoder`), hex 8 thường. slug tenant: NFD bỏ dấu, `đ→d`, lowercase, ngoài `[a-z0-9]` ⇒ `-`, gộp `-`, cắt `-` hai đầu, cắt 32; < 2 ⇒ `org-<fnv8(id)>`. username: như trên nhưng giữ `._-`, < 2 ⇒ thêm `-u`; fallback `<≤23>-<fnv8(email)>`. Bảng ví dụ = `domain/import.rules.test.ts`. |
| R4 | Xung đột trong file phân giải ở domain (key ⇒ `DUPLICATE_KEY`; username ⇒ fallback). Hàng `on conflict do nothing` không trả về (đua) ⇒ issue `USERNAME_TAKEN` / `ORG_KEY_TAKEN`, không nuốt im. |
| R5 | Gói: dùng `packs.rules` (`packFeatureKeys`, `roleGroupRows`, `roleGrantPairs`) như PUT packs; thiếu 3 feature `contracts-*` ⇒ exit 1 `PACK_NOT_INSTALLED`. |
| R6 | Tenant khớp nhưng `active=false` ⇒ `TENANT_INACTIVE` (user ⇒ `ORG_FAILED`). User đã có (kể cả inactive/khoá) ⇒ không đổi trạng thái; đã thuộc Group vai **khác** của gói ⇒ không thêm, `ROLE_CONFLICT` (an toàn hơn thêm: tránh nâng quyền ngầm). Key trùng mà thiếu `mgmt_org_id` ⇒ `ORG_KEY_TAKEN`. |
| R7 | Nhập hash chỉ khi PHC argon2id chặt, `v=19`, `19456 ≤ m ≤ 262144`, `2 ≤ t ≤ 10`, `1 ≤ p ≤ 4`, dài ≤ 256 (trần chặn DoS bộ nhớ). Bí mật hash không dùng được: 32 byte CSPRNG. |
| R8 | Audit: tenant mới ⇒ `create`/`tenant`; bật gói ⇒ `grant`/`entitlement` `summary.op=pack.enable` (như PUT); user mới ⇒ `import`/`user`, `summary {op:"identity.import", source:"mgmt-app", reset_required, hash_imported}`; thêm thành viên cho user đã có ⇒ một hàng `grant`/`group` mỗi tenant (`summary.added`). Lô không đổi ⇒ không bump/audit. Actor không phải platform admin active ⇒ exit 1 `ACTOR_INVALID`. Role DB: đăng nhập `admin_api` (thành viên `admin_rw`, NOBYPASSRLS). |
| R9 | Đếm câu bằng hook `options.debug` của pool postgres.js (bỏ begin/commit/notify). Ngưỡng: lô user apply ≤ 6 (gồm `set_config`), dry-run ≤ 2, lô org ≤ 10; 10.000 user ≤ 30 s (máy dev, ghi số thật). |
| B1 | (BUILD, đo) Khớp user theo `(tenant, username ứng viên)` thay vì `lower(email)`: dưới RLS `lower()` không leakproof ⇒ không dùng index ⇒ seq scan 261 ms/lô (10.000 user); lọc leakproof qua `users_tenant_username_uq` ⇒ ~1 ms. Email so ở domain. User tạo tay cùng email khác username ⇒ chèn đụng `users_tenant_email_uq` ⇒ `USER_CONFLICT` (không tạo, không gán Group — vận hành gán tay). |
| L | Báo cáo có `accounts[{tenant_key, email, username, reset_required}]` cho user mới (không hash) để vận hành/N3 biết tên đăng nhập. User buộc đặt lại **không đăng nhập được tới khi N3** gửi link. |
