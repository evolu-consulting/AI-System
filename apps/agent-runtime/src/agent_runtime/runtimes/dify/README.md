# runtimes/dify/ — runtime `workflow.async`: gọi Dify thay user (plan-runtime §3, plan-runtime-dify)

| File | Nội dung |
|---|---|
| `stream.py` | (thuần) `StreamState`, `reduce(state, event, data)` → `Progress`/`Finished`/`Failed`/None (workflow, chat, agent; `first_seen` cho mọi sự kiện ≠ `ping`), `final_text` (= `finalText` TS) |
| `policy.py` | (thuần) `ErrKind`, `BACKOFF`, `RetryFlags`, `retry_delay` (§3.4, Q6), `map_failure` (R11 = `plan-errors` §2), `usage_row` (R15, `cost_usd` Decimal chỉ khi USD), `mask` (che key thô/base64/hex trước, cắt sau) |
| `client.py` | `DifyClient` (httpx2, một `AsyncClient`/process): `run_stream(cred, req)` → `DifyEvent(event, data)` (SSE `EventSource`), `stop(cred, task_id, user)` best-effort; `DifyHTTPError` (thân đã `mask`), `classify(exc)` → `ErrKind` |
| `credential.py` | `fetch_credential(client, hub_url, job_id, token)` → `DifyCredential` (`repr` che key) \| `CredentialError(retryable, http_status)`; `make_hub_client`, `NO_PROXY_MOUNTS` (loopback bỏ proxy) |

Còn: `host.py` `DifyJobHost` (PY-03). Mock HTTP: `tests/support/dify_mock.py` (Dify + credential Hub).
Import-linter: không import `providers`, `sandbox`, `runtimes.cli`. Không log token/app-key.
