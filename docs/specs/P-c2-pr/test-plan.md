# Test plan · P-c2-pr (push nhánh + PR / apply_mode / rebase / repo riêng) · qc

Chế độ **WRITE + LOCK** (T3) · 2026-10-14. "Đúng" = spec §2 (PC2-R01…R16), §3–§4, §6 (hàng rào), §7 (giả lập), spec §9 (C36–C44) và `spec-decisions.md` (Q1–Q10 đã chấp nhận; C1–C35, C45–C52) · plan §1–§6 (chữ ký §4) · plan-frontend §0–§5 (nhãn nguyên văn) · BA HUB-FR-128…130, HUB-FR-68, HUB-BR-30/34/38(b), WRK-FR-29. Hộp đen: chỉ contract hiện có + test khoá cũ làm mẫu.

## 1. Quy ước
| Mục | P-c2 |
|---|---|
| Tên test | `"<mã BA> · [PC2-Rxx ·] <ID> · mô tả"`; Python `test_<mã>_<id>_…` + docstring có mã |
| Loại | **R** hàm thuần + contract (`bun test`, nạp động — vắng ⇒ đỏ ở `fn()/schema()`) · **A** int Hub thật + DB tag riêng · **P** pytest Runtime không hạ tầng · **P-int** Runtime thật + bare repo + mock Hub (`-m int`) · **E** Playwright (stack P-b2 + `page.route`) · **M** unit mock GitHub |
| Vị trí | R `tests/acceptance/P-c2/rules/` · A `tests/acceptance/P-c2/*.int.test.ts` (+ `_support/pc2.ts`) · P/P-int `apps/agent-runtime/tests/acceptance/pc2/` (+ `_pc2.py`) · E `e2e/P-c2/{admin,chat}/*.pc2.ts` (config `playwright.pc2.config.ts`, `_pc2-support.ts`) · M `tools/mocks/src/github{,.test}.ts` |
| Id cố định | R `c2c2…`, A `c2c1…` (secret/job) `c2c3…` (db), e2e `c2e2…`; fixture P-b (`app-repo`…) + P-c (`local-app`) |
| Nguồn A | SQL jsonb (được trước code): `gh-priv` (github, khoá acme, pr mặc định) · `gh-auto` (auto_merge) · `gh-branch` (branch_only) · `gh-pub` (github, không khoá) · `gl-repo` (gitlab, không khoá) · `beta-priv` (beta, khoá beta) · `local-app` |
| Secret A | chèn owner theo spec H4b-1 (AES-GCM, `HUB_KEY`): `source_credential` acme/acme2/beta, `kh_api_key` acme, `provider_api_key` nền tảng; giá trị `qc-pc2-tok-*-Zx9Pq7Lm` (quét rò) |
| Chưa có 0032 | `needPc2(c)` đầu mỗi ca A ⇒ đỏ ở expect `{migration0032:true}`; def có stage Áp chỉ tạo khi 0032 có |
| Cấm | `skip/only/todo`, `sleep` cố định (chờ theo điều kiện; ngoại lệ: không), dữ liệu ngẫu nhiên không seed |

