# Test plan · H4b1-secrets (qc)

Chế độ **WRITE + LOCK** (T2) · 2026-10-13. "Đúng" = spec §2 (luật), §3 (contract, chuẩn), §4 (DDL/RLS/GRANT), §8 (AC-H4b1-01…08), §9 (Q1–Q12) · `plan.md` §2 (chữ ký hàm thuần), §4 (boot), §5 (cách kiểm "không lộ") · `plan-frontend.md` §4–§5 (câu chữ + nhãn e2e VI). Contract chuẩn = spec §3 (plan-frontend C2/C3 đang được frontend-lead chỉnh cho khớp: `SECRET_NAME_TAKEN`, `DELETE ?version=`, `used_by {type,id,key}`). Hộp đen: chỉ đọc DDL cũ + fixture test cũ + kiểu `AuthUser` để dựng dữ liệu.

## 1. Quy ước
Như H4a §1 (tên test có mã, chờ theo điều kiện, cấm `skip/only/todo`, id cố định dải `a4b1…`/`e4b1…`), thêm:

| Mục | Quy ước H4b-1 |
|---|---|
| Tên test | `"<mã BA> · [AC-H4b1-xx ·] <ID> · mô tả"` |
| Mã đầu tên | CRUD/chỉ ghi/mã hoá/list → `HUB-FR-68`; version/audit/NOTIFY → `HUB-FR-69`; quyền theo loại + cách ly tenant → `HUB-BR-15`; không vào job/log/bảng → `HUB-BR-30`; khoá khác master, log → `HUB-FR-04` |
| Loại | **R** hàm thuần + contract (`bun test`, nạp động — module chưa có ⇒ đỏ ở expect) · **A/D** int hub-api thật + DB tag riêng (`bun run test:int`) · **E** e2e Playwright studio-web, API giả lập `page.route` |
| Vị trí | R `tests/acceptance/H4b1/rules/*.test.ts` · A/D `tests/acceptance/H4b1/*.int.test.ts` · E `e2e/studio/h4b1-secrets.studio.ts` (config `e2e/studio/playwright.config.ts`, đuôi `.studio.ts`) |
| Mã hoá đối chứng | `_h4b1.ts` `specSeal/specOpen` viết theo spec Q2/D3 bằng `node:crypto` — kiểm bản mã sản phẩm và dựng secret bằng owner (không dùng code sản phẩm) |
| "0 ghi" | `stateOf()` = hàng `hub.secrets` (gồm iv/bản mã hex) + `hub_config_version` + max `audit.seq`; NOTIFY vắng qua sentinel `listenHub` (H3b) |
| Bảng chưa có | helper kiểm `to_regclass` ⇒ ca đỏ ở expect, không `PostgresError` trong `beforeAll` |

## 2. Hạ tầng (`tests/acceptance/H4b1/_h4b1.ts`)
`startH4b1()` = `setupH3b()` (H1 tenant acme/beta/platform + users `padmin`, `tadmin` (acme), `lan` (member acme), `badmin` (tenant_admin beta), cấu hình Hub) + `startHubH3b(k, {hubSecretsKey: HUB_KEY})` (seam `AppDeps.hubSecretsKey`, plan D11; `null` ⇒ NOT_CONFIGURED). Khoá cố định `KEY_BYTES` (32 byte tất định, Q6). `extraHub()` = Hub thứ hai cùng DB (không khoá; `hubAudit` tiêm lỗi `failingAudit` H3b). `captureAll()` bắt `setSink` logger Hub + `console.*`. Tham chiếu giả: `insertProvider` (`hub.providers.secret_id`), `insertSourceRef` (`hub.sources.config.credential_secret_id`, spec §4). Boot: spawn `apps/hub-api/src/server.ts` (mẫu H2c A25).

