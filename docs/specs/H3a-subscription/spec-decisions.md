# H3a — Quyết định

## Trước SPEC — người dùng đã chốt (không hỏi lại)
| # | Quyết định | Áp vào |
|---|---|---|
| U1 | (2026-10-05, CR-041) API key chỉ dùng ở **Dify**; Hub chạy **Claude subscription** `claude-sub`. H2d (Model Gateway/API, `llm`/`python`, fallback sang API, Codex/Gemini) **hoãn** — H3a không có provider API, không fallback | §1, R07, AC-W02 |
| U2 | (2026-10-05) Không chạm Dify thật; smoke chỉ `claude-sub`; e2e tích hợp 3 app chờ người dùng ghép | §7, AC-07, AC-12 |
| U3 | Phiên Hub/Worker: code H3 chỉ ở `apps/hub-api`, `apps/agent-runtime`, `packages/**`; UI Admin/Chat → CR-impact cho phiên Chat/Admin | §5 |
| U4 | Trên `main`, không push | — |
| U5 | (2026-10-06) **Chu kỳ probe 20 phút** (`AGENT_RT_PROBE_S=1200`); Q3 phần còn lại và Q1, Q2, Q4–Q7 theo mặc định | R11, R12, K1, Q3 |

## D1 · Chia H3 thành mốc con (docs-architect đề xuất, ghi ROADMAP)
H3 gộp 3 khối độc lập, ước > 3 000 dòng diff, chạm 3 nhóm rủi ro cao khác nhau (subscription/khoá provider · quyền · quota/chi phí) → chia như H2:

| Mốc con | Nội dung | Mã | Vì sao thứ tự này |
|---|---|---|---|
| **H3a** (spec này) | Subscription `claude-sub`: probe → `provider_state`, hết quota/giới hạn, lỗi rõ | WRK-FR-22, 15; CR-041 | Hub chạy **chỉ** bằng một subscription: hết quota/mất đăng nhập là ngưng dịch vụ agent; rủi ro H1 "hết quota thật" còn mở; nhỏ, chủ yếu Python, không phụ thuộc Admin |
| **H3b** | `/agent-grants` (GET/POST/DELETE) + `GET /agent-grants/effective/:user_id` (Kiểm tra quyền phần agent — đóng M5 phần agent) + trace API `GET /runs/:id/trace` + xem trace theo role + audit `view_trace` | HUB-FR-78, 79, 52, 87; HUB-BR-17; ADM-FR-37 (vế Hub) | Không phụ thuộc H3a/H3c; UI Admin (trang Groups, Kiểm tra quyền) → CR-impact |
| **H3c** | Quota (đếm, `overage`, `run.started.quota`, NOTIFY `quota_threshold`), chặn cứng `QUOTA_BLOCKED`, `price_book` → `billable_usd` (+ tính lại khi thêm giá), báo cáo usage | HUB-FR-81, 82, 83, 84, 93, 53; HUB-BR-16 | Cần cột Admin `tenant_quotas.hard_block` (CR-034, phiên Admin) và phải khớp Admin M4 (`/admin/usage` đã có ở admin-api, evaluator ngưỡng Q2b M4) — câu hỏi riêng khi spec H3c |

Ghi chú cho H3c (để không phá M4): Admin M4 đã có `GET /admin/usage` (admin-api đọc `hub.usage_logs`, M4-R03/R08) và tự đánh giá ngưỡng khi nhận NOTIFY `quota_threshold {tenant_id}` (M4 spec-decisions Q2b). BA-H §9.1 ghi Hub cũng có `GET /admin/usage` → khi spec H3c: mặc định đề xuất **Hub không làm endpoint trùng**; Hub chỉ ghi đúng `usage_logs` (`billable_usd`, `overage`, `feature_id`) + gửi NOTIFY; chiều agent/provider của HUB-FR-53 là CR cho Admin nếu cần.

## Câu hỏi mở (mỗi câu có mặc định — Luật 2b: không trả lời ⇒ dùng mặc định)

