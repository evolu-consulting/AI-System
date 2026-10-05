---
id: H3a-subscription
title: Subscription `claude-sub` — probe định kỳ → `hub.provider_state`, xử lý hết quota / bị giới hạn (lỗi rõ, không claim job mới tới giờ reset)
milestone: H3a
status: draft                  # draft → ready → approved → in-progress → done
requirements:
  [WRK-FR-22, WRK-FR-15, WRK-FR-20, HUB-FR-86, HUB-FR-89, HUB-BR-04,
   AC-W02, CR-041]
design:
  - docs/design/worker/ba-worker.md (§3 job `maint.probe`; §4 bảng trạng thái provider; §5 WRK-FR-15, 20, 22; §8 runbook "Provider báo logged_out", "cooldown liên tục"; §10 AC-W02)
  - docs/design/agent-hub/ba-agent-hub.md (§6.8 HUB-FR-86; §7 HUB-BR-04; §8 `provider_state`; §9.3 `ALL_PROVIDERS_EXHAUSTED`)
  - docs/specs/H1-hub-core/spec-decisions.md ("Kết luận H1" — rủi ro chưa xác minh "hết quota thật"; S8, S9; PY-12)
  - CR-041 (hoãn H2d; probe + hết quota `claude-sub` vào H3)
owner: backend-lead (Python chính + TS phần câu lỗi)
---

# H3a · Subscription `claude-sub`: probe + hết quota

Mốc con **đầu** của H3 (chia H3a/H3b/H3c — `docs/ROADMAP.md`, lý do: [spec-decisions](spec-decisions.md) D1). Hub chạy **chỉ** bằng Claude subscription (`claude-sub`); API key chỉ ở Dify; không có provider API, không fallback sang API (H2d hoãn, CR-041). Quyết định + câu hỏi mở: [spec-decisions.md](spec-decisions.md). AC: [spec-ac.md](spec-ac.md).

## 0. Hiện trạng (code thắng tài liệu — đã đọc 2026-10-05)
| Đã có từ H1/H2 | Ở đâu |
|---|---|
| Nhận diện hết quota: `RateLimitEvent.status=="rejected"` (+ `resets_at`), `ResultMessage.api_error_status==429`, chữ khớp `usage limit\|rate limit\|429`; chưa đăng nhập: 401 / `/login\|not logged in…` | `agent_runtime/providers/claude/mapping.py`, `providers/patterns.py` |
| Cooldown = `resets_at`, không có → 30 phút (`DEFAULT_COOLDOWN`) | `runtimes/cli/outcome.py` |
| Provider hỏng → `provider_state` (`cooldown`/`logged_out`/`error`) + fail mọi job `queued` của provider (`ALL_PROVIDERS_EXHAUSTED`, reason `quota`/`provider_unavailable`) trong transaction Kết thúc | `db/provider_state_sql.py`, `db/finish_sql.py` |
| Claim bỏ qua provider `cooldown` chưa hết hạn / `logged_out` / `error` | `db/jobs_sql.py` `CLAIM_SELECT` |
| Hub kiểm `provider_state` trước khi enqueue → `ALL_PROVIDERS_EXHAUSTED provider_unavailable`, không tạo job | `hub-api/.../runner/job/job-agent-runner.ts` (`providerBlocked`) |
| `error`/`logged_out` chỉ được reset **khi Runtime khởi động** | `queue/runtime.py` → `jobs_sql.reset_providers` |
| Câu lỗi Run theo **mã** (một câu cho `ALL_PROVIDERS_EXHAUSTED`: "Tất cả dịch vụ AI đang quá tải…") | `hub-api/.../runs/run-errors.ts` |
| SDK `claude-agent-sdk==0.2.163`: `RateLimitInfo{status: allowed\|allowed_warning\|rejected, resets_at, rate_limit_type: five_hour\|seven_day\|seven_day_opus\|seven_day_sonnet\|overage, utilization 0–1, overage_*, raw}` — **chưa đo** CLI subscription có phát đủ các trường này không | `.venv/.../claude_agent_sdk/types.py` |

