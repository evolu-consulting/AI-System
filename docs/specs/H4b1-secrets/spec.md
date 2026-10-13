---
id: H4b1-secrets
title: H4b-1 · Secrets của Hub (chỉ ghi, AES-256-GCM) — provider key, source_credential, khoá KnowledgeHub
milestone: H4b-1 (tách từ H4b, người dùng 2026-10-13: ưu tiên ai-sdlc)
status: draft            # khung do docs-architect 2026-10-13; chưa PLAN/readiness/Gate
requirements: [HUB-FR-68, HUB-FR-69, HUB-BR-30, HUB-BR-15, AC-H4b1-01, AC-H4b1-02, AC-H4b1-03, AC-H4b1-04, AC-H4b1-05, AC-H4b1-06, AC-H4b1-07, AC-H4b1-08]
design:
  - docs/design/agent-hub/ba-agent-hub.md#HUB-FR-68 (dòng ~211) · HUB-FR-04 (dòng ~137, key riêng, không log) · HUB-FR-69 (audit)
  - docs/design/agent-hub/ba-agent-hub.md HUB-FR-120 (nguồn `git_remote` repo riêng → secret `source_credential`, CR-060) · HUB-FR-129 · HUB-BR-30
  - docs/design/agent-hub/ba-agent-hub.md HUB-FR-131 (khoá KH = secret chỉ ghi) · HUB-BR-36/37
  - docs/design/agent-hub/ui-agent-studio.md §11 "Secrets" (dòng ~152–156), §ràng buộc xoá "Được dùng bởi" (dòng ~223); SecretField: docs/design/admin/ui-admin.md
  - docs/adr/0012-knowledgehub-external-rag.md §1 (quyết định 1) · docs/CHANGE-REQUESTS.md#CR-060 · #CR-062
  - nền: H4a (Studio khung, audit + `hub_config_version`) · ADM secrets M2 (`admin.secrets`, mẫu mã hoá — tham khảo, KHÔNG dùng chung key)
owner: backend-lead + frontend-lead + qc
---

# H4b-1 · Secrets của Hub

Tách từ H4b (ROADMAP). Phần còn lại của H4b (Models, `provider_state` UI, entitlement agent × tenant) → H4b-2. Spec này **chỉ khung**: mục 3–5 do backend-lead/frontend-lead; Gate chưa qua.

## 1. Phạm vi
**Làm:**
- Kho secret của Hub (`hub.secrets`), mã hoá AES-256-GCM bằng `HUB_SECRETS_KEY` (khác master key Admin), **chỉ ghi, không đọc lại**.
- Ba loại: `provider_api_key` (API key provider), `source_credential` (CR-060: token repo git riêng của nguồn), `kh_api_key` (khoá KnowledgeHub, ADR-0012 §1).
- API ghi/thay/xoá/liệt kê metadata (không giá trị) + "Được dùng bởi"; audit (không có giá trị) + `hub_config_version`.
- Hàm nội bộ giải mã tại điểm dùng (`useSecret`) cho các mốc sau (K1, P-c, provider `api`); không endpoint đọc.
- Studio: màn Secrets (drawer, SecretField, chỉ ghi) — loại `provider_api_key` và `kh_api_key`.

**Không làm:** CRUD provider/profile, "Kiểm tra key" (cần provider → H4b-2); trang KnowledgeHub + kiểm tra kết nối (K1); clone/fetch repo riêng bằng `source_credential` (P-c/sau); xoay `HUB_SECRETS_KEY` (xem Q3); app-key workflow (vẫn ở Admin).

## 2. Nghiệp vụ
Trỏ BA, chỉ ghi phần cụ thể hoá.

| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| Chỉ ghi | Không API/log/audit/export nào trả giá trị; chỉ trả metadata (`id`, `kind`, `name`, `version`, `updated_at`, `used_by[]`) | HUB-FR-68, HUB-FR-04 |
| Mã hoá | AES-256-GCM, IV 12 byte ngẫu nhiên mỗi lần ghi, AAD = `id‖kind‖tenant_id`; `HUB_SECRETS_KEY` 32 byte, thiếu/sai độ dài ⇒ Hub không khởi động | HUB-FR-68, Q2 |
| Phạm vi | `provider_api_key`: toàn nền tảng, chỉ `platform_admin`. `kh_api_key`: toàn nền tảng **hoặc** theo tenant (Q7), chỉ `platform_admin` ghi. `source_credential`: gắn `tenant_id` (RLS); ghi bởi `tenant_admin` của tenant đó hoặc `platform_admin` | HUB-BR-15, CR-060, Q1 |
| Không vào job | Giải mã chỉ trong tiến trình Hub (và Runtime-chương-trình cho `source_credential` ở mốc sau); không bao giờ vào `work/<job_id>/`, prompt, trace, audit | HUB-BR-30, ADR-0012 §1 |
| Thay giá trị | Ghi đè = giá trị mới, `version + 1`, audit `secret.rotate` (không giá trị); chống ghi đè đồng thời bằng `version` | HUB-FR-69 |
| Xoá | Chặn `409` khi còn được dùng (provider/source/KH trỏ tới); trả danh sách "Được dùng bởi" | ui-agent-studio §ràng buộc xoá |
| Tên | `name` duy nhất theo (kind, tenant); `^[A-Za-z0-9_-]{2,64}$`, duy nhất không phân biệt hoa-thường (khác Admin `^[A-Z0-9_]{2,64}$` — Q4) | Q4 |

## 3. Contract (backend-lead)
<!-- backend-lead -->
File: `packages/contracts/src/hub-admin/secrets.ts` (export qua `@ai/contracts/hub-admin`). Mọi object `strictObject`. Chi tiết luật/hàm: `plan.md` §1–§3.

**Kiểu chung**
| Tên | Định nghĩa |
|---|---|
| `HUB_SECRET_KINDS` | `["provider_api_key", "kh_api_key", "source_credential"]` |
| `HubSecretNameSchema` | `string().trim().regex(/^[A-Za-z0-9_-]{2,64}$/)`; duy nhất **không phân biệt hoa-thường** theo (kind, tenant_id) |
| `HubSecretValueSchema` | = `SecretValueSchema` của Admin (8–2048 đơn vị UTF-16, không trim). Chuỗi mờ đục — có thể là JSON nhỏ (vd cặp `client_id`/`client_secret` của KH, Q7); mã hoá nguyên khối, server không parse |
| `SecretUsedBySchema` | `{ type: "provider" \| "source" \| "knowledge_hub", id: uuid, key: string(1..64) }` (FE gắn nhãn theo `type` + `key`) |
| `SecretTenantRefSchema` | `{ id: uuid, key: string, name: string }` (như `studio/orchestrator.ts`) |
| `HubSecretSchema` (response) | `{ id: uuid, kind, tenant: SecretTenantRef \| null, name, version: int ≥ 1, used_by: SecretUsedBy[] (sắp theo type, key), created_at, updated_at: ISO, updated_by: UpdatedBySchema }` — **không** có `value`/`ciphertext`/`iv`/`key_version`/`last4` (chỉ ghi tuyệt đối, Q11) |

**Phạm vi theo loại** (`secretScopeOk(kind, tenantId)`, plan §2): `provider_api_key` ⇒ `tenant_id = null`; `kh_api_key` ⇒ `null` (dùng chung nền tảng) **hoặc** một tenant (Q7); `source_credential` ⇒ bắt buộc tenant. Sai ⇒ 400 `VALIDATION_ERROR` path `tenant_id`.

**A. Studio — `/studio/api/secrets*`** (chỉ `platform_admin`; role khác ⇒ 403 `FORBIDDEN` trước parse, sẵn ở `mountH4a`)
| Method · path | Request | 2xx | Lỗi |
|---|---|---|---|
| `GET /studio/api/secrets` | query `HubSecretListQuerySchema` `{ kind?, tenant_id?: uuid, q?: string ≤ 64, limit: 1..100 = 100, cursor?: string ≤ 512 }`. `tenant_id` vắng ⇒ mọi secret (nền tảng + mọi tenant); có ⇒ chỉ secret của tenant đó | 200 `{ items: HubSecret[], next_cursor: string \| null }` sắp `(kind, lower(name), id)` | 400 |
| `POST /studio/api/secrets` | `HubSecretCreateRequestSchema` `{ kind, name, value, tenant_id?: uuid }` | 201 `HubSecret` (`version = 1`) | 400 (gồm `tenant_id` không có trong `admin.tenants` ⇒ path `tenant_id`) · 409 `SECRET_NAME_TAKEN` · 409 `NOT_CONFIGURED` (Hub thiếu khoá, chỉ khi test bỏ khoá) |
| `GET /studio/api/secrets/:id` | — | 200 `HubSecret` | 404 `NOT_FOUND` |
| `PUT /studio/api/secrets/:id` | `HubSecretRotateRequestSchema` `{ version: int ≥ 1, value }` (thay giá trị: IV mới, cùng AAD) | 200 `HubSecret` (`version + 1`) | 400 · 404 · 409 `VERSION_CONFLICT` `details = { current: HubSecret, updated_at }` |
| `DELETE /studio/api/secrets/:id?version=N` | query `{ version: coerce int ≥ 1 }` | 204 | 404 · 409 `VERSION_CONFLICT` · 409 `SECRET_IN_USE` `details = { used_by: SecretUsedBy[] (≥ 1) }` |