## 3. Ma trận AC → test
| AC | Then (chi tiết qc) | Loại · file | Ca |
|---|---|---|---|
| AC-H4b1-01 | POST `anthropic-main` ⇒ 201 `HubSecretSchema` strict (không value/ciphertext/iv/key_version/last4); GET/list cùng metadata; mọi response (cả 400 value ngắn, 409 `current`), log, audit không chứa giá trị | A `studio-crud`, `no-leak`, `audit-version` · R `contracts`, `rules` | A04–A05, A11, A17, A60, A90–A93 · R11, R55 |
| AC-H4b1-02 | Bản mã DB ≠ bản rõ, iv 12 byte khác nhau giữa hai lần ghi cùng giá trị (kể cả PUT cùng giá trị); giải bằng bộ đối chứng với AAD spec; đổi kind/tenant/id/key_version hoặc 1 byte ⇒ thất bại | A `crypto-db`, `use-secret` · R `crypto` | A70–A75, A85 · R26–R41 |
| AC-H4b1-03 | PUT version cũ ⇒ 409 `VERSION_CONFLICT {current v2 không giá trị, updated_at}` + 0 ghi; đúng ⇒ v+1, iv/bản mã mới, audit `rotate` before/after snapshot; UI ConflictDialog không "Xem khác biệt", [Ghi đè] gửi version mới | A `studio-crud`, `audit-version`, `crypto-db` · E | A16–A17, A61, A74 · E04, E08 |
| AC-H4b1-04 | Provider/nguồn sống cùng tenant trỏ tới ⇒ 409 `SECRET_IN_USE {used_by}` (nguồn xoá mềm / khác tenant không tính); gỡ ⇒ 204 + audit `delete`; UI hộp "Không xoá được {name}" | A `delete-usedby`, `audit-version` · E | A22–A26, A62 · E05–E07 |
| AC-H4b1-05 | tenant_admin B GET/PUT/DELETE source_credential của A ⇒ 404 giống hệt id lạ; tenant_admin không ghi provider/kh (Studio 403, route tenant có `kind` ⇒ 400); RLS user chỉ thấy hàng tenant mình; `secret_material` không mở chéo tenant | A `tenant-routes`, `studio-crud`, `db-guard`, `use-secret` · R `rules` | A02–A03, A42, A47–A49, D05, D07, D09, A83 · R04–R07 |
| AC-H4b1-06 | `server.ts` thiếu / rỗng / 16 byte / không base64 / trùng master ⇒ thoát ≠ 0 ≤ 15 s, cổng đóng, log `hub_secrets_key_invalid` + `reason` (missing\|invalid\|same_as_master), không chứa khoá; hợp lệ ⇒ /health 200 | A `boot` · R `crypto` | A110–A115 · R20–R25 |
| AC-H4b1-07 | (Q12 mặc định) log Hub + console, audit, response, mọi bảng `hub.*` (`x::text`) không chứa giá trị sau vòng đời API + `useSecret` (thành công/lỗi); `useSecret` không ghi jobs/run_steps/audit/config; warn chỉ `{secret_id, kind, failure}` | A `no-leak`, `use-secret` | A87–A88, A90–A94 |
| AC-H4b1-08 | Studio: nhập trong SecretField (`type=password`), Lưu ⇒ POST đúng thân, Sheet ở lại `status` "Đã lưu · v1" + [Đóng], ô rỗng lại, không nút xem; DOM/URL/storage không chứa giá trị | E | E02, E03, E04, E12 |

### 3.1 Luật / quyết định → ca
| Luật | Ca |
|---|---|
| §2 Chỉ ghi (không endpoint đọc, metadata đúng trường) | R54–R55, A04–A05, A91 |
| §2 Mã hoá (GCM, IV 12 mới, AAD `hub.secrets:<id>:<kind>:<tenant\|->:<kv>`, khoá 32 byte) | R20–R41, A70–A75 |
| §2 Phạm vi theo loại (`secretScopeOk`, `canManageSecret`, CHECK `secrets_scope_ck`) | R01–R05, A07–A08, A10 (provider+tenant, source vắng tenant, tenant lạ), D11 |
| §2 Không vào job (HUB-BR-30) | A88, A94, D02–D03 (agent_runtime/hub_ro không quyền) |
| §2 Thay giá trị + version | R58, A16–A19, A61, A74 |
| §2 Xoá chặn khi dùng | A22–A26, D13 (FK RESTRICT) |
| §2 Tên regex + duy nhất không phân biệt hoa-thường (Q4) | R51–R52, A10, A12–A14, A46, D12 |
| §3 B route tenant (`credentialTenant`, D13) | R06–R09, A40–A52 |
| §3 Audit + `hub_config_version` + NOTIFY + rollback | R10–R12, A60–A66, D14 |
| §3 list (sắp, lọc, q, cursor, limit) | R13–R16, R59, A100–A106 |
| §4 GRANT cột / RLS / `secret_material` definer | D01–D10 |
| D11 NOT_CONFIGURED | A28 |
| D12 không cache; plan §2.3 lỗi `SecretUseError` | A80–A86 |
| Q7 kh_api_key nền tảng + tenant, giá trị JSON mờ đục | R02, R31, A07, A14, A81, E12 |
| Q1 tab nguồn không tạo | E09 |