**Lỗ hổng H3a lấp:** (1) không có probe → `logged_out` kẹt tới khi khởi động lại Runtime, không biết trước khi user gửi tin; (2) câu lỗi user không phân biệt "hết hạn mức gói" với "cần đăng nhập lại" (HUB-BR-04); (3) `allowed_warning`/`utilization`/loại cửa sổ bị bỏ, không có dữ liệu để xác minh "hết quota thật" (rủi ro H1); (4) `cooldown_until` từ `resets_at` không kiểm biên.

## 1. Phạm vi
| # | Làm | Mã |
|---|---|---|
| 1 | Spike **S1** (cách probe không/ít tốn quota) + **S2** (ghi lại tín hiệu hết quota thật) trước PLAN chốt | WRK-FR-22, 15 |
| 2 | Vòng probe trong Agent Runtime cho provider `kind='subscription'` → `hub.provider_state` (đăng nhập, quota, mức dùng) | WRK-FR-22 |
| 3 | Probe/ job thành công đưa `logged_out`/`cooldown`/`error` về `ok` **không cần khởi động lại** | WRK-FR-22, runbook §8 |
| 4 | Ghi thêm tín hiệu quota từ job thật (`allowed_warning`, `utilization`, `rate_limit_type`, `resets_at`) vào `provider_state` + log | WRK-FR-15 |
| 5 | Kiểm biên `cooldown_until`; không thử lại vô hạn; không claim / không enqueue tới giờ reset (giữ H1, thêm test) | WRK-FR-15, 20 |
| 6 | Câu lỗi Run theo **lý do** (`quota` / `provider_unavailable`) — vẫn mã `ALL_PROVIDERS_EXHAUSTED`, contract chat không đổi | HUB-BR-04 |
| 7 | `fake-cli` thêm kịch bản probe; smoke `HUB_LIVE=1` probe thật + `logged_out` giả lập | test |

**Không làm (H3a):** chuyển sang tài khoản subscription khác (Q1, mặc định không); fallback sang API (H2d hoãn); quyền agent, trace (H3b); quota tenant, `price_book`, `billable_usd`, `QUOTA_BLOCKED` (H3c); UI xem trạng thái provider (Studio H4; Admin không đổi); Codex/Gemini (H2d); sửa Chat/Admin, contract chat; gọi Dify thật.

## 2. Nghiệp vụ
### 2.1 Nhận diện và trạng thái
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| H3a-R01 | Tín hiệu **hết quota** (giữ H1, thứ tự ưu tiên): `RateLimitEvent.status=="rejected"` → `ResultMessage.api_error_status==429` → chữ khớp `RATE_RE`. Tín hiệu **chưa đăng nhập**: 401 → chữ khớp `AUTH_RE`. Rate trước auth. Không thêm mẫu chữ mới khi chưa có bằng chứng S2 | WRK-FR-15, H1 §3.3 |
| H3a-R02 | `cooldown_until` = `resets_at` (giây Unix) nếu `now < resets_at ≤ now + 8 ngày`; ngoài khoảng / vắng → `now + AGENT_RT_COOLDOWN_DEFAULT_S` (mặc định 1 800). `rate_limit_type`, `utilization` (nếu có) ghi kèm. Log `provider.cooldown{provider, until, type, source: job\|probe}` | WRK-FR-15 |
| H3a-R03 | `allowed_warning` (job hoặc probe): **không** đổi `status`, ghi `utilization`, `rate_limit_type`, `warn_at = now`; log `provider.quota_warning` một lần mỗi (provider, cửa sổ `resets_at`). Không ảnh hưởng user | WRK-FR-15 |
| H3a-R04 | Ghi `rate_limit_info.raw` **chỉ tên khoá + kiểu** (không giá trị chữ tự do) vào log `claude.rate_limit` để S2 có dữ liệu thật; không log prompt, token, email tài khoản | S2, HUB-NFR-04 |
| H3a-R05 | Trạng thái giữ bảng BA-W §4 (`ok`/`busy`/`cooldown`/`logged_out`/`error`). Cột mới `provider_state` (backend-lead chốt tên): `last_probe_at`, `last_ok_at`, `rate_limit_type`, `utilization`, `warn_at`. Không đổi nghĩa cột cũ | WRK-FR-22 |

