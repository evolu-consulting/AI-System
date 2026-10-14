# Plan · P-c2-pr (push nhánh + PR / apply_mode / rebase / repo riêng)

Backend-lead PLAN 2026-10-14. Luật: spec §2 PC2-R01…R16 (P-c1 PC-R* giữ). Q1–Q10 đã chấp nhận (`spec-decisions.md`); readiness lần 1 áp = spec §9 C19–C35. Không chép BA — trỏ mã. Migration kế tiếp: `0032`.

## Backend (backend-lead)

### §1 Luồng tổng
| # | Ai | Bước | Ghi chú |
|---|---|---|---|
| 0 | Hub | (P-b, sửa) resolve: `ResolveItem.config.credential_secret_id` ≠ null ⇒ Runtime gọi `source-credential` trước khi fetch; mirror `src-<source_id>` | PC2-R11/R12, §5.1 |
| 1 | Người | gate stage tự-sửa (bước k) Đạt — view hiện `apply_mode` (PC2 C7) | P-c1 sẵn có |
| 2 | Hub | launcher bước k+1: stage `executor.kind="apply"` ⇒ preconfirm D4 `authorize_real_action` (mở rộng cho `apply`) ⇒ `applyPlan(...)` | §6.2 |
| 3a | Hub | `no_changes` / `branch_only` cho `local_path` ⇒ tx: insert `autofix_applies` + output `apply.md` + stage `done` (không job) | PC2-R03 |
| 3b | Hub | `git_remote` ⇒ job `source.apply` (§3.3), `push_only = mode==="branch_only"` | |
| 4 | Runtime | claim → (khoá?) `POST …/source-credential` → fetch mirror → `target` = `rev-parse refs/heads/<branch>` → checkout `target` ở `work/<job>/repo/` → tải `patch` → `git apply --3way --index --binary` → commit | §5.2 |
| 5 | Runtime | `target≠pin` ⇒ xuất cây đã lọc PB-R07 → `work/<job>/workspace/<key>/` → kiểm PC-R08 (paths/size/secrets trên diff `target..HEAD`, rồi install + test trong container) | dùng lại `check.run_checks`, `AutofixHost` pha prep/test |
| 6 | Runtime | push `+HEAD:refs/heads/<branch>` (bỏ qua nếu `ls-remote` = head) → `POST …/apply-result` (retry 1/2/4 s; 409 `APPLY_RESULT_EXISTS` = thành công) → kết thúc job → dọn `work/<job>/` + container | PC2-R06 |
| 7 | Hub | endpoint lưu hàng `autofix_applies` (+ blob log test nếu có) | §6.3 |
| 8 | Hub | stage-driver sau job: `applyOutcome` ⇒ decision **hoặc** (`pushed`, không `push_only`) ⇒ `GithubClient` tìm/tạo PR (+ auto-merge) ⇒ UPDATE hàng ⇒ output `apply.md` ⇒ stage `done` ⇒ run tiếp/kết thúc | §6.4 |

