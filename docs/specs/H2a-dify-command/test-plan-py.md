# Test plan · H2a-dify-command · phụ lục Python P28, P30 (qc)

Phụ lục của [`test-plan-cases.md`](test-plan-cases.md) §1.9, §5: ca tối thiểu cho `test_dify_rules.py` (P30, QW-PU). Nguồn: `plan-runtime-dify` §3.2, §3.4, §3.5, §3.7; chữ ký `plan-runtime` §3.1; mã/`reason`: `plan-errors` §2.

## `retry_delay(err_kind, attempt, flags, backoff=BACKOFF)` · P28
`flags = RetryFlags(first_seen, side_effect)` (`plan-runtime` §3.1, ≤ 4 tham số). BACKOFF mặc định `(2, 8)`. `connect` = chưa gửi request (retry kể cả `side_effect`); `first_seen=true` ⇒ `None` mọi `err_kind`; `side_effect` ∧ `err_kind ≠ connect` ⇒ `None`.
| Ca (`err_kind`, `flags`) | Kỳ vọng attempt 1 / 2 / 3 |
|---|---|
| `connect`, `RetryFlags(False, False)` và `RetryFlags(False, True)` | 2.0 / 8.0 / `None` |
| `http_5xx`, `RetryFlags(False, False)` | 2.0 / 8.0 / `None` |
| `read`, `RetryFlags(False, False)` | 2.0 / 8.0 / `None` |
| `http_5xx` hoặc `read`, `RetryFlags(False, True)` | `None` |
| `http_5xx`, `read`, `connect`, `RetryFlags(True, False)` | `None` |
| `http_4xx` (401/403/404, 400, 413, 415, 422, 429), `sse_error`, `finished_failed`, `empty`, `RetryFlags(False, False)` | `None` |
| `backoff=(0.2, 0.8)`, `connect`, `RetryFlags(False, False)` | 0.2 / 0.8 / `None` |

## `map_failure(err_kind, http_status)` · 7 `ErrKind`
| `ErrKind` · status | Kỳ vọng `(code, reason)` |
|---|---|
| `connect` · `None` | `UPSTREAM_ERROR`, `upstream` |
| `http_5xx` · 503 | `UPSTREAM_ERROR`, `upstream` |
| `read` · `None` | `UPSTREAM_ERROR`, `upstream` |
| `http_4xx` · 401 | `NOT_CONFIGURED`, `upstream` (cũng 403, 404) |
| `http_4xx` · 429 | `UPSTREAM_ERROR`, `upstream` (cũng 400, 413, 415, 422) |
| `sse_error` · `None` | `UPSTREAM_ERROR`, `upstream` |
| `finished_failed` · `None` | `UPSTREAM_ERROR`, `upstream` |
| `empty` · `None` | `UPSTREAM_ERROR`, `invalid_output` |

## `usage_row(app_type, usage, latency_ms, feature_id)`
| Ca | Kỳ vọng `(input, output, cost_usd)` |
|---|---|
| workflow, `{total_tokens:30}` | 30, 0, `Decimal(0)` |
| chat, `{prompt_tokens:10, completion_tokens:5, total_price:"0.0012", currency:"USD"}` | 10, 5, `Decimal("0.0012")` |
| chat, `usage=None` | 0, 0, `Decimal(0)` |
| chat, `currency:"RMB"` | 10, 5, `Decimal(0)` |
`latency_ms`, `feature_id` truyền nguyên vào kết quả.

## `reduce(state, event, data)`
| Sự kiện | Kỳ vọng `(state, Step)` |
|---|---|
| `ping` | state không đổi, `None` |
| `node_started` (workflow, `nodes=0`) | `nodes=1`, `first_seen=true`, `Progress(n=1)`; lần 2 → `n=2` |
| `workflow_finished` `status:"failed"` | `Failed("finished_failed")` |
| `message_end` `metadata.usage{…}` (chat) | `usage` lưu vào state, `Finished` |
| `error` (`data{message}`) | `Failed("sse_error")`, `first_seen=true` |
| `text_chunk` `{text:"ab"}` rồi `{text:"c"}` (workflow) · `message` `{answer:"x"}` (chat) | `text` cộng dồn `"abc"` · `"x"`, `first_seen=true`, `None` |
| `workflow_started` `{task_id:"t1"}` | `task_id="t1"`, `first_seen=true`, `None` |
| `workflow_finished` `status:"stopped"` | `Failed("finished_failed")` |