## 2. Hạ tầng
- **A** (`_support/pc2.ts`): `startPc2()` = Hub in-process như P-b `start3` + `hubSecretsKey: HUB_KEY` + seam GitHub (G1) trỏ mock GitHub cùng tiến trình (`createGithubMock`, token chấp nhận = khoá acme/beta). `mkApply` (def tự-sửa bước 0 + Áp bước 1 qua `POST /process-defs`), `toGate` (resolver ok → job tự-sửa → báo `ok` → output `MD_FIX` có `## Thay đổi`/`## Test`/bí mật/mục riêng → waiting_review), `passGate` (B Đạt), `claimApply` (Runtime giả: `source.apply` queued→running + token job), `postCred`/`postApply`, `endApply` (UPDATE `hub.jobs` như `finish_resolve` — G2), `waitRunIn` (chờ trạng thái run, gọi `sweepOnce` định kỳ), `expectNoToken`, `settlePc2` (settle P-b + reset mock + xoá `autofix_applies`/`autofix_results`).
- Fixture SQL `db.int` chạy thử trên DDL nháp plan §2 trong tx ROLLBACK (DB qc): `ok | err_req_ck | pushed_ck | json_ck | branch_ck | pr_ck` — đúng tên constraint. Máy móc flow (def tự-sửa trên `app-repo`/`gh-priv` → gate → Đạt → run done) chạy thử xanh (file tạm, đã xoá).
- **M** mock GitHub (`tools/mocks/src/github.ts`, cũng chạy trong `bun run mocks` cổng `GITHUB_MOCK_PORT`=4040): `GET/POST /repos/:o/:r/pulls` (422 "already exists" khi trùng head mở), `POST /graphql` (`enablePullRequestAutoMerge`), 401 "Bad credentials" khi token lạ; phản hồi ép theo op (`queue`), PR mồi (`seedPr`), nhật ký gọi (`calls`) gồm header/thân; điều khiển HTTP `/__mock/{reset,queue,pulls,calls}`.
- **P-int** (`pc2/_pc2.py`): `make_origin` (repo `seed` + `bare/app-repo.git`), `Origin.patch` (`git diff --full-index --binary` — để 3-way), `commit` (đẩy main mới), `install_hook` (pre-receive từ chối); `ApplyHub` (mock Hub: attachments + `source-credential` + `apply-result`, Bearer xác thực bằng DB `source.apply` running); Runtime env `GIT_CONFIG_*` insteadOf `https://github.com/pc2-test/` → `file://…/bare/` + `protocol.file.allow`, `RUNTIME_ENV=test`, `RUNTIME_SANDBOX=fake`. Fixture chạy thử trong container uv-git: 3-way trên main sửa cùng dòng ⇒ `UU src/sum.js`; hook ⇒ push rc 1.
- **E**: stack P-b2 (cổng `PC2_E2E_PORT_BASE`=5100, Redis DB 13, env `.env.test-pc2_e2e.local`, `HUB_SECRETS_KEY` khoá test cố định nếu vắng); `seedPc2Admin` (nguồn `pc2-repo`/`pc2-local`/`pc2-used` + secret metadata `gh-e2e-used` + def `pc2-edit`/`pc2-bad`, SQL jsonb); `patchRun`/`withApply` vá `GET /process-runs/:id`; `setApplyDecision` chỉ khi 0032 có.
- DB: `bun run db:test:create pc2_qc` (int, `.env.test-pc2_qc.local`) · `pc2_e2e` (e2e) · Runtime pytest dùng DB H1 (`ai_system_h1_test`, cần 0032 — G15).

## 3. Ma trận luật → ca
| Luật / FR | R | A | P / P-int | E |
|---|---|---|---|---|
| PC2-R01 stage Áp hợp lệ (APPLY_REAL/AFTER/NO_AUTOFIX/MAX/FIELDS, thêm cuối) | C06–C07, I01–I09 | V01–V04 | — | E06–E07 |
| PC2-R02 `apply_mode` hiệu lực + SOURCE_APPLY_UNSUPPORTED | C02–C05 | S04, F07–F09 | — | E01, E03, E05 |
| PC2-R03 Áp theo kết quả: no_changes / local branch_only / job | H01 | F01, F09–F10 | — | E11–E12 |
| PC2-R04 fetch → target HEAD → `apply --3way` → commit | — | — | AP01, AP03 | — |
| PC2-R05 rebase ⇒ kiểm lại + test container | P07 | X04 | AP02, AP04 | E08 (badge) |
| PC2-R06 refspec chỉ `ai/<run>/<stage>`, cưỡng bức trong ai/, không main/tag | C08 | D04 | P01, AP05–AP06 | — |
| PC2-R07 PR: tìm → tạo (base) → 422 exists ⇒ tìm lại; auto_merge SQUASH, hỏng ⇒ failed nhưng done | H02 | F03–F06 | — | E08–E10, E17 |
| PC2-R08 lỗi ⇒ quyết định (thứ tự), chỉ add_attempt/cancel, use_current 409 | H02, H12–H13 | X01–X08 | P05, AP08–AP09 | E15–E16 |
| PC2-R09 lỗi provider (401/403/404/429/5xx/422, retry, ≤ 60 s) | H04 | G01–G06 | — | — |
| PC2-R10 khoá nguồn cùng tenant, một thân 422; xoá khoá đang dùng | C01, C03 | S01–S03, S05, S07 | — | E02, E04–E05 |
| PC2-R11 kênh khoá nội bộ (job đúng loại/nguồn, 404/401 một thân, 409, không log) + env GIT_CONFIG | C09, H10–H11 | K01–K07, F02, G11 | P03–P04, AP01, AP07–AP08 | — |
| PC2-R12 mirror riêng theo nguồn có khoá | — | — | P02 | — |
| PC2-R13 audit `autofix_applies` + `authorize_real_action` (actor người Đạt) | — | D01–D06, E05–E08, F01 | — | — |
| PC2-R14 tiêu đề/thân PR (không người duyệt, không input, che bí mật) | H05–H07 | F03 | — | — |
| PC2-R15 `pr_url` chỉ https + host | H08 | D04, G08 | — | E13 |
| PC2-R16 cách ly tenant (RLS, view, log) | — | D05, T01–T02, K04 | — | — |
| C7/C9 `apply_mode` + `apply_base` ở gate | C15 | F03, F08–F09, F11 | — | E14 |
| C10/C11 `test_log_file`, `error_code` khi failed/check_failed | C13–C14 | D03, E05, E07, X04–X06 | — | E16 |
| C12 route khoá nguồn theo tenant phiên | — | S08 | — | E02, E04 |
| spec §6 Hub gọi ra ngoài (không redirect, ≤ 1 MiB, header) | — | F03, G09–G10 | — | — |
| C5 seed `fixbug-pr`, `fixbug-apply` giữ | — | V05–V06 | — | — |