### §2 Dữ liệu — migration `0032_pc2_apply.sql` (viết tay, idempotent, chỉ THÊM/nới)
```sql
CREATE TABLE IF NOT EXISTS hub.autofix_applies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  process_run_id uuid NOT NULL,
  stage_run_id uuid NOT NULL,                 -- stage Áp
  job_id uuid,                                -- null khi không job (no_changes/branch_only local)
  autofix_result_id uuid,                     -- kết quả tự-sửa được áp
  source_key text NOT NULL,
  mode text NOT NULL,
  status text NOT NULL,
  branch text,
  pin_sha text,
  target_sha text,
  head_sha text,
  rebased boolean NOT NULL DEFAULT false,
  provider text,
  pr_number integer,
  pr_url text,
  auto_merge text,
  error_code text,
  detail text,
  conflict_files jsonb NOT NULL DEFAULT '[]'::jsonb,
  failures jsonb NOT NULL DEFAULT '[]'::jsonb,
  test_exit_code integer,
  test_duration_ms integer,
  test_log_attachment_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT autofix_applies_job_uq UNIQUE (job_id),
  CONSTRAINT autofix_applies_mode_ck CHECK (mode IN ('pr','auto_merge','branch_only')),
  CONSTRAINT autofix_applies_status_ck CHECK (status IN ('no_changes','branch_only','pushed','pr_opened','conflict','check_failed','failed')),
  CONSTRAINT autofix_applies_provider_ck CHECK (provider IS NULL OR provider IN ('github')),
  CONSTRAINT autofix_applies_auto_ck CHECK (auto_merge IS NULL OR auto_merge IN ('on','failed')),
  CONSTRAINT autofix_applies_err_ck CHECK (error_code IS NULL OR error_code IN
    ('auth','no_credential','push_rejected','network','rate_limited','provider_error','check_failed','unsupported_provider')),
  CONSTRAINT autofix_applies_err_req_ck CHECK (status NOT IN ('failed','check_failed') OR error_code IS NOT NULL),
  CONSTRAINT autofix_applies_sha_ck CHECK ((pin_sha IS NULL OR pin_sha ~ '^[0-9a-f]{40}$')
    AND (target_sha IS NULL OR target_sha ~ '^[0-9a-f]{40}$') AND (head_sha IS NULL OR head_sha ~ '^[0-9a-f]{40}$')),
  CONSTRAINT autofix_applies_branch_ck CHECK (branch IS NULL OR branch ~ '^ai/[0-9a-f-]{36}/[a-z0-9-]{1,32}$'),
  CONSTRAINT autofix_applies_url_ck CHECK (pr_url IS NULL OR (pr_url ~ '^https://' AND length(pr_url) <= 2048)),
  CONSTRAINT autofix_applies_detail_ck CHECK (detail IS NULL OR length(detail) <= 300),
  CONSTRAINT autofix_applies_json_ck CHECK (jsonb_typeof(conflict_files)='array' AND jsonb_typeof(failures)='array'),
  CONSTRAINT autofix_applies_pushed_ck CHECK (status NOT IN ('pushed','pr_opened') OR head_sha IS NOT NULL),
  CONSTRAINT autofix_applies_pr_ck CHECK (status <> 'pr_opened' OR (pr_number IS NOT NULL AND provider IS NOT NULL)),
  CONSTRAINT autofix_applies_run_fk FOREIGN KEY (process_run_id, tenant_id)
    REFERENCES hub.process_runs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT autofix_applies_result_fk FOREIGN KEY (autofix_result_id) REFERENCES hub.autofix_results (id) ON DELETE SET NULL,
  CONSTRAINT autofix_applies_log_fk FOREIGN KEY (test_log_attachment_id) REFERENCES hub.attachments (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS autofix_applies_stage_idx ON hub.autofix_applies (stage_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS autofix_applies_run_idx ON hub.autofix_applies (process_run_id);
CREATE INDEX IF NOT EXISTS autofix_applies_log_att_idx ON hub.autofix_applies (test_log_attachment_id) WHERE test_log_attachment_id IS NOT NULL;
```
- RLS `ENABLE`; policy `autofix_applies_hub_rw FOR ALL TO hub_rw USING/WITH CHECK v_t` (mẫu 0031). `GRANT SELECT, INSERT ON hub.autofix_applies TO hub_rw; GRANT UPDATE (status, provider, pr_number, pr_url, auto_merge, error_code, detail, updated_at) ON hub.autofix_applies TO hub_rw;` — UPDATE cột khác/DELETE ⇒ 42501. Không GRANT `agent_runtime`, `hub_ro`.
- Nới CHECK (mẫu 0031): `review_tasks_reason_ck` += `'apply_conflict','apply_failed'`; `jobs_type_ck` += `'source.apply'` và `jobs_agent_ck` (0021) cho `source.apply` không agent (C15) (BUILD đọc danh sách hiện hành từ migration gần nhất đã sửa nó — giữ đủ giá trị).
- `stage_runs`/`process_defs`/`sources`: không DDL (executor + config trong jsonb).
- Drizzle: `packages/db/src/schema/hub-autofix.ts` thêm `autofixApplies` (cùng file, ≤ 400 dòng).
- Query mới + index: (a) view/driver: `WHERE stage_run_id=$1 ORDER BY created_at DESC LIMIT 1` ⇒ `autofix_applies_stage_idx`; (b) endpoint: unique `job_id`; (c) kết quả tự-sửa bước trước: `autofix_results_stage_idx` (P-c1) theo `stage_run_id` của stage tự-sửa; (d) đọc log test (PC-R14 mở rộng): `test_log_attachment_id` ⇒ `*_log_att_idx`; (e) kênh khoá: `sources` theo `id` + `tenant_id` (PK). Mọi query trong `withHubScope` + `tenant_id` tường minh.

