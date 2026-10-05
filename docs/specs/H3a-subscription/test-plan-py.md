# Test plan · H3a-subscription · phụ lục Python, stack, smoke (qc)

Phụ lục của [`test-plan.md`](test-plan.md). Chữ ký: `plan-runtime` §3 (`quota_rules`), chỉ thị `fake-cli` §5, log §7, env §6 (biên dev/test PL6); SQL `plan-db` §2–4. Tên Python `test_<mã_snake>_…` + docstring `"""WRK-FR-22 · P20 · … [H3a-Rxx · HUB-H3a-AC-yy]"""`.

## 1. P · unit thuần `apps/agent-runtime/tests/acceptance/test_quota_rules.py` (QW-PU → Q-PU, trước PY-01)
`now = datetime(2026,10,6,tzinfo=UTC)`; `ts(x) = int((now+x).timestamp())`; `snap(...)` dựng `ProviderSnap` (mặc định `db_now=now`, `consecutive_errors=0`); `cfg = ProbeCfg(probe_s=1200, logged_out_s=60)`. Đỏ đúng lý do = `NotImplementedError` của stub PY-00 (import được vì dataclass thật).

| ID | Hàm · AC | Ca (Given → Then) |
|---|---|---|
| P01 | `cooldown_until` · AC-01 · R02 | `None`/`ts(−1 s)`/`ts(0)` → `now+1800 s`; `ts(+1 s)` → đúng; `ts(+8 ngày)` → đúng (biên ≤); `ts(+8 ngày +1 s)` → `now+1800`; `default_s=60` → `now+60`; kết quả có `tzinfo=UTC` |
| P02 | `clean_type` · R02 | `five_hour`, `seven_day_opus`, `overage` → giữ; `Five-Hour`, `""`, `"a"*41`, `5`, `None`, `"x y"` → `None` |
| P03 | `clean_util` · R02/R03 | `0`, `1`, `0.85` → giữ (float); `-0.01`, `1.01`, `nan`, `inf`, `True`, `"0.5"`, `None` → `None` |
| P04 | `warn_window` · R03 · PL14 | `resets_at` hợp lệ → `ts`; `None`/quá khứ/> 8 ngày → `now` cắt đầu giờ (`now=10:37:12` → `10:00:00`) |
| P05 | `raw_shape` · R04 · AC-11 | `None`/`[1]`/`"x"` → `None`; `{"status":"rejected","resetsAt":1,"util":0.5,"ok":True,"x":None,"d":{},"l":[]}` → `{status:"str", resetsAt:"int", util:"float", ok:"bool", x:"NoneType", d:"dict", l:"list"}`; 31 khoá → 30 khoá đầu; khoá 61 ký tự → 60; giá trị `"user@x.com"` **không** xuất hiện trong `repr(kết quả)` |
| P06 | `probe_due` · R12, R13 · AC-09 · PL3 | bảng ≥ 22 dòng: `probe_s=0` → False (mọi trạng thái); `status None` → True; `cooldown` `until None` → True; `until now+1 s` → False (cả `startup=True`); `until now−1 s` + `last_probe None` → True; `+ last_probe ≥ until` → False; `+ last_probe < until` → True; `logged_out` `startup` → True; `last_probe now−59 s` → False; `now−60 s` → True (biên ≥); `error` `startup` → True; `last_probe now−1199 s` → False; `now−1200 s` → True; `ok`/`busy` `last_ok now−1199 s` → False (cả `startup`); `last_ok now−1200 s` + `startup` → True; `last_ok None` + `last_probe now−10 s` + không startup → False; `last_probe now−1200 s` → True |
| P07 | `auth_logged_in` · R14(a) · PL7 | `(1, b'{"loggedIn":false}')` → False; `(1, b"")` → False; `(-9, b"")` → False; `(0, b'{"loggedIn":true,"email":"a@b"}')` → True; `(0, b'{"loggedIn":false}')` → False; `(0, b"not json")` → None; `(0, b"{}")` → None; `(0, b'{"loggedIn":"true"}')` → None; `(0, b"[true]")` → None |
| P08 | `probe_result` · R14(b), R01 · AC-02 (vế thuần) | `auth None` → `error`; `auth False` → `logged_out`, `step="auth"`, không đọc `seen`; `seen None` → `ok`; `timed_out` → `error`; `rate_limit rejected` + `ts(+1 h)` + `five_hour` → `cooldown`, `until=ts`, type giữ; **thứ tự R01**: `rejected` + `final.is_error` chữ "Not logged in" → `cooldown`; `rate_limit.status="logged_out"` → `logged_out`; `fatal` → `error`; `final None` → `error`; `final.is_error` chữ "You've hit your usage limit" → `cooldown` (`now+default_s`); "Not logged in · Please run /login" → `logged_out`; chữ khác → `error`; `allowed_warning` util 0.85 → `ok` + `warning(0.85, type, window)`; util 1.5/type `Bad` → `None` qua `clean_*`; `message` ≤ 500, không chứa chữ của `final.text` (không PII); `tokens` = usage (`(10,1)`) |
| P09 | `probe_transition` · R15 · PL4, PL5 | `ok` × {`ok`,`busy`,`None`} → `healthy`; `ok` × {`cooldown`,`logged_out`,`error`} → `recover`; `cooldown` cùng `until` ← `cooldown` → `seen`; khác `until` → `broken`; ← `ok` → `broken`; `logged_out` ← `logged_out` → `seen`; ← `cooldown`/`ok`/`error` → `broken`; `error` × mọi → `error` |
| P10 | `parse_fake_probe` · R18 | `None`/`""`/`"\n"` → ok; `ok`; `rejected`; `rejected:1790000000`; `rejected:1790000000:seven_day`; `logged_out`; `revoked`; `warning:0.85`; `warning:0.85:1790000000`; `hang`; `error`; dòng 2 bị bỏ qua; `warning:abc`, `rejected:x`, `zzz` → `error` + `ok:1` → ok(delay 1 ms); `ok:3000` → ok(3000 ms); `ok:60000` → ok; `ok:0`, `ok:60001`, `ok:abc`, `ok:` → `error` (G2, đã xử lý) |
| P11 | hằng | `COOLDOWN_MAX == timedelta(days=8)`; `RATE_TYPE_RE` khớp `five_hour`, không khớp `Five` |
| P12 | `mapping.result_signal(ResultMessage)` (H1) · R01 · AC-02 vế job · G1 | import `from agent_runtime.providers.claude.mapping import result_signal`; dựng `ResultMessage` SDK: `is_error=True, api_error_status=429, result="Not logged in · Please run /login"` → `RateLimit(rejected)` (429 thắng chữ auth); `api_error_status=401` → `logged_out`; `api_error_status=None` + `result="You've hit your usage limit"` → `rejected`; `is_error=False` → `None` |