### 2.2 Không claim, không treo, lỗi rõ
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| H3a-R06 | Provider `cooldown` (chưa tới `cooldown_until`) / `logged_out` / `error`: Hub **không tạo job** (đã có), Runtime **không claim** (đã có), job `queued` của provider bị fail ngay khi provider hỏng (đã có). H3a thêm test int + stack chứng minh cả ba; job lọt khe hở (Hub kiểm xong, provider hỏng trước khi claim) không treo: bị fail khi quá `max_wait_s` `queued` (cơ chế H1 `job-follow.ts` `queueTimeoutReason`) — PLAN xác nhận reason trả về là `quota` khi provider `cooldown` | WRK-FR-15, 20 |
| H3a-R07 | **Không thử lại vô hạn**: job `agent.cli` gặp hết quota → `failed ALL_PROVIDERS_EXHAUSTED quota`, không retry, không requeue; Orchestrator nhận job lỗi → run `failed` (không delegate lại cùng provider trong run đó). Thời gian từ tín hiệu đến `run.failed` ≤ 5 s (§6) | WRK-FR-15, HUB-BR-04 |
| H3a-R08 | Câu lỗi Run chọn theo `(code, reason)`: `ALL_PROVIDERS_EXHAUSTED` + `quota` → vi "Dịch vụ AI đã dùng hết hạn mức của gói hiện tại." / hint "Thử lại sau; hạn mức sẽ tự mở lại." · + `provider_unavailable` → vi "Dịch vụ AI đang tạm ngưng để quản trị viên kiểm tra." / hint "Báo quản trị viên nếu lỗi kéo dài." · reason khác/vắng → câu H1 giữ nguyên. Bản en tương ứng (backend-lead viết). Câu **tĩnh** (H1-R26: không giờ, không tên provider/tài khoản) — Q5 | HUB-BR-04 |
| H3a-R09 | Hub đọc reason từ `providerBlocked` (trước enqueue: `cooldown` → `quota`; `logged_out`/`error` → `provider_unavailable`) và từ `jobs.error_reason`. Hiện Hub trả `provider_unavailable` cho cả `cooldown` → sửa | HUB-BR-04 |
| H3a-R10 | Command `/` (Dify, sync/async) **không** bị chặn khi `claude-sub` hết quota (không dùng provider này). Run Orchestrator dùng `claude-sub` → mọi tin không `/` fail nhanh theo R08 tới giờ reset | CR-041 |