### Q1 · Hết quota thì chuyển sang tài khoản subscription khác? (WRK-FR-21 vế subscription → subscription)
| Lựa chọn | Nội dung | Hệ quả |
|---|---|---|
| **A (đề xuất)** | **Chưa làm** — hiện chỉ có một tài khoản. Hết quota ⇒ lỗi rõ R08 tới giờ reset | Gọn; khi có tài khoản thứ hai: thêm provider `claude-sub-2` (đăng nhập riêng, `CLAUDE_CONFIG_DIR` riêng) + dùng lại cơ chế profile nhiều bước (WRK-FR-21) — mốc sau |
| B | Làm ngay: profile `claude-sub` → `claude-sub-2`, job tạo lại với bước kế | Cần tài khoản thứ hai + quản lý nhiều thư mục đăng nhập trên Worker; cần kiểm điều khoản gói (K5) |

**Mặc định: A.**

### Q2 · Nhận diện hết quota từ Claude CLI bằng gì?
Đọc code: H1 đã nhận diện bằng 3 tín hiệu (spec §0). "Kết luận H1": chữ **hết quota thật** + giờ reset trong text **chưa đo**. SDK 0.2.163 có `RateLimitEvent` với `resets_at`, `rate_limit_type`, `utilization`, `allowed_warning` — chưa đo CLI subscription phát đủ hay không.

| Lựa chọn | Nội dung |
|---|---|
| **A (đề xuất)** | Giữ 3 tín hiệu H1 (R01); thêm đọc `allowed_warning`/`utilization`/`rate_limit_type` (R03); kiểm biên `resets_at` (R02); log khoá `raw` (R04) để **S2** xác minh khi gặp thật; không thêm mẫu chữ đoán |
| B | Thêm mẫu chữ đoán (vd "limit reached", "resets at …") và parse giờ trong chữ | Có thể bắt thêm ca, nhưng là bịa hành vi CLI — trái luật "không bịa API" |

**Mặc định: A.** Spike S2 không chặn mốc.

### Q3 · Chu kỳ probe
| Lựa chọn | Nội dung |
|---|---|
| **A (chốt — người dùng 2026-10-06: 20 phút)** | **20 phút** `AGENT_RT_PROBE_S=1200` (BA-W §3 ghi 5 phút — lệch, ghi CR khi đóng mốc cùng Q4); bỏ lượt khi có job thành công trong chu kỳ (R12); probe ngay khi khởi động / `cooldown_until` qua; `logged_out` mỗi 60 s (R13) |
| B | Probe cố định 5 phút, không bỏ lượt | Đơn giản hơn; tốn quota gói ~288 lượt/ngày |
| C | Không probe định kỳ, chỉ probe khi khởi động + khi `cooldown_until` qua | Ít tốn nhất; `logged_out` phát hiện muộn (chỉ khi user gửi tin) |

**Mặc định: A.**

### Q4 · Probe là job trong `hub.jobs` (`maint.probe`, BA-W §3) hay vòng lặp trong Runtime?
| Lựa chọn | Nội dung |
|---|---|
| **A (đề xuất)** | Vòng lặp trong Runtime + khoá advisory theo provider (R11) — như sweeper H2c trong Hub; không thêm loại job, không ai phải lập lịch enqueue |
| B | Job `maint.probe` (Hub hoặc cron enqueue) | Đúng chữ BA; cần bộ lập lịch + job chiếm slot `max_concurrency` của provider |

**Mặc định: A** — ghi lệch chữ BA-W §3 vào CR khi đóng mốc (docs-architect I3).

### Q5 · Câu lỗi cho user có ghi giờ mở lại không?
| Lựa chọn | Nội dung |
|---|---|
| **A (đề xuất)** | Không: câu tĩnh theo lý do (R08), contract chat không đổi, giữ H1-R26 (không tham số động) |
| B | Có: thêm `details.retry_at` vào `run.failed` (contract chat **chỉ thêm**) + Chat hiện giờ | Rõ hơn cho user; cần CR-impact Chat; lộ nhịp hạn mức gói ra client |

**Mặc định: A.**