Không đổi được `kind`, `tenant_id`, `name` sau khi tạo (đổi = xoá + tạo mới; giữ AAD bất biến). `:id` không phải uuid ⇒ 404 (không rò).

**B. Tenant — `/admin/source-credentials*`** (`tenant_admin` hoặc `platform_admin`; `member` ⇒ 403 qua `requireAdminRole`; thêm prefix vào `PROTECTED_PREFIXES`). Chỉ loại `source_credential`; body **không** có `kind`. Tenant đích theo `writeTenant`/`readTenant` của module nguồn: `tenant_admin` = tenant phiên (gửi `tenant_id` khác ⇒ 404); `platform_admin` phải gửi `tenant_id` (ghi vắng ⇒ 400, đọc vắng ⇒ 404).
| Method · path | Request | 2xx |
|---|---|---|
| `GET /admin/source-credentials` | `{ tenant_id?, q?, limit 1..100 = 50, cursor? }` | 200 list như A |
| `POST /admin/source-credentials` | `{ name, value, tenant_id? }` | 201 |
| `GET/PUT/DELETE /admin/source-credentials/:id` | `?tenant_id=` (+ body/query như A) | 200 / 200 / 204 |

Secret thuộc tenant khác hoặc không phải `source_credential` ⇒ 404 `NOT_FOUND` (cùng thân, HUB-BR-14).

**Mã lỗi** `HUB_SECRET_ERRORS` (body = `ErrorResponse` M0, message cố định): `SECRET_NAME_TAKEN` 409 · `SECRET_IN_USE` 409 · dùng lại `NOT_FOUND` 404, `VERSION_CONFLICT` 409 (`details = { current: HubSecret, updated_at }` — có `current.version` như FE cần), `VALIDATION_ERROR` 400, `FORBIDDEN` 403, `NOT_CONFIGURED` 409.

**Audit** (`hub.audit_log`, trong transaction ghi, lỗi ⇒ rollback): entity `secret`; action `create` · `rotate` (PUT) · `delete`. `tenant_id` = tenant của secret (null cho nền tảng); `entity_name` = `<kind>:<name>`; `before`/`after` = `{ name, kind, tenant_id, version }` (không giá trị, không bản mã); `summary = { kind }`. Mỗi ghi tăng `hub_config_version` + NOTIFY `hub_config_changed` (qua `withConfigWrite`).

**Không có endpoint đọc giá trị.** Hub dùng giá trị qua `HubSecretReader.useSecret` nội bộ (plan §2.3).

## 4. Dữ liệu (backend-lead)
<!-- backend-lead -->
Migration `packages/db/migrations-hub/0028_h4b1_secrets.sql` (viết tay, idempotent như 0021: `IF NOT EXISTS`, `DO $$` kiểm `pg_constraint`/`pg_policies`; chỉ THÊM — không mất dữ liệu). Kiểu Drizzle: file mới `packages/db/src/schema/hub-secrets.ts` (`hub.ts` đã 400 dòng).

