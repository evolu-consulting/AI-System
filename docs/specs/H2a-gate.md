# Gate H2a — Dify + command `/` + MCP

Ngày: 2026-10-05 · Trạng thái: **ĐÃ DUYỆT 2026-10-05** (người dùng: "duyệt"; Dify thật lấy cấu hình từ `D:AIevoluconsultinguto-pilot`) · Readiness: READY (`H2a-dify-command/readiness.md`, 4 lần)

**Không tự duyệt (Luật 2b):** có ADR thư viện mới (ADR-0010) và một quyết định của người dùng được thực hiện theo cách khác (Q1). Người dùng đã chốt Q1/Q3/Q5 và Codex/Gemini để sau (`spec-decisions.md`).

## 1. Phạm vi (`H2a-dify-command/spec.md` §1)
- **Command `/`:** `GET /commands` (chỉ lệnh user được dùng, HUB-FR-76), parser (`"…"`, `rest`, `default`, `fallback $selection`, `//`), `CMD_NOT_FOUND` kèm ≤ 3 gợi ý, `CMD_MISSING_ARG`.
- **Command Runner:** sync → gọi Dify streaming, stream về chat; async → job `workflow.async` cho Agent Runtime (retry 2 s/8 s chỉ lỗi mạng/5xx trước sự kiện đầu, requeue khi Runtime chết, huỷ gọi `stop` Dify). Bẫy "HTTP 200 nhưng `status=failed`" xử lý thành lỗi.
- **Agent `dify-workflow`/`dify-agent`** qua `AgentRunner`.
- **MCP `/mcp`:** workflow gắn cho agent thành tool (tên = key workflow, CR-035); token riêng mỗi job, Runtime sinh lúc claim, DB chỉ lưu hash; hỗ trợ cả bản MCP 2026-07-28.
- **Xác nhận tool có tác dụng phụ** (HUB-FR-95): chưa xác nhận thì Dify **không** được gọi; đã gửi thì không retry.
- **`/internal/test-run`** (service token) cho nút Test của Admin M5; endpoint nội bộ cấp credential Dify cho Runtime bằng token job (Q5).
- Usage Dify (`billing=dify`), `user=<tenant>:<user_id>`.
- **Không làm:** `@agent`, Orchestrator theo tenant, giới hạn run/user, stream trực tiếp (→ H2b); đính kèm (→ H2c); Model Gateway/`llm`/`python`/Codex/Gemini (→ H2d); quota (→ H3).

## 2. Cần bạn duyệt
| Mục | Nội dung |
|---|---|
| **ADR-0010** | Agent Runtime khai báo trực tiếp `httpx2` (gọi Dify, SSE, mock transport). Đã có sẵn trong `uv.lock` (do `claude-agent-sdk` kéo theo) — không thêm gói mới |
| **Q1 làm khác cách đã chọn** | Bạn chọn "cho `hub_ro` đọc cột bản mã secret". Thực hiện bằng **hàm `hub.workflow_secret(workflow_id)` SECURITY DEFINER** (chỉ `hub_ro` gọi được, chỉ trả secret gắn workflow) — hẹp hơn GRANT cột, và GRANT cột sẽ làm đỏ test khoá Admin M2 `db-rls` (CR-035) |
| **Q3 (contract chat, sửa thẳng)** | Chỉ **thêm**: `GET /commands`, trường `context` tuỳ chọn, mã lỗi `CMD_*` ở hằng mới `CHAT_COMMAND_ERRORS` (không chèn vào danh sách 6 mã cũ để test chat không đỏ). Không sửa `apps/chat-web`, không sửa test khoá C1 |

## 3. Contract / dữ liệu
`plan.md` §2 (contract chat thêm, hub `workflow.async`, nội bộ), `plan-db.md` (migration `0002_h2a_dify.sql`: `jobs.token_hash/queued_at/dispatched_at`, provider `dify`, `tool_confirmations` RLS, hàm `workflow_secret`/`log_dify_usage`), `plan-errors.md` (mã lỗi, ánh xạ lỗi Dify), `plan-rules.md` (hàm thuần cho qc).

## 4. Test (`test-plan.md`, `test-plan-cases.md`, `test-plan-py.md`)
~197 ca mới: hàm thuần TS 78 (quyền command chạy đối chiếu bản Hub và bản Admin), int hub-api ~83, Python ~30, stack 3, perf 3; chạy lại test khoá C1, M1–M4, H1. Khoá 3 đợt: Q2 (TS) → Q-PU (unit Python, trước PY-01) → Q3 (Python/stack). Lệnh xong `done:h2a` (kế thừa `done:h1`). Mock Dify riêng cho Hub và cho Python; Dify thật (`DIFY_LIVE=1`) và MCP với Claude CLI thật làm thủ công.

## 5. Rủi ro / phụ thuộc
- **Spike PY-S1 (MCP với Claude CLI thật trong WSL):** nếu không truyền được token MCP bằng file (chỉ qua argv) → PY-04 `blocked`, báo bạn (không tự chấp nhận lộ token qua `/proc`).
- **Combine:** Admin — cột `workflows.side_effect` (tạm lấy từ seed), gọi `/internal/test-run` cho M5, rà hàm `hub.workflow_secret`; Chat — menu `/`, gửi `context`, hiện lỗi `CMD_*`. Production: `/internal/*`, `/mcp` phải đi TLS/mạng nội bộ khi Runtime ở máy khác.
- Dify thật chưa có: smoke `DIFY_LIVE` chờ, không chặn mốc.

## 6. Thứ tự BUILD sau duyệt
Tiền đề (tách `job_run.py` PY-00, spike PY-S1, mock MK) ∥ C1/D1 → B0 stub → qc QW (TS) → Q2 khoá → QW-PU → Q-PU → BUILD B*/PY-01…02 → QW-P → Q3 → PY-03…06 → `done:h2a` → review (≤ 2 vòng) → docs. Trên `main`, không push.
