# Plan · H2b · Mã lỗi, HTTP, câu chữ, trace (phụ lục `plan.md`)

Câu **nguyên văn** (kể cả dấu chấm). Không tham số động, không tên agent/provider/model trong câu lỗi (H1-R26). Không thêm mã `run.failed` (T14) — `runErrorText` 7 mã H1 giữ nguyên.

## 1. HTTP E12 · GET `/agents` (`lib/errors.ts`, `ERROR_MESSAGES` tiếng Anh, client dịch theo `code`)
| Mã | HTTP | `message` | `details` | Header | Khi nào (thứ tự R18) |
|---|---|---|---|---|---|
| `VALIDATION_ERROR` | 400 | Invalid request | issues (H1) | — | body sai |
| `CMD_NOT_FOUND` / `CMD_MISSING_ARG` (lệnh `/`) | 404 / 422 | như H2a | như H2a | — | router `/` |
| `AGENT_NOT_FOUND` | 404 | Agent not found | `{suggestions: string[]}` (luôn có, ≤ 3, có thể `[]`; key không `@`) | — | router `@`: tag sai đầu tiên (R02) · `@` trơn đầu tin (`[]`) |
| `CMD_MISSING_ARG` (tag rỗng) | 422 | Missing or invalid command argument | `{missing: ["content"], invalid: []}` | — | router `@`: mọi tag hợp lệ, nội dung rỗng (R04) |
| `NOT_FOUND` | 404 | Not found | — | — | hội thoại / flow lạ |
| `FLOW_BUSY` | 409 | Flow is busy | — | — | flow có run `running` (thắng 429) |
| `TOO_MANY_RUNS` | 429 | Too many running requests | — (không key `details`) | `Retry-After: 5` | `countRunning ≥ HUB_MAX_CONCURRENT_RUNS` |
| `AUTH_EXPIRED` | 401 | Session expired | — | — | JWT (trước mọi thứ) |

Thứ tự kiểm `@`: `empty_tag` → tag sai đầu tiên → nội dung rỗng. Ví dụ `@sai` (không nội dung) → `AGENT_NOT_FOUND` (tag kiểm trước); `@` → `AGENT_NOT_FOUND{[]}`.

## 2. Câu chữ theo `runs.locale`
| Chỗ | vi | en |
|---|---|---|
| `PARTIAL_PREFIX` (R07, `directText`; nối sau `"\n\n"`) | `Phần chưa làm được: ` | `Not done yet: ` |
| Hint `UPSTREAM_ERROR` + reason `refused` (R27, `runErrorTextFor`; `message` giữ câu `UPSTREAM_ERROR` H1) | `Yêu cầu chưa xử lý được — hãy diễn đạt lại hoặc chia nhỏ.` | `The request could not be handled — rephrase or split it.` |
| Nhãn step `delegate` của run `direct` | nhãn tĩnh H1 `step.delegate` (không tên agent) | như vi H1 |

## 3. Trace + log (không nội dung tin/câu trả lời, HUB-NFR-04)
| Sự kiện | `run_steps.detail` (step đã stream) | Log |
|---|---|---|
| R23 lệch tiền tố | `stream: "delta_mismatch"`, `streamed_len`, `final_len` | `warn run-delta-mismatch {run_id, step_id}` |
| R23 JSON cuối hỏng sau khi phát (Orchestrator `parseDecision` lỗi; agent `job.failed reason=invalid_output`) | `stream: "stream_unparsed"` | `warn run-stream-unparsed {run_id, step_id}` |
| P11 `seq` hở | `stream: "delta_gap"`, `seq_expected`, `seq_seen` | `warn run-delta-gap {run_id, job_id}` |
| R09 thu hẹp | step `orchestrator`: `scope: [keys]` | — |
| R14 bản tenant hỏng | — | `warn orchestrator_tenant_invalid {run_id, tenant_id, agent_id}` |
| R13 seed tenant lạ | — | `warn seed-orchestrator-tenant-unknown {tenant_key}` |
| 429 | — | `info run-limit {tenant_id, user_id, running, limit}` |

## 4. F4 phân loại `is_error` 0 token (Runtime, `plan-runtime` §4) → Hub
| Mẫu (≤ 300 ký tự đầu chữ result, không phân biệt hoa) | `job.failed.code` | `reason` | `provider_state` | `run.failed` |
|---|---|---|---|---|
| `usage limit` · `rate limit` · `\b429\b` (= `RATE_RE` H1) | `ALL_PROVIDERS_EXHAUSTED` | `quota` | `cooldown` (giờ reset hoặc +30 phút, H1-R24) | `ALL_PROVIDERS_EXHAUSTED` |
| `/login` · `not logged in` · `invalid api key` · `oauth token` · `\b401\b` · `\b403\b` | `NOT_CONFIGURED` | `credential` | `logged_out` | `NOT_CONFIGURED` |
| còn lại | `UPSTREAM_ERROR` | `refused` | không đổi | `UPSTREAM_ERROR` + hint §2 |
`is_error` có output token > 0 → như H1 (`UPSTREAM_ERROR`, reason `null`). Chữ result chỉ vào trace job (đã che, ≤ 300) — không vào `run.failed`.
