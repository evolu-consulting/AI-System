# Test plan · H4b2-models (qc)

Chế độ **WRITE + LOCK** (T2) · 2026-10-13. "Đúng" = spec §2 (luật), §3 (contract), §4 (dữ liệu/GRANT), §8 (AC-H4b2-01…06), §9 (Q1–Q8) · `plan.md` §2 (chữ ký hàm thuần), §3 (luồng), §5 (kiểm "không lộ") · `plan-frontend.md` §3–§5 (câu chữ + role/nhãn VI) · mockup đã duyệt (Provider-Sheet, Check, Runbook, States) + artboard `Models.dc.html`, `Access.dc.html`. Hộp đen: chỉ đọc DDL cũ + fixture test cũ để dựng dữ liệu.

**Q4:** AC-H04 nguyên văn (dự phòng *giữa chừng*, trace `provider=openai-api`) dời H2d. qc thay bằng **AC-H4b2-07** (dự phòng **lúc giao job**):
> Given profile [A on {trigger}, B]; When giao job lúc A tắt / cooldown (quota) / logged_out|error (error) — Then job ở B nếu A tắt hoặc trigger ∈ `on` của A; ngược lại run.failed `ALL_PROVIDERS_EXHAUSTED`, không tạo job; payload job giữ contract (`profile_steps` = [bước đã chọn], `step_index` 0); Studio `active_step` của profile = chỉ số bước được giao (cùng `pickStep`).

**Migration kế:** `packages/db/migrations-hub/0030_h4b2_models.sql` + `meta/_journal.json` idx 30 (D20–D26 kiểm).

## 1. Quy ước
Như H4b-1 §1 (tên test có mã, chờ theo điều kiện, cấm `skip/only/todo`, id cố định dải `a4b2…` int / `e4b2…` e2e).

| Mục | Quy ước H4b-2 |
|---|---|
| Tên test | `"<mã BA> · [AC-H4b2-xx ·] <ID> · mô tả"` |
| Mã đầu tên | provider/check/GRANT → `HUB-FR-66`; profile/pickStep/giao job → `HUB-FR-67`; audit → `HUB-FR-69`; entitlement → `HUB-FR-78`; tenant_admin bị chặn / NOT_ENTITLED → `HUB-BR-17` |
| Loại | **R** hàm thuần + contract (`bun test`, nạp động — module chưa có ⇒ đỏ ở `fn()`/`expect`) · **A** int hub-api thật + DB tag riêng (`bun run test:int`) · **E** e2e Playwright studio-web, API giả lập `page.route` |
| Vị trí | R `tests/acceptance/H4b2/rules/*.test.ts` · A `tests/acceptance/H4b2/*.int.test.ts` · E `e2e/studio/h4b2-{models,profiles,access}.studio.ts` (+ `e2e/studio/_h4b2.ts` kho giả) |
| "0 ghi" | `cfgState()` = provider + profile (`to_jsonb − updated_at`) + `hub_config_version` + max `audit.seq`; entitlement: `entState()` |
| "Không lộ" | key dựng bằng owner (`specSeal` H4b-1): `fake-ok-qc-H4B2-…`, `fake-bad-…`, `sk-qc-H4B2-openai-…`; grep response/audit/log (`captureAll`) + chuỗi con ≥ 8 (plan §5) |
| Hãng thật | `fetch` tiêm (`H4aDeps.fetch`, plan §4) — ghi URL/header/redirect; `sleep` tiêm đóng vai Runtime probe (C10–C13) |

## 2. Hạ tầng (`tests/acceptance/H4b2/_h4b2.ts`)
`startH4b2({fetch?, sleep?, hubSecretsKey?})` = `setupH3b()` (H1 tenant/user + cấu hình Hub H1: provider `fake-cli`/`claude-sub` subscription, profile `fake-1`/`claude-sub-1`; agent H3b `hoadon`/`khodu`/`tatt`/`cli-x`/`cu`/`chua`/Orchestrator mặc định + `orch-acme`/`orch-beta`; group `ke-toan`/`kho`; `badmin`) + 7 secret (5 `provider_api_key`, 1 `kh_api_key`, 1 bản mã khoá khác) + provider `dify` (readonly) rồi `startHubH3b(k, {hubSecretsKey: HUB_KEY, ...})`. `dispatch.int.test.ts` dùng nền H1 thuần (`ScriptRuntime` đóng vai Runtime; đổi cấu hình bằng owner + bump/NOTIFY, chờ ảnh Hub qua `GET /agent-grants/effective`).