### 2.3 Probe (WRK-FR-22)
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| H3a-R11 | Vòng probe trong Agent Runtime (không phải job trong `hub.jobs` — Q4), mỗi `AGENT_RT_PROBE_S` (mặc định 1 200 = 20 phút — người dùng 2026-10-06; 60–3 600; sai → Runtime không khởi động), cho mỗi provider `kind='subscription'`, `enabled` mà Runtime này phục vụ. Nhiều Runtime: khoá advisory theo provider (`pg_try_advisory_lock`), Runtime khác bỏ lượt | WRK-FR-22 |
| H3a-R12 | **Bỏ qua lượt probe** khi provider `ok` **và** có job thành công trong `AGENT_RT_PROBE_S` vừa qua (`last_ok_at`) — job thật đã là bằng chứng, không tốn quota | Q3 |
| H3a-R13 | Probe ngay (không chờ chu kỳ) khi: Runtime khởi động (thay cho reset mù H1); `cooldown_until` vừa qua; `logged_out` mỗi `AGENT_RT_PROBE_LOGGED_OUT_S` (mặc định 60) | Q3 |
| H3a-R14 | **Cách probe** (chốt bởi spike S1, `spec-decisions` "Spike S1") — hai bước: **(a)** chạy CLI **bundled** của SDK `auth status --json` (cwd thư mục probe, hạn 15 s; không mạng, không tốn quota; chỉ đọc khoá `loggedIn`, **không log stdout** — có email/org): `exit≠0` hoặc `loggedIn≠true` ⇒ `logged_out`, dừng (vòng `logged_out` chỉ dùng (a)). **(b)** (a) ok và R12 không bỏ lượt ⇒ một lượt `ClaudeSDKClient`: `model='haiku'`, `system_prompt` cố định ngắn, prompt cố định ngắn, `tools=[]`, `mcp_servers={}`, `setting_sources=[]`, `max_turns=1`, cwd thư mục probe riêng (sandbox H1), hạn `AGENT_RT_PROBE_TIMEOUT_S` (mặc định 60). Đọc `RateLimitEvent` + `ResultMessage` như job (R01); chữ chưa đăng nhập ở (b) ⇒ `logged_out`. Đo S1: (a) ~5 s; (b) ~9 s, ~4,2 K token vào / ~45 ra | WRK-FR-22 |
| H3a-R15 | Kết quả probe → `provider_state` (một UPSERT, không giữ khoá claim lâu): thành công → `status='ok'`, `consecutive_errors=0`, `cooldown_until=NULL`, `last_probe_at`, `last_ok_at`; `rejected` → `cooldown` (R02); chưa đăng nhập → `logged_out`; lỗi khác (timeout, CLI không chạy) → `consecutive_errors+1`, ngưỡng 3 → `error` (như H1). Probe **không ghi đè** trạng thái mới hơn do job ghi trong lúc probe chạy (so `updated_at` lúc bắt đầu probe) | WRK-FR-22 |
| H3a-R16 | Chuyển trạng thái do probe/job: log `provider.recovered{provider, from}` khi về `ok`; `provider.logged_out` khi sang `logged_out` (log mức `warn`, để runbook §8 "đăng nhập lại" có tín hiệu) | WRK-FR-22 |
| H3a-R17 | Probe **không** ghi `usage_logs` (không có tenant/run); token probe chỉ ghi log `probe.result{provider, ok, ms, input_tokens, output_tokens}`. Tắt probe: `AGENT_RT_PROBE_S=0` (dev) | — |
| H3a-R18 | `fake-cli` (provider giả, test): chỉ thị probe theo biến môi trường test (`ok`, `rejected[:resets_at]`, `logged_out`, `warning:<util>`, `hang`) — backend-lead chốt cú pháp; không chạm CLI thật | test |

### 2.4 Tương thích
| Luật | Điều kiện | Nguồn |
|---|---|---|
| H3a-R19 | Contract `@ai/contracts/chat` **không đổi**; `test:contract:chat` 41 ca xanh nguyên văn; test khoá H1/H2a/H2b/H2c xanh nguyên văn (trừ câu lỗi R08 nếu test khoá so nguyên văn câu → qc phân xử tranh chấp, BA thắng) | H2c-R30 |
| H3a-R20 | Admin M4 đọc `hub.usage_logs` không đổi (H3a không đổi cột `usage_logs`) | M4 |

## 3. Contract (backend-lead)
<!-- backend-lead --> Phác (chốt ở PLAN): không endpoint mới; `@ai/contracts/hub` có thể thêm hằng `PROVIDER_STATE_VALUES` (đã có ở `@ai/db`) / kiểu `ProbeResult` nếu Python cần qua JSON Schema; `run-errors.ts` thêm bảng câu theo reason. Không sửa `@ai/contracts/chat`.

## 4. Dữ liệu (backend-lead)
<!-- backend-lead --> Phác: migration `migrations-hub/0008_h3a_provider_state.sql` thêm cột R05 vào `hub.provider_state` (nullable, không xoá/đổi dữ liệu cũ); `schema/hub.ts` cập nhật. Không bảng mới.

## 5. UI
Không có UI. Trạng thái provider xem bằng log + SQL (runbook `docs/guides/hub-dev.md` thêm mục); UI ở Agent Studio H4 (WRK-FR-22 "Studio đọc"). Không CR-impact Chat/Admin (câu lỗi đi qua `run.failed.message/hint` sẵn có).