### §3 Contract (bảng trường)
#### 3.1 `hub-admin/sources.ts`
| Trường | Kiểu | Ràng buộc |
|---|---|---|
| `APPLY_MODES` | `["pr","auto_merge","branch_only"] as const`; `ApplyModeSchema` | |
| `GitRemoteConfig.credential_secret_id` | `uuid \| null` | `.nullable().default(null)`; đọc cũ `?? null` |
| `GitRemoteConfig.apply_mode` | `ApplyMode` optional | vắng = mặc định (PC2-R02); FE gửi khi người dùng chọn |
| `GIT_PROVIDERS` | `["github"] as const` | |
| `SOURCE_ERRORS` | += `SOURCE_CREDENTIAL_INVALID: 422`, `SOURCE_APPLY_UNSUPPORTED: 422` (cuối) | `details.path` = `config.credential_secret_id` / `config.apply_mode` |
| `SourceView` | không đổi hình (config đã gồm 2 trường mới); FE tính chế độ hiệu lực bằng `effectiveApplyMode` | |
| `GitPinSchema` | không đổi | |
#### 3.2 `hub-admin/processes.ts` + `process-steps.ts` + `chat/processes.ts`
| Trường | Kiểu | Ràng buộc |
|---|---|---|
| `ProcessStageDef.executor` | union += `z.strictObject({kind: z.literal("apply")})` | |
| `EXECUTOR_KINDS` (chat) | += `"apply"` (cuối) | view stage `executor.kind` |
| `PROCESS_DEF_RULES` | += `APPLY_REAL, APPLY_AFTER, APPLY_NO_AUTOFIX, APPLY_MAX, APPLY_FIELDS` (cuối) | `applyStageIssues` gộp vào `processDefStageIssues` |
| Stage Áp — các trường stage còn lại | giữ schema; luật `APPLY_FIELDS` đòi `sources=[]`, `autofix=null`, `token_budget=null`, `must_know=[]`; `instruction` bỏ qua; `output` bắt buộc như cũ (seed: `apply.md`, mục `Kết quả áp`) | Hub tự sinh output |
| `AutofixStageShape` | += kiểu cho `applyStageIssues` (§4) | |
#### 3.3 `hub/job.ts`
| Trường | Kiểu | Ràng buộc |
|---|---|---|
| `SourceApplyJobSchema.v/type/job_id/tenant_id/process_run_id` | như `SourceResolveJob`; `type: "source.apply"`; `process_run_id` uuid (không null) | |
| `.source` | `{source_id: uuid, key: SourceKey, url: GitUrl, branch: Branch, has_credential: boolean}` | chỉ `git_remote` |
| `.pin_sha` | `^[0-9a-f]{40}$` | `pin.sha` của kết quả tự-sửa |
| `.branch` | `AUTOFIX_BRANCH_RE` | = `autofix_results.branch` |
| `.apply_mode` | `ApplyMode` | chế độ hiệu lực lúc launch (C8) |
| `.push_only` | boolean | `= apply_mode==="branch_only"` (refine) |
| `.patch` | `JobAttachment` | diff đính kèm (`diff_attachment_id`) của kết quả `ok`; tải qua `GET /internal/jobs/:id/attachments/:aid` (thuộc run — PB-R18) |
| `.install_cmd` / `.test_cmd` / `.write_allowlist` | như `JobAutofix` | từ stage tự-sửa trong snapshot def |
| `.timeout_s` | int 60..3600 | = `timeout_s` stage Áp |
| `JobPayloadSchema` | union += `SourceApplyJobSchema` | sinh lại pydantic `hub.py` |
| `ResolveItem.config` | `SourceConfig` (đã có) — nay mang `credential_secret_id` | chỉ id, không giá trị |
#### 3.4 `hub-internal/source-credential.ts` (mới) — `POST /internal/jobs/:job_id/source-credential`
| Trường | Kiểu | Ràng buộc |
|---|---|---|
| Request | `{source_id: uuid}` strict | |
| 200 | `{username: string 1..64, token: string 1..4096}` | `username` = `credentialUsername(provider)` (`github` ⇒ `x-access-token`; host khác ⇒ `oauth2`); `Cache-Control: no-store` |
| Lỗi | 400 `VALIDATION_ERROR` · 401 `UNAUTHORIZED` (token job sai) · 404 `NOT_FOUND` (job không `running` / sai type / nguồn không thuộc job / không khoá / tenant khác — một thân) · 409 `NOT_CONFIGURED` (`SecretUseError`) | không log giá trị; log `{job_id, source_id, failure}` |
#### 3.5 `hub-internal/apply.ts` (mới) — `POST /internal/jobs/:job_id/apply-result`
| Trường | Kiểu | Ràng buộc |
|---|---|---|
| `status` | `pushed\|conflict\|check_failed\|failed` | |
| `target_sha` | `^[0-9a-f]{40}$ \| null` | null chỉ khi `failed` trước khi fetch được |
| `head_sha` | `^[0-9a-f]{40}$ \| null` | `≠ null ⇔ status=pushed` |
| `rebased` | boolean | |
| `code` | `APPLY_JOB_CODES = auth\|no_credential\|push_rejected\|network \| null` | `≠ null ⇔ status=failed` |
| `conflict_files` | `string ≤1024 [] ≤ 50` | chỉ khi `conflict` (khác ⇒ `[]`) |
| `failures` | `AutofixFailure[] ≤ 50` | chỉ khi `check_failed` |
| `test` | `{exit_code int\|null, duration_ms ≥0, log_tail ≤ 65_536} \| null` | khi đã chạy test sau rebase |
| `detail` | `string ≤ 300` optional | đã che (Runtime `redact` + `redact_auth`) |
| Phản hồi | 201 `{id}` · 400 · 401 · 409 `APPLY_NOT_EXPECTED` (job không `source.apply`/không `running`) · 409 `APPLY_RESULT_EXISTS`; `no-store`; 413 `PAYLOAD_TOO_LARGE` (thân > 256 KiB; 401 xét trước 413 — mẫu `autofix.routes.ts`, C30) | `HUB_INTERNAL_ERRORS +=` 2 mã 409 |
#### 3.6 `chat/processes-entities.ts` + `chat/processes.ts`
| Trường | Kiểu |
|---|---|
| `DECISION_REASONS` | += `apply_conflict`, `apply_failed` (cuối) |
| `APPLY_ERROR_CODES` (export từ `hub-admin/autofix.ts`, dùng chung) | `auth, no_credential, push_rejected, network, rate_limited, provider_error, check_failed, unsupported_provider` |
| Stage view `executor` (Áp) | `{kind:"apply", key:"apply", name:{vi:"Áp bản sửa", en:"Apply the fix"}}` (C19) |
| Stage view `.apply` | optional `ApplyStageView{mode: ApplyMode, status: ApplyStatus, branch: string\|null, target_sha, head_sha: string\|null, rebased: boolean, provider: "github"\|null, pr_number: int\|null, pr_url: string\|null, auto_merge: "on"\|"failed"\|null, error_code: ApplyErrorCode\|null, conflict_files: string[], failures: AutofixFailure[], test_log_file: AutofixFile\|null, created_at}` — chỉ khi stage Áp đã có hàng; không `detail` thô (chỉ `error_code`) |
| `AutofixStageView.apply_mode` | `ApplyMode \| null` — `effectiveApplyMode(nguồn hiện tại)` nếu def có stage Áp, ngược lại null |
| `AutofixStageView.apply_base` | `string \| null` — `config.branch` của nguồn hiện tại (cùng lần đọc nguồn) khi `apply_mode ≠ null` và nguồn `git_remote`; ngược lại null (C9) |
| `error_code` bất biến | `status ∈ {failed, check_failed}` ⇒ `error_code ≠ null`; `check_failed` ⇒ `"check_failed"`; thiếu báo cáo/lỗi job khác ⇒ hàng `failed`+`provider_error`; `conflict` ⇒ null (C11) |
| `GET /admin/source-credentials` (xác nhận, C12) | `credentialTenant`: tenant_admin dùng tenant phiên (không cần `tenant_id`); platform_admin bắt buộc `?tenant_id=` (thiếu ⇒ 404 `NOT_FOUND`, C26); không đổi BE |
| Decision view | `options` = `autofixDecisionOptions(reason)` (mở rộng: `apply_*` ⇒ `[add_attempt, cancel]`); `use_current` ⇒ 409 `PROCESS_RUN_STATE` |