**`hub.secrets`**
| Cột | Kiểu | Null | Default | Ghi chú |
|---|---|---|---|---|
| `id` | uuid PK | no | `gen_random_uuid()` | thuộc AAD |
| `kind` | text | no | — | CHECK `IN ('provider_api_key','kh_api_key','source_credential')`; thuộc AAD |
| `tenant_id` | uuid | yes | — | null = nền tảng; thuộc AAD. CHECK `secrets_scope_ck`: `(kind='provider_api_key' AND tenant_id IS NULL) OR (kind='source_credential' AND tenant_id IS NOT NULL) OR kind='kh_api_key'` |
| `name` | text | no | — | CHECK `name ~ '^[A-Za-z0-9_-]{2,64}$'` |
| `ciphertext` | bytea | no | — | bản mã ‖ tag 16 byte; CHECK `octet_length BETWEEN 16 AND 8208` (2048 UTF-16 × ≤ 4 byte + 16) |
| `iv` | bytea | no | — | CHECK `octet_length(iv) = 12` |
| `key_version` | smallint | no | 1 | Q3; CHECK ≥ 1 |
| `version` | integer | no | 1 | CHECK ≥ 1; khoá lạc quan |
| `created_by`, `updated_by` | uuid | yes | — | user Admin (không FK chéo schema, như `sources`) |
| `created_at`, `updated_at` | timestamptz | no | `now()` | |

Index: `secrets_name_uq` UNIQUE `(kind, COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))` (dùng cho kiểm trùng) · `secrets_list_idx` `(tenant_id, kind, lower(name), id)` (list theo tenant + cursor; list toàn bộ của Studio quét bảng nhỏ, ≤ 100 hàng/trang). Xoá = **DELETE cứng** (bản mã mất theo hàng; audit giữ id/tên).

**RLS** (`ENABLE ROW LEVEL SECURITY`, policy `secrets_hub_rw FOR ALL TO hub_rw`): `app.scope='system'` **hoặc** (`app.scope='user'` AND `tenant_id IS NOT NULL` AND `tenant_id = app.tenant_id`). Hàng nền tảng chỉ thấy ở scope `system`.

**GRANT** (bảo vệ cột): `GRANT SELECT (id, kind, tenant_id, name, key_version, version, created_by, updated_by, created_at, updated_at) ON hub.secrets TO hub_rw` — **không** SELECT `ciphertext`/`iv`; `GRANT INSERT, UPDATE, DELETE ON hub.secrets TO hub_rw`. Không GRANT gì cho `hub_ro`, `agent_runtime`, `admin_rw`. Đọc bản mã CHỈ qua hàm:

`hub.secret_material(p_id uuid, p_kind text, p_tenant uuid) RETURNS TABLE(ciphertext bytea, iv bytea, key_version smallint)` — `SECURITY DEFINER`, `SET search_path = pg_catalog, hub`, `STABLE`; trả hàng khi `id = p_id AND kind = p_kind AND tenant_id IS NOT DISTINCT FROM p_tenant` **và** (`app.scope = 'system'` OR `p_tenant IS NULL` OR `p_tenant = app.tenant_id`) — scope `user` không mở được secret tenant khác; ngoài ra 0 hàng. `REVOKE ALL ON FUNCTION … FROM PUBLIC; GRANT EXECUTE … TO hub_rw`.

**FK `hub.providers.secret_id`** (Q5): `providers_secret_fk FOREIGN KEY (secret_id) REFERENCES hub.secrets(id) ON DELETE RESTRICT`, thêm `NOT VALID` rồi `VALIDATE` chỉ khi không có giá trị mồ côi (DO block; mồ côi ⇒ giữ NOT VALID + `RAISE NOTICE`, không sửa dữ liệu). Kind đúng `provider_api_key` kiểm ở service H4b-2. Index `providers_secret_idx (secret_id) WHERE secret_id IS NOT NULL` (cho `used_by`).

**Audit CHECK**: mở rộng `hub_audit_log_action_check` thêm `'rotate'`, `hub_audit_log_entity_check` thêm `'secret'` (DROP + ADD giữ toàn bộ giá trị 0019, như mẫu 0019); `HUB_AUDIT_ACTION_VALUES`/`_ENTITY_VALUES` thêm tương ứng.

**`used_by`** (query, plan §2): `provider` = `hub.providers WHERE secret_id = $id` (index trên) · `source` = `hub.sources WHERE deleted_at IS NULL AND config->>'credential_secret_id' = $id::text AND tenant_id = secret.tenant_id` (tên khoá jsonb chốt trước cho P-c; chưa có trong `GitRemoteConfigSchema`, quét theo `sources_tenant_idx`) · `knowledge_hub` = K1 bổ sung (H4b-1 trả rỗng). Không seed.

## 5. UI (frontend-lead)
<!-- frontend-lead -->
Chi tiết: [`plan-frontend.md`](plan-frontend.md) (không chép lại). Tóm tắt:

