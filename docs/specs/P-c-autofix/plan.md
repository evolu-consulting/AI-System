# Plan · P-c-autofix (P-c1 diff-only)

Backend-lead PLAN 2026-10-13. Phạm vi = spec §1 hàng P-c1 (chờ Q1). Luật: spec §2 PC-R01…R15. Hạ tầng: ADR-0011 (Proposed). Không chép BA — trỏ mã.

## Backend (backend-lead)

### §1 Luồng tổng (một vòng stage tự-sửa)
| # | Ai | Bước | Ghi chú |
|---|---|---|---|
| 1 | Hub | `start` run: resolve nguồn như P-b; nguồn của stage tự-sửa ⇒ `allowlist_union=[]`, `ResolveItem.caps="autofix"` | `allowlistUnion` (sources.rules.ts) xét `stage.autofix.source_key` |
| 2 | Runtime | `source.resolve` dựng snapshot lọc PB-R07, trần `RUNTIME_AUTOFIX_MAX_MB/_FILES` khi `caps=autofix` | `sources/snapshot.py` nhận trần theo item |
| 3 | Hub | launcher: stage có `autofix` ⇒ job `agent.cli` + `payload.autofix` (§3.2) + `allowed_tools` theo PC-R07; `token_budget` null ⇒ 200k; `base_patch` = diff `ok` mới nhất của `stage_run` (nếu có) | `autofix.rules.ts` `autofixJobPart`, `basePatchOf` |
| 4 | Runtime | claim → `AutofixHost.prepare`: copy snapshot → `workspace/<key>/` (ghi được) → (có `install_cmd`) container prep có mạng → `git init --separate-git-dir` + commit `base` → nhánh `ai/<run>/<stage>` → (có `base_patch`) tải + `git apply --binary --index` + commit `rounds 1..k-1` → dựng container agent `--network none` | §5.1–5.3 |
| 5 | Runtime | chạy agent (CLI cũ) + MCP trong tiến trình `ws` (4 tool, `exec` vào container); ghi `commands[]` | §5.5 |
| 6 | Runtime | `finally` agent: xoá container agent → commit `round k` (git cứng, ngoài container) → diff `base..HEAD` → kiểm PC-R08 (đường dẫn → kích thước → bí mật → test trong container MỚI) | §5.4 |
| 7 | Runtime | `POST /internal/jobs/:id/autofix-result` **trước** khi kết thúc job; rồi kết thúc job như cũ; dọn container + `work/<job_id>/` | lỗi gửi ⇒ retry 3 lần (1/2/4 s); vẫn lỗi ⇒ job `failed` reason `upstream` (lỗi kênh Hub, không phải `container`); 409 `AUTOFIX_RESULT_EXISTS` = thành công |
| 8 | Hub | endpoint lưu blob diff/log (ngoài tx, như OUTBLOB) → tx: `attachments` + `autofix_results` | §6.2 |
| 9 | Hub | `stage-driver` sau job: stage có `autofix` ⇒ `autofixOutcome(row)`; `check_failed`/thiếu ⇒ needs_decision `autofix_check_failed`; job lỗi `container` ⇒ `sandbox_unavailable`; còn lại ⇒ kiểm template + gate review như cũ | §6.3 |
| 10 | Người | gate: xem diff (stage view `autofix`), Đạt ⇒ đi tiếp/kết thúc; Chưa đạt ⇒ làm lại (về bước 3 với `base_patch`) | P-a/P-b2 sẵn có |

