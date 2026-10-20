---
slice: ai-sub
lane: nhanh (không chạm RLS/quyền/tiền thật; usage ghi qua hàm SECURITY DEFINER mới — đọc kỹ ở review cuối đợt)
decision: người dùng 2026-10-20 — AI của gói contracts chạy trên GÓI Claude (Claude Code CLI), không khoá API
---
# ai-sub · AI chạy trên gói Claude

## Hiện trạng (bản đồ, trước lát)
- **Gói qua worker (đã có):** hub-api `JobAgentRunner` → `INSERT hub.jobs` (`agent.cli`) + `pg_notify('job_enqueued')` → agent-runtime
  (Python, systemd `ai-worker`, user `worker`/`aisys`) claim `FOR UPDATE SKIP LOCKED` → tiến trình con → `claude_agent_sdk` spawn CLI
  `claude` (đăng nhập = `~/.claude` của HOME user worker; env con chỉ HOME/PATH/…, KHÔNG `CLAUDE_CONFIG_DIR`) → usage ghi
  `hub.usage_logs` billing `subscription` trong tx kết thúc job → sự kiện Redis `run:<id>`. Mọi job gắn run/step/conversation/agent
  (cột NOT NULL + FK) ⇒ không có job "một lượt hoàn thành" dùng lại được cho lời gọi trực tiếp.
- **Trợ lý `mgmt-assistant` (b):** đã đi đường worker trên profile Studio `claude-sub-1` (seed `$HUB_SEED_PROFILE`: trống ⇒ `fake-1`
  ở dev/test, `claude-sub-1` ngoài ra). Usage = dòng `subscription` của runtime, Hub gắn `feature='chat'` ⇒ tính vào trần tenant.
- **AI client chung (a, c):** `lib/ai-client` chỉ có `anthropicProvider` (khoá API), ghi `hub.log_ai_usage` cứng billing `api`.

## Làm trong lát
- `claude-cli.provider.ts`: `ModelProvider` gói = MỘT lượt `claude -p --output-format json --max-turns 1 --tools "" --strict-mcp-config
  --setting-sources "" --disable-slash-commands --no-session-persistence`, lời nhắc qua stdin, trần output = token được cấp
  (`CLAUDE_CODE_MAX_OUTPUT_TOKENS`), env con danh sách trắng (không lọt `ANTHROPIC_API_KEY`), giới hạn chạy cùng lúc, chưa đăng
  nhập ⇒ `UNAVAILABLE`. Seam `CliRun` (test dùng runner giả).
- `ai-client.ts`: provider có `billing`; dòng usage mang billing (gói ⇒ chi phí 0, vẫn giữ chỗ/qua trần); provider chọn theo `feature`.
- `ai-client.env.ts`: `AI_PROVIDER` = `subscription` (mặc định ngoài test) | `api` | `off`; ghi đè `AI_PROVIDER_KNOWLEDGE_RERANK`,
  `AI_PROVIDER_KNOWLEDGE_GRAPH`, `AI_PROVIDER_CONTRACTS_EXTRACT`; `AI_SUB_CLI_PATH`, `AI_SUB_CLAUDE_CONFIG_DIR`,
  `AI_SUB_MAX_CONCURRENCY`. Test (`APP_ENV`/`NODE_ENV=test`) mặc định `off`.
- Migration hub **0044_ai_sub_billing**: `hub.log_ai_usage_billed(..., p_billing)` chỉ nhận `api|subscription` (giữ hàm cũ).
- Eval N4 (d): rerank theo `AI_PROVIDER`, chấm `EVAL_JUDGE` = `subscription` (mặc định) | `api` | `offline`; FTS không cần OpenAI.
  Biến thể `embedding*` VẪN cần `OPENAI_API_KEY` (gói Claude không có API embedding) ⇒ giữ FTS(+rerank) làm đường chính.

## Quyết định trong lúc làm
- Lời gọi trực tiếp (trích HĐ, rerank, đồ thị) chạy CLI **trong hub-api**, không qua hàng đợi worker: job worker bắt buộc
  run/conversation/agent (NOT NULL + FK) và kết quả đi qua `run:<id>`; thêm loại job mới = đổi bảng lõi + runtime Python (rủi ro cao,
  quá ½ ngày). Dùng lại đúng cách worker gọi CLI (một lượt, không tool, env trắng) + cùng provider key `claude-sub`.
- Trợ lý chat giữ đường worker + profile Studio (chọn gói/API ở Studio bằng profile của agent `mgmt-assistant`); không đổi code.
- Gói: `cost_usd = 0` (như dòng runtime), token vẫn tính vào `AI_TENANT_DAILY_TOKENS`.
- Huỷ giữa lượt CLI ⇒ không có usage một phần (CLI chỉ báo usage khi xong); chỗ giữ vẫn được trả.

## BƯỚC NGƯỜI DÙNG LÀM MỘT LẦN — đăng nhập gói (agent KHÔNG làm)
evotest: **không cần** (test chỉ dùng runner giả; `AI_PROVIDER` mặc định `off` khi test). Làm trên máy chạy `ai-hub-api` + `ai-worker`
(staging/production, user dịch vụ `aisys` theo `docs/guides/deploy.md`):
1. Đăng nhập gói cho hub-api (một thư mục cấu hình riêng):
   ```bash
   sudo -u aisys -H env CLAUDE_CONFIG_DIR=/home/aisys/.ai-system-claude-hub /home/aisys/.local/bin/claude
   #   trong CLI gõ  /login  → chọn "Claude account with subscription" → mở link trên trình duyệt, dán mã → /exit
   sudo -u aisys -H env CLAUDE_CONFIG_DIR=/home/aisys/.ai-system-claude-hub /home/aisys/.local/bin/claude auth status
   #   phải báo đã đăng nhập bằng tài khoản gói (không dán token vào chat/log)
   ```
2. Thêm vào `/etc/ai-system.env` rồi `sudo systemctl restart ai-hub-api`:
   ```
   AI_PROVIDER=subscription
   AI_SUB_CLI_PATH=/home/aisys/.local/bin/claude
   AI_SUB_CLAUDE_CONFIG_DIR=/home/aisys/.ai-system-claude-hub
   ```
   (Không cần `ANTHROPIC_API_KEY`; muốn một tính năng dùng API: `AI_PROVIDER_CONTRACTS_EXTRACT=api` + khoá.)
3. Trợ lý chat (worker): nếu chưa đăng nhập, chạy `sudo -u <User của ai-worker.service> -H /home/aisys/.local/bin/claude` → `/login`
   (worker đọc `~/.claude` của HOME, không đọc `CLAUDE_CONFIG_DIR`); Studio → Models: provider `claude-sub` phải hiện `ok` sau lượt
   probe kế (≤ 20 phút, hoặc bấm Kiểm tra lại).

## Còn lại
- [ ] Chat (trợ lý) chưa CHẶN trước khi chạy khi tenant vượt trần (dòng chat chỉ được tính, như trước lát) — lát sau nếu cần.
- [ ] Chọn nhà cung cấp cho AI client theo **profile Studio** (hiện theo env từng tính năng) — lát sau nếu cần.
- [ ] Chạy eval N4 thật (`bun --env-file=.env.local eval/n4-knowledge/run.ts --variant fts` và `fts+rerank`) sau bước đăng nhập.
- [ ] Merge cuối đợt: migration hub 0044 (đối chiếu số với lát khác).
