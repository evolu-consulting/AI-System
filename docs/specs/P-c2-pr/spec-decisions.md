# Quyết định người dùng · P-c2-pr (chuyển từ spec §10, 2026-10-14)

## Câu hỏi Q1–Q10 (trình Gate; mỗi câu có mặc định đề xuất tối giản)
| # | Câu hỏi | Mặc định đề xuất |
|---|---|---|
| Q1 | Provider ở P-c2? | **Chỉ GitHub (`github.com`)**. GitLab/GHES để sau (thêm `gitProviderOf` + client). Nguồn host khác: mặc định `branch_only` |
| Q2 | Runtime nhận token `source_credential` qua kênh nội bộ (như `dify-credential`) để clone/fetch/push repo riêng? (HUB-BR-30 hiện nói "clone/fetch") | **Có** — chỉ trong bộ nhớ + env của tiến trình git; mở rộng HUB-BR-30 thêm "push" |
| Q3 | "Áp" là **stage riêng** (executor `apply`, sau stage tự-sửa) hay tự áp ngay khi gate stage tự-sửa Đạt? | **Stage riêng** (C1) — thấy được trên canvas, có kết quả/quyết định riêng |
| Q4 | Nghĩa của `branch_only`? | `local_path`: **không push, không clone lâu dài** — "nhánh" = diff đã duyệt ở Hub (tải `.diff`, `git apply`), vì Runtime không giữ trạng thái (B3) và cấm ghi `local_path`. `git_remote` + `branch_only`: **push nhánh `ai/…`, không mở PR** |
| Q5 | Rebase khi `main` đổi: chỉ xét lúc Áp; xung đột ⇒ chỉ "Thử lại / Huỷ"? | **Có**. Muốn sửa trên `main` mới ⇒ chạy lại quy trình. Tự quay lại stage tự-sửa trên `main` mới để sau |
| Q6 | `auto_merge`: bật auto-merge của GitHub kiểu **squash**; repo chưa bật "Allow auto-merge"/không có branch protection ⇒ PR vẫn mở, ghi "auto-merge không bật được", không "Cần người quyết"? | **Có** |
| Q7 | Nội dung PR: tiêu đề + mục `## Thay đổi`/`## Test` của output đã duyệt, không tên người duyệt, không đầu vào người dùng (PC2-R14)? | **Có** |
| Q8 | Ai đặt `apply_mode` (kể cả `auto_merge`)? | **tenant_admin** của tenant (như sửa nguồn); `local_path` cố định `branch_only` |
| Q9 | Smoke với GitHub thật (repo thử + fine-grained PAT: Contents RW, Pull requests RW, chỉ repo đó)? | **Không chặn mốc**: P-c2 đạt bằng mock + bare repo; người dùng cấp repo/PAT thì `qc-uat` chạy thêm (hard stop: secret thật) |
| Q10 | Khoá nguồn dùng cho cả nguồn **chỉ-đọc** P-b (vd `fixbug-evolu` đọc repo riêng)? | **Có** — cùng đường resolve, không thêm việc |

**Người dùng trả lời 2026-10-14:** chấp nhận mặc định Q1–Q10 (Q1 chỉ GitHub; Q2 Runtime nhận khoá qua kênh nội bộ, chỉ ngoài container; Q3 stage "Áp" riêng sau gate; Q4–Q10 như bảng). Mockup `Pc2-*` (T1) đã duyệt; qc viết test theo test-plan.

## Áp mặc định readiness lần 1 (2026-10-14; chi tiết plan) — C19–C35
| # | Quyết định |
|---|---|
| C19 | Stage Áp `executor` view = `{kind:"apply",key:"apply",name:{vi:"Áp bản sửa",en:"Apply the fix"}}` |
| C20 | Job Áp lấy url/branch từ nguồn **hiện tại**; nguồn xoá / `url≠pin.url` / đổi kind ⇒ không job, hàng `failed`+`provider_error`, `apply_failed` |
| C21 | `advanceApply` kiểm run + stage còn `running` trước khi gọi provider; run đã huỷ ⇒ chỉ lưu hàng |
| C22 | Slot sandbox dùng chung: claim tự-sửa **và** claim `source.apply` (`db/apply_sql.py`, không qua `CLAIM_SELECT` vì không `provider_key`) đòi (tự-sửa + Áp đang chạy) < `RUNTIME_SANDBOX_MAX` (C38); `SANDBOX_SLOT` đếm thêm `type='source.apply'` |
| C23 | Đường dẫn Runtime thật: R1 `runtimes/resolve/host.py`, `sources/{git_driver,resolve}.py`; R2 `db/apply_sql.py`, `queue/runtime.py` |
| C24 | Lệnh xong R2: `db:test:drop h1 && db:test:create h1` rồi pytest `pc2` + `-m int apply_int_test.py` qua `run.ts` (C39) |
| C25 | F1 rủi ro `cao`; lệnh xong B2/B7 thêm file test khoá; hồi quy liệt kê thư mục (không `test:int` toàn bộ) |
| C26 | GET thiếu `tenant_id` (platform_admin) ⇒ 404 `NOT_FOUND` (plan §3.6 sửa theo C12) |
| C27 | Sweep: `sweepOnce` gọi `advanceApply` cho job `source.apply` đã kết thúc mà stage còn `running`; bỏ "interrupted" |
| C28 | `advanceApply` chạy trong tx khoá `process_runs FOR UPDATE` + kiểm lại trạng thái (mẫu `lockAndLoad`) |
| C29 | `unsupported_provider`: Hub sinh khi mode ∈ {pr, auto_merge} mà `githubRepoOf(url)` null |
| C30 | `apply-result`: 401 trước 413, 413 `PAYLOAD_TOO_LARGE` (thân > 256 KiB), theo `autofix.routes.ts` |
| C31 | Chân PR "vòng k" = `autofix_results.round` của kết quả được áp |
| C32 | `auditRealAction` cho Áp: `agent_id:null, workflow_ids:[], executor:"apply"` |
| C33 | `<stage_key>` log test Áp = key stage Áp; lỗi `container` ⇒ hàng `failed`+`provider_error`, decision theo `applyOutcome` |
| C34 | `has_credential=false` + lỗi `auth` ⇒ `no_credential`; `push_rejected`/`network` giữ; đổi ở `ApplyHost` (C36) |
| C35 | Env test mock: `GITHUB_MOCK_PORT`, `GITHUB_MOCK_TOKEN` thêm `.env.example` (B8) |