### §4 Luật thuần (chữ ký — QC viết test trước)
**contracts `hub-admin/sources.ts`:**
| Hàm | Trả |
|---|---|
| `gitProviderOf(url: string): GitProvider \| null` | host (chữ thường) `=== "github.com"` ⇒ `"github"`; URL hỏng/host khác ⇒ `null` |
| `effectiveApplyMode(config: {kind: SourceKind; url?: string; apply_mode?: ApplyMode}): ApplyMode` | PC2-R02 (`library` ⇒ `branch_only`, không dùng) |
| `applyModeIssue(config: SourceConfig): "SOURCE_APPLY_UNSUPPORTED" \| null` | `git_remote` + `apply_mode ∈ {pr, auto_merge}` + provider null ⇒ mã |

**contracts `hub-admin/process-steps.ts`:** `applyStageIssues(stages: readonly ApplyStageShape[]): ProcessDefIssue[]` — `ApplyStageShape = AutofixStageShape & {real_action: boolean; sources?: readonly unknown[]; token_budget?: number|null; must_know?: readonly unknown[]}`; path: `stages.<i>.real_action` (APPLY_REAL) · `stages.<i>.after` (APPLY_AFTER) · `stages.<i>.executor` (APPLY_NO_AUTOFIX; APPLY_MAX từ stage Áp thứ 2) · `stages.<i>` (APPLY_FIELDS). Bước theo `resolveSteps`.