**AC-02 vế job** ("429 + chữ not logged in → cooldown", "401 → logged_out") — G1 (test-plan §8): phân loại nằm ở `mapping.result_signal` H1, chưa có chữ ký trong `rt §3`. Đã xử lý (G1): P12 gọi thẳng `result_signal` (hàm thuần H1) với `ResultMessage` SDK; P08 phủ thứ tự trên `probe_result`; K07 `refusal_int_test` + P48 bổ sung.

## 2. P · int Runtime thật (`fake-cli`) — QW-P (sau PY-02), khoá Q3
Env mỗi ca qua `ctx.runtime(**env)`: `AGENT_RT_PROBE_S` (2 hoặc 60), `AGENT_RT_PROBE_LOGGED_OUT_S=1`, `AGENT_RT_PROBE_TIMEOUT_S=10` (mặc định; chỉ ca treo P22, P38 đặt `2` — N1), `AGENT_RT_FAKE_PROBE_FILE=<tmp_path>/probe.txt` (ghi nội dung trước/giữa ca); `<file>.calls` đếm `auth`/`turn`. Chờ theo điều kiện (`wait_until`, ≤ 15 s); **kiểm "không probe trước hạn" bằng mốc DB** (`last_probe_at ≥ mốc`), không bằng `sleep`. Log: đọc file JSON log của Runtime (`box.logs`, mẫu `startup_int_test`).