| Mục | Quyết định |
|---|---|
| Route | Studio `/secrets` (basepath `/studio`), `?kind=` chọn tab, `?drawer=new\|<id>` mở Sheet; menu "Secrets" từ "Sắp có" thành link |
| Artboard | Không có riêng; bám mẫu màn Agents + Sheet Orchestrator + SecretField Admin (ui-agent-studio §11). Không cần artboard mới |
| Bố cục | 3 tab theo loại (`provider_api_key`, `source_credential`, `kh_api_key`); bảng Tên · Tenant (tab nguồn) · Giá trị `•••• •••• Đã lưu` · Được dùng bởi · Cập nhật · [Thay giá trị] [Xoá] |
| Chỉ ghi | Không nút xem, không last4, ô giá trị `password`, rỗng lại sau lưu; sau lưu Sheet hiện "Đã lưu · v{n}" (AC-H4b1-08) |
| Tạo | Chỉ `provider_api_key` và `kh_api_key`; tab `source_credential` xem/thay/xoá (Q1: UI tạo ở màn Nguồn) |
| Xoá | ConfirmDialog; còn `used_by` hoặc `409 SECRET_IN_USE` → hộp "Không xoá được {name}" liệt kê nơi dùng |
| Trạng thái | tải (skeleton) · rỗng theo tab · lỗi (ErrorState + Thử lại) · không quyền · `VERSION_CONFLICT` → ConflictDialog dùng chung (ẩn diff) |
| Câu chữ / nhãn e2e / validate | plan-frontend §3–§5 (VI+EN nguyên văn) |
| Contract | plan-frontend §8 (C1–C8 đã đối chiếu spec §3: `Phạm vi` tenant cho khoá KH, cột Tenant, DELETE `?version=`, `SECRET_NAME_TAKEN`) |

## 6. Hiệu năng
Mặc định `CONVENTIONS.md` §6 (không siết thêm; perf không chặn mốc).

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| `HUB_SECRETS_KEY` | `bun run keys:dev` sinh khoá dev (Q6); test dùng khoá cố định trong fixture |
| Studio khung + audit/`hub_config_version` | Có sẵn từ H4a |
| Provider/KH/source dùng secret | Chưa có ở mốc này ⇒ `used_by` rỗng; test chèn bản ghi tham chiếu giả |

Env mới: `HUB_SECRETS_KEY` (base64 32 byte).

## 8. Tiêu chí nghiệm thu (qc)
| AC | Given / When / Then | Test |
|---|---|---|
| AC-H4b1-01 | `platform_admin` tạo `provider_api_key` "anthropic-main" ⇒ 201 chỉ có metadata; mọi GET/list/audit/log không chứa giá trị | <!-- qc --> |
| AC-H4b1-02 | DB: `ciphertext` ≠ plaintext, IV khác nhau giữa hai lần ghi cùng giá trị; sửa 1 byte ciphertext hoặc đổi `kind`/`tenant_id` ⇒ giải mã thất bại (AAD) | |
| AC-H4b1-03 | Thay giá trị với `version` cũ ⇒ 409 `VERSION_CONFLICT`; đúng `version` ⇒ `version+1`, audit `secret.rotate` không giá trị | |
| AC-H4b1-04 | Xoá secret đang được tham chiếu ⇒ 409 kèm `used_by[]`; không tham chiếu ⇒ 204 + audit | |
| AC-H4b1-05 | `source_credential` của tenant A: tenant_admin B GET/PUT/DELETE ⇒ 404; `tenant_admin` không ghi được `provider_api_key`/`kh_api_key` ⇒ 403 | |
| AC-H4b1-06 | Hub khởi động thiếu/sai độ dài `HUB_SECRETS_KEY` ⇒ thoát có thông báo rõ, không log khoá | |
| AC-H4b1-07 | Chuỗi giá trị secret không xuất hiện trong log Hub, trace run, `work/<job_id>/` (job giả dùng `useSecret`) | |
| AC-H4b1-08 | e2e Studio: nhập key trong SecretField, lưu ⇒ hiện "Đã lưu" + metadata, không có nút xem; ô nhập rỗng lại | |

Lệnh xong: `bun run typecheck && bun test && bun run test:int && bunx playwright test e2e/H4b1` (đề xuất `done:h4b1`).

