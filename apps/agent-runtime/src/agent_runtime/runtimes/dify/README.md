# runtimes/dify/ — runtime `workflow.async`: gọi Dify thay user (plan-runtime §3, plan-runtime-dify)

| File | Nội dung |
|---|---|
| `stream.py` | (thuần) `StreamState`, `reduce(state, event, data)` → `Progress`/`Finished`/`Failed`/None (workflow, chat, agent; `first_seen` cho mọi sự kiện ≠ `ping`), `final_text` (= `finalText` TS); text nối dừng ở `OUTPUT_MAX` = 64 000 (phần thừa chỉ đếm `dropped`) |
| `policy.py` | (thuần) `ErrKind`, `BACKOFF`, `RetryFlags`, `retry_delay` (§3.4, Q6), `map_failure` (R11 = `plan-errors` §2), `usage_row` (R15, `cost_usd` Decimal chỉ khi USD), `mask` (che key thô / base64 ± padding / base64url ± padding / hex / percent-encoded trước, cắt sau) |
| `client.py` | `DifyClient` (httpx2, một `AsyncClient` mỗi lần claim job — mở trong `DifyRun.execute`; proxy theo env, loopback bỏ proxy): `run_stream(cred, req)` → `DifyEvent(event, data)` (SSE `EventSource`), `stop(cred, task_id, user)` best-effort; `DifyHTTPError` (thân đã `mask`), `classify(exc)` → `ErrKind` |
| `credential.py` | `fetch_credential(client, hub_url, job_id, token)` → `DifyCredential` (`repr` che key) \| `CredentialError(retryable, http_status)`; `make_hub_client` (`trust_env=False` — Hub nội bộ, token không qua proxy), `NO_PROXY_MOUNTS` (loopback bỏ proxy) |
| `progress.py` | `Throttle`: `job.progress` ≤ 1/giây, giữ tin mới nhất (tin đến lúc đang XADD phát ở lượt sau); `close(flush)` phát nốt tin chờ trước XADD kết thúc (`flush=False` khi `lost`/`shutdown`) |
| `job_run.py` | `DifyRun` một lần claim: credential (§3.3) → `mark_dispatched` (Q6, rào `token_hash`) → vòng thử → `Outcome` |
| `host.py` | `DifyJobHost.run`: `asyncio.timeout(timeout_s)` (`JobTimedOut` chỉ khi deadline này hết — `TimeoutError` khác → `INTERNAL_ERROR`/`crash`), huỷ/lost/shutdown, "Kết thúc" rào `token_hash` |

 Mock HTTP: `tests/support/dify_mock.py` (Dify + credential Hub).
Import-linter: không import `providers`, `sandbox`, `runtimes.cli`. Không log token/app-key.