**Hub `apps/hub-api/src/modules/processes/runs/apply.rules.ts`:**
| Hàm | Trả |
|---|---|
| `applyPlan(i: {result: {status: AutofixStatus; diff: JobAttachment \| null} \| null; sourceKind: SourceKind; mode: ApplyMode}): {kind:"no_changes"} \| {kind:"branch_only"} \| {kind:"job"; pushOnly: boolean} \| {kind:"invalid"}` | PC2-R03: `result` null/`check_failed`/`ok` thiếu diff ⇒ `invalid`; `no_changes` ⇒ `no_changes`; `local_path` ⇒ `branch_only`; `git_remote` ⇒ `job`, `pushOnly = mode==="branch_only"` |
| `applyOutcome(r: {status: ApplyStatus; code: ApplyErrorCode \| null} \| null, jobReason: string \| null, pushOnly: boolean): {kind:"provider"} \| {kind:"done"} \| {kind:"decision"; reason: "apply_conflict"\|"apply_failed"\|"sandbox_unavailable"; code: ApplyErrorCode \| null}` | PC2-R08 thứ tự: `jobReason==="container"` ⇒ sandbox; `r` null hoặc jobReason khác null ⇒ `apply_failed{code: r?.code ?? "provider_error"}`; `conflict` ⇒ `apply_conflict`; `check_failed` ⇒ `apply_failed{check_failed}`; `failed` ⇒ `apply_failed{r.code}`; `pushed` ⇒ `provider` nếu `!pushOnly`, ngược lại `done`. |
| `githubRepoOf(url: string): {owner: string; repo: string} \| null` | path `/<owner>/<repo>[.git]`, owner/repo `^[A-Za-z0-9_.-]{1,100}$`; khác ⇒ null |
| `mapProviderError(i: {status: number; retryAfter: string \| null; rateRemaining: string \| null; rateReset: string \| null; nowMs: number; body422AlreadyExists: boolean}): {kind:"exists"} \| {kind:"retry"; waitMs: number} \| {kind:"fail"; code: ApplyErrorCode}` | PC2-R09; `retry` cho rate limit chỉ khi `waitMs ≤ 60_000` |
| `prTitle(processName: string, stageName: string, runId: string): string` | PC2-R14, ≤ 256 (cắt tên quy trình trước) |
| `prBody(output: string \| null, runId: string, round: number /* autofix_results.round, C31 */): string` | lấy mục `## Thay đổi` + `## Test` (tách theo heading cấp 2), che bằng `redactSecrets` (bản TS của mẫu P-c1 §5.4, đặt ở `apply.rules.ts`), ≤ 8000 + chân |
| `prUrlOk(url: string, webHost: string): boolean` | PC2-R15 |
| `applyOutputMd(r: {mode; status; branch; head_sha; target_sha; rebased; pr_url; pr_number; auto_merge}): string` | Markdown có `## Kết quả áp` (đạt template seed); `branch_only` local ⇒ hướng dẫn `git apply` (không đường dẫn máy) |
| `credentialUsername(provider: GitProvider \| null): string` | `github` ⇒ `x-access-token`; null ⇒ `oauth2` |
| `credentialJobAllows(job: {type: string; status: string; items?: readonly {source_id: string}[]; source?: {source_id: string}}, sourceId: string): boolean` | PC2-R11 |
| `autofixDecisionOptions` (sẵn có) | mở rộng `apply_*` ⇒ `[add_attempt, cancel]` |

**Runtime `apps/agent-runtime/src/agent_runtime/apply/rules.py`:**
| Hàm | Trả |
|---|---|
| `push_refspec(branch: str) -> str` | `+HEAD:refs/heads/<branch>`; `branch` không khớp `^ai/[0-9a-f-]{36}/[a-z0-9-]{1,32}$` ⇒ `ValueError` |
| `mirror_key(url: str, source_id: str, has_credential: bool) -> str` | có khoá ⇒ `src-<source_id>`; không ⇒ `sha256(url)` (giữ P-b) |
| `auth_env(base: dict[str,str], origin: str, username: str, token: str) -> dict[str,str]` | nối thêm cặp `GIT_CONFIG_KEY_n=http.<origin>/.extraHeader`, `VALUE_n=Authorization: Basic <b64>` vào `GIT_CONFIG_COUNT` hiện có (không ghi đè C6) |
| `redact_auth(text: str) -> str` | che `Authorization: …`, `Basic …`, `x-access-token:…@` |
| `classify_push_error(exit_code: int, stderr: str) -> Literal["auth","push_rejected","network"]` | 403/401/"Authentication failed"/"could not read Username" ⇒ `auth`; "rejected"/"protected branch"/"pre-receive hook declined" ⇒ `push_rejected`; còn lại ⇒ `network` |
| `conflict_files(stderr: str, status_porcelain: str) -> list[str]` | ≤ 50, đường dẫn tương đối |
| `needs_retest(pin_sha: str, target_sha: str) -> bool` | `pin != target` |

