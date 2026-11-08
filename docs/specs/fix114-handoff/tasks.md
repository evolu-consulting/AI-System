---
id: fix114-handoff
lát: fix114-handoff
cr: CR-114
làn: nhanh (sửa 2 lỗi TB review cuối đợt của hub-agent-handoff)
migration: không
phụ thuộc: hub-agent-handoff (đã merge)
---
## Plan (ngắn)
Review cuối đợt CR-114: (1) `canFetch` = mọi `agentic-cli` ⇒ agent direct-SDK / job `noTools` / job đã đủ `MCP_TOOLS_MAX`
nhận `ref` mà không đọc được; (2) lịch sử bị nén và `<steps>` cũ bị trích 400 ký tự cho CẢ run ⇒ Orchestrator (không MCP),
dify, direct-SDK mất dữ kiện ở lượt cũ.
Sửa: vòng Orchestrator không còn quyết ai đọc được `ref`. Job delegate mang hai bản: nguyên văn (`prompt`/`history`, y như tắt
cờ) và `byRef` (phong bì `ref` + lịch sử nén). Chỉ `JobAgentRunner` — nơi cấp tool — chọn `byRef`, qua `jobVariant(task, mcp)`
dùng chung `artifactToolsGranted(payload.mcp)` (có `artifact-get` sau `withArtifactTools` + `mcpConfigFor`). Runner khác
(direct-SDK, dify) không đọc `byRef`. Orchestrator luôn thấy lịch sử + `<steps>` nguyên văn.

## Làm
- `orchestrator.handoff.ts`: bỏ `canFetch`, `stepsView`, `delegateTask`; thêm `byRefOf`, `byRefJob` (nén lịch sử lười, một lần
  mỗi run, chỉ khi có delegate; lỗi kho ⇒ nguyên văn).
- `orchestrator.loop.ts`: Orchestrator dùng `c.history` + `s.notes`; delegate gửi `prompt=task`, `history`, `historyTotal` như
  tắt cờ + `byRef?`.
- `orchestrator.service.ts`: bỏ `canFetch`/`mcpUrl`.
- `artifact.mcp.ts`: `artifactToolsGranted`, `jobVariant`; `job-agent-runner.ts` `#payload` dùng `jobVariant`;
  `job-agent-runner.types.ts` `AgentTask.byRef?`.

## Không làm / Chạm
Không đổi prompt Orchestrator (giữ tiền tố cache của fast-sdk), không migration, không đụng routing/direct/dify runner.

## Test tối thiểu
unit: `artifact.mcp.test.ts`, `orchestrator.handoff.test.ts`, `handoff.scenario.test.ts`; int: 4 file artifact + H1/H2b
orchestrator/runner trên evotest.

## Quyết định trong lúc làm
- Không tóm tắt bằng model cho người đọc không MCP: họ nhận đúng bản như tắt cờ (lịch sử `history_n` + `<steps>` đầy đủ).
- Với 19 tool workflow, `withArtifactTools` chỉ thêm `artifact-get` (đủ để đọc) ⇒ vẫn `byRef`; 20 ⇒ nguyên văn.
- Bản nguyên văn của delegate = `task` của Orchestrator (như tắt cờ, không tự dán kết quả bước trước); `byRef` thêm `in:[ref]`.
- Test chặn: chỉ `runner/job/job-agent-runner.ts` đọc `byRef`/`jobVariant` (quét nguồn `modules/runner`).
- Số đo kịch bản cố định (Orchestrator dán kết quả bước trước, mọi agent có `artifact-get`): 29046 → 25240 token (−13,1 %),
  trước đây −50,8 % là nhờ nén `<steps>`/lịch sử của Orchestrator — phần đó đã bỏ vì làm mất dữ kiện. Agent không MCP:
  0 % (y hệt tắt cờ).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Ghi chú: `engine/agent-handoff.md` chưa có trong docs/current (Delta ADDED của hub-agent-handoff chưa gộp) ⇒ khối dưới là ADDED cùng file; khi gộp cuối đợt, docs-architect áp khối này SAU khối của hub-agent-handoff (ghi đè hai Yêu cầu cùng tên).

### ADDED engine/agent-handoff.md
#### Yêu cầu: Bàn giao bằng tham chiếu
Chỉ job agent THỰC SỰ được cấp `artifact-get` (job `agentic-cli` qua runner job, có URL `/mcp`, không `noTools`, còn chỗ dưới `MCP_TOOLS_MAX`) nhận phong bì tham chiếu và lịch sử nén; mọi người đọc khác (Orchestrator, dify, direct-SDK, job không tool) nhận đúng như khi tắt cờ.
- Kịch bản: khi job không có artifact-get (noTools, đủ tool, cờ tắt) thì nhận prompt và lịch sử nguyên văn [test: apps/hub-api/src/modules/artifacts/artifact.mcp.test.ts » job có artifact-get ⇒ byRef]
- Kịch bản: khi agent chạy đường direct-SDK hoặc dify thì bản tham chiếu bị bỏ qua [test: apps/hub-api/src/modules/artifacts/artifact.mcp.test.ts » chỉ JobAgentRunner đọc byRef]
- Kịch bản: khi bật bàn giao thì agent không MCP nhận y như tắt cờ [test: apps/hub-api/src/modules/artifacts/handoff.scenario.test.ts » agent không có artifact-get (noTools / direct-SDK / đủ tool) nhận nguyên văn như tắt cờ]
#### Yêu cầu: Nén lịch sử hội thoại dài
Chỉ nén cho job có `artifact-get`; Orchestrator luôn thấy lịch sử và `<steps>` nguyên văn (dữ kiện ở lượt cũ, quá 120 ký tự vẫn còn).
- Kịch bản: khi dữ kiện nằm ở lượt cũ sau ký tự 120 thì Orchestrator vẫn thấy, prompt Orchestrator y như tắt cờ [test: apps/hub-api/src/modules/artifacts/handoff.scenario.test.ts » kịch bản đa agent: giảm token và đủ dữ kiện]

## Việc còn lại
- Báo Orchestrator khi người nhận có `artifact-get` để nó không dán lại kết quả bước trước (cần đổi prompt ⇒ đo lại cache fast-sdk).