## 4. Danh sách ca
| Nhóm | File | Ca |
|---|---|---|
| R | `rules/secrets-rules.test.ts` | R01–R16 (16) |
| R | `rules/secrets-crypto.test.ts` | R20–R41 (22) |
| R | `rules/contracts-h4b1.test.ts` | R50–R61 (12) |
| A | `studio-crud.int.test.ts` | A01–A19 (26: A10 × 9) |
| A | `delete-usedby.int.test.ts` | A22–A26, A28 (6) |
| A | `tenant-routes.int.test.ts` | A40–A52 (13) |
| A | `audit-version.int.test.ts` | A60–A66 (7) |
| D | `db-guard.int.test.ts` | D01–D14 (14) |
| A | `crypto-db.int.test.ts` | A70–A75 (6) |
| A | `use-secret.int.test.ts` | A80–A88 (9) |
| A | `no-leak.int.test.ts` | A90–A94 (5) |
| A | `list.int.test.ts` | A100–A106 (7) |
| A | `boot.int.test.ts` | A110–A115 (6) |
| E | `e2e/studio/h4b1-secrets.studio.ts` | E01–E13 (13) |

Tổng **162**: R 50 · A/D 99 · E 13.

## 5. Rủi ro chập chờn
| Rủi ro | Giảm |
|---|---|
| Boot (A110–A115) spawn `server.ts`, 15 s/ca | cổng ngẫu nhiên 45000+; A115 chờ /health theo điều kiện ≤ 20 s; kill trong `finally` |
| Hub thứ hai (A28, A65) cùng DB | `stop()` trong `finally` |
| Thứ tự sắp list phụ thuộc collation | tên chỉ khác nhau ở chữ cái (không dấu câu) |
| Sau T5a `HUB_SECRETS_KEY` bắt buộc: boot test cũ (H2c A26, H2b…) spawn `server.ts` với `...process.env` | cần `.env.local` có `HUB_SECRETS_KEY` (`keys:dev`, T5a) — ghi ở §8 |

## 6. Lệnh xong mốc — đề xuất `bun run done:h4b1` (T7 tạo `tools/scripts/src/done-h4b1.ts`, mẫu `done-h4a`)
| # | Bước | Lệnh |
|---|---|---|
| 1 | typecheck | `bun run typecheck` |
| 2 | unit + R | `bun test` (gồm `tests/acceptance/H4b1/rules`) |
| 3 | int (gồm A/D H4b1 + hồi quy H4a/H3b/P-b) | `bun run test:int` |
| 4 | e2e studio | `bunx playwright test -c e2e/studio/playwright.config.ts` (= `bun run e2e:studio`; riêng mốc: `… h4b1-secrets`) |
| 5 | vết FR | `bun run trace --check` |
| 6 | khoá | `bun run test:lock:verify` |
Chạy tay: `bun test tests/acceptance/H4b1/rules` · `bun --env-file=.env.local --config=bunfig.int.toml test --timeout 30000 tests/acceptance/H4b1/*.int.test.ts`.

