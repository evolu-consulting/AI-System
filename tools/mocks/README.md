# tools/mocks

Mock dev/test cho Dify (M0) và Hub (M0 + kênh chat C1). Không dùng ở production.

## Chạy

```sh
bun run mocks                                   # Dify :4010/v1 · Hub :4020
MOCK_FAST=1 bun run mocks                       # chờ ÷10, dùng cho test/e2e
HUB_MOCK_PORT=4021 DIFY_MOCK_PORT=4011 bun run mocks   # instance thứ hai (CHAT-AC-32)
```

Env (`src/env.ts`, trống = mặc định; sai → thoát, nêu tên biến):

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `DIFY_MOCK_PORT` · `HUB_MOCK_PORT` | 4010 · 4020 | cổng |
| `MOCK_TIMEOUT_MS` | 30000 | kịch bản timeout M0 giữ kết nối |
| `MOCK_FAST` | 0 | `1` → chờ ÷10 (trừ nhịp có sàn riêng) |
| `MOCK_FLOW_IDLE_S` | 600 | flow nghỉ quá N giây → tin đầu chạy `flow-cold` |
| `MOCK_EVENTS_RETENTION_S` | 600 | giữ sự kiện run sau khi xong; quá hạn → E13 410 `EVENTS_EXPIRED` |

## Mock chat (`src/chat/`)

Contract: `@ai/contracts/chat`; thiết kế: `docs/specs/C1-chat-ui/plan.md` §2–§3. Dữ liệu trong bộ nhớ, mất khi tắt.

User mẫu — mật khẩu dev chung `dev-password-1` (không phải secret):

| tenant_key | username | Ghi chú |
|---|---|---|
| `acme` | `minh` | có seed 4 hội thoại (e2e chính) |
| `acme` | `lan` · `hoa` | rỗng (test contract user A · B) |
| `acme` | `khoa` | bị khoá → 403 `ACCOUNT_LOCKED` |
| `beta` | `an` | khác tenant (cách ly) |

Kịch bản: thêm tiền tố `#scn:<tên>` vào đầu tin nhắn (tên lạ → `normal`); không có tiền tố → flow nghỉ ⇒ `flow-cold`,
rồi mặc định toàn cục (`/__mock/scenario`), rồi `normal`.

| Tên | Hành vi |
|---|---|
| `normal` | `run.started` → 30 delta → `run.finished` |
| `markdown` | như `normal`, nội dung có tiêu đề, danh sách, bảng, code |
| `steps` | 2 bước (`step.started`/`step.finished`) rồi trả lời |
| `ask` | sự kiện `ask` (câu hỏi + lựa chọn) |
| `slow` | 60 delta mỗi 250 ms (fast: 100 ms) — để thử Dừng |
| `err-exhausted` · `err-timeout` · `err-upstream` | `run.failed` `ALL_PROVIDERS_EXHAUSTED` · `TIMEOUT` · `UPSTREAM_ERROR` |
| `drop` | 30 delta × 100 ms; stream E12 đóng sau delta thứ 5, run chạy tiếp → nối lại bằng E13 `Last-Event-ID` |
| `flow-cold` | chờ 3 s (fast: 1 s) trước `run.started` |
| `quota-warn` · `quota-over` | `normal` với quota 85 % · 104 % |

Điều khiển (không auth, chỉ mock; trạng thái toàn cục → test dùng phải chạy tuần tự):

| Endpoint | Tác dụng |
|---|---|
| `GET /__mock/ping` | 204 — test contract dùng để bật ca chỉ-mock |
| `POST /__mock/reset` | xoá store, run, phiên; nạp lại seed; mặc định = `normal` |
| `POST /__mock/scenario` `{"name": string \| null}` | đặt kịch bản mặc định; tên lạ → 400 |
| `POST /__mock/expire-access` | access token cấp trước đó → 401 `AUTH_EXPIRED` |

Giới hạn bộ nhớ: ≤ 500 run (bỏ run đã xong cũ nhất), ≤ 5.000 sự kiện/run (vượt → `run.failed INTERNAL_ERROR`).

## Test

```sh
bun test tools/mocks                            # unit
bun run test:contract:chat                      # contract, tự dựng mock trong tiến trình
HUB_URL=http://localhost:4021 bun run test:contract:chat   # contract với mock đang chạy (CHAT-AC-32)
```
