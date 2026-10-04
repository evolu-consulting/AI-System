# modules/runs — E12–E14, SSE hai stream (HUB-FR-41, HUB-FR-42, HUB-BR-04)

Tạo run + SSE theo contract chat C1 (`@ai/contracts/chat`, C1 plan §2.4–2.5), plan H1 §5.1–5.3, P9/P11/P12, CR-030.

| File | Vai trò |
|---|---|
| `runs.routes.ts` | E12 `POST /conversations/:id/messages` (mount dưới `/conversations`) · E13 `GET /runs/:id/events` · E14 `GET /runs/:id` |
| `runs.service.ts` | `RunService`: E12 transaction `user` (conversations → flows → runs → messages), 409 `FLOW_BUSY`, `run.started`; E13/E14; `RunDriver` (chỗ cắm B8) |
| `runs.repo.ts` | SQL run (lọc `tenant_id`+`user_id`); `finishRun` = `flows FOR UPDATE` → `UPDATE runs … status='running' AND owner=$me` |
| `sse-writer.ts` | `SseWriter` (chủ run, `XADD sse:<id> <seq>-0`, fencing, `finish`), `appendExternal` ("XADD bên ngoài"), `RunRegistry` |
| `sse-reader.ts` | `SseReader` (một kết nối `XREAD BLOCK 1000` multiplex), `runEventStream` (XRANGE → theo dõi → đóng ở sự kiện kết thúc, ping 15 s) |
| `runs.rules.ts` · `run-errors.ts` | thuần: `parseLastEventId`, `eventsExpired`, `leaseExpired`, `queueTimeoutReason` · `runErrorText` (plan-errors) |

Luật:
- Hub ghi duy nhất `sse:<id>`; entry field `e` = JSON `{event, data}`; TTL 24 h khi chạy, 600 s sau kết thúc; `DEL run:<id>` khi kết thúc.
- `run.failed` + `runs.error_*` = `runErrorText(code, runs.locale)` ghi cùng câu; đọc ra (E11/E14/dựng lại) chỉ từ cột.
- E13: 410 chỉ khi `eventsExpired`; DB đã kết thúc (> 2 s) mà stream thiếu sự kiện kết thúc → dựng từ DB + `appendExternal`.
- Chỗ cắm: B7/B8 cài `RunDriver` (`AppDeps.runDriver`); B9 `registry.get(id)?.abort()` + `appendExternal`; B10 lease theo `registry.ids()`.

Phụ thuộc: `@ai/db/hub-scope`, `@ai/db/schema/hub`, `modules/config` (ảnh + locale), `modules/conversations` (service, kiểm sở hữu).