## 3. Ma trận AC → test
| AC | Then (chi tiết qc) | Loại · file | Ca |
|---|---|---|---|
| AC-H4b2-01 | POST api gắn secret H4b-1 ⇒ 201 `ProviderDetail` (secret `{id,name}`, `has_secret`, v1, `dev_only` cho fake); list có `version`/`slots_in_use`, KHÔNG `secret_id`/`last_error` (H4a A17 xanh); audit create (secret là id); không lộ giá trị; role khác ⇒ 403, không token ⇒ 401 | A `providers`, `role` · R `contracts` · E | A01–A08, A22, A24, Q01–Q03 · R73–R76 · M03 |
| AC-H4b2-02 | fake `fake-ok…` ⇒ ok; `fake-bad…` ⇒ error/auth_failed + `invalid x-api-key (fake)`; hãng thật qua fetch: URL/header theo bảng, `redirect:"error"`, lỗi vọng key ⇒ `***`, không chuỗi con ≥ 8; timeout/network/secret_unreadable/NOT_CONFIGURED; audit `check` không bump, không `message`; log không key. UI: "Đang kiểm tra key…" → "Key hợp lệ"/"Key không hợp lệ" + `group "Chi tiết"` nguyên văn | A `provider-check` · R `provider-check-rules`, `contracts` · E | C01–C14 · R30–R47, R77 · M07–M10 |
| AC-H4b2-03 | Profile 2 bước, PUT đảo thứ tự lưu đúng (GET + DB + audit before/after); xoá provider đang được profile dùng ⇒ 409 `PROVIDER_IN_USE{profiles:[{id,key}]}`; UI Lên/Xuống ⇒ PUT đúng thứ tự, alertdialog "Không xoá được …" kèm tên profile; "Xoá profile" chỉ ở profile đã lưu, DELETE ?version=N, 409 `PROFILE_IN_USE` kèm badge `agents[].key` | A `profiles`, `providers` · E | P01–P02, A17, A21 · M12, M24, M27–M29 |
| AC-H4b2-04 | PUT ô (chua × acme) ⇒ `{hub_config_version v+1, affected_grants 0}`, audit `agent_entitlement`/`enable`; tadmin grant được (trước đó NOT_ENTITLED); ≤ 5 s menu lan có agent; UI bật switch không xác nhận | A `entitlements` · E | E03–E04 · M31 |
| AC-H4b2-05 | DELETE ô có 2 grant ⇒ `affected_grants 2`, grant giữ nguyên, ≤ 5 s biến khỏi menu (effective `no_entitlement`); PUT lại ⇒ grant tự có hiệu lực ≤ 5 s; run đang chạy vẫn `run.finished`; UI alertdialog "Thu hồi … ?" nêu "2 grant … sẽ mất hiệu lực" | A `entitlements` · E | E05–E06 · M32 |
| AC-H4b2-06 | tadmin acme: mọi `/studio/api/agent-entitlements*` ⇒ 403 (không thấy entitlement tenant khác); sau khi padmin thu hồi qua Studio, tadmin cấp grant ⇒ 409 `NOT_ENTITLED{agent_ids}` | A `entitlements` · E | E09–E10 · M37 |
| AC-H4b2-07 (thay AC-H04, Q4) | `pickStep` 8 ca plan §2.3 + biên; giao job thật: cooldown+on[quota] / logged_out+on[error] / tắt ⇒ bước kế; on[] hoặc mọi bước chặn ⇒ `ALL_PROVIDERS_EXHAUSTED`, không job; payload `profile_steps` = [bước chọn]; log `job.fallback`; `active_step` Studio khớp; agent có model riêng (vế model, D08–D09); UI dòng "Lúc này sẽ chạy bằng bước n · key" lấy từ `active_step` server (null ⇒ "Hiện không bước nào sẵn sàng") | R `profile-step` · A `dispatch`, `profiles` · E | R50–R70 (kể R66–R70) · D01–D09 (kể D08–D09) · A08b · P12–P13 · M21–M22 · M25b · M38 |
| AC-H04 (vế cảnh báo) | Profile toàn subscription ⇒ `all_subscription` true + cảnh báo "Profile này chỉ có bước subscription." | R · A · E | R20–R21 · P10–P11 · M23 |

