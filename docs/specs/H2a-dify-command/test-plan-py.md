# Test plan · H2a-dify-command · phụ lục Python P30 (qc)

Phụ lục của [`test-plan-cases.md`](test-plan-cases.md) §5: ca tối thiểu cho `test_dify_rules.py` (P30, QW-PU). Nguồn: `plan-runtime-dify` §3.2, §3.4, §3.5, §3.7; chữ ký `plan-runtime` §3.1; mã/`reason`: `plan-errors` §2.

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
