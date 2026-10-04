# Plan · H1 · Câu lỗi `run.failed` (phụ lục plan §6.4, readiness #35)

`runErrorText(code, locale)` trả `{message, hint}` từ bảng tĩnh dưới đây, **nguyên văn** (kể cả dấu chấm). `hint: string`, `""` khi không có (contract chat `hint: z.string().max(CHAT_ERROR_TEXT_MAX)`). Không tham số động, không tên provider/agent/đường dẫn. Mã: `CHAT_RUN_ERROR_CODES` (`packages/contracts/src/chat/errors.ts`).

Nguồn vi: `ALL_PROVIDERS_EXHAUSTED`, `TIMEOUT`, `UPSTREAM_ERROR` = `ERRORS`, `CANCELLED` = `CANCELLED_ERROR` trong `tools/mocks/src/chat/scenarios.ts`; ba mã còn lại viết mới theo BA `ba-agent-hub.md` bảng mã lỗi và `ui-chat-extension.md` §8. en: viết mới cả 7.

| Mã | vi `message` | vi `hint` | en `message` | en `hint` |
|---|---|---|---|---|
| `ALL_PROVIDERS_EXHAUSTED` | Tất cả dịch vụ AI đang quá tải nên chưa trả lời được. | Thử lại sau ít phút. | All AI services are overloaded, so no answer could be produced. | Try again in a few minutes. |
| `TIMEOUT` | Hệ thống phản hồi quá lâu nên yêu cầu đã dừng. | Thử lại sau ít phút. | The system took too long to respond, so the request was stopped. | Try again in a few minutes. |
| `UPSTREAM_ERROR` | Dịch vụ AI trả lỗi khi xử lý yêu cầu. | Thử lại; nếu vẫn lỗi, báo quản trị viên. | The AI service returned an error while processing the request. | Try again; if it still fails, contact your administrator. |
| `CANCELLED` | Bạn đã dừng yêu cầu này. | `""` | You stopped this request. | `""` |
| `BUDGET_EXCEEDED` | Yêu cầu quá lớn để xử lý một lần. | Hãy chia nhỏ yêu cầu rồi gửi lại. | The request is too large to process at once. | Split it into smaller requests and send again. |
| `NOT_CONFIGURED` | Tính năng này chưa được cấu hình xong. | Báo quản trị viên. | This feature isn't fully configured yet. | Contact your administrator. |
| `INTERNAL_ERROR` | Có lỗi khi xử lý yêu cầu. | Thử lại; nếu vẫn lỗi, báo quản trị viên. | Something went wrong processing the request. | Try again; if it still fails, contact your administrator. |

Kỳ vọng test (qc): đủ 7 mã × 2 locale, đúng nguyên văn bảng; `message` không rỗng, ≤ `CHAT_ERROR_TEXT_MAX`; `CANCELLED` → `hint === ""`.

## Ghi vào `runs` (readiness #45)

**Locale của run:** cột `runs.locale text NOT NULL DEFAULT 'vi' CHECK (locale IN ('vi','en'))`, chụp ở E12 bước 3 (`plan` §5.1) từ cache `admin.users.locale` của user gọi (`plan` §4 Cache); không có/không hợp lệ → `'vi'`. Không lấy từ header/JWT: contract chat C1 (`packages/contracts/src/chat/*`) không có trường/header locale, access token chỉ có `sub, tid, role, sid` (`apps/admin-api/src/lib/jwt.ts`); `users.locale` là nguồn Admin dùng (`MeUpdateRequestSchema`). Đổi locale giữa chừng không đổi run đang chạy. Nhãn step Orchestrator (`plan` §6.1) cũng dùng `runs.locale`.

**Luật ghi:** mọi `UPDATE hub.runs` đặt `error_code = $code` ghi **cùng câu** `error_message = $m, error_hint = $h` với `{m, h} = runErrorText($code, locale)`; `locale` đọc cùng dòng ứng viên (không đọc lại sau UPDATE):

| Chỗ | `locale` lấy từ |
|---|---|
| Kết thúc phía chủ `SseWriter` (`plan` §5.2), gồm run lỗi do job `failed`/hết hạn `queued` (§5.6 bước 5 → `ALL_PROVIDERS_EXHAUSTED`), `BUDGET_EXCEEDED`, `NOT_CONFIGURED`, `INTERNAL_ERROR` | bộ nhớ run (chụp lúc E12) |
| E15 (`plan` §5.7) | câu kiểm run của user: `SELECT … , locale FROM hub.runs WHERE id=$1` |
| E9 (`plan` §5.7) | câu lặp run `running` của hội thoại: `SELECT id, flow_id, locale …` |
| Sweeper lease (`plan` §5.8) | ứng viên: `SELECT id, flow_id, locale FROM hub.runs WHERE status='running' AND lease_until < now() LIMIT 20` |
| Dựng lại từ DB (§5.3) | không ghi — chỉ đọc cột |

`hub.jobs` hết hạn `queued` chỉ đặt `jobs.error_code` (không có `runErrorText`); run kết thúc qua dòng đầu bảng. **Runtime (Python) không ghi `hub.runs`** (không GRANT, `plan` §3.4; `plan-db` §5.4–5.5 chỉ `UPDATE hub.jobs`) — Hub là bên duy nhất kết thúc run.

**CHECK** (migration `0000_hub_core.sql`, cùng các CHECK `runs` ở `plan` §3.2): `runs_error_cols_ck CHECK ((error_code IS NULL) = (error_message IS NULL) AND (error_code IS NULL) = (error_hint IS NULL))`. `error_hint` là `''` (không NULL) với `CANCELLED`.

**Đọc ra:** E11 (`RunSummary.error`), E14 (`GET /runs/:id`), E15 và `run.failed` (live + dựng lại §5.3) đều lấy `{code, message, hint}` = `runs.error_code/error_message/error_hint` — **không** gọi lại `runErrorText`; `error_code IS NULL` → `error: null`. SSE và `GET /runs/:id` của cùng run trả cùng giá trị.

Kỳ vọng test (qc, gợi ý): run bị sweeper kết thúc có `error_message`, `error_hint` khớp bảng theo `runs.locale` của run (không theo instance); INSERT/UPDATE vi phạm `runs_error_cols_ck` → 23514.