## 9. Quyết định
### Trước Gate — câu hỏi (mặc định đề xuất → trả lời backend-lead 2026-10-13, PLAN)
| # | Câu hỏi | Trả lời (backend-lead) |
|---|---|---|
| Q1 | Ai ghi `source_credential`? UI ở đâu? | **Giữ mặc định, đổi đường dẫn:** Studio `/studio/api/secrets*` (platform_admin, mọi tenant) + tenant `/admin/source-credentials*` (tenant_admin; platform_admin kèm `tenant_id`) — cùng gốc `/admin/sources` của module nguồn, đủ GET/POST/PUT/DELETE (GET cần cho chọn credential ở form nguồn sau này). UI tenant: không làm ở H4b-1 |
| Q2 | Khoá & AAD | **Giữ, cụ thể hoá:** AAD = UTF-8 `hub.secrets:<id>:<kind>:<tenant_id \| "-">:<key_version>` (tiền tố miền như Admin `admin.secrets:` ⇒ không tráo bản mã giữa hai bảng; thêm `key_version` chừa xoay khoá). `HUB_SECRETS_KEY` bắt buộc (thiếu/sai ⇒ fatal) và **phải khác** `SECRET_MASTER_KEY` (trùng ⇒ fatal, HUB-FR-04) |
| Q3 | Xoay khoá | Giữ: chưa làm; `key_version smallint default 1` |
| Q4 | Quy ước `name` | **Sửa ghi chú:** Admin thật là `^[A-Z0-9_]{2,64}$` + viết HOA, không phải như §2. Giữ regex §2 `^[A-Za-z0-9_-]{2,64}$` (AC-01 dùng "anthropic-main"), duy nhất **không phân biệt hoa-thường** theo (kind, tenant_id) để tránh "Anthropic-Main" ≠ "anthropic-main" |
| Q5 | FK `providers.secret_id` | **Đổi nhẹ:** luôn thêm FK `ON DELETE RESTRICT` ở 0028, dạng `NOT VALID` + `VALIDATE` khi không mồ côi (mồ côi ⇒ giữ NOT VALID, NOTICE) — không sửa dữ liệu, không phải chờ H4b-2 |
| Q6 | Khoá dev | Giữ: `keys:dev` sinh `HUB_SECRETS_KEY` (khác `SECRET_MASTER_KEY`); test dùng khoá cố định trong fixture |
| Q7 | `kh_api_key` nền tảng hay theo tenant? | **Đổi theo khảo sát KH v6.4 (điều phối 2026-10-13):** cho phép **cả** nền tảng (`tenant_id` null) **và** theo tenant (vd client OIDC `kh-ns-<ns>` của namespace tenant). Giá trị là chuỗi mờ đục, có thể JSON nhỏ `{client_id, client_secret}`, mã hoá nguyên khối. Chỉ `platform_admin` ghi (Studio). **K1 chốt** cách dùng/định dạng |
| Q8 | "Kiểm tra key" | Giữ: không (H4b-2/K1) |
| Q9 | Rủi ro BUILD | Giữ: cao (Opus) + security review riêng (T7) |
| Q10 | Hard stop | Giữ: không có; không thư viện mới (`node:crypto`), không ADR |
| Q11 (mới) | Hiện `last4` như SecretField Admin (ui-admin)? | **Không** — theo spec §2 (metadata không có `last4`) và plan-frontend D3: lộ 4 ký tự là lộ; khác Admin có chủ đích. Cũng không có `note` (không ai dùng) |
| Q12 (mới) | AC-H4b1-07 phần `work/<job_id>/` | Chưa có bên dùng nào tạo job ở H4b-1 (KH dùng qua Hub proxy, `source_credential` dùng ở P-c). Mặc định đề xuất: H4b-1 kiểm log Hub + audit + mọi response + quét mọi bảng `hub.*` trừ `secrets.ciphertext` (plan §5); phần thư mục job kiểm ở mốc có bên dùng (K1/P-c). qc quyết |

### Trong lúc làm (agent tự quyết theo Luật 2)
- FE PLAN 2026-10-13: không hiện `last4` (chỉ-ghi tuyệt đối); `name` bất biến sau tạo; tab `source_credential` không có nút tạo (Q1); `ConflictDialog` dùng chung ẩn [Xem khác biệt] khi không có diff; Sheet ở lại sau lưu hiện "Đã lưu · v{n}" (AC-H4b1-08).

## 10. Tranh chấp test
- (không)