### §2 Dữ liệu — migration `0031_pc_autofix.sql` (viết tay, idempotent, chỉ THÊM/nới)
```sql
CREATE TABLE IF NOT EXISTS hub.autofix_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  process_run_id uuid NOT NULL,
  stage_run_id uuid NOT NULL,
  job_id uuid NOT NULL,
  round smallint NOT NULL,
  source_key text NOT NULL,
  pin jsonb NOT NULL,
  branch text NOT NULL,
  base_sha text NOT NULL,
  head_sha text NOT NULL,
  status text NOT NULL,
  failures jsonb NOT NULL DEFAULT '[]'::jsonb,
  diff_stats jsonb,
  diff_attachment_id uuid,
  test_log_attachment_id uuid,
  test_exit_code integer,
  test_duration_ms integer,
  commands jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT autofix_results_job_uq UNIQUE (job_id),
  CONSTRAINT autofix_results_status_ck CHECK (status IN ('ok','no_changes','check_failed')),
  CONSTRAINT autofix_results_diff_ck CHECK (status = 'ok' OR diff_attachment_id IS NULL),
  CONSTRAINT autofix_results_round_ck CHECK (round BETWEEN 1 AND 100),
  CONSTRAINT autofix_results_sha_ck CHECK (base_sha ~ '^[0-9a-f]{40}$' AND head_sha ~ '^[0-9a-f]{40}$'),
  CONSTRAINT autofix_results_branch_ck CHECK (branch ~ '^ai/[0-9a-f-]{36}/[a-z0-9][a-z0-9_-]{0,63}$'),
  CONSTRAINT autofix_results_json_ck CHECK (jsonb_typeof(failures)='array' AND jsonb_typeof(commands)='array'
    AND jsonb_typeof(pin)='object' AND (diff_stats IS NULL OR jsonb_typeof(diff_stats)='object')),
  CONSTRAINT autofix_results_run_fk FOREIGN KEY (process_run_id, tenant_id)
    REFERENCES hub.process_runs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT autofix_results_diff_fk FOREIGN KEY (diff_attachment_id) REFERENCES hub.attachments (id) ON DELETE SET NULL,
  CONSTRAINT autofix_results_log_fk FOREIGN KEY (test_log_attachment_id) REFERENCES hub.attachments (id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS autofix_results_stage_idx ON hub.autofix_results (stage_run_id, created_at DESC);
CREATE INDEX IF NOT EXISTS autofix_results_run_idx ON hub.autofix_results (process_run_id);
```
- `autofix_results_diff_ck` chỉ một chiều (không `ok` ⇒ không diff). Chiều `ok ⇒ có diff` kiểm ở service + test, KHÔNG CHECK vì FK `ON DELETE SET NULL` (xoá attachment sẽ vi phạm). Sweeper đã chặn xoá output quy trình (`e0c82bd3`) ⇒ khi run còn sống không SET NULL.
- `branch_ck` dùng regex stage key hiện hành (`STAGE_KEY_RE`, TD #150 đã nới 1 ký tự) — BUILD đọc `chat/processes.ts` và khớp đúng.
- RLS: `ENABLE ROW LEVEL SECURITY`; policy `autofix_results_hub_rw FOR ALL TO hub_rw USING/WITH CHECK v_t` (mẫu 0021 dòng 149–162). `GRANT SELECT, INSERT ON hub.autofix_results TO hub_rw` (append-only ⇒ UPDATE/DELETE 42501). Không GRANT `agent_runtime`, `hub_ro`.
- Nới CHECK (mẫu 0024 dòng 47–55): `review_tasks_reason_ck` += `'autofix_check_failed','sandbox_unavailable'`; `jobs_error_reason_check` += `'container'` (giữ đủ giá trị 0007).
- Drizzle: `packages/db/src/schema/hub-autofix.ts` + export `hub.ts`.
- Query mới + index: (a) `basePatchOf`: `WHERE stage_run_id=$1 AND status='ok' ORDER BY created_at DESC LIMIT 1` ⇒ `autofix_results_stage_idx`; (b) view: cùng index, `LIMIT 1`; (c) endpoint: unique `job_id`. Mọi query trong `withHubScope` user/system theo mẫu P-b (RLS + `tenant_id` tường minh).

### §3 Contract (bảng trường)
#### 3.1 `hub-admin/processes.ts` + `process-steps.ts`
| Trường | Kiểu | Ràng buộc |
|---|---|---|
| `ProcessStageDef.autofix` | `StageAutofix \| null` | `.nullable().default(null)`; type đọc `?? null` (snapshot cũ) |
| `StageAutofix.source_key` | `SourceKey` | ∈ `def.sources` (superRefine, path `stages.<i>.autofix.source_key`, như `processDefSourcePaths`) |
| `.install_cmd` | `string.trim().min(1).max(1000) \| null` | không ký tự NUL; default null |
| `.test_cmd` | `string.trim().min(1).max(1000)` | bắt buộc |
| `.write_allowlist` | `GlobSchema[]` | `.max(STAGE_ALLOWLIST_MAX=20).default([])` |
| `PROCESS_DEF_RULES` | += `AUTOFIX_EXECUTOR`, `AUTOFIX_REVIEW`, `AUTOFIX_MAX` | thêm **cuối** mảng; `autofixStageIssues(stages)` gộp vào `processDefStageIssues` |
| Kiểm loại nguồn (server, cần DB) | — | `defs.service` khi lưu: `kind ∉ {git_remote, local_path}` ⇒ 422 `PROCESS_REF_INVALID{path:"stages.<i>.autofix.source_key", ref:"source"}` |
#### 3.2 `hub/job.ts`
| Trường | Kiểu | Ràng buộc |
|---|---|---|
| `AgentCliJob.autofix` | `JobAutofix` optional | vắng = job thường (pydantic sinh khớp, không `default`) |
| `JobAutofix.source` | `JobSource` | `allowlist` phải `[]` (refine) |
| `.install_cmd` / `.test_cmd` / `.write_allowlist` | như 3.1 | |
| `.branch` | `string` regex `^ai/[0-9a-f-]{36}/<STAGE_KEY>$` | = `autofixBranch(run, stage)` |
| `.round` | `int 1..100` | = `stage_runs.attempt` |
| `.base_patch` | `JobAttachment \| null` | tải qua `GET /internal/jobs/:id/attachments/:aid` sẵn có (attachment phải thuộc run — PB-R18) |
| `ResolveItem.caps` | `"source" \| "autofix"` optional | vắng = `source` |
| `JOB_FAIL_REASONS` | += `"container"` | `hub/errors.ts`; Runtime: CLI không có / dựng container lỗi / tự kiểm cgroup sai |
#### 3.3 `hub-internal/autofix.ts` (mới) — `POST /internal/jobs/:job_id/autofix-result`
| Trường | Kiểu | Ràng buộc |
|---|---|---|
| `status` | enum `ok\|no_changes\|check_failed` | |
| `branch` | như 3.2 | phải = `payload.autofix.branch` của job, sai ⇒ 400 |
| `base_sha`, `head_sha` | `^[0-9a-f]{40}$` | git cục bộ (không phải SHA remote) |
| `diff` | `string ≤ 2_097_152 byte \| null` | `≠ null ⇔ status=ok`; > trần ⇒ 413 |
| `diff_stats` | `{files 0..300, insertions ≥0, deletions ≥0, bytes ≥0} \| null` | null ⇔ status ≠ ok |
| `test` | `{exit_code int\|null, duration_ms ≥0, log_tail string ≤ 65_536} \| null` | null = chưa chạy test (trượt trước bước test) |
| `failures` | `AutofixFailure[] ≤ 50` | `{check: paths\|size\|secrets\|tests\|install\|apply_patch, path?: ≤1024, line?: int, rule?: ≤64, detail: ≤500}` — **không** giá trị bí mật |
| `commands` | `{tool: exec\|read\|write\|edit, arg ≤ 500 (cắt), exit_code?: int, ms ≥0}[] ≤ 300` | |
| Phản hồi | 201 `{id}` · 400 `VALIDATION_ERROR` · 401 `UNAUTHORIZED` (một thân, như outputs) · 409 `AUTOFIX_NOT_EXPECTED` · 409 `AUTOFIX_RESULT_EXISTS` · 413 `PAYLOAD_TOO_LARGE`; mọi phản hồi `no-store`; body limit 3 MiB |
#### 3.4 `chat/processes-entities.ts` + `chat/processes.ts`
| Trường | Kiểu |
|---|---|
| `DECISION_REASONS` | += `autofix_check_failed`, `sandbox_unavailable` (cuối) |
| Stage view `.autofix` | optional `AutofixStageView{source_key, branch, round, status, diff_stats \| null, diff_file: RunFile \| null, test_log_file: RunFile \| null, test: {exit_code, duration_ms} \| null, failures: AutofixFailure[], created_at}` — chỉ khi stage có cấu hình `autofix` VÀ đã có kết quả |
| Decision view | `options` theo `decisionOptionsFor` (PC-R10); FE không tự suy |

### §4 Luật thuần (chữ ký — QC viết test trước)
**contracts `hub-admin/process-steps.ts`:** `autofixStageIssues(stages: readonly AutofixStageShape[]): ProcessDefIssue[]` — `AutofixStageShape = StepStageShape & {executor:{kind:string}; autofix?: {source_key:string} | null}`; path `stages.<i>.executor` / `stages.<i>.after` / `stages.<i>.autofix` (stage tự-sửa thứ 2 trở đi).

**Hub `apps/hub-api/src/modules/processes/runs/autofix.rules.ts`:**
| Hàm | Trả |
|---|---|
| `autofixBranch(processRunId: string, stageKey: string): string` | `ai/<id>/<key>` |
| `autofixAllowedTools(hasReadSources: boolean): AllowedTool[]` | `[Read,Grep,Glob]` \| `[]` |
| `autofixAllowlistUnion(stages: readonly StageLike[], sourceKey: string): string[] \| null` | `[]` nếu có stage tự-sửa dùng nguồn; `null` = không áp (dùng `allowlistUnion` cũ) |
| `autofixJobPart(i: {stage: SnapStage; pin: SourcePin; kind: SourceKind; runId: string; round: number; basePatch: JobAttachment \| null}): JobAutofix` | |
| `autofixOutcome(r: {status: AutofixStatus} \| null, jobReason: string \| null): {kind:"continue"} \| {kind:"decision"; reason: "autofix_check_failed" \| "sandbox_unavailable"}` | `jobReason==="container"` ⇒ sandbox; `r` null/`check_failed` ⇒ check; còn lại continue |
| `decisionOptionsFor(reason: DecisionReason): DecisionOption[]` | `autofix_*` ⇒ `[add_attempt, cancel]`; khác ⇒ như cũ |
| `autofixRetryNote(failures: readonly AutofixFailure[]): string` | ≤ 2000 ký tự, mỗi lỗi một dòng `check path:line rule`, không `detail` thô của `secrets` |
| `reportMatchesJob(report: {branch: string}, job: {autofix?: {branch: string}}): boolean` | |

**Runtime `apps/agent-runtime/src/agent_runtime/autofix/rules.py`:**
| Hàm | Trả |
|---|---|
| `container_args(spec: SandboxSpec, *, phase: Literal["prep","agent","test"]) -> list[str]` | argv `run` (§5.2); `prep` không có `--network none` |
| `check_paths(changed: list[str], allowlist: list[str]) -> list[Failure]` | PC-R08(1); cấm thắng allowlist trừ CI ghi rõ |
| `check_size(stats: DiffStats, ws_bytes: int, lim: Limits) -> list[Failure]` | |
| `scan_secrets(diff: str) -> list[Failure]` | chỉ dòng `+`, mẫu §5.4; trả path + line + rule |
| `redact(text: str) -> str` | thay khớp mẫu bằng `[REDACTED]` |
| `git_env(git_dir: Path, work_tree: Path) -> dict[str,str]` + `GIT_SAFE_ARGS: list[str]` | §5.3 |
| `ws_rel_ok(rel: str) -> bool` | tương đối, không `..`, không tuyệt đối, không NUL |
| `truncate_cmd(cmd: str) -> str` | ≤ 500 |

### §5 Runtime
**5.1 Gói mới** `agent_runtime/autofix/`: `rules.py` (thuần), `oci.py` (`OciCli`: `run/exec/rm/ps` qua `subprocess` mảng đối số, timeout, `RUNTIME_SANDBOX`), `fake_oci.py` (chỉ `RUNTIME_ENV=test`), `workspace.py` (copy snapshot, git), `check.py` (PC-R08), `ws_tools.py` (MCP trong tiến trình, `create_sdk_mcp_server`), `report.py` (POST + retry), `host.py` (`AutofixHost` bọc vòng đời quanh `CliJobHost`), `sweeper.py`. `dispatch.py`: `agent.cli` có `autofix` ⇒ `AutofixHost`. Slot riêng `RUNTIME_SANDBOX_MAX` (mặc định 1) trong claimer (job tự-sửa không claim khi đầy).
**5.2 argv** (`agent`/`test`): `run -d --name aif-<job>[-test] --label ai.autofix=1 --label ai.job=<job> --network none --cpus <c> --memory <m>m --memory-swap <m>m --pids-limit <p> --read-only --tmpfs /tmp:rw,exec,size=<t>m --cap-drop ALL --security-opt no-new-privileges --user 1000:1000 [podman: --userns keep-id] -e HOME=/tmp -e CI=1 -e LANG=C.UTF-8 -v <host_ws>:/workspace:rw -w /workspace <image> sleep infinity`; `exec` có `--user 1000:1000 -w /workspace <ctr> sh -c <cmd>` (cmd qua đối số, không nội suy). `prep`: như trên nhưng bỏ `--network none`, lệnh = `install_cmd`. `<host_ws>` = `RUNTIME_SANDBOX_HOST_WORKDIR` (dev) hoặc đường thật. Khởi động Runtime: `RUNTIME_SANDBOX≠off` ⇒ tự kiểm (CLI chạy được, ảnh có, container thử đọc `memory.max` = trần đặt); sai ⇒ log `sandbox.unavailable` và coi như `off`.
**5.3 git cứng:** `GIT_DIR=work/<job>/git GIT_WORK_TREE=…/workspace/<key> GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 GIT_PAGER=cat`; args `-c core.hooksPath=/dev/null -c core.fsmonitor=false -c core.symlinks=true -c diff.external= -c core.attributesFile=/dev/null`; `diff --binary --no-ext-diff --no-textconv base HEAD`; bỏ qua `.git` trong worktree (file `.git` container tạo ra coi như file thường, cấm theo PB-R07). Commit tác giả `ai-autofix <noreply@local>`.
**5.4 Mẫu bí mật** (bắt đầu tối thiểu, sửa theo test qc): `AKIA[0-9A-Z]{16}`, `-----BEGIN [A-Z ]*PRIVATE KEY-----`, `gh[pousr]_[A-Za-z0-9]{36,}`, `github_pat_[A-Za-z0-9_]{60,}`, `glpat-[A-Za-z0-9_-]{20,}`, `xox[baprs]-[A-Za-z0-9-]{10,}`, `sk-[A-Za-z0-9]{32,}`, `sk-ant-[A-Za-z0-9_-]{20,}`, `eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`, `(?i)(password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"\s]{12,}['"]`; + file thêm có basename PB-R07. Không entropy (dương tính giả).
**5.5 Tool `ws`** (MCP trong tiến trình, tên `mcp__ws__*`): `ws_exec{cmd ≤4000, timeout_s 1..600=120}` → `{exit_code, stdout ≤32 KiB đuôi, stderr ≤32 KiB đuôi, truncated, ms}`; `ws_read{path, offset?, limit≤2000 dòng}` → text ≤256 KiB; `ws_write{path, content ≤1 MiB}` (nội dung qua stdin của `exec … sh -c 'cat > "$1"' _ <path>`); `ws_edit{path, old_string, new_string, replace_all=false}` (đọc → thay trong Python → ghi lại; không khớp/khớp nhiều ⇒ lỗi như Edit). Mọi `path` qua `ws_rel_ok`. Sau mỗi `ws_exec`: `du` workspace > trần ⇒ trả lỗi cho agent + đánh dấu `size`.
**5.6 fake-cli** directive (QC dùng): `#fake:ws_write=<path>|<base64>`, `#fake:ws_edit=<path>|<old>|<new>`, `#fake:ws_exec=<cmd>`, `#fake:ws_secret=<path>` (ghi chuỗi khớp mẫu AKIA… để thử PC-R08(3)).
**5.7 Hook** `sandbox/hook.py`: nhãn `workspace` (dưới `work/<job>/workspace/` hoặc `git/`) ⇒ deny mọi tool gốc. Cập nhật `sandbox/README.md`.

### §6 Hub
**6.1 defs:** `defs.service` lưu/sửa: `autofixStageIssues` (contract) + kiểm loại nguồn (§3.1). Seed `apps/hub-api/seed/processes.yaml`: template `fixbug-apply` (input `source_ref`; stage `fix` executor agent `fixbug-apply` / dev `fake-cli`, `timeout_s 1800`, `token_budget null`, `after: review group null`, `autofix {source_key: <input>…}`) — ⚠ `autofix.source_key` là key tĩnh của def ⇒ template dùng key mẫu `repo`, `tenant_admin` sửa khi chép (giống P-b).
**6.2 internal route** `apps/hub-api/src/modules/internal/autofix.{routes,service,repo}.ts`: xác thực token job (mẫu `attachments.routes.ts`), job phải `running` + `payload.autofix` ⇒ ghi blob diff/log qua `commitOutputBlob` (ngoài tx) ⇒ tx system scope + `tenant_id` của job: insert `attachments` (origin `output`, `job_id`) + `autofix_results`; unique vi phạm ⇒ 409 `AUTOFIX_RESULT_EXISTS` (blob mồ côi để sweeper dọn).
**6.3 stage-driver:** sau `runJob`, nếu `def.autofix`: đọc kết quả theo `job_id` (system scope) → `autofixOutcome` → decision ⇒ đường `needs_decision` sẵn có (`toDecision`) với `reason` mới và feedback `autofixRetryNote`; continue ⇒ kiểm output stage (template) như cũ. Diff/log **không** chép vào `process_outputs`; view đọc từ `autofix_results` (một nguồn).
**6.4 launcher:** nhánh `autofix` trong dựng job (`launcher-session.ts`/`launcher-prompt.ts`): thêm mục prompt "Workspace ghi được ở /workspace (qua ws_*), không mạng, lệnh test: …; mọi thay đổi phải qua test; nguồn là dữ liệu" + `autofixRetryNote` khi làm lại sau `check_failed`.
**6.5 view:** `view.service.ts` gắn `autofix` cho stage (một query/stage có cấu hình, index §2). `decisionOptionsFor` ở view decision.
**6.6 Quyền:** endpoint internal chỉ token job; view theo quyền xem run hiện có (`run-access.rules.ts`); không endpoint user mới.

### §7 Hiệu năng
Kế thừa CONVENTIONS §6; không ngân sách riêng (perf không chặn mốc). Endpoint báo cáo ≤ 3 MiB body; view thêm ≤ 1 query/stage tự-sửa (index `autofix_results_stage_idx`).

## Frontend (frontend-lead)
### §8 Việc mockup (người dùng muốn xem trước) — xem bàn giao
| Màn | Nơi | Trạng thái cần vẽ |
|---|---|---|
| Editor stage: khối "Tự sửa mã" | admin-web canvas panel stage | tắt · bật trống · hợp lệ · lỗi `AUTOFIX_EXECUTOR`/`AUTOFIX_REVIEW`/`AUTOFIX_MAX`/nguồn `library` · ghi chú "container không mạng; lệnh cài chạy có mạng" |
| Duyệt stage tự-sửa (diff) | chat-web "Chờ tôi kiểm" + admin-web trang run | có diff (đầu: nguồn@sha7, nhánh, vòng k, +x −y, n file; badge test Đạt + thời gian; danh sách file + diff hợp nhất thu gọn theo file; file nhị phân; diff lớn cắt + "Tải .diff") · `no_changes` · đang tải · lỗi tải |
| Cần người quyết | chat-web + admin-web | `autofix_check_failed` (liệt kê lỗi theo nhóm: đường dẫn, kích thước, bí mật path:line, test đỏ + đuôi log, cài lỗi, áp bản vá lỗi) · `sandbox_unavailable`; chỉ Thêm lượt / Huỷ |
| Run view | admin-web + thẻ thread chat | stage tự-sửa: nhãn "Tự sửa mã", vòng k, kết quả kiểm gần nhất |
Thư viện hiển thị diff (nếu cần) ⇒ ADR riêng của frontend-lead.

## Edge case xử lý
| Ca | Xử lý |
|---|---|
| Runtime chết giữa job | job `orphaned` như cũ; container còn ⇒ sweeper xoá; không có kết quả ⇒ `autofix_check_failed` (failures `[]`, retry note "không có báo cáo") |
| Báo cáo 2 lần (retry mạng) | lần 2 ⇒ 409 `AUTOFIX_RESULT_EXISTS`; Runtime coi 409 là thành công |
| `base_patch` không áp được (snapshot đổi do PB-R16 dựng lại) | `check_failed{check:"apply_patch"}`; người chọn Thêm lượt (làm lại từ đầu, `base_patch` vẫn là bản cũ ⇒ lại trượt) — **chốt:** Thêm lượt sau `apply_patch` ⇒ Hub gửi `base_patch=null` (`basePatchOf` bỏ qua khi kết quả gần nhất là `apply_patch`) |
| Agent ghi `.git` / symlink ra ngoài | `.git` = tên cấm (PC-R08); symlink lưu như link trong diff, không theo; đường dẫn đích ngoài workspace không ảnh hưởng host (git không theo) |
| Hết token/thời gian giữa chừng | `stage_tokens`/`job_timeout` như P-a; Runtime vẫn chạy bước 6–7 nếu kịp (≤ 60 s ân hạn) — không kịp ⇒ không báo cáo |
| Diff chỉ đổi file bị `.gitignore` | không xuất hiện trong diff ⇒ `no_changes` |
| Tenant tắt quy trình giữa run | như P-a (run đang chạy tiếp) |

## Rủi ro regression
| Chỗ | Kiểm |
|---|---|
| `allowlistUnion` (P-b) | thêm nhánh autofix, ca P-b cũ giữ nguyên (test P-b chạy lại) |
| `DECISION_REASONS`/`PROCESS_DEF_RULES` thêm cuối | FE map nhãn đủ (i18n check), CHECK DB khớp |
| Hook Runtime | ca H2c `Write out/` + P-b `sources/` không đổi |
| Claimer | slot `RUNTIME_SANDBOX_MAX` không chặn job thường |
| pydantic sinh lại `hub.py` | `JobAutofix` optional, không `default` |

## ADR mới (nếu có)
Không ADR mới — ADR-0011 điền khuyến nghị (Proposed). Không thêm thư viện Python/TS. FE: nếu dùng thư viện diff ⇒ ADR riêng.
