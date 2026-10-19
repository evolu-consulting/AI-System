# Plan · N5b-legacy-hash (ngắn)

| Lớp | File | Nội dung |
|---|---|---|
| luật thuần | `apps/admin-api/src/modules/auth/auth.legacy.rules.ts` | `LEGACY_PREFIX`, `parseLegacyHash` (regex chặt + trần + `maxmem`), `legacyActive(now, sunset)`, `DEFAULT_LEGACY_SUNSET` |
| verify | `apps/admin-api/src/modules/auth/auth.legacy.ts` | `scryptVerify` (node:crypto `scrypt` async + `timingSafeEqual`), hash giả lazy, `verifyLogin(pw, stored \| null, o)` ⇒ `{ ok, rehash }`: trước sunset luôn `Promise.all([argon2 verify\|hash, scrypt])` (một thật, một giả; nhánh legacy băm argon2id thay verify giả — spec D6) |
| repo | `auth.repo.ts` | `rehashLegacy(tx, tenantId, userId, legacy, next)` CAS ⇒ số hàng |
| service | `auth.service.ts` | `login` dùng `verifyLogin`; `rehash` có ⇒ ghi trong tx; `afterPasswordOk` chạy `applyRehash` (CAS + `recordAudit` là câu cuối) trong mọi nhánh `confirmNotTempLocked` |
| config | `config/env.ts`, `server.ts`, `app.ts`, `auth.session.ts` | `LEGACY_HASH_SUNSET` ⇒ `AppDeps.legacySunset?` ⇒ `AuthCtx.legacySunset?` |
| importer | `identity-import/domain/import.rules.ts` | `importableHash(h)`: argon2 như cũ; mgmt `scrypt$hex32$hex128` ⇒ chuỗi legacy; `classifyHash` = `importableHash ? import : reset` |

## Test (viết trước)
- Unit `auth.legacy.rules.test.ts`: parse đúng/hỏng, trần (ln 18, r 9, p 3, dk ≠ 64, salt ngắn), maxmem, sunset biên.
- Unit `auth.legacy.test.ts`: vector RFC 7914 + vector Python mgmt-app; sai mật khẩu; vượt trần ⇒ false; mỗi đường đúng 1 argon2 + 1 scrypt (đếm qua primitive tiêm); timing trung vị 3 đường lệch < 35 %.
- Unit importer `import.rules.test.ts`: mgmt scrypt ⇒ import + chuỗi legacy; Werkzeug / hex hoa / dk ngắn ⇒ reset.
- Int `auth.legacy.int.test.ts` (admin-api, app thật + RLS): legacy đúng ⇒ 200, hash thành argon2id, `version` + `password_changed_at` giữ, 1 audit `legacy_rehash` không chứa hash; sai ⇒ 401 + đếm, hash giữ; vượt trần ⇒ 401; sau sunset ⇒ 401 hash giữ; 2 login song song ⇒ 1 audit, cả hai 200; tx lỗi (hook) ⇒ hash giữ; user cùng username tenant khác không bị đụng; importer → login round-trip.
- Perf: `users.perf.int.test.ts` (login p95 < 150 ms) chạy lại, ghi số trước/sau.
