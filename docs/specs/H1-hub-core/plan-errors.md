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
