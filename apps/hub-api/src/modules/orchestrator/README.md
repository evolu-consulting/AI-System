# modules/orchestrator — vòng Orchestrator (HUB-FR-20, 21, 27, 28, 29 · CR-025)

Mọi tin qua Orchestrator (plan H1 §6): job Orchestrator → `delegate|answer|ask`; delegate → kiểm quyền → job agent → `done|partial|need_input`.

| File | Vai trò |
|---|---|
| `orchestrator.rules.ts` | thuần §6.4: `parseDecision`, `budgetExceeded`, `budgetOutcome`, `canPassThrough`, `chunkText` |
| `orchestrator.prompt.ts` | thuần §6.2–6.3: khối `<agents>…<message>` (JSON, `<` thoát `<`), khối định dạng, câu nhắc thử lại |
| `orchestrator.loop.ts` | `runLoop(io, input) → LoopEnd` (I/O tiêm: `job`, `skip`) — budget, thử lại JSON cùng step, skipped, pass-through, need_input |
| `orchestrator.repo.ts` | `flows.agent_id/pending_ask`, `history_n` tin của flow (trừ run hiện tại), `run_steps` `skipped` (qua `lib/run-steps.ts` `insertStep`, `seq` do DB cấp — H2a P11) |
| `orchestrator.service.ts` | `orchestratorDriver` = `RunDriver` mặc định (`app.ts`): dựng input từ ảnh run + flow, chạy job qua `runJob` (B7), cắt `delta` (P6), `writer.finish` |

H2b: driver dùng `ctx.orchestrator` (bản Orchestrator của tenant hoặc mặc định, chốt lúc tạo run — `agent`, `max_steps`, `token_budget`, `history_n`; không chọn lại giữa run); run nhiều tag ⇒ `ctx.scope` (`onlyKeys`) thu hẹp `<agents>` + `canDelegate` (ngoài tập → `skipped not_allowed`), step Orchestrator `detail.scope`. Stream: job Orchestrator `payload.stream` (`answer`), `DeltaSink` (`modules/stream`) phát `delta` khi job còn chạy; kết thúc đối chiếu `reconcileStream` (đã phát thì không thử lại JSON hỏng — `stream_unparsed`).

Luật chính: `max_steps` chặn mọi step (Orchestrator, delegate, skipped); `token_budget` (in + out mọi job) kiểm trước mỗi lần gọi Orchestrator. JSON hỏng → gọi lại 1 lần cùng `run_steps.id` (`reopen`) kèm câu nhắc; vẫn hỏng → `UPSTREAM_ERROR`. `need_input` / `ask` → `delta` = câu hỏi + SSE `ask`; `flows.agent_id` = agent khi pass-through hoặc `need_input`, còn lại giữ. Step `skipped` không phát SSE (E11 chỉ tóm tắt `ok/failed`). Nhãn step tĩnh theo locale (runner), không lộ agent/provider.

Phụ thuộc: `modules/runner` (`runJob`, `AgentRunner`), `modules/runs` (kiểu `RunDriver`, `SseWriter`), `modules/agents` (quyền), `modules/config` (kiểu ảnh).