FR trong phạm vi: HUB-FR-129 ✓ (MUST của mốc), HUB-FR-128 ✓ (rebase E4, gate), HUB-FR-130 ✓ (audit, `apply_mode`), HUB-FR-68 ✓ (khoá nguồn), HUB-BR-30/34/38(b) ✓, WRK-FR-29 ✓ (P-int). Smoke GitHub thật (S1) ngoài khoá (hard stop Q9).

## 4. Danh sách ca
| Nhóm | File | Ca |
|---|---|---|
| R | `rules/contracts-pc2.test.ts` | C01–C16 (16) |
| R | `rules/apply-issues.test.ts` | I01–I09 (9) |
| R | `rules/apply-rules.test.ts` | H01–H13 (13) |
| A | `db.int.test.ts` | D01–D08 (8) |
| A | `sources.int.test.ts` | S01–S08 (8) |
| A | `credential.int.test.ts` | K01–K07 (7) |
| A | `report.int.test.ts` | E01–E08 (8) |
| A | `flow.int.test.ts` | F01–F11 (11) |
| A | `provider.int.test.ts` | G01–G11 (11) |
| A | `decision.int.test.ts` | X01–X08 (11 sau `it.each` X05×4) |
| A | `tenant.int.test.ts` | T01–T02 (2) |
| A | `defs.int.test.ts` | V01–V06 (6) |
| P | `pc2/test_pc2_rules.py` | P01–P07 (35 sau parametrize) |
| P-int | `pc2/apply_int_test.py` | AP01–AP09 (9, `-m int`) |
| E | `e2e/P-c2/admin/sources.pc2.ts` | E01–E05 (5) |
| E | `e2e/P-c2/admin/editor.pc2.ts` | E06–E07 (2) |
| E | `e2e/P-c2/chat/result.pc2.ts` | E08–E14 (7) |
| E | `e2e/P-c2/chat/decision.pc2.ts` | E15–E17 (3) |
| M | `tools/mocks/src/github.test.ts` | 3 (không khoá) |
**Tổng khoá 171** = R 38 · A 72 · P 35 · P-int 9 · E 17 (+ M 3 ngoài khoá).