### §5 Runtime
**5.1 Repo riêng (P-b resolve + Áp):** `sources/git_driver.py` nhận `auth: GitAuth | None` (`username`, `token`, giữ trong bộ nhớ); `_run_git` ghép `auth_env`; `mirror_path` dùng `mirror_key`. `sources/resolve.py`: item `config.credential_secret_id` ≠ null ⇒ `hub.source_credential(job_id, source_id)` (httpx, no-store, retry 2 lần) trước fetch; 404/409 ⇒ `SOURCE_UNRESOLVABLE` (message chung). `GIT_TERMINAL_PROMPT=0` giữ ⇒ không treo hỏi mật khẩu. Lỗi git đi qua `redact_auth` trước log/báo cáo.
**5.2 Gói mới `agent_runtime/apply/`:** `rules.py` (§4), `host.py` (`ApplyHost(cfg, oci, hub)`, `async run(job: SourceApplyJob) -> JobResult`), `report.py` (POST + retry như `autofix/report.py`). Slot (C22): `SANDBOX_SLOT` (`db/jobs_sql.py`) đếm cả `type='source.apply'` lúc claim `RUNTIME_SANDBOX_MAX`; không xin slot giữa job. Claim riêng `db/apply_sql.py`, nối ở `queue/runtime.py`.
Các bước `ApplyHost.run` (git cứng P-c1 §5.3 trên `GIT_DIR=work/<job>/repo/.git`, ngoài mọi mount):
1. `ensure_mirror_fresh` (khoá nếu `has_credential`) → `target = rev-parse refs/heads/<branch>`; lỗi ⇒ `failed{code: auth|network|no_credential}` (push bị từ chối mà `has_credential=false` ⇒ `no_credential`, C34).
2. `git clone --no-checkout --no-hardlinks <mirror> work/<job>/repo` → `checkout -B <ai branch> <target>`.
3. Tải `patch` → `git apply --3way --index --binary` → lỗi ⇒ `git status --porcelain` → `conflict{files}`.
4. Commit tác giả `ai-autofix <noreply@local>`, thông điệp cố định `ai-autofix: <branch>` (không đưa chữ tự do vào git).
5. `needs_retest` ⇒ `git archive HEAD` → giải nén + lọc PB-R07 (hàm lọc `sources/snapshot.py`) vào `work/<job>/workspace/<key>/` → `workspace.prepare` (git riêng, base = target) → `check.run_checks` (diff `target..HEAD`) với prep/test container như `AutofixHost` (P-c1 §5.2) → trượt ⇒ `check_failed`; không sandbox ⇒ job lỗi `container`.
6. `ls-remote <url> refs/heads/<branch>` = HEAD ⇒ bỏ push; ngược lại `push <url> push_refspec(branch)` (timeout 120 s) → lỗi ⇒ `failed{classify_push_error}`.
7. Báo cáo → `finally`: xoá container + `work/<job>/`; xoá khoá khỏi bộ nhớ.
**5.3 Kiểm thử Runtime:** bare repo trong thư mục tạm (`git init --bare`), `GIT_CONFIG_*` insteadOf `https://github.com/acme/` → `file://…` (C6, `RUNTIME_ENV=test`); push thật vào bare repo; kiểm `refs/heads/ai/...` và nhánh mặc định không đổi. Khoá giả: bare repo không đòi auth ⇒ test `auth_env` bằng hàm thuần + ca "khoá được lấy và không xuất hiện trong `work/`, log, báo cáo".