### 2.1 `probe_int_test.py` (P20–P39) · WRK-FR-22
| ID | AC · luật | Given → Then |
|---|---|---|
| P20 | AC-08 · R13, R15, R16 | file `logged_out`, không hàng `provider_state` → khởi động ⇒ `logged_out`, log `provider.logged_out{source:probe}` mức warn; ghi file `ok` ⇒ ≤ 15 s `ok`, `consecutive_errors=0`, `last_probe_at`/`last_ok_at` ≠ NULL, log `provider.recovered{from:"logged_out"}`; **cùng** process Runtime (pid không đổi, `ctx.alive()` None) |
| P21 | AC-08 · AC-04 (vế Runtime) · R15, PL8 | `acme_limit=1`: job ACME `#fake:sleep=30` running + job ACME thứ hai `queued`; `PROBE_S=2`, file → `rejected:<ts+1 h>:five_hour` ⇒ `cooldown`, `cooldown_until=ts`, `rate_limit_type=five_hour`, `last_probe_at`; job `queued` → `failed ALL_PROVIDERS_EXHAUSTED quota`, `attempts=0`, đúng 1 `job.failed` trên Redis; log `provider.cooldown{source:probe}` |
| P22 | AC-08 · R15 · PL5 | `PROBE_S=2`, `PROBE_TIMEOUT_S=2`, file `hang` ⇒ mỗi lượt sau 2 s: `consecutive_errors` 1→2→3 ⇒ `status=error`; job `queued` (dựng như P21) → `provider_unavailable`; sau mỗi lượt `group_pids` của con probe rỗng (bị giết); `last_error` không chứa `@` |
| P23 | R15 · PL5 | file `error` một lượt ⇒ `consecutive_errors=1`, `status` vẫn `ok` |
| P24 | PL5 | `logged_out` + file `error` (a ok ⇒ b lỗi, PL11) ⇒ `consecutive_errors+1`, status **giữ** `logged_out` |
| P25 | PL11 · R14 | `logged_out` + file `revoked` ⇒ `.calls` có `auth` rồi `turn`; status giữ `logged_out` (không về `ok`) |
| P26 | AC-08 · R11 | 2 Runtime (`qc-1`, `qc-2`) cùng file `ok`, `PROBE_S=60`, không hàng state ⇒ chờ `last_probe_at` ≠ NULL rồi chờ cả hai Runtime ghi log khởi động xong ⇒ `.calls` đúng **1** `auth` + **1** `turn`; ≥ 1 log `probe.skipped` (`locked` hoặc `recent`) |
| P27 | AC-09 · R12 · PL14 | state `ok`, `last_ok_at = now()−58 s` (SQL), `PROBE_S=60` ⇒ chờ `.calls` có `turn` ⇒ `last_probe_at ≥ last_ok_at(ban đầu) + 60 s` (không probe sớm); rồi chạy 1 job thành công ⇒ `last_ok_at` mới (PROVIDER_OK UPSERT) và `updated_at` **không đổi** (PL4) |
| P28 | AC-09 · R12 | state `ok`, `last_ok_at = now()` , `PROBE_S=60` ⇒ chờ Runtime sẵn sàng (manifest) + 1 job thành công ⇒ `.calls` không tồn tại/rỗng; `last_probe_at` NULL (0 lời gọi provider) |
| P29 | AC-09 · R13 | `cooldown`, `cooldown_until = now()+2 s`, file `ok` ⇒ `ok` + `provider.recovered{from:"cooldown"}`; `last_probe_at ≥ cooldown_until` (không probe trước hạn) |
| P30 | AC-09 · R13 · PL2 | `error`, `consecutive_errors=3`, file `logged_out` ⇒ sau khởi động `logged_out` (chứng minh probe thay reset mù H1, không về `ok`) |
| P31 | R17 · PL2 | `PROBE_S=0`, `error` ⇒ `ok` (reset mù H1) và `.calls` không tồn tại |
| P32 | PL3 | `cooldown` `now()+1 h` + khởi động ⇒ sẵn sàng ⇒ `last_probe_at` NULL; SQL đổi `cooldown_until = now()+1 s` ⇒ probe chạy (`last_probe_at ≥` mốc) — chứng minh vòng sống và lượt khởi động đã bỏ |
| P33 | AC-10 · R15 (G2) | state `ok` `last_ok_at` cũ, file `ok:3000` (< timeout 10 s) ⇒ chờ `.calls` có `turn` ⇒ thêm job `#fake:ratelimit=<ts+1 h>` ⇒ job `failed quota` ⇒ sau khi probe xong: `cooldown`, `cooldown_until=ts`; log `probe.stale` |
| P34 | AC-10 · R15 | `logged_out`, file `ok:3000` (< 10 s) ⇒ chờ `turn` ⇒ SQL (owner) đổi sang `cooldown now()+1 h`, `updated_at=now()` ⇒ cuối: `cooldown` (PROBE_RECOVER bị rào), log `probe.stale` |
| P35 | AC-11 · R17 | file `ok`, không job ⇒ log `probe.result{provider, ok:true, step:"turn", ms, input_tokens:10, output_tokens:1}`; `count(*) usage_logs` = 0; quét mọi dòng log của ca: không `Reply`, không `@`, không `organization`, không `accessToken` |
| P36 | R03 · AC-03 (vế probe) | file `warning:0.85:<ts+1 h>` 2 lượt (`PROBE_S=2`) ⇒ `status=ok`, `utilization=0.85`, `warn_at`, `warn_resets_at=ts`; `provider.quota_warning` đúng **1**; đổi `<ts+2 h>` ⇒ thêm đúng 1 |
| P37 | §6 · P8 | `from agent_runtime.db.jobs_sql import K_CLAIM` (câu SQL `SELECT pg_advisory_xact_lock(hashtext('hub.jobs.claim'));`, G3) ⇒ sau khi Runtime sẵn sàng, owner `async with conn.transaction(): await conn.execute(K_CLAIM)` rồi chờ `last_probe_at ≥ mốc` (`PROBE_S=2`) ⇒ probe `ok` vẫn ghi `last_probe_at` trong lúc khoá còn giữ (0 lần chờ `K_CLAIM`) |
| P38 | K8 · R11 | sau lượt probe (`last_probe_at` ≠ NULL) và giữa hai lượt: `pg_locks` không có `locktype='advisory'` với `classid = hashtext('hub.provider.probe')`; với `PROBE_TIMEOUT_S=2`, SIGTERM Runtime khi file `hang` ⇒ không còn pid con probe |
| P39 | R11 | `hub.providers.enabled=false` cho `fake-cli` ⇒ `.calls` không tồn tại sau khi sẵn sàng + đổi lại `enabled=true` ⇒ có `turn` (vòng sống) |