## Áp mặc định readiness lần 3 (2026-10-14) — C45–C52
| # | Quyết định |
|---|---|
| C45 | (#4) Hàng không job (C20/invalid): `failed`+`provider_error`; mode = `effectiveApplyMode(nguồn còn)` hoặc `branch_only`; source_key/branch/pin từ `autofix_results`; result null ⇒ key nguồn stage tự-sửa, branch/pin null |
| C46 | (#6) `apply_sql.py` FINISH ghi `error_reason='container'` khi job Áp lỗi container |
| C47 | (#1) `thread.rules.ts` (Record<DecisionReason>): `apply_conflict` = "bản sửa xung đột với mã mới" / "the fix conflicts with the new code"; `apply_failed` = "áp bản sửa không thành công" / "applying the fix failed" |
| C48 | (#1) `sources.errors.ts` (Record<SourceErrorCode>) thêm mã `SOURCE_*` mới; MESSAGES = EN `apiError.SOURCE_*` |
| C49 | (#1) `def-form.ts:146` (admin-web): executor `apply` ⇒ `"apply"` (B1 chạm 3 file này để `typecheck` xanh) |
| C50 | (#5) `ensureHandoff` chỉ cho executor `agent` (stage Áp không có "Bàn giao"); B7 sửa `defs/def.rules.ts` |
| C51 | (#2) B2: `bun run db:test:create pc2_qc` trước int (F3: `db:test:create pc2_e2e`, lệnh của frontend-lead) |
| C52 | (#7–#10) plan §5.2 đánh lại bước 1–8; trạng thái plan/tasks cập nhật; §5 tách `plan-runtime.md`; D1 thêm `tools/scripts/src/done-pc2.ts` |

## Quyết định trong lúc làm (BUILD)
| # | Task | Quyết định |
|---|---|---|
| D1 | B1 | `SourceConfig`/`SourceCreateRequest`/`SourceUpdateRequest` = `z.input` (`credential_secret_id` optional — config cũ trong DB/bản nháp FE); thêm `SourceConfigParsed` + `sourceConfigOut()` để chuẩn hoá về kiểu sau parse (null) |
| D2 | B1 | Payload `source.resolve` (launcher-prompt, check.service) + `SourceView.config` (`publicConfig`) đi qua `sourceConfigOut` — pydantic `hub.py` đòi `credential_secret_id` (UUID\|None, bắt buộc); job resolve cũ còn trong hàng đợi lúc deploy (≤ 300 s) chấp nhận lỗi |
| D3 | B1 | `AutofixStageView.apply_mode`/`apply_base` = `.nullable().optional()` (fixture FE `satisfies AutofixStageView` không sửa được ở B1); Hub luôn gửi (B7), FE đọc `?? null` |
| D4 | B1 | `AutofixFileSchema` + `AutofixStageViewSchema` + `ApplyStageViewSchema` chuyển sang `chat/processes-autofix.ts` (giữ `processes-entities.ts` ≤ 400 dòng); export qua `@ai/contracts/chat` như cũ |
| D5 | B1 | `APPLY_STATUSES` (thứ tự CHECK DB), `APPLY_REPORT_STATUSES`, `APPLY_JOB_CODES`, trần `APPLY_*` đặt ở `hub-admin/autofix.ts`; `ApplyReport.failures` chỉ khi `check_failed` (plan §3.5); `APPLY_BODY_MAX_BYTES = 256 KiB` |
| D6 | B1 | `applyModeIssue`/`effectiveApplyMode` nhận `{kind, url?, apply_mode?}` (SourceConfig gán được) để FE dùng với bản nháp; thứ tự issue trong một stage Áp: REAL → AFTER → NO_AUTOFIX → MAX → FIELDS |
| D7 | B1 | `SourceApplyJob` đăng ký `$defs` riêng trong `hubJsonSchemaBundle` (như `SourceResolveJob`, không vào `HUB_JSON_SCHEMAS`); fixture `SourceApplyJob.{pr,branch-only}` valid + `{branch-main,timeout-low}` invalid; fixture `SourceResolveJob` thêm `credential_secret_id` |
| D8 | B1 | Ngoài danh sách file B1 phải chạm để typecheck xanh: `tools/mocks/.../actions.ts` (`steps("apply")` ⇒ `[]`), `sources/{check.service,source.rules}.ts`, `runs/launcher-prompt.ts` (D2) |
| D9 | F2 | Option "Áp bản sửa" nằm trong chính `combobox "Người thực hiện"` (giá trị `apply`); nhãn editor đổi VI "Làm bởi" → "Người thực hiện" (EN "Performed by") theo G13/mockup (cột `col.executor` của bảng chạy giữ nguyên) |
| D10 | F2 | Stage Áp vẫn hiện khối Kết quả (tên tệp/mẫu/mục), Người trả lời, Hạn giai đoạn (contract bắt buộc `output`; mockup không nói ẩn); ẩn instruction, nguồn, tự sửa mã, Sau stage (khoá auto), ngân sách, must_know |
| D11 | F2 | Ô ẩn của stage Áp giữ trong draft; `normalizeApply` xoá chúng khi gửi/validate nên `APPLY_REAL/AFTER/FIELDS` chỉ còn từ server với def cũ |
| D12 | F2 | Ghi chú nhánh (`apply.note`) lấy nguyên văn từ mockup, thêm khoá i18n `process.admin.apply.note` ngoài bảng plan §3 |
| D13 | B2 | Cập nhật danh sách bảng/policy trong hai test BE-sở-hữu khi thêm bảng RLS mới (như P-c1 làm cho `autofix_results`): `migrate-hub.int.test.ts` `HUB_TABLES += autofix_applies`; `hub-rls.int.test.ts` `PA_POLICY_TABLES += autofix_applies`. 2 ca `hub-rls.int.test.ts:185` đỏ SẴN trên `main` (xác minh bằng stash: full `packages/db` = 189p/2f cả khi chưa có B2) — hiện vật tranh chấp DB dùng chung giữa file test chạy song song, KHÔNG do B2; ghi TECH-DEBT, không sửa trong B2 (ngoài phạm vi) |
| D14 | B3 | `#checkConfig` kiểm `git_remote` theo thứ tự host → `applyModeIssue` → khoá; `details.path` = chuỗi chấm `config.apply_mode` / `config.credential_secret_id` (khớp `SOURCE_ERRORS` contract). Khoá kiểm qua repo mới `sourceCredentialExists` (count scope system + lọc `tenant_id`, `kind='source_credential'`; `hub.secrets` xoá cứng ⇒ không cột `deleted_at`, còn hàng = chưa xoá) — một thân chung, không rò. `credential_secret_id ?? null` (bỏ qua khi null). Nguồn cũ đọc được sẵn qua `sourceConfigOut` (B1) ⇒ không cần code thêm ở B3 (S06 xanh) |

## Tranh chấp test
| # | Test khoá | Vì sao | Đề nghị qc |
|---|---|---|---|
| T1 | `tests/acceptance/P-c/rules/contracts-pc.test.ts` C05 (`PROCESS_DEF_RULES` toEqual 9 mã), C14 (`DECISION_REASONS` toEqual 18 mã) | P-c2 (plan §3.2, §3.6; test P-c2 C07/C12) bắt buộc thêm CUỐI 5 + 2 mã — hai bộ test khoá mâu thuẫn | đổi sang `slice(0, n)` (giữ thứ tự cũ) |
| T2 | `tests/acceptance/P-b/pfs1/rules/contracts.test.ts` R-C24 (`SOURCE_ERRORS` đúng 7 mã) | P-c2 C03 thêm cuối `SOURCE_CREDENTIAL_INVALID`, `SOURCE_APPLY_UNSUPPORTED` | so 7 mã đầu |
| T3 | `tests/acceptance/P-b/pfs3/start-resolve.int.test.ts` ST-02 (`items[0]` toEqual config git `{kind,url,branch}`) | B1 thêm `.default(null)` cho `credential_secret_id` ⇒ item `source.resolve` (chép config đã parse, D2) nay có `credential_secret_id:null`; hành vi nguồn cũ KHÔNG vỡ (B3 S06 xanh), chỉ expected khoá lỗi thời | thêm `credential_secret_id: null` vào expected hoặc đổi `toMatchObject`. Phát hiện ở B3 (lệnh hồi quy P-b); gốc là B1 (commit `8cc608a2`), không do B3 |
| — | `tests/acceptance/H2c/rules/contracts-h2c.test.ts` R48, R49 | đỏ SẴN trước B1 (`JOB_FAIL_REASONS` cuối = `container` từ P-c1; fixture `SourceResolveJob` không thuộc `HUB_JSON_SCHEMAS` từ P-b) — không do P-c2 | ghi nhận |