### Ca chính (kỳ vọng rút gọn)
| ID | Dữ liệu → kỳ vọng |
|---|---|
| C05 | `effectiveApplyMode`: local ⇒ branch_only (kể cả có mode); github vắng ⇒ pr; gitlab vắng ⇒ branch_only; `applyModeIssue` gitlab+pr/auto_merge ⇒ mã, branch_only/vắng ⇒ null |
| C08 | `SourceApplyJob` chặn: push_only ≠ (mode = branch_only), nhánh `main`/hoa/không uuid, sha HEAD/hoa, timeout 59/3601, process_run_id null, khoá `token`, URL có `user:token@` |
| C11 | báo cáo: head ⇔ pushed, code ⇔ failed (chỉ auth/no_credential/push_rejected/network), conflict_files chỉ conflict ≤ 50, failures ≤ 50, log ≤ 65 536, detail ≤ 300, target null chỉ failed |
| I05 | Áp bước 0 / Áp cách 2 bước / bước trước không tự-sửa ⇒ `{stages.<i>.executor, APPLY_NO_AUTOFIX}` |
| H04 | 401/403 thường/404 ⇒ auth; 403 rate 0 reset +30 s ⇒ retry ≈30 000; +120 s ⇒ rate_limited; 429 retry-after 5/60 ⇒ retry, 61 ⇒ rate_limited; 422 exists ⇒ exists, khác ⇒ provider_error |
| H06 | thân PR: có `## Thay đổi`, `## Test`, chân `Tạo bởi AI System · run <id> · vòng 2`; không `AKIA…`, `ghp_…`, mục khác |
| D06 | hub_rw UPDATE (status, provider, pr_number, pr_url, auto_merge, error_code, detail, updated_at) ok; UPDATE branch/head_sha/mode, DELETE ⇒ 42501 |
| D08 | `review_tasks_reason_ck` ∋ apply_conflict/apply_failed; `jobs_type_ck` ∋ source.apply (giữ source.resolve); `jobs_agent_ck` cho source.apply không agent (G3) |
| S02 | khoá beta / kh_api_key / provider_api_key / không tồn tại ⇒ 422 SOURCE_CREDENTIAL_INVALID, 4 thân giống hệt, có path `config.credential_secret_id`, 0 hàng |
| K04 | queued / succeeded / nguồn ngoài job / nguồn không khoá / nguồn beta / job beta / workflow.async ⇒ 404 NOT_FOUND, 7 thân giống hệt |
| E05 | hàng: job, gh-priv, mode pr, pushed, `ai/<run>/fix`, pin C1, target, head, rebased, autofix_result_id, test 0/3 400 ms, log attachment `(apply|fix)-apply-test.log.txt` text/plain |
| F01 | payload = {v1, source.apply, job, acme, run, source{gh-priv, url, main, has_credential}, pin C1, nhánh, pr, push_only false, patch = diff vòng 1 (tên/mime/size/sha256), `bun install`, `bun test`, `["src/**"]`, 600}; hợp `JobPayloadSchema`; patch tải được; audit `authorize_real_action` actor B |
| F03 | list `head=pc2-test:ai/<run>/fix&state=open` → create {tiêu đề `[AI] Áp pc2-f · Sửa lỗi (<run8>)`, base main, draft false, maintainer_can_modify false}; header Bearer khoá acme, `application/vnd.github+json`, `2022-11-28`, `ai-system-hub`; hàng pr_opened #1 + URL; view stage 1 `apply`; gate `apply_mode` pr + `apply_base` main |
| G05 | 502 mọi lần ⇒ đúng 4 lời gọi list (1 + 3) ⇒ provider_error |
| G09 | 301 ⇒ không gọi `/qc-redirect-target`; không pr_opened |
| X02 | Thêm lượt sau conflict ⇒ job Áp mới cùng nhánh/bản vá/pin ⇒ PR ⇒ hàng [conflict, pr_opened] |
| X06 | job kết thúc không báo cáo ⇒ apply_failed; driver ghi hàng failed + provider_error |
| AP01 | bare: `refs/heads/ai/<run>/fix` = head báo cáo, cha = pin, `src/sum.js` có `a+b`, tác giả `ai-autofix`; 1 lần lấy khoá (Bearer + source_id); main không đổi; không rò token (đĩa/log/báo cáo); `work/<job>` dọn |
| AP03 | main sửa cùng dòng ⇒ conflict `src/sum.js`, head null, rebased true, không ref ai/ |
| AP05 | ref ai/ cũ trỏ commit lệch ⇒ cưỡng bức cập nhật; chạy lại ⇒ pushed; ref ai/ của run khác + main giữ nguyên; chỉ có `main` + `ai/*` |
| AP06 | payload nhánh `main` ⇒ job failed, không báo pushed, mọi ref giữ nguyên |
| E16 | 8 `error_code` ⇒ heading `Áp bản sửa không thành công` + câu `err.<code>` nguyên văn; không "Dùng bản hiện có" |

## 5. Rủi ro chập chờn
| Rủi ro | Giảm |
|---|---|
| `prepareDb`/`ALTER ROLE` cấp cụm khi nhiều file | chạy từng file (như P-c) |
| G05 chờ 1+2+4 s thật | timeout ca 60 s, chờ theo trạng thái run (≤ 30 s) |
| G02 rate reset theo giây đồng hồ | reset = now + 1 s (Hub chờ ≤ 60 s) |
| Hub phát hiện job Áp kết thúc (vòng nền tắt) | `waitRunIn` gọi `sweepOnce` mỗi ~0,4 s (G2) |
| P-int phụ thuộc git + DB H1 có 0032 | chạy trong ảnh `ai-system-uv-git` (`scripts/run.ts`); G15 |