### Q6 · Cách probe (spike S1)
| Lựa chọn | Nội dung |
|---|---|
| **A (đề xuất)** | Làm S1 trước PLAN chốt: nếu CLI bản đang ghim có cách kiểm đăng nhập không gọi model → dùng cho vế đăng nhập; vế quota luôn cần lượt tối thiểu R14(b) (chỉ khi R12 không bỏ lượt). Chưa có kết quả S1 → PLAN theo (b) |
| B | Chỉ (b), bỏ S1 | Đơn giản; mỗi probe tốn một lượt nhỏ |

**Mặc định: A.** → **Đã chốt bởi Spike S1: (a) `auth status` cho đăng nhập + (b) lượt haiku cho quota** (xem mục Spike S1).

### Q7 · Ai được báo khi `logged_out` / `cooldown` / `allowed_warning`?
| Lựa chọn | Nội dung |
|---|---|
| **A (đề xuất)** | Chỉ log (`warn` cho `logged_out`) + `provider_state`; runbook đọc log/SQL. UI ở Studio H4 |
| B | Thêm NOTIFY/email cho `platform_admin` | Cần kênh Admin mới → CR-impact Admin |

**Mặc định: A.**

## Spike S1 — cách probe
Chạy 2026-10-06, WSL Ubuntu user `worker`, CLI **bundled** của `claude-agent-sdk==0.2.163` = `2.1.286` (`~/.local/bin/claude` = 2.1.289 — **khác bản**, probe phải gọi bản bundled như Runtime). Không logout/login, không đọc/in giá trị token (chỉ tên khoá + hạn).

| # | Lệnh / thử | Kết quả |
|---|---|---|
| 1 | `claude --help`, `claude auth --help` | Có `auth status [--json\|--text]` (JSON mặc định), `auth login/logout`, `doctor` (kiểm cài đặt, không phải đăng nhập), `setup-token` |
| 2 | `claude auth status` (đã đăng nhập) | exit 0, JSON `loggedIn:true, authMethod:"claude.ai", subscriptionType:"max"` + email/orgId (PII — **không log**). ~5,1 s (cố định) |
| 3 | như 2 nhưng `unshare -rn` (không mạng, không DNS) | Vẫn `loggedIn:true`, exit 0, ~5,1 s ⇒ **chỉ đọc file local, không xác thực với server** |
| 4 | `CLAUDE_CONFIG_DIR=<tmp rỗng>` hoặc `HOME=<tmp rỗng>` | exit **1**, `loggedIn:false, authMethod:"none"` |
| 5 | SDK: `ClaudeSDKClient` connect (không `query`) → `get_server_info()["account"]` | Đăng nhập: `{email, organization, subscriptionType:"Claude Max", apiProvider}`; config rỗng: `{tokenSource:"none"}`. ~5,8–7 s; cũng chạy được không mạng ⇒ cùng tính chất #3. SDK không có hàm auth riêng |
| 6 | `.credentials.json` (chỉ khoá/hạn) | `claudeAiOauth.{accessToken, refreshToken, expiresAt, refreshTokenExpiresAt, scopes, subscriptionType, rateLimitTier}`; access hết hạn sau ~6,7 h (CLI tự refresh), refresh ~28,5 ngày |
| 7 | **Lượt thật #1**: `max_turns=1`, `tools=[]`, `setting_sources=[]`, `mcp_servers={}`, prompt `Reply with: ok`, model mặc định | `RateLimitEvent{status:allowed, rate_limit_type:five_hour, resets_at}` (đến **trước** câu trả lời) · Result success · usage opus in 2 / out 4 / cache_creation 3 833 + lượt phụ haiku in 896 / out 8 · `total_cost_usd` 0,0317 (quy đổi, trừ vào hạn mức gói) · connect 5,8 s, API 2,0 s, tổng 9,5 s |
| 8 | **Lượt thật #2**: như #7 + `model='haiku'`, `system_prompt='Reply ok.'` | `RateLimitEvent` như #7 · haiku in 4 211 / out 45 · cost 0,0044 (~7× rẻ hơn) · connect 6,1 s, API 1,7 s, tổng 8,7 s |

