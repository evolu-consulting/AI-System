# Plan · P-c2-pr — §5 Runtime (tách từ plan.md để giữ trần 30 KB)

Ngữ cảnh: `plan.md` (§1 luồng, §4 chữ ký Runtime). Mã mục §5.x giữ nguyên.

### §5 Runtime
**5.1 Repo riêng (P-b resolve + Áp):** `sources/git_driver.py` nhận `auth: GitAuth | None` (`username`, `token`, giữ trong bộ nhớ); `_run_git` ghép `auth_env`; `mirror_path` dùng `mirror_key`. `sources/resolve.py`: item `config.credential_secret_id` ≠ null ⇒ `hub.source_credential(job_id, source_id)` (httpx, no-store, retry 2 lần) trước fetch; 404/409 ⇒ `SOURCE_UNRESOLVABLE` (message chung). `GIT_TERMINAL_PROMPT=0` giữ ⇒ không treo hỏi mật khẩu. Lỗi git đi qua `redact_auth` trước log/báo cáo.
**5.2 Gói mới `agent_runtime/apply/`:** `rules.py` (§4), `host.py` (`ApplyHost(cfg, oci, hub)`, `async run(job: SourceApplyJob) -> JobResult`), `report.py` (POST + retry như `autofix/report.py`). Slot (C22/C38): job `source.apply` không có `provider_key` ⇒ không qua `CLAIM_SELECT` (JOIN providers) — claim riêng `db/apply_sql.py` (mẫu `resolve_sql.py`), nối ở `queue/runtime.py`, đòi (job `running` của worker có `payload.autofix` object **hoặc** `type='source.apply'`) < `RUNTIME_SANDBOX_MAX`; `SANDBOX_SLOT` (`db/jobs_sql.py`) đếm thêm `type='source.apply'` để claim tự-sửa thấy job Áp. Không xin slot giữa job.
Các bước `ApplyHost.run` (git cứng P-c1 §5.3 trên `GIT_DIR=work/<job>/repo/.git`, ngoài mọi mount):
1. `ensure_mirror_fresh` (khoá nếu `has_credential`) → `target = rev-parse refs/heads/<branch>`; lỗi ⇒ `failed{code: auth|network|no_credential}` (C34).
2. `git clone --no-checkout --no-hardlinks <mirror> work/<job>/repo` → `checkout -B <ai branch> <target>`.
3. Tải `patch` → `git apply --3way --index --binary` → lỗi ⇒ `git status --porcelain` → `conflict{files}`.
4. Commit tác giả `ai-autofix <noreply@local>`, thông điệp cố định `ai-autofix: <branch>` (không đưa chữ tự do vào git).
5. `needs_retest` ⇒ `git archive HEAD` → giải nén + lọc PB-R07 (hàm lọc `sources/snapshot.py`) vào `work/<job>/workspace/<key>/` → `workspace.prepare` (git riêng, base = target) → `check.run_checks` (diff `target..HEAD`) với prep/test container như `AutofixHost` (P-c1 §5.2) → trượt ⇒ `check_failed`; không sandbox ⇒ job lỗi `container`.
6. `ls-remote <url> refs/heads/<branch>` = HEAD ⇒ bỏ push; ngược lại `push <url> push_refspec(branch)` (timeout 120 s) → lỗi ⇒ `failed{classify_push_error}`; `has_credential=false` + `auth` ⇒ `no_credential` (đổi ở `ApplyHost`, C34).
7. Báo cáo được Hub nhận (201/409 `APPLY_RESULT_EXISTS`) ⇒ job `succeeded` kể cả `conflict`/`failed`/`check_failed` (C37); không sandbox ⇒ job `failed` reason `container`, không báo cáo (C46: `apply_sql.py` FINISH ghi `error_reason='container'`).
8. Báo cáo → `finally`: xoá container + `work/<job>/`; xoá khoá khỏi bộ nhớ.
**5.3 Kiểm thử Runtime:** bare repo trong thư mục tạm (`git init --bare`), `GIT_CONFIG_*` insteadOf `https://github.com/acme/` → `file://…` (C6, `RUNTIME_ENV=test`); push thật vào bare repo; kiểm `refs/heads/ai/...` và nhánh mặc định không đổi. Khoá giả: bare repo không đòi auth ⇒ test `auth_env` bằng hàm thuần + ca "khoá được lấy và không xuất hiện trong `work/`, log, báo cáo".