### 3.1 Luật / quyết định → ca
| Luật | Ca |
|---|---|
| §2 Quyền thao tác (chỉ platform_admin) | Q01–Q03, E09, E11, M37 |
| §2 Provider api ⇒ secret `provider_api_key`; subscription không secret/base_url | R07–R10, A05, A07, A14 |
| §3 BaseUrlSchema (https; http chỉ dev + loopback) | R01–R06, R09, A04–A05 |
| §2/Q2 Xoá provider: PROVIDER_IN_USE / PROVIDER_HAS_HISTORY / cascade state | R12–R13, A17–A21 |
| D11 readonly `dify` | R11, R16, A09, A16, P06 |
| Q6 list giữ H4a-R13 | R76, A22 (+ H4a A17 khoá, không sửa) |
| Q7 không nhận key thô | R74, A06, M03 |
| Q8 key/kind/vendor + key profile bất biến (contract + GRANT cột) | R75, R79, A12, P04, D22–D23 |
| D5/D6 version + VERSION_CONFLICT + không đổi ⇒ không bump | A10–A13, A15, A20, P03–P04, M14, M26 |
| D9 "Kiểm tra lại" chỉ xoá `last_probe_at` và `last_ok_at` (không `updated_at`) | C10, D24 |
| D13 redactKey + audit không message | R36–R41, C03–C04, C14 |
| §4 cột version, GRANT cột, audit CHECK, migration chạy lại | D20–D26 |
| §3 B stepsProblem / 1..5 bước / KEY_TAKEN / PROFILE_IN_USE | R14–R19, R78, P06–P09 |
| §3 C ma trận (chỉ ô chưa thu hồi, đếm grant theo loại, only_tenant_id), ô (grant hiện khi đã thu hồi), AGENT_IS_DEFAULT, INVALID_REFERENCE | E01–E02, E07–E08 |
| plan-frontend D3/D6/D8/D9/D10/D11 | M07–M14, M24–M26, M31–M35 |

## 4. Danh sách ca
| Nhóm | File | Ca |
|---|---|---|
| R | `rules/models-rules.test.ts` | R01–R24 (24) |
| R | `rules/provider-check-rules.test.ts` | R30–R47 (18) |
| R | `rules/profile-step.test.ts` | R50–R70 (21) |
| R | `rules/contracts-h4b2.test.ts` | R71–R82 (12) |
| A | `providers.int.test.ts` | A01–A24 + A08b (25) |
| A | `provider-check.int.test.ts` | C01–C14 (14) |
| A | `profiles.int.test.ts` | P01–P14 (14) |
| A | `dispatch.int.test.ts` | D01–D09 (9) |
| A | `entitlements.int.test.ts` | E01–E11 (11) |
| A | `role.int.test.ts` | Q01–Q03 (3) |
| D | `db-h4b2.int.test.ts` | D20–D26 (7) |
| E | `e2e/studio/h4b2-models.studio.ts` | M01–M14 (14) |
| E | `e2e/studio/h4b2-profiles.studio.ts` | M20–M29 + M25b (11) |
| E | `e2e/studio/h4b2-access.studio.ts` | M30–M38 (9) |

Tổng **192**: R 75 · A/D 83 · E 34.