## 6. Hiệu năng
| Chỉ tiêu | Ngưỡng | Đo bằng |
|---|---|---|
| Từ tín hiệu `rejected` trong job → `run.failed` tới client | ≤ 5 s | stack (`fake-cli`) |
| Tin mới khi provider `cooldown` → `run.failed` (không tạo job) | ≤ 1 s | int |
| Một lượt probe (fake) không giữ khoá claim | 0 lần chờ khoá `K_CLAIM` | Python int |
| Probe thật (`claude-sub`) | ≤ 60 s (hạn), không chặn claim | smoke |

## 7. Phụ thuộc, spike & giả lập
| # | Spike / phụ thuộc | Cách làm | Kết quả cần |
|---|---|---|---|
| S1 ✅ | Cách probe đăng nhập + quota rẻ nhất — **xong 2026-10-06: (a)+(b), xem R14** | Đọc `claude --help` / tài liệu CLI **của bản đang ghim** trên máy Worker (WSL); thử lượt tối thiểu R14(b) đo token + thời gian + có `RateLimitEvent` không; thử `CLAUDE_CONFIG_DIR` trỏ thư mục trống ⇒ chữ "Not logged in" (đã thấy ở PY-02) | Chọn (a) hay (b), tham số; ghi `spec-decisions` "Spike S1". Chưa xong S1 → PLAN theo (b) |
| S2 | Tín hiệu hết quota **thật** | Không ép hết quota (tốn gói). Bật R04 log; khi lần đầu gặp `rejected`/`allowed_warning` thật → chép khoá `raw`, `resets_at`, `rate_limit_type` vào `spec-decisions` "Spike S2". **Không chặn mốc** | Xác nhận/điều chỉnh R01–R03 |
| — | CLI `claude-sub` | `fake-cli` (R18) cho unit/int/stack; thật chỉ smoke `HUB_LIVE=1` |
| — | Dify | Không dùng (R10 kiểm bằng mock Dify H2a) |

Env mới (Runtime): `AGENT_RT_PROBE_S=1200` · `AGENT_RT_PROBE_LOGGED_OUT_S=60` · `AGENT_RT_PROBE_TIMEOUT_S=60` · `AGENT_RT_COOLDOWN_DEFAULT_S=1800`.

## 8. Tiêu chí nghiệm thu
Bảng AC: [spec-ac.md](spec-ac.md) (AC-W02 vế subscription, HUB-H3a-AC-01…13). Lệnh xong mốc: `done:h3a` (qc, mẫu `done:h2c`).

## 9. Câu hỏi mở
Q1–Q7 — [spec-decisions.md](spec-decisions.md). Không trả lời → dùng mặc định đề xuất (Luật 2b).

## 10. Rủi ro
| # | Rủi ro | Giảm thiểu |
|---|---|---|
| K1 | Probe tốn quota gói chung của mọi tenant | R12 bỏ qua khi có job thành công; chu kỳ 20 phút (người dùng); prompt tối thiểu; S1 tìm cách không gọi model |
| K2 | Chữ/sự kiện hết quota thật khác giả định (rủi ro H1) | Ba tín hiệu R01; mặc định 30 phút khi thiếu `resets_at`; S2 + log R04 để sửa nhanh |
| K3 | Một tài khoản duy nhất → hết quota là Hub (phần agent) ngưng tới giờ reset | Lỗi rõ R08; Dify vẫn chạy (R10); Q1 nhiều tài khoản là việc sau; runbook §8 |
| K4 | Probe chạy đồng thời với job → ghi đè trạng thái | R15 so `updated_at`; khoá advisory theo provider (R11) |
| K5 | Vi phạm điều khoản gói khi dùng subscription phục vụ nhiều khách | Đã ghi ở BA-H §6.8 "cần xác nhận loại gói" — ngoài phạm vi kỹ thuật; nhắc lại ở PRODUCTION-NOTES khi đóng mốc |

## 11. Tranh chấp test
- (không)