**Kết luận — chọn (a)+(b) lai:**
- **(a) vế đăng nhập, miễn phí:** `<bundled claude> auth status --json`, cwd thư mục probe, hạn 15 s. `exit≠0` hoặc `loggedIn≠true` ⇒ `logged_out` **không gọi model**. Chỉ đọc khoá `loggedIn` (bỏ email/orgId, không log stdout). Vòng `logged_out` mỗi `AGENT_RT_PROBE_LOGGED_OUT_S` chỉ dùng (a).
- **(b) vế quota + token thật còn dùng được:** (a) ok và R12 không bỏ lượt ⇒ một lượt như #8 (`model='haiku'`, system prompt ngắn cố định, không tool/MCP/setting). Đọc `RateLimitEvent` + `ResultMessage` như job; lỗi "Not logged in"/401 ở (b) ⇒ `logged_out` (token bị thu hồi/refresh hết hạn mà (a) không thấy).
- Chi phí (b): ~4,2 K token vào / ~45 ra trên haiku, ~9 s; với `AGENT_RT_PROBE_S=1200` tối đa 72 lượt/ngày khi rảnh.

**Rủi ro:** (1) (a) không phát hiện token bị thu hồi phía server / refresh hết hạn — (b) và lỗi job (R01/PY-02) bù. (2) Probe haiku thấy giới hạn `five_hour` chung; giới hạn riêng theo model (vd tuần cho opus) có thể không lộ ở probe ⇒ job opus vẫn có thể bị `rejected` — R01–R02 đã xử lý từ tín hiệu job. (3) Chữ/khoá `auth status` là CLI nội bộ, có thể đổi khi nâng SDK ⇒ khoá theo bản ghim, kiểm lại khi nâng (PY-02). (4) ~5 s cố định mỗi lần (a); không chặn claim (chạy nền). (5) stdout chứa PII (email/org) ⇒ cấm log.

## Spike S2 — tín hiệu hết quota thật
(chưa gặp — ghi khi log `claude.rate_limit` có `rejected`/`allowed_warning` thật)

## Quyết định trong lúc làm
PLAN (backend-lead, 2026-10-06) — chính xác hoá spec theo Luật 2 (spec → BA → ADR → CONVENTIONS → code hiện có → đơn giản nhất). Chi tiết: `plan.md`, `plan-db.md`, `plan-runtime.md`.

