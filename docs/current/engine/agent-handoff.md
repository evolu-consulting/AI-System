# Engine · Bàn giao kết quả agent bằng tham chiếu (artifact)

Cập nhật: 2026-11-09 · Nguồn: hub-agent-handoff, fix114-handoff, fix114-handoff2. Code: `apps/hub-api/src/modules/artifacts/`, `modules/orchestrator/` (khối `<handoff>`), `modules/runner/routing-runner`. Lát sau thắng lát trước khi cùng tên Yêu cầu.

#### Yêu cầu: Kho artifact theo nội dung (nguồn: hub-agent-handoff)
Kết quả một bước (text/JSON) lưu một lần trong `hub.artifacts` của tenant, khoá sha256 nội dung (khoá ngắn 8 ký tự), có TTL; ghi lại cùng nội dung không tạo bản mới. Vòng dọn xoá bản hết hạn theo lô, hai Hub dọn cùng lúc không xoá trùng. `hub.artifacts` và `hub.artifact_runs` (migration 0084) bật RLS, mỗi bảng một policy tenant chỉ cho `hub_rw` (nguồn: fix114-handoff2).

#### Yêu cầu: Bàn giao bằng tham chiếu (nguồn: hub-agent-handoff, fix114-handoff)
Nội dung < 300 token vẫn dán thẳng; từ 300 token thành phong bì `{g,in:[art:…],sum,c,o,b}`. Agent lấy phần cần bằng MCP `artifact-get(key, range)` / `artifact-search(query)`; token job chỉ đọc được artifact cùng tenant và cùng run (hai run cùng nội dung đều đọc được; run thứ ba không link thì không), và chỉ khi `payload.mcp.tools` có tool artifact; tenant khác nhận "không tìm thấy".
Chỉ job agent THỰC SỰ được cấp `artifact-get` (job `agentic-cli` qua runner job, có URL `/mcp`, không `noTools`, còn chỗ dưới `MCP_TOOLS_MAX`) nhận phong bì và lịch sử nén; mọi người đọc khác (Orchestrator, dify, direct-SDK, job không tool) nhận đúng như khi tắt cờ.

#### Yêu cầu: Orchestrator không chép lại kết quả cho agent nhận tham chiếu (nguồn: fix114-handoff2)
Khi đã có kết quả bước lưu thành artifact, prompt Orchestrator có khối `<handoff>` (sau breakpoint cache) liệt kê agent mà job sẽ nhận `artifact-get` cùng khoá + tóm tắt; Orchestrator chỉ ghi khoá + tóm tắt cho các agent đó, agent khác chép như thường. Runner dify/direct-SDK không báo là nhận tham chiếu. Lệch lúc chạy (báo nhận nhưng job không có `artifact-get`) ⇒ bản nguyên văn tự đính kèm toàn văn.

#### Yêu cầu: Nén lịch sử hội thoại dài (nguồn: hub-agent-handoff, fix114-handoff)
Quá N lượt: lượt cũ thành một mục tóm tắt kèm khoá artifact, N lượt cuối giữ nguyên văn. Chỉ nén cho job có `artifact-get`; Orchestrator luôn thấy lịch sử và `<steps>` nguyên văn (dữ kiện ở lượt cũ vẫn còn). Kịch bản đa agent cố định: token giảm, bên nhận đủ 7/7 dữ kiện.
