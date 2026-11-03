---
id: fix114-handoff2
lát: fix114-handoff2
cr: CR-114
làn: nhanh
migration: không
phụ thuộc: fix114-handoff (đã merge 4c5678bf)
---
## Plan (ngắn)
Lấy lại mức tiết kiệm mà không mất dữ kiện: Orchestrator KHÔNG chép lại kết quả bước trước khi delegate cho agent nhận được
tham chiếu, chỉ ghi `art:…` + tóm tắt 1–2 dòng; agent khác vẫn nhận nguyên văn.
- `AgentRunner.artifactAccess?(task)`: `JobAgentRunner` = `artifactToolsGranted((await #mcp(task)).mcp)` — đúng đường cấp
  tool và đúng vị từ mà `jobVariant` dùng lúc chạy; `RoutingRunner`: dify / direct-SDK ⇒ false (cùng luật chọn đường của
  `run`), còn lại hỏi runner job; `HookedRunner` chuyển tiếp.
- Driver Orchestrator (`handoffOf.refAgents`): thăm dò các agent hiển thị bằng task delegate của run (agent, files, snapshot),
  lười — chỉ khi đã có kết quả bước lưu thành artifact, một lần mỗi run.
- Prompt Orchestrator: khối `<handoff>` (`{agents, refs:[{agent,ref,sum}]}` + `HANDOFF_RULE`) ngay trước `<message>` — trong
  lượt user, SAU breakpoint cache cuối; system prompt không đổi; không có kết quả lưu / không agent nhận ⇒ không khối (prompt y
  như trước).
- Lưới an toàn: agent đã được báo nhận tham chiếu mà lúc chạy job lại không có `artifact-get` ⇒ bản nguyên văn (`fullPrompt`)
  tự đính kèm toàn văn kết quả bước trước.

## Làm
`runner/job/job-agent-runner{,.types}.ts`, `runner/routing-runner.ts`, `agent-hooks/hooked-runner.ts`,
`orchestrator/orchestrator.{handoff,loop,prompt,service}.ts`, test `handoff.scenario`, `orchestrator.handoff`, `routing-runner`.

## Không làm / Chạm
Không đổi system prompt Orchestrator / `prompt-cache.ts`; không migration.

## Test tối thiểu
unit orchestrator/artifacts/runner/mcp/ai-client/agent-hooks (gồm `prompt-cache.test.ts` byte-stable); int 4 file artifact +
H1/H2b orchestrator/runner trên evotest.

## Quyết định trong lúc làm
- Đếm token = prompt dựng cho mọi job + lịch sử + đầu ra quyết định của Orchestrator (phần chép lại là token ra, đắt nhất).
- Số đo (kịch bản cố định, 24 lượt lịch sử, researcher(partial) → analyst → writer → answer, mọi agent có `artifact-get`):
  **tắt cờ 32179 → bật 22639 token (−29,6 %)**; 7/7 dữ kiện tới writer (prompt/lịch sử + `artifact-get`),
  analyst đủ 3/3 dữ kiện nghiên cứu; prompt Orchestrator bỏ khối `<handoff>` thì y hệt khi tắt cờ. Agent không MCP: 0 % (y
  hệt tắt cờ). (Số −50,8 % lần đầu có nén `<steps>`/lịch sử của Orchestrator — đã bỏ vì mất dữ kiện.)
- `packages/db/src/hub-rls.int.test.ts` (không khoá) đỏ mới sau 0084: thêm `artifacts`, `artifact_runs` vào `LATER_POLICY_TABLES` (hành vi đúng: 2 bảng RLS mới, 1 policy `hub_rw` mỗi bảng).
- Thăm dò `artifactAccess` gọi `#mcp` (catalog từ cache, gate quyền, KH khi là job stage — delegate chat thì không) cho mỗi
  agent hiển thị, một lần mỗi run và chỉ sau khi có artifact; lỗi ⇒ coi như không nhận (Orchestrator chép như cũ).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Ghi chú: `engine/agent-handoff.md` chưa có trong docs/current (Delta của hub-agent-handoff, fix114-handoff chưa gộp) ⇒ khối
dưới là ADDED cùng file; khi gộp áp SAU hai lát trên (ghi đè Yêu cầu cùng tên).

### ADDED engine/agent-handoff.md
#### Yêu cầu: Orchestrator không chép lại kết quả cho agent nhận tham chiếu
Khi đã có kết quả bước lưu thành artifact, prompt Orchestrator có khối `<handoff>` (sau breakpoint cache) liệt kê agent mà job sẽ nhận `artifact-get` và khoá + tóm tắt các kết quả; Orchestrator chỉ ghi khoá + tóm tắt cho các agent đó, agent khác chép như thường. Lệch lúc chạy ⇒ bản nguyên văn tự đính kèm toàn văn.
- Kịch bản: khi có kết quả lưu và agent nhận tham chiếu thì khối handoff nằm ngay trước message, phần trước giữ nguyên byte [test: apps/hub-api/src/modules/orchestrator/orchestrator.handoff.test.ts » khối <handoff>]
- Kịch bản: khi agent đi dify hoặc direct-SDK thì không được báo là nhận tham chiếu [test: apps/hub-api/src/modules/runner/routing-runner.test.ts » artifactAccess: dify / direct-SDK ⇒ false]
- Kịch bản: khi runner báo nhận tham chiếu nhưng job không có artifact-get thì agent vẫn nhận toàn văn [test: apps/hub-api/src/modules/artifacts/handoff.scenario.test.ts » runner báo nhận tham chiếu nhưng lúc chạy job không có artifact-get]
- Kịch bản: khi chạy kịch bản đa agent cố định thì token giảm và writer tới được 7/7 dữ kiện [test: apps/hub-api/src/modules/artifacts/handoff.scenario.test.ts » kịch bản đa agent: giảm token và đủ dữ kiện]

#### Yêu cầu: RLS trên bảng artifact
Bảng `hub.artifacts` và `hub.artifact_runs` (0084) bật RLS, mỗi bảng một policy tenant chỉ cho `hub_rw`.
- Kịch bản: khi liệt kê bảng hub có RLS thì có artifacts và artifact_runs với policy chỉ cho hub_rw [test: packages/db/src/hub-rls.int.test.ts » RLS bật trên đúng 5 bảng hội thoại]

## Việc còn lại