### 2.2 `quota_int_test.py` (P40–P49) · WRK-FR-15 · WRK-FR-20
| ID | AC · luật | Given → Then |
|---|---|---|
| P40 | AC-03 · R03 | job `#fake:ratewarn=0.85,<ts+1 h>` ⇒ `succeeded`; `status=ok`, `utilization=0.85`, `warn_resets_at=ts`; log `provider.quota_warning` 1 lần; job thứ hai cùng chỉ thị ⇒ vẫn 1; log `claude.rate_limit{source:"job", status:"allowed_warning", job_id, run_id}` |
| P41 | R03 · PL14 | 2 job `#fake:ratewarn=0.5` (không ts) ⇒ `warn_resets_at` = đầu giờ UTC; 1 log |
| P42 | AC-01 (vế job) · R02 | `#fake:ratelimit=<ts+9 ngày>` ⇒ `cooldown_until ≈ now+1800 s` (±60 s); `#fake:ratelimit=<ts−60 s>` ⇒ như vậy; `#fake:ratelimit=<ts+1 h>,seven_day` ⇒ `until=ts`, `rate_limit_type=seven_day`; env `AGENT_RT_COOLDOWN_DEFAULT_S=120` + `#fake:ratelimit` ⇒ `now+120 s` (±30 s) |
| P43 | AC-04 (vế Runtime) · R06 | (i) `logged_out` + file `logged_out`; (ii) `error` + file `error` (PL5 chỉ đếm) ⇒ thêm job `queued` ⇒ chờ `last_probe_at ≥ jobs.created_at` (vòng đã chạy sau khi có job) ⇒ job vẫn `queued`, `attempts=0` (Runtime không claim) |
| P44 | AC-11 (vế job) · R04 | log `claude.rate_limit`: `keys` (nếu có) là map tên → tên kiểu; không chuỗi giá trị nào của raw; không `prompt` |
| P45 | PL4 · PL14 | không hàng state + 1 job thành công ⇒ hàng có `last_ok_at` ≠ NULL, `status=ok`; job thành công lần 2 ⇒ `updated_at` không đổi |
| P46 | `plan-db` §1 (CHECK an toàn) | `#fake:ratelimit=<ts+1 h>,Bad-Type` ⇒ job `failed quota`, `rate_limit_type` NULL (không rollback "Kết thúc"); `#fake:ratewarn=1.5` ⇒ `succeeded`, `utilization` NULL |
| P47 | AC-05 (vế Runtime) · R07 | `#fake:ratelimit=<ts+1 h>` ⇒ `attempts=1`, đúng 1 `job.failed`; chờ Runtime claim job khác provider/xong 1 job tenant khác ⇒ job vẫn `failed` (không requeue) |
| P48 | AC-W02 · R01 | `#fake:is-error=rate` ⇒ `cooldown` + `quota`; `#fake:is-error=auth` ⇒ `logged_out` + `provider_unavailable` + log `provider.logged_out{source:"job"}` (bổ sung log cho K07 `refusal_int_test`) |
| P49 | R16 vế job | `#fake:ratelimit=<ts+1 h>` ⇒ log `provider.cooldown{source:"job", until, type}` mức warn. `provider.recovered` chỉ kiểm qua probe (P20, P29) — job thành công không đổi `status` (`PROVIDER_OK`, `plan-db` §2) ⇒ G5 |

