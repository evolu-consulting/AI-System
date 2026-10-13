# modules/secrets — Secrets của Hub (HUB-FR-68, HUB-FR-69, HUB-FR-04, HUB-BR-30)

Lưu khoá provider API, khoá KnowledgeHub, credential nguồn — **chỉ ghi**: không endpoint nào trả giá trị; response/audit/log chỉ metadata. Mã hoá AES-256-GCM bằng `HUB_SECRETS_KEY` (KHÁC `SECRET_MASTER_KEY`), AAD `hub.secrets:<id>:<kind>:<tenant|->:<key_version>`. Spec: `docs/specs/H4b1-secrets/` (spec §3–§4, plan §2–§3). **Mất `HUB_SECRETS_KEY` = mất mọi secret Hub** (sao lưu ngoài repo); xoay khoá chưa làm (`key_version` chừa sẵn).

| File | Vai trò |
|---|---|
| `secrets.crypto.ts` | Thuần: parse/kiểm khoá (boot fatal), `sealHubSecret`/`openHubSecret` (lỗi message cố định), self-test |
| `secrets.rules.ts` | Thuần: `secretScopeOk`, `canManageSecret`, `credentialTenant` (route tenant), snapshot audit, `entity_name`, cursor |
| `secrets.repo.ts` | SQL `hub.secrets`. `hub_rw` KHÔNG SELECT được `ciphertext`/`iv` ⇒ luôn liệt kê cột; bản mã chỉ qua `hub.secret_material(id, kind, tenant)`. `usedByMany` một query (`USED_BY_BRANCHES`: provider, source; K1 thêm `knowledge_hub`) |
| `secrets.service.ts` | create/list/get/rotate/remove. Ghi qua `withConfigWrite` (khoá config_meta → ghi → bump → audit `secret.create|rotate|delete` → NOTIFY). `SecretTarget`: Studio scope `system`; route tenant filter `source_credential` + tenant, scope `user` |
| `secrets.use.ts` | `HubSecretReader.useSecret(ref, fn)` nội bộ (không route) |
| `secrets.routes.ts` | A: `/studio/api/secrets*` (platform_admin). B: `/admin/source-credentials*` (tenant_admin / platform_admin kèm `tenant_id`) |
| `secrets.mount.ts` | Một service cho cả hai; gọi từ `app.h4a.ts`; `SECRETS_PROTECTED_PREFIXES` trải vào `PROTECTED_PREFIXES` (`app.ts`) |
| `secrets.errors.ts` | `SECRET_NAME_TAKEN`/`SECRET_IN_USE` (409) + `NOT_CONFIGURED` 409 khi Hub không có khoá (D11) |

## Dùng giá trị (bên gọi: K1, H4b-2, P-c)

```ts
const reader = new HubSecretReader({ db, key: deps.hubSecretsKey ?? null, log });
await reader.useSecret({ id, kind: "kh_api_key", tenantId: run.tenantId }, async (value) => callKh(value));
```
- `tenantId` = tenant **của run** (hoặc `null` cho secret nền tảng) — không lấy từ input người dùng. Sai id/kind/tenant ⇒ `secret_missing`.
- Lỗi ⇒ `SecretUseError { code: "NOT_CONFIGURED", reason: "credential", failure: key_missing | secret_missing | decrypt_failed }`, message `hub secret: <failure>`; log warn chỉ `{secret_id, kind, failure}`.
- Không cache bản rõ. Giá trị chỉ sống trong `fn`: không đưa vào payload job, `work/<job_id>/`, prompt, trace, audit, `detail` lỗi, log.

## `used_by` (chặn xoá)

`usedByMany(tx, ids)` → `Map<secretId, SecretUsedBy[]>` sắp `(type, key)`. Thêm loại tham chiếu mới = thêm một nhánh vào `USED_BY_BRANCHES` (trả `sid, type, id, key`) + giá trị `type` trong contract `SECRET_USED_BY_TYPES`. FK `providers.secret_id` RESTRICT là chốt cuối.

## Phụ thuộc

`lib/db` (`withConfigWrite`, NOTIFY config), `modules/audit`, `@ai/contracts/hub-admin` (schema, `SECRET_USED_BY_TYPES`), `HUB_SECRETS_KEY` qua deps. Không import module nghiệp vụ khác; bên dùng giá trị chỉ qua `HubSecretReader`.