### §6 Hub
**6.1 Nguồn** (`sources.service #checkConfig`): `git_remote` + `credential_secret_id` ⇒ đọc `hub.secrets` scope system, `id=$1 AND kind='source_credential' AND tenant_id=$tenant AND deleted_at IS NULL` (cột thật theo H4b-1) — không có ⇒ 422 `SOURCE_CREDENTIAL_INVALID`; `applyModeIssue` ⇒ 422 `SOURCE_APPLY_UNSUPPORTED`. `used_by` của secret (H4b-1, `config->>'credential_secret_id'`) đã có ⇒ xoá khoá đang dùng ⇒ `SECRET_IN_USE`. `ResolveItem` đã chép `config` ⇒ không sửa launcher resolve.
**6.2 Launcher stage Áp** (`processes/runs/apply-launch.ts` mới, gọi từ nhánh executor ở `launcher.ts`/`executor-ref.ts`): `realActionStepCheck` + audit `authorize_real_action` mở rộng điều kiện `executor.kind ∈ {agent, apply}` (`launcher-step.ts:45`). `launcher-step.ts` `realActionPreconfirm` đọc `executor.agent_id` ⇒ rẽ nhánh `apply` (không agent); `auditRealAction` nhận `agentId: null` (C32: `agent_id:null, workflow_ids:[], executor:"apply"`). Tìm stage tự-sửa bước k−1 (def snapshot) → `stage_run` → `autofix_results` mới nhất → nguồn **hiện tại** (scope system + `tenant_id`) → `applyPlan`; nguồn xoá / `config.url ≠ pin.url` / đổi kind ⇒ không job, hàng `failed`+`provider_error` + decision `apply_failed` (C20). `no_changes`/`branch_only`/`invalid`: một tx — insert `autofix_applies` (+ `error_code` nếu invalid) + output `apply.md` (`output-attachment.ts`) + stage `done`/decision. `job`: insert job `source.apply` (§3.3) + stage `running` như job resolve.
**6.3 Internal** `apps/hub-api/src/modules/internal/{source-credential,apply}.{routes,service,repo}.ts`: xác thực token job (mẫu `autofix.routes.ts`). `source-credential`: `credentialJobAllows` → nguồn (tenant job) → `HubSecretReader.useSecret({id, kind:"source_credential", tenantId: job.tenant_id}, v => v)` — **ngoại lệ có chủ đích:** giá trị rời Hub tới Runtime (Q2); phản hồi `no-store`. `apply-result`: log test (nếu có) qua `commitOutputBlob` ngoài tx → tx system + `tenant_id`: attachment (origin `output`, tên `<stage_key>-apply-test.log.txt`) + insert `autofix_applies` (`mode` = `payload.apply_mode` — chế độ hiệu lực lúc launch, không đọc lại nguồn; C8). Unique ⇒ 409. Sau commit: `advanceApply(job_id)` (C14).
**6.4 Stage-driver Áp** (`processes/runs/apply-driver.ts` mới; `stage-driver.ts` chỉ rẽ nhánh — giữ ≤ 400 dòng): sau job: đọc hàng theo `job_id` → `applyOutcome` → decision (`toDecision`, feedback = nhãn `error_code`/`conflict_files`) / `push_only` ⇒ UPDATE `status` giữ `pushed` + output + `done` / provider ⇒ `github-client.ts` (§6.5) → UPDATE (`pr_opened`/`failed`) → output + `done` hoặc decision `apply_failed`. Chạy từ `apply-result` và `sweepOnce` (job `source.apply` đã kết thúc mà stage còn `running`: không hàng ⇒ `failed`+`provider_error`, C14/C27). Tx khoá `process_runs FOR UPDATE` + kiểm lại trạng thái (`core.lockRun`, C28); run/stage không còn `running` (huỷ) ⇒ chỉ lưu hàng, không gọi provider (C21). Mode ∈ {pr, auto_merge} mà `githubRepoOf` null ⇒ `unsupported_provider` (C29). Lỗi `container` ⇒ hàng `failed`+`provider_error`, decision `sandbox_unavailable` (C33). Gọi provider **ngoài** tx; UPDATE + output + chuyển trạng thái trong một tx. `add_attempt` ⇒ job `source.apply` mới (cùng branch, idempotent).
**6.5 `processes/runs/github-client.ts`** (fetch Bun, không thư viện): `findOpenPr(repo, branch)` `GET /repos/{o}/{r}/pulls?head={o}:{branch}&state=open&per_page=1`; `createPr` `POST /repos/{o}/{r}/pulls {title, head: branch, base, body, draft:false, maintainer_can_modify:false}`; `enableAutoMerge(node_id)` `POST /graphql` mutation `enablePullRequestAutoMerge(input:{pullRequestId, mergeMethod: SQUASH})`. Header: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: ai-system-hub`. Token chỉ trong callback `useSecret` (bọc cả chuỗi gọi). `redirect:"manual"`, `AbortSignal.timeout(15000)`, đọc thân ≤ 1 MiB. Lỗi ⇒ `mapProviderError`. Nguồn không khoá + `pr` ⇒ `apply_failed{no_credential}` (API cần token kể cả repo công khai).
**6.6 View** (`view-autofix.ts` mở rộng → `view-apply.ts` mới): stage executor `apply` ⇒ query §2(a) → `ApplyStageView`; `AutofixStageView.apply_mode` + `apply_base` (cùng đọc nguồn); `ApplyStageView.test_log_file` từ `test_log_attachment_id`. Quyền đọc log test của hàng Áp: mở rộng nhánh `findReadableAttachment` P-c1 (PC-R14) thêm `autofix_applies.test_log_attachment_id`.
**6.7 Seed** `apps/hub-api/seed/processes.yaml`: template `fixbug-pr` = `fixbug-apply` (stage `fix` nguyên văn P-c plan §6.1, `step: 0`) + stage `apply`: `name: Áp bản sửa (PR)`, `step: 1`, `executor: {kind: apply}`, `instruction: ""`, `output: {filename: apply.md, template: "## Kết quả áp\n", required_sections: [Kết quả áp], fields: []}`, `after: auto`, `real_action: true`, `answerer: starter`, `timeout_s: 600`, `token_budget: null`; `name: Sửa lỗi tự áp (PR)`, `description: Agent tự sửa mã, người duyệt diff, hệ thống đẩy nhánh ai/… và mở PR theo chế độ áp của nguồn.`; tắt sẵn.
**6.8 Env/doc:** seam `deps.github?:{apiUrl,webHost}` ưu tiên hơn env (C13). `.env.example` += `HUB_GITHUB_API_URL`, `HUB_GITHUB_WEB_HOST`; `PRODUCTION-NOTES`: PAT fine-grained tối thiểu (Contents RW, Pull requests RW, Metadata R), auto-merge cần bật ở repo + branch protection; tường lửa Hub egress chỉ `api.github.com`.

### §7 Hiệu năng
Kế thừa CONVENTIONS §6; không ngân sách riêng. View +1 query/stage Áp (index §2a). Provider: ≤ 3 lời gọi/lần Áp (+ thử lại theo PC2-R09).

## Frontend (frontend-lead)
### §8 Frontend
`plan-frontend.md` + mockup `Pc2-*` (spec §5). Contract FE dùng: `effectiveApplyMode`, `gitProviderOf`, `applyStageIssues`, `APPLY_ERROR_CODES`, `ApplyStageView`, `AutofixStageView.apply_mode`; route khoá nguồn H4b-1 `/admin/source-credentials*` (BE sẵn có, FE chưa có).

## Edge case xử lý
| Ca | Xử lý |
|---|---|
| Hub chết sau `pushed`, trước PR | stage còn `running`, job xong ⇒ `sweepOnce` gọi `advanceApply` (C27) ⇒ nếu `apply_failed` ⇒ Thêm lượt ⇒ job Áp mới: push bỏ qua (ref = head) hoặc force trong `ai/`; PR tìm thấy ⇒ dùng lại |
| PR cũ đã đóng/merge cùng nhánh | `findOpenPr` rỗng ⇒ tạo PR mới (GitHub cho phép) |
| Quay lại bước tự-sửa sau khi đã Áp (back_to của stage sau) | stage tự-sửa làm lại → Áp lại cùng branch: force trong `ai/<run>/` ⇒ PR mở cập nhật tự động |
| Khoá bị xoá/thay giữa resolve và Áp | `useSecret` lỗi ⇒ 409 `NOT_CONFIGURED` ⇒ Runtime `failed{no_credential}` / Hub `apply_failed{no_credential}` |
| Nhánh mặc định bị xoá/đổi tên | fetch không có ref ⇒ `failed{network}` (detail "branch not found") — người sửa nguồn rồi Thêm lượt |
| Bản vá không áp được dù `target=pin` | không thể (cùng cây) ⇒ nếu xảy ra ⇒ `conflict` như thường |
| `local_path` + def có stage Áp | `branch_only` không job (PC2-R03) |
| Repo công khai + `pr` không khoá | Áp ⇒ `apply_failed{no_credential}`; FE cảnh báo ở màn Nguồn khi `pr/auto_merge` mà không khoá |
| Rate limit dài (> 60 s) | `apply_failed{rate_limited}`; người Thêm lượt sau |

## Rủi ro regression
| Chỗ | Kiểm |
|---|---|
| `git_driver` thêm auth + `mirror_key` | nguồn không khoá giữ `sha256(url)` ⇒ mirror P-b cũ còn dùng; test P-b/P-c1 chạy lại |
| `GitRemoteConfigSchema` thêm trường | strict + default ⇒ nguồn cũ parse được; FE gửi body cũ vẫn hợp lệ |
| Executor union + `EXECUTOR_KINDS` | team/agent không đổi; view/editor FE map nhãn đủ (i18n check) |
| `launcher-step` real_action | điều kiện mở rộng chỉ thêm `apply`; ca D4 P-a giữ |
| `DECISION_REASONS`/`PROCESS_DEF_RULES`/`SOURCE_ERRORS` thêm cuối | CHECK DB khớp, FE map nhãn |
| pydantic sinh lại `hub.py` | `SourceApplyJob` mới; không `default` |

## ADR mới (nếu có)
Không. Không thư viện mới (Bun `fetch`, `git` CLI có sẵn). GitHub API là tích hợp ngoài miễn phí dùng khoá người dùng cấp — ghi ở spec §7/PRODUCTION-NOTES. ADR-0011 không đổi (git ngoài container, token không vào container — đúng #2/#4).