| # | Quyết định | Nguồn / lý do |
|---|---|---|
| PL1 | **Contract không đổi** (chat, hub, hub-internal): `JOB_FAIL_REASONS` đã có `quota`/`provider_unavailable`; probe không đi qua job/Redis/HTTP ⇒ không cần `ProbeResult` trong contract (kiểu nội bộ pydantic) | spec §3 ("có thể"); đơn giản nhất |
| PL2 | Khởi động Runtime: `AGENT_RT_PROBE_S>0` ⇒ bỏ reset mù H1, lượt probe `startup` chạy nền (không chặn "sẵn sàng"); `=0` ⇒ giữ reset mù H1 | R13, R17; test khoá `orphan_int_test` restart (về `ok` ≤ 10 s) |
| PL3 | `probe_due`: `cooldown` chưa tới `cooldown_until` ⇒ **không** probe, kể cả lúc khởi động (job opus có thể bị chặn theo cửa sổ riêng mà haiku không thấy — Spike S1 rủi ro 2); `error` ⇒ probe lúc khởi động + mỗi `AGENT_RT_PROBE_S` (R13 không liệt kê `error`) | R13; test khoá `test_wrk_restart_keeps_cooldown` |
| PL4 | Probe `ok` khi provider đang khoẻ (`ok`/`busy`/chưa có hàng) = một UPSERT chỉ ghi `last_probe_at`/`last_ok_at`/quota — **không** reset `consecutive_errors`, không đổi `updated_at` (đếm lỗi H1 là lỗi **job**; probe haiku không chứng minh đường job). `consecutive_errors=0` (R15) chỉ áp khi probe đưa provider hỏng về `ok`. Quy ước: `updated_at` chỉ đổi khi `status`/`cooldown_until`/`consecutive_errors` đổi (mốc rào R15) | R15, K4; tránh đua với `orphan_int_test` 3 crash → `error` |
| PL5 | Probe lỗi (timeout, CLI không chạy, parse sai): `consecutive_errors+1`; chỉ chuyển `error` (+ fail job `queued`) khi provider đang khoẻ và chạm ngưỡng 3 (như H1 "Kết thúc"); provider đã `logged_out`/`cooldown`/`error` ⇒ chỉ đếm, giữ trạng thái | R15 "như H1"; không ghi đè lý do hỏng cụ thể bằng `error` chung |
| PL6 | Biên env: production đúng spec (`PROBE_S` 0 hoặc 60–3 600…); `APP_ENV` development/test cho phép tới 1 s để int test không chờ 60 s. `AGENT_RT_FAKE_PROBE_FILE` chỉ dev/test | R11 (biên), R18; như `fake-cli` chỉ dev (H1) |
| PL7 | (a) exit 0 mà stdout không phải JSON có `loggedIn` boolean ⇒ **lỗi probe** (PL5), không suy ra `logged_out`; exit ≠ 0 ⇒ `logged_out` (Spike S1 #4) | R14; chữ CLI nội bộ có thể đổi khi nâng SDK |
| PL8 | Probe chuyển provider sang hỏng (`cooldown`/`logged_out`/`error`) ⇒ fail job `queued` của provider như H1 "Kết thúc" trong một transaction ngắn `K_CLAIM → jobs → provider_state` **sau** khi probe xong. Spec §6 "probe không giữ `K_CLAIM`" hiểu là: không giữ trong lúc gọi provider; probe khoẻ 0 lần `K_CLAIM` | R06 ("job queued bị fail ngay khi provider hỏng"), R15 ("không giữ khoá claim lâu") |
| PL9 | stderr của `auth status` và con probe ⇒ `DEVNULL` (không file log): có thể chứa email/org; kết quả chỉ qua exit code + sự kiện | HUB-NFR-04, R14 "không log stdout" |
| PL10 | Smoke AC-12 "`CLAUDE_CONFIG_DIR` trỏ thư mục trống" làm bằng **`HOME` tạm có symlink** `.claude`/`.claude.json` → thư mục thật (đổi symlink sang thư mục rỗng rồi trả lại): env con là danh sách trắng (`sandbox/env.py`, không có `CLAUDE_CONFIG_DIR`) và không được đụng/đổi tên file credential thật | WRK-BR-02; tránh mất dữ liệu đăng nhập |
| PL11 | `logged_out` mà (a) báo `loggedIn:true` ⇒ chạy (b) để xác nhận rồi mới về `ok` (token có thể bị thu hồi phía server — Spike S1 rủi ro 1). "Vòng `logged_out` chỉ dùng (a)" = khi (a) còn `false` | R14 |
| PL12 | R06 khe hở: job `queued` quá `max_wait_s` ⇒ Hub đọc `provider_state`: đang chặn ⇒ reason theo `blockedReason` (`cooldown` ⇒ `quota`); không chặn ⇒ `queueTimeoutReason` H1 (chữ ký không đổi — test khoá H1 R10) | R06 ("PLAN xác nhận reason `quota`") |
| PL13 | Admin test-run (`internal/test-run.service.ts`) giữ `runErrorText(code)` (không theo reason) — R08 nói câu lỗi Run của user | R08 phạm vi; U3 |
| PL14 | R03 "một lần mỗi cửa sổ" giữa nhiều Runtime: cột `warn_resets_at` + `NOTE_WARNING … RETURNING first`; vắng `resets_at` ⇒ cửa sổ = đầu giờ UTC (tối đa 1 log/giờ). Job thành công luôn ghi `last_ok_at` (`PROVIDER_OK` thành UPSERT) cho R12 | R03, R12 |
| PL15 | Chỉ **probe** (`PROBE_RECOVER`) đưa provider về `ok`; job thành công chỉ ghi `last_ok_at` (+ `consecutive_errors=0`), không đổi `status`, không `provider.recovered` — job bắt đầu trước khi hỏng có thể xong sau, không chứng minh hạn mức đã mở lại (cùng lý do PL3). Khớp plan-db §2 | R16, G5 |
| B-D1a | 0008: `IF NOT EXISTS (… pg_constraint WHERE conname = … AND conrelid = 'hub.provider_state'::regclass)` (thêm `conrelid` so với plan-db §1) — bắt chước `0006`, tránh trùng tên ràng buộc ở bảng khác | CONVENTIONS/code hiện có |
| B-D1b | `hub-h2c.int.test.ts` ca "gỡ 0007 + dòng journal": xoá dòng journal theo `created_at >= when(0007)` và kỳ vọng `hub` = số migration từ 0007 (đọc `_journal.json`) thay vì `max(id)` + `{hub: 1}` — có 0008 thì `max(id)` là 0008, ca cũ sai. Test D1 `hub-h3a.int.test.ts` dùng cùng cách (không vỡ khi thêm 0009+) | test của backend-lead (không khoá); giữ ý ca H2c |
| PY-01a | `probe_result`: `ms=0` (nơi gọi `probe/` PY-03 điền số đo bằng `replace`); `message` là câu cố định tiếng Anh (`provider rate limited`, `probe timed out`…), không chép `final.text`/`fatal.msg`; `seen is None` ⇒ `ok` với `step="auth"` (chỉ (a) chạy), mọi ca có `seen` ⇒ `step="turn"`; `rate_limit_type`/`utilization` qua `clean_*` ghi kèm mọi `kind` khi có `rate_limit`; `tokens` = (`in`+`cache_read`+`cache_write`, `out`) như `UsageSum` job | rt §2–3; test-plan-log QW-PU; bắt chước `outcome.UsageSum` |
| PY-01b | `ProbeSeenLike` thêm property `usage: UsageEv \| None` (rt §2 `ProbeSeen` có `usage`); `rate_limit_type`/`utilization` đọc bằng `getattr` (RateLimit có trường từ PY-02; test dùng đối tượng vịt). Thêm `RATE_TYPE_RE` cạnh `RATE_TYPE_PATTERN` (giữ tên cho P11) | test-plan-log QW-PU |
| PY-01c | `parse_fake_probe`: số (`resets_at`, `ms`) chỉ nhận chữ số `[0-9]{1,12}` (không `+`, `_`, khoảng trắng); `rejected:<ts>:<type>` sai regex type ⇒ `error`; `warning:<util>` ngoài [0,1]/NaN ⇒ `error`; thừa tham số ⇒ `error` | rt §5 "sai cú pháp ⇒ error" |
| PY-01d | `outcome.broken_of(rl, now=None, default_s=1800)`, `decide_exit(payload, seen, default_s=1800)`, `is_error_verdict(kind, default_s=1800)` (tham số mặc định giữ chữ ký cũ); `HostConfig.cooldown_default_s` (mặc định 1800) ← `Settings.cooldown_default_s` ở `main.host_config`; `job_run` truyền `cfg.cooldown_default_s`. Ngoài danh sách file PY-01 phải chạm `job_run.py` + `main.py` (2 dòng) để env tới được `decide_exit`. `DEFAULT_COOLDOWN` (timedelta) → `DEFAULT_COOLDOWN_S` (int); unit `test_outcome` (của backend-lead, không khoá) đổi `resets_at=1_800_000_000` (quá 8 ngày ⇒ giờ là mặc định theo R02) sang now+1 h + ca biên R02 | R02; tasks PY-01 |
| B-B1a | B1: không thêm unit test cạnh file cho `blockedReason`/`EXHAUSTED_TEXTS` — hàm thuần đã phủ đủ bởi test khoá `H3a/rules` (R01–R05, R10–R18); `job-follow` tách `#expiredReason` (đọc `providerStateOf` không khoá rồi mới `slotCounts`) để `#poll` giữ ≤ 50 dòng. `EXHAUSTED_TEXTS` là `Map` theo reason như `UPSTREAM_HINTS` (reason lạ/null ⇒ câu H1) | CONVENTIONS §4; code hiện có |