## 6. Chỗ hở spec (mặc định qc đã dùng) · Cần bổ sung
| # | Hở | Mặc định trong test | Agent |
|---|---|---|---|
| G1 | Seam Hub cho GitHub không có trong `AppDeps` | test truyền `deps.github = {apiUrl, webHost}` **và** đặt `process.env.HUB_GITHUB_API_URL/HUB_GITHUB_WEB_HOST` trước `createApp`; Hub dùng một trong hai | backend-lead (B6) |
| G2 | Cơ chế Hub biết job `source.apply` kết thúc (job không có `hub.runs`/stream) | Runtime kết thúc = UPDATE `hub.jobs` (như `finish_resolve`); Hub phản ứng qua POST `apply-result` và/hoặc `sweepOnce` (test gọi định kỳ) | backend-lead (B7, R2) |
| G3 | plan §2 chỉ nới `jobs_type_check`; tên thật `jobs_type_ck`; `jobs_agent_ck` (0021) chặn job không agent ngoài resolve | D08 đòi cả `jobs_type_ck` và `jobs_agent_ck` chứa `'source.apply'` | backend-lead (B2) |
| G4 | Tên export contract | `SourceApplyJobSchema` (hub) · `SourceCredentialRequestSchema`, `SourceCredentialResponseSchema`, `ApplyReportSchema` (hub-internal) · `ApplyStageViewSchema` (chat) · `APPLY_MODES`, `GIT_PROVIDERS`, `APPLY_ERROR_CODES`, `gitProviderOf`, `effectiveApplyMode`, `applyModeIssue`, `applyStageIssues` (hub-admin) | backend-lead (B1) |
| G5 | Tên log test Áp `<stage_key>-apply-test.log.txt` — stage nào | chấp nhận `apply-` hoặc `fix-` | backend-lead (B5) |
| G6 | Runtime: chữ ký/hành vi | `agent_runtime.apply.host.ApplyHost`; claim `source.apply` riêng (provider_key NULL); nhánh ngoài ai/ ⇒ job failed không push; báo cáo trước khi kết thúc; tác giả commit `ai-autofix`; `failures[0].check="tests"` khi test sau rebase đỏ | backend-lead (R1–R2) |
| G7 | C12 nói platform_admin GET thiếu `tenant_id` ⇒ 400, nhưng test khoá H4b-1 A51 = 404 và C12 "không đổi BE" | S08: GET ⇒ 404 NOT_FOUND, POST ⇒ 400 path `tenant_id` | Đã chốt: 404 theo C12/C26 (hết chờ) |
| G8 | `StageView.executor` (ExecutorRef cần key/name) cho stage Áp chưa định nghĩa | Đã định nghĩa ở C19: executor `{kind:"apply", key:"apply", name…}` | Đã chốt (C19) |
| G9 | GitHub 3xx: mã lỗi; thân > 1 MiB | G09 khoá "không theo redirect + không pr_opened"; G10 ⇒ provider_error | backend-lead |
| G10 | PC2-R15 `pr_url` sai: status hàng | khoá `pr_url` null + `error_code=provider_error`, không khoá status | — |
| G11 | Quyền đọc log test Áp cho người duyệt stage tự-sửa | khoá A đọc được, X/Db 404; B không khoá | — |
| G12 | auto-merge "bật không được" | mock GraphQL 200 + `errors` ⇒ `auto_merge="failed"` | — |
| G13 | Editor hiện chưa có `combobox "Người thực hiện"` | e2e theo plan-frontend §5 (combobox + option "Áp bản sửa") | frontend-lead (F2) |
| G14 | Stack e2e cần `HUB_SECRETS_KEY` | config đặt khoá test cố định khi vắng | — |
| G15 | DB Runtime H1 (`ensure_schema` chỉ migrate khi chưa có `hub.jobs`) cần 0032 | `done:pc2` phải tạo lại / migrate DB H1 trước P-int | backend-lead (D1) |
| G16 | Gate `local_path` (`gate.local`) — FE nhận diện bằng gì | Đã trả lời ở FC13 plan-frontend (luật `apply_mode`/`apply_base`); không khoá câu `gate.local` | Đã chốt (FC13) |