## 7. Đỏ đúng lý do · chạy 2026-10-13 (trước T4, DB `ai_system_h4b1_qc_test` qua `bun run db:test:create h4b1_qc`)
| Nhóm | File | Ca | Kết quả | Lý do đỏ |
|---|---|---|---|---|
| R | 3 file rules | 50 | 50 đỏ | `qc: <hàm> chưa có (plan §2)` (module `secrets.rules/crypto` chưa có) hoặc `expect(typeof safeParse)` (export contract chưa có) |
| A | `studio-crud` | 26 | 23 đỏ · **3 xanh** | đỏ ở `expect(status)` 404 thay 201/400/409; **A01** (401 không token), **A02** (403 role khác — `mountH4a` chặn mọi `/studio/api/*`), **A06** (404 id lạ) xanh trước code — chấp nhận, khoá hồi quy |
| A | `delete-usedby`, `tenant-routes`, `audit-version`, `crypto-db`, `list`, `no-leak` | 44 | 44 đỏ | `expect(status)` 404/401 thay 201/200/204/403; audit/bảng rỗng |
| D | `db-guard` | 14 | 14 đỏ | SQLSTATE `42P01`/`42883` (bảng/hàm chưa có) ≠ kỳ vọng; D14 `23514` (audit CHECK chưa có `rotate`/`secret`) |
| A | `use-secret` | 9 | 9 đỏ | `expect(typeof HubSecretReader)` (module chưa có) |
| A | `boot` | 6 | 5 đỏ · **1 xanh** | A110–A114: `server.ts` chưa kiểm khoá ⇒ chạy tới hết 15 s ⇒ `code` null; **A115** (khoá hợp lệ ⇒ lên) xanh trước code — hồi quy |
| E | `h4b1-secrets.studio.ts` | 13 | 13 đỏ | `/studio/secrets` chưa có ⇒ không thấy badge khung / link "Secrets" (còn "Sắp có") / form đăng nhập (E13) |

Int: 99 ca = 95 đỏ ở `expect` + 4 xanh trước code (A01, A02, A06, A115); **0 ca đỏ do dựng dữ liệu** (không `PostgresError`/`TypeError` trong `beforeAll`/fixture). `tsc -p tsconfig.tests.json` sạch; `biome check` sạch.

## 8. Chỗ hở spec (mặc định qc đã dùng) · Cần bổ sung
| # | Hở | Mặc định trong test | Agent |
|---|---|---|---|
| G1 | Q12: AC-07 phần `work/<job_id>/` chưa có bên dùng | **qc chấp nhận mặc định**: H4b-1 kiểm log Hub + console, audit, response, mọi bảng `hub.*`, `useSecret` không ghi job/trace; thư mục job kiểm ở K1/P-c (mốc có bên dùng `useSecret` trong job) | docs-architect: ghi spec Q12 (đã ghi) + K1/P-c test-plan |
| G2 | spec §8 lệnh e2e `bunx playwright test e2e/H4b1` (và tasks T2/T6 `e2e/H4b1/**`) không khớp hạ tầng studio (config riêng, đuôi `.studio.ts`) | e2e ở `e2e/studio/h4b1-secrets.studio.ts`; lệnh `bunx playwright test -c e2e/studio/playwright.config.ts h4b1-secrets` (spec §8 đã sửa) | frontend-lead: lệnh xong T6 |
| G3 | Mã HTTP khi audit ném (A65) | chỉ kiểm `≥ 500` + rollback | — |
| G4 | Nhãn lỗi `NAME_TAKEN` ở plan-frontend §4 vs mã contract `SECRET_NAME_TAKEN` | mock trả `SECRET_NAME_TAKEN` (contract); kiểm câu chữ VI "Tên này đã được dùng cho loại secret này" | frontend-lead: map `errors.SECRET_NAME_TAKEN` |
| G5 | plan-frontend `used_by` nhãn "Nguồn · {name}" nhưng contract chỉ có `key` | e2e chỉ kiểm `Provider · {key}` | frontend-lead: dùng `key` |
| G6 | Log boot `hub_secrets_key_invalid` + `reason` (plan §4) là chuỗi kiểm | A110–A114 kiểm `"reason":"<x>"` trong stdout/stderr | backend-lead giữ đúng tên sự kiện |
| G7 | `HubSecretReader` log warn: tên trường `{secret_id, kind, failure}` (plan §2.3) | A87 kiểm đúng các khoá này | backend-lead |
| G8 | Sau T5a khoá bắt buộc ⇒ boot test cũ cần `HUB_SECRETS_KEY` trong `.env.local` | không sửa test cũ; T5a chạy `keys:dev` | backend-lead (T5a) |

## 9. Khoá
Khoá 2026-10-13 (T2, theo điều phối: khoá trước T3 Gate; Gate đổi spec ⇒ qc mở lại + ghi lý do): `bun run test:lock:write` thêm 16 file (`tests/acceptance/H4b1/**` 15 + `e2e/studio/h4b1-secrets.studio.ts`); `bun run test:lock:verify` OK (690 file).