## 5. Rủi ro chập chờn
| Rủi ro | Giảm |
|---|---|
| C12 chờ đủ 10 s (không probe) | `sleep` tiêm chờ 25 ms thật; timeout ca 30 s |
| Hiệu lực ≤ 5 s (E03, E05) | `waitFor` ≤ 10 s, khẳng định ms ≤ 5 000 (in ms ra log) |
| D01–D07 đổi cấu hình giữa ca | owner + bump/NOTIFY, chờ `effective.hub_config_version ≥ v` trước khi gửi; `finally` trả về [fake-cli] |
| E06 thu hồi giữa run | job agent đã giao trước DELETE; `tryNext` 1,5 s cho lượt Orchestrator kế (nếu có) |
| e2e Sheet/alertdialog modal ẩn bảng | đóng dialog trước khi kiểm dòng/toast (bài học H4b-1 readiness #4) |

## 6. Lệnh xong mốc — đề xuất `bun run done:h4b2` (B8 tạo `tools/scripts/src/done-h4b2.ts`, mẫu `done-h4b1`; tasks B8 ghi `done:h4b` ⇒ đặt `done:h4b` là alias)
| # | Bước | Lệnh |
|---|---|---|
| 1 | typecheck | `bun run typecheck` |
| 2 | unit + R | `bun test` (gồm `tests/acceptance/H4b2/rules`) |
| 3 | int (gồm A/D H4b2 + hồi quy H4a A17, H4b1, H3b, H1 runner) | `bun run test:int` |
| 4 | e2e studio | `bunx playwright test -c e2e/studio/playwright.config.ts h4b2` |
| 5 | vết FR | `bun run trace --check` |
| 6 | khoá | `bun run test:lock:verify` |
Chạy tay: `bun test tests/acceptance/H4b2/rules` · `bun --env-file=.env.local --config=bunfig.int.toml test --timeout 30000 tests/acceptance/H4b2/`.

## 7. Đỏ đúng lý do · chạy 2026-10-13 (trước B1, DB `ai_system_h4b2_qc_test` qua `bun run db:test:create h4b2_qc`)
| Nhóm | File | Ca | Kết quả | Lý do đỏ |
|---|---|---|---|---|
| R | 4 file rules | 70 | 70 đỏ | `qc: <hàm> chưa có (plan §2)` (module chưa có) hoặc `expect(typeof …safeParse)`/`toMatchObject` trên export contract vắng |
| A | `providers` | 24 | 24 đỏ | `expect(status)` 404 thay 201/200/400/409 (route chưa mount) |
| A | `provider-check` | 14 | 14 đỏ | 404 thay 200/409; C14 điều kiện dương (log có `qc-c04`) chưa có |
| A | `profiles` | 14 | 14 đỏ | 404 thay 201/200/400/409 |
| A | `entitlements` | 11 | 9 đỏ · **2 xanh** | đỏ ở `expect(status)` 404; **E09** (tadmin 403) và **E11** (lan/badmin 403, 401) xanh trước code — `mountH4a` chặn `/studio/api/*`; khoá hồi quy |
| A | `role` | 3 | **3 xanh** | Q01–Q03 403/401 xanh trước code (như H4b-1 A01/A02) — khoá hồi quy |
| A | `dispatch` | 7 | 4 đỏ · **3 xanh** | D01/D02 đỏ ở `ScriptRuntime.next` `toBeDefined` (chưa có dự phòng ⇒ run lỗi ngay, không job); D04 đỏ `provider_key` claude-sub ≠ fake-cli; D07 `active_step` vắng. **D03, D05, D06 xanh trước code**: hành vi cũ trùng luật mới (on [] dừng; không chặn ⇒ bước 0; mọi bước chặn ⇒ hết) — khoá hồi quy B6 |
| D | `db-h4b2` | 7 | 7 đỏ | SQLSTATE `42703` (cột version chưa có), `42501` (GRANT chưa có), `23514` (audit CHECK chưa có `provider`/`model_profile`), D26 `version` null |
| E | 3 file `h4b2-*.studio.ts` | 29 (+3 M27–M29 xanh với code H4b-2 T5c) | 29 đỏ (trước code) | `/studio/models`, `/studio/access` chưa có ⇒ link "Models"/"Quyền agent" chưa bấm được (M01, M30), heading "Models"/"Quyền agent" không thấy ở `openModels`/`openAccess`; M37 form đăng nhập không hiện ở route chưa có |

Int: 80 ca = 72 đỏ ở `expect` + 8 xanh trước code (E09, E11, Q01–Q03, D03, D05, D06); **0 ca đỏ do dựng dữ liệu** (không `PostgresError`/`TypeError` trong `beforeAll`/fixture). `tsc -p tsconfig.tests.json` sạch; `biome check` sạch.

### 7.1 Kết quả chạy int sau Docker · 2026-10-13 (backend-lead, sau B1–B7; DB `ai_system_h4b2_be_test`, chạy tuần tự từng file)
| File | Lần đầu | Sau sửa | Ghi chú |
|---|---|---|---|
| `packages/db/src/hub-h4b2.int.test.ts` | 6/6 | 6/6 | |
| `db-h4b2` | 7/7 | 7/7 | |
| `providers` | 24/25 | 25/25 | A08b: TC-1 đã phân xử, test sửa (GET không body) |
| `role` | 3/3 | 3/3 | |
| `provider-check` | 12/14 | 14/14 | C12 (chờ đồng hồ thật 10 s > timeout client 10 s) + C14 (logger che trường `provider_key`) — sửa code |
| `profiles` | 13/14 | 14/14 | P08: TC-1 đã phân xử |
| `entitlements` | 10/11 | 11/11 | E07: TC-2 đã phân xử (đặt mặc định acme = hoadon) |
| `dispatch` | 9/9 | 9/9 | |
| Hồi quy: H4a ×5, runner, seed ×4, CR-054, H4b1 ×10 | xanh | xanh | |

### 7.x Kết quả `done:h4b2` · 2026-10-13 (DB `h4b2_done`)
| Bước | Kết quả |
|---|---|
| 1 typecheck | xanh |
| 2 `bun test` | 3574 pass / 1 fail: R49 `contracts-h2c` (có sẵn, đã biết) |
| 3 `db:test:create h4b2_done` | xanh |
| 4 `test:int` (3116 ca, 59 phút) | 4 fail (xem dưới); toàn bộ ca H4b2 xanh |
| 5 e2e studio (toàn bộ, 82 ca) | 81 pass / 1 fail |
| 6 `trace --check` | OK (244 mã) |
| 7 `test:lock:verify` | OK (728 file) |

Ca đỏ và phân loại:
- 2 ca `hub-rls` (WRK-FR-24 `agent_runtime`; HUB-FR-96 RLS 7 policy): có sẵn, TECH-DEBT #148.
- `hub-k1.int.test.ts` "HUB-FR-131 · 0029 idempotent": **H4b-2 ảnh hưởng** — migration H4b-2 thêm `provider`, `model_profile` vào `hub_audit_log_entity_check`; chạy lại 0029 đưa CHECK về danh sách K1 nên snapshot lệch. Cần backend-lead/qc phân xử (test K1 cũ chưa tính H4b-2 hoặc 0029 nên idempotent theo CHECK mới).
- `tests/acceptance/K1/query.int.test.ts` A50 (KH vẫn bị gọi khi kết nối hết dùng được): có sẵn K1 — H4b-2 không đụng `modules/kh`.
- e2e `e2e/studio/auth.studio.ts:53` HUB-FR-72 E04 (H4a): đòi menu "Models" `toHaveCount(0)` / "Sắp có"; H4b-2 bật mục Models ⇒ test khoá H4a lỗi thời, **H4b-2 ảnh hưởng**, qc phải cập nhật test (mở khoá) theo spec H4b-2.
- Ghi chú: ca `tuple concurrently updated` không xuất hiện ở lần chạy sau (lần đầu 5 fail, lần hai 4).

## 8. Chỗ hở spec (mặc định qc đã dùng) · Cần bổ sung
| # | Hở | Mặc định trong test | Agent |
|---|---|---|---|
| G1 | AC-H04 nguyên văn dời H2d (Q4); AC-H4b2-07 do qc đặt chưa có ở frontmatter/§8 spec | test dùng `AC-H4b2-07` (định nghĩa ở đầu file này) | docs-architect: thêm AC-H4b2-07 vào spec frontmatter + §8 | **đã đóng** (readiness lần 2) |
| G2 | plan-frontend §3 `errors.PROVIDER_KEY_TAKEN` / C2 `PROVIDER_KEY_TAKEN` vs contract `KEY_TAKEN` | mock trả `KEY_TAKEN`; kiểm câu "Khoá này đã được dùng" (M06) | frontend-lead: map `errors.KEY_TAKEN` | **đã đóng** (readiness lần 2) |
| G3 | plan-frontend §4 regex khoá `^[a-z0-9][a-z0-9-]{1,63}$` vs contract `^[a-z][a-z0-9-]{1,47}$` | dữ liệu e2e hợp cả hai; M05 dùng "A" (sai cả hai) | frontend-lead: dùng `ProviderKeySchema` | **đã đóng** (readiness lần 2) |
| G4 | "Tên profile" (plan-frontend) nhưng profile chỉ có `key` | `textbox "Tên profile"` ⇒ gửi `key` (M25) | frontend-lead | **đã đóng** (lần 3, FE có "Tên profile") |
| G5 | Nhãn option Hãng/Loại không có trong bảng §3 | Loại "API"/"Subscription" (provider.kind.*); Hãng "Anthropic"/"OpenAI" (artboard) | frontend-lead giữ đúng nhãn |
| G6 | Câu chữ cho `status: "requested"` chỉ có ở spec §3 A ("Worker chưa kiểm xong") | M10 kiểm chuỗi con "Worker chưa kiểm xong"; "Kiểm tra lại" ok kiểm "phiên đăng nhập hợp lệ" | frontend-lead: thêm key i18n | **đã đóng** (readiness lần 1: mặc định áp; i18n có) |
| G7 | plan-frontend D7 (tính ở client) đã thay bằng `active_step` server (spec §9) | M22: `active_step` null ⇒ "Hiện không bước nào sẵn sàng" dù bước 2 trông sẵn sàng | frontend-lead: sửa D7 | **đã đóng** (readiness lần 2) |
| G8 | `subscriptionOutcome(state, t0, now)` chưa nêu kiểu `state` | không có ca R; phủ bằng int C10–C13 | backend-lead | **đã đóng** (readiness lần 1: mặc định áp; i18n có) |
| G9 | Phân biệt timeout/network từ lỗi `fetch` | C07: `DOMException("TimeoutError")` ⇒ timeout; `TypeError` ⇒ network | backend-lead | **đã đóng** (readiness lần 1: mặc định áp; i18n có) |
| G10 | Định dạng log `job.fallback` | D02: có dòng chứa `job.fallback` và `fake-cli` | backend-lead giữ tên sự kiện |
| G11 | D8 "biết trước từ danh sách thì không gọi API" (list không có `used_by_profiles`) | M12 chấp nhận cả hai luồng (xác nhận rồi 409, hoặc hộp chặn ngay) | — |
| G12 | Sheet provider sau Lưu đóng hay ở lại (khác H4b-1) | M03 đóng bằng [Huỷ] nếu còn mở, rồi kiểm dòng | — | **đã đóng** (readiness lần 2) |
| G13 | spec §8 lệnh e2e `bunx playwright test h4b2` thiếu config studio | `-c e2e/studio/playwright.config.ts h4b2` (§6) | docs-architect: sửa spec §8 | **đã đóng** (readiness lần 2) |
| G14 | D24: `hub_api` chỉ UPDATE `last_probe_at` của `provider_state` (spec §4 #4) | `status`/`updated_at` ⇒ 42501 | — | **đã đóng** (readiness lần 2) |
## 9. Khoá
Khoá 2026-10-13 (T2, trước T3 Gate; Gate đổi spec ⇒ qc mở lại + ghi lý do): `bun run test:lock:write` thêm 17 file (`tests/acceptance/H4b2/**` 13 + `e2e/studio/_h4b2.ts` + 3 `h4b2-*.studio.ts`); `bun run test:lock:verify` OK (728 file); `bun run trace --check` OK (244 mã).

### 9.1 Cập nhật sau readiness lần 1 · 2026-10-13 (mở khoá → khoá lại)
- **#2:** M05 và ca mới **M25b** (Tên profile "A") đòi câu "Bắt đầu bằng chữ thường; chỉ chữ thường, số và - (2–48 ký tự)".
- **Q4 chốt "Không dự phòng"** (`agentHasOwnModel`): `profile-step.test.ts` truyền `false` cho R50–R65 (helper `pick(..., ownModel=false)`), thêm **R66–R70** (ca 9–13 plan §2.3); `dispatch.int` thêm **D08** (agent.model + bước 0 tắt ⇒ ALL_PROVIDERS_EXHAUSTED, không job, không log `job.fallback`) và **D09** (agent.model thắng `step.model`, giữ bước 0).
- **C10:** `last_ok_at` cũng NULL khi "Kiểm tra lại" (`setState` thêm `lastOk`); **D24:** `UPDATE last_ok_at` ⇒ ok; **P10:** item `steps` hợp `ProfileStepSchema`; **A08/P08:** `KEY_TAKEN` `details = {field:"key"}`; **A08b** (mới) + P08: path param không uuid ⇒ 400 `VALIDATION_ERROR` (providers GET/PUT/PATCH/DELETE/check, profiles GET/PUT/DELETE).
- **E2E:** M03/M04 khẳng định Sheet đóng sau Lưu (bỏ nhánh "đóng bằng Huỷ" — G12 hết hiệu lực); **M38** (mới) `AGENT_IS_DEFAULT` toast riêng, switch hoàn về, không GET lại ma trận. Đã khớp: câu chữ kết quả kiểm tra M07–M10, nhãn ô `{agent.key} × {tenant.key}` M30–M32, xoá luôn qua xác nhận M12/M13, A01 `secret {id,name}`.
- Ca mới: R66–R70 (5), D08–D09 (2), A08b (1), M25b, M38 ⇒ +10. R `profile-step` 21 ca đỏ `qc: pickStep chưa có`. Int mới/sửa **chưa chạy được đỏ-đúng-lý-do** vì Docker Desktop không khởi động (Postgres :5432 CONNECT_TIMEOUT); typecheck + biome sạch. Chạy lại khi có Docker (ghi vào VERIFY/B-task đầu).

## 9. Mở khoá bổ sung — e2e Xoá profile (readiness lần 3 #2, #8)
- `h4b2-profiles.studio.ts` thêm **M27** (nút "Xoá profile" chỉ ở profile đã lưu, cạnh "Lưu profile"), **M28** (alertdialog "Xoá {key}?" ⇒ `DELETE ?version=1` ⇒ toast "Đã xoá profile {key}", biến khỏi danh sách), **M29** (409 `PROFILE_IN_USE` ⇒ alertdialog "Không xoá được {key}" + badge `agents[].key`). Cả ba thuộc AC-H4b2-03; chạy xanh với code `1cb8cf82`.
- Đổi mã trùng: ca hằng contract `PROVIDER_KINDS` từ R70 thành **R82** (R70 chỉ còn `pickStep` ca 13). G4/G6/G8/G9 đã đóng; M38 thuộc AC-H4b2-05 (đã ghi).

## 10. Phân xử TC-1/TC-2 · 2026-10-13 (qc)
- TC-1: test sai (fixture gửi body với GET). Sửa: GET không body; PUT/PATCH/DELETE/check giờ chạy và kiểm 400 uuid. providers 25/25, profiles 14/14.
- TC-2: test sai dữ liệu (AGT.orch ngoài catalog acme ⇒ 400 đúng thứ tự `putEntitlement`, CR-054). Ý AC-H4b2 "thu hồi agent mặc định ⇒ 409" giữ nguyên; E07 ghi `tenant_agent_defaults(acme, hoadon)` rồi DELETE hoadon × acme ⇒ 409, xoá hàng ở finally. entitlements 11/11. Không có lỗi code thật.