## 7. Lệnh xong mốc — `bun run done:pc2` (D1, mẫu `done-pc`)
| # | Bước | Lệnh |
|---|---|---|
| 1 | typecheck | `bun run typecheck` |
| 2 | R + unit + mock | `bun test packages/contracts apps/hub-api/src/modules/processes tests/acceptance/P-c2/rules tools/mocks` |
| 3 | DB int | `bun run db:test:create pc2_done` |
| 4 | A (từng file) + hồi quy | `bun --env-file=.env.test-pc2_done.local --config=bunfig.int.toml test --timeout 60000 tests/acceptance/P-c2/<file>.int.test.ts` · hồi quy (không chạy `test:int` toàn bộ): `bun --env-file=.env.test-pc2_done.local --config=bunfig.int.toml test --timeout 60000 tests/acceptance/P-a tests/acceptance/P-b tests/acceptance/P-c tests/acceptance/H4b1` (xanh); mỗi file P-c2 chạy riêng |
| 5 | P + P-int | `bun apps/agent-runtime/scripts/run.ts "uv run pytest tests/acceptance/pc2 tests/acceptance/pc -q && uv run pytest -m int tests/acceptance/pc2/apply_int_test.py -q"` (trước pytest: `bun run db:test:drop h1 && bun run db:test:create h1` để H1 có 0032 — G15) |
| 6 | sandbox (hồi quy retest) | `bun run test:pc:sandbox` (Linux + Docker/Podman) |
| 7 | DB e2e | `bun run db:test:create pc2_e2e` |
| 8 | E | `bunx playwright test -c e2e/P-c2/playwright.pc2.config.ts --reporter=line` (+ hồi quy `e2e/P-c`) |
| 9 | khoá + vết | `bun run test:lock:verify && bun run trace --check` |

## 8. Đỏ đúng lý do · chạy 2026-10-14 (main `d6199b29`, chưa B1; DB `ai_system_pc2_qc_test`, e2e `ai_system_pc2_e2e_test`)
| Nhóm | File | Ca | Kết quả | Lý do đỏ |
|---|---|---|---|---|
| R | 3 file rules | 38 | 38 đỏ | `qc: <hàm> chưa có (plan §4)` / `qc: <Schema> chưa có (plan §3)`; C01–C03, C06–C07, C09, C12–C16, I09, H12–H13 đỏ ở `expect` (trường/mã/nhánh chưa có) |
| A | db | 8 | 8 đỏ | D01 `{file0032:false}`; D02–D07 `{table_hub_autofix_applies:false}`; D08 constraint chưa chứa giá trị mới |
| A | sources | 8 | 5 đỏ · 3 xanh | S01–S05 đỏ ở `expect` (400 VALIDATION_ERROR — khoá lạ strict). **Xanh sẵn (hồi quy, đúng):** S06 nguồn cũ đọc được, S07 SECRET_IN_USE (used_by H4b-1), S08 route khoá theo tenant |
| A | credential, report, flow, provider, decision, tenant, defs | 56 | 56 đỏ | `needPc2`: `{migration0032:false}`; 0 `PostgresError`/`TypeError` ở `beforeAll` (chạy từng file) |
| P | `test_pc2_rules.py` | 35 | 35 đỏ | `ModuleNotFoundError: agent_runtime.apply` |
| P-int | `apply_int_test.py` | 9 | 9 đỏ | `ModuleNotFoundError: agent_runtime.apply` (`need_r2`) |
| E | `e2e/P-c2` (stack P-b2 lên đủ, seed + đăng nhập OK) | 17 | 17 đỏ | E01–E02: `combobox "Khoá nguồn"` chưa có; E03: cột "Chế độ áp"; E04: `button "Khoá nguồn"`; E05: alert câu `apiError.SOURCE_*`; E06: `combobox "Người thực hiện"`; E07: alert `err.APPLY_MAX`; E08–E14: region "Kết quả áp bản sửa"/câu gate chưa có; E15–E16: heading quyết định (0032 vắng ⇒ lý do cũ); E17: `article` "Áp bản sửa" |
| M | `github.test.ts` | 3 | 3 xanh | mock (không khoá) |

`bun run typecheck` xanh (gồm `@ai/mocks`); `biome check` sạch (tests/acceptance/P-c2, e2e/P-c2, tools/mocks); `ruff check` + `ruff format --check` + `pyright` (tests/acceptance/pc2) sạch.

## 9. Khoá
Khoá lần 1: 2026-10-14 (T3) — `tests/acceptance/P-c2/**`, `apps/agent-runtime/tests/acceptance/pc2/**`, `e2e/P-c2/**`. `bun run test:lock:write` + `bun run test:lock:verify` OK.

Không có Tranh chấp test.