## 3. S · stack `tests/acceptance/H3a/stack/quota.stack.test.ts` — QW-P, khoá Q3
Hub thật trên host + Runtime container `fake-cli` (mẫu H2b `_stack.ts`, TC-4/TC-5); helper riêng `tests/acceptance/H3a/stack/_stack.ts` `startRuntimeBoxH3a(name, worker, env)` (nhận env thêm như H2a; dùng `dockerArgs`) đặt `AGENT_RT_PROBE_S=2`, `AGENT_RT_PROBE_LOGGED_OUT_S=1`, `AGENT_RT_FAKE_PROBE_FILE=/work/.data/h3a-stack/probe.txt`; test ghi chỉ thị ở host `<REPO>/.data/h3a-stack/probe.txt` (repo đã mount `/work`; `.data/` trong `.gitignore`) (G6, đã xử lý). Script `test:h3a:stack` (MK) chỉ gọi + bỏ qua `H3a/stack/**` ở lần chạy thường. `finally`: SQL đưa `provider_state` về `ok`, `cooldown_until=NULL`.

| ID | AC | Then |
|---|---|---|
| S01 | AC-W02 | `lan` gửi `#fake:ratelimit=<now+1 h>` (job Orchestrator) ⇒ SSE `run.failed{code:ALL_PROVIDERS_EXHAUSTED}` message/hint = R10 nguyên văn ≤ 5 000 ms (ghi ms; vỡ trên Windows ⇒ nới 10 s theo memory perf, ghi §10); `provider_state` `cooldown`, `cooldown_until` = ts |
| S02 | AC-05 | run S01: đúng 1 hàng `jobs`, `attempts=1`, `status=failed`, `error_reason=quota`; sau S03 vẫn 1 |
| S03 | AC-04 (đầu-cuối) | tin thường kế ⇒ `run.failed` R10 ≤ 3 000 ms, 0 hàng `jobs` mới |
| S04 | AC-09 · R13 (đầu-cuối) | SQL `cooldown_until = now()+2 s` ⇒ probe (file vắng ⇒ `ok`) ⇒ `ok`; tin thường kế ⇒ `run.finished` |

## 4. SM · smoke `tests/smoke/h3a-live.test.ts` (`HUB_LIVE=1`, I2, không chặn, không khoá)
Runtime thật `claude-sub` (Windows → WSL user `worker`), `APP_ENV=development`, `AGENT_RT_PROBE_S=1200`, `AGENT_RT_PROBE_LOGGED_OUT_S=5`; `HOME` tạm có symlink `.claude`/`.claude.json` → thư mục thật (PL10). **Không** gửi tin agent, **không** Dify thật. Số lượt model thật = **2** lượt haiku (SM1, SM3); `auth status` miễn phí. Trước SM1: SQL `last_ok_at=NULL` (để R12 không bỏ lượt).

| ID | Bước | Kỳ vọng |
|---|---|---|
| SM1 | khởi động Runtime | ≤ 60 s `status=ok`, `last_probe_at` ≠ NULL; log `probe.result{step:"turn"}` có `ms`, token (ghi vào `smoke.md` + `sd` "Spike S1") |
| SM2 | đổi symlink → thư mục rỗng | ≤ 30 s `logged_out` + log `provider.logged_out` (chỉ (a), 0 lượt model) |
| SM3 | trả symlink | ≤ 60 s `ok` + `provider.recovered` (PL11: 1 lượt (b)), cùng pid Runtime; `finally` luôn trả symlink, không đụng file credential |
| SM4 | quét toàn bộ log SM1–SM3 | không `@`, `organization`, `orgId`, `accessToken`, `refreshToken`, câu "Reply" (K7, AC-11 vế CLI thật) |
