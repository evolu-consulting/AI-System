---
id: hub-fast-sdk
lát: hub-fast-sdk
cr: CR-114
làn: nhanh (phần token bucket = đồng thời ⇒ test trước)
migration: không (0083 giữ chỗ, không dùng — cờ agent nằm trong `runtime_options`)
phụ thuộc: hub-warm-runtime (đã merge)
---
## Plan (ngắn)
Lượt chat ngắn của agent không cần sandbox/tool trên đĩa đi thẳng Anthropic SDK (bỏ spawn CLI ~1–7 s), có prompt
caching ổn định byte, và trần tốc độ token/phút theo tenant (Redis, Lua nguyên tử) trước mọi lời gọi SDK.

## Làm
1. `lib/ai-client/prompt-cache.ts` — dựng request theo thứ tự cố định system → tools → ngữ cảnh tenant/agent → history,
   `cache_control` ở cuối system và cuối history; phần biến động (dòng giờ, prompt lượt này) sau breakpoint cuối.
   `anthropic.provider.ts` (ai-client) dùng nó; usage ghi `cache_read`/`cache_creation` (đã có cột).
2. `modules/runner/direct/direct-sdk.rules.ts` — luật đủ điều kiện (cờ `runtime_options.direct_sdk === true`, mặc định tắt;
   `agentic-cli`; không file/nguồn/stage/autofix/tool workflow/pack tool/KH). `direct-sdk-runner.ts` — `AgentRunner` trong Hub:
   mở/đóng `run_steps` (job_id NULL, provider `anthropic`) trong `withHubScope(system)` + kiểm chủ run như `enqueueJob`,
   `gatedRun` (trần ngày), token bucket, stream `job.delta` qua `DeltaSink` sẵn có, `job.result` ⇒ `runJob` ghi usage chat như cũ.
   `RoutingRunner` chọn runner này khi luật cho phép; còn lại giữ đường job.
3. `lib/ai-client/token-bucket.ts` — bucket token/phút theo tenant (Lua: nạp lại theo `TIME` của Redis, trừ nguyên tử),
   Redis lỗi ⇒ cho qua + log `ai-rate-bucket-fail-open` (trần ngày vẫn giữ). `AiClient` kiểm trước khi gọi (dep `rate`).
4. Đo: `direct-sdk.perf.int.test.ts` với server Anthropic giả.

## Không làm / Chạm
Không migration, không đổi contract Runtime, không đổi đường job CLI. Orchestrator qua SDK không stream delta (JSON quyết
định; vòng parse như job không stream).

## Test tối thiểu
- unit: prompt-cache (prefix byte-ổn định qua 3 lượt), direct-sdk.rules, direct-sdk-runner (fake SDK + fake bước).
- int: token-bucket (đồng thời không vượt cấp, fail-open), direct-sdk perf (E12→delta đầu, tỉ lệ cache 3 lượt).

## Quyết định trong lúc làm
- Cờ agent = `runtime_options.direct_sdk` (không cột mới ⇒ không cần 0083).
- `TokenUsage` (contract strict) giữ `input/output`; `input_tokens` của đường SDK = input + cache_read + cache_creation (trần
  ngày không đếm thiếu); tách chi tiết cache vào `run_steps.detail.usage`.
- `AiClient` hết bucket ⇒ trả `CAP_EXCEEDED` (không thêm mã mới: `AiFailCode` lan sang contract gói contracts) + log
  `ai-rate-limited`.
- Server Anthropic giả mô phỏng tra lùi cache qua ranh giới tin (như API) — `fake-anthropic.ts`.
- Bị bucket chặn ở đường SDK ⇒ `job.failed ALL_PROVIDERS_EXHAUSTED/provider_busy` (mã sẵn có).
- Model đường SDK: `runtime_options.model` → `agent.model` → `HUB_DIRECT_SDK_MODEL` → `claude-opus-5-5`; thinking adaptive
  (mặc định), `effort: low` cho lượt chat ngắn.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED hub/direct-sdk.md
#### Yêu cầu: Đường SDK trực tiếp cho lượt chat ngắn
Agent `agentic-cli` có `runtime_options.direct_sdk = true` và lượt không cần file/nguồn/tool chạy bằng Anthropic SDK trong Hub,
cùng bản ghi bước, phạm vi tenant, trần token và luồng delta như đường job; agent khác giữ đường job CLI.
- Kịch bản: khi cờ tắt hoặc lượt có file/tool thì đi đường job [test: apps/hub-api/src/modules/runner/direct/direct-sdk.rules.test.ts » direct-sdk eligibility]
- Kịch bản: khi đủ điều kiện thì phát delta và job.result kèm usage, đóng bước ok [test: apps/hub-api/src/modules/runner/direct/direct-sdk-runner.test.ts » direct-sdk runner streams deltas and result]
- Kịch bản: khi đo với server giả thì E12→delta đầu của đường SDK được báo số [test: apps/hub-api/src/modules/runner/direct/direct-sdk.perf.int.test.ts » direct-sdk perf]
#### Yêu cầu: Prompt caching ổn định
Request SDK theo thứ tự system → tools → ngữ cảnh → history với breakpoint `cache_control`; tiền tố byte-ổn định qua các lượt.
- Kịch bản: khi hội thoại thêm lượt thì tiền tố đã cache của lượt trước là tiền tố byte của lượt sau [test: apps/hub-api/src/lib/ai-client/prompt-cache.test.ts » prompt-cache prefix stable]
#### Yêu cầu: Trần tốc độ token/phút theo tenant
Trước mọi lời gọi SDK, bucket Redis (Lua nguyên tử) trừ token ước tính; hết ⇒ từ chối; Redis lỗi ⇒ cho qua kèm log, trần ngày giữ.
- Kịch bản: khi N lời gọi đồng thời thì tổng token được cấp không vượt dung lượng [test: apps/hub-api/src/lib/ai-client/token-bucket.int.test.ts » token bucket never over-admits]
- Kịch bản: khi Redis lỗi thì cho qua và log [test: apps/hub-api/src/lib/ai-client/token-bucket.int.test.ts » token bucket fails open]
- Kịch bản: khi caller cũ (`createHubAiClient`, contracts/knowledge) hết bucket thì `CAP_EXCEEDED`, không gọi nhà cung cấp [test: apps/hub-api/src/lib/ai-client/ai-client.rate.int.test.ts » legacy createHubAiClient caller is blocked when tenant bucket is exhausted]
#### Yêu cầu: Cửa sổ history dịch theo khối
Đường SDK biết tổng tin của flow (`count(*) over ()` cùng câu history) dịch điểm bắt đầu cửa sổ theo khối (8 lượt = 16 tin, ≤ n/2)
thay vì trượt mỗi lượt; giữ (n − khối, n] tin. Đường job giữ `history_n` tin như cũ.
- Kịch bản: khi tổng tin tăng trong cùng khối thì điểm bắt đầu cửa sổ không đổi [test: apps/hub-api/src/lib/ai-client/prompt-cache.test.ts » history window shifts by block, keeping the start stable]
- Kịch bản: khi runner SDK nhận history kèm tổng thì cắt theo khối [test: apps/hub-api/src/modules/runner/direct/direct-sdk-runner.test.ts » history window shifts by block when flow total is known]

## Số đo (local, server giả)
- Đường SDK E12→delta đầu: 21,1 / 2,8 / 1,5 ms (lượt 1 gồm dựng kết nối) — đường job: spawn CLI ~1–7 s (đo prod CR-114).
- Cache 3 lượt (token ≈ ký tự/4): đọc/ghi/input = 0/585/21 → 585/46/18 → 631/43/17; tỉ lệ trúng 3 lượt 0,625, lượt 2–3 0,907.

## Việc còn lại
- Đo đường job cùng khung (cần Runtime/worker giả phát `job.delta` qua Redis) — chưa làm.
- ~~Nối `rate` vào các chỗ gọi `createHubAiClient`~~ — xong (contracts + knowledge qua `redis` của packs mount).
- Bật cờ `direct_sdk` cho agent cụ thể (Studio/seed) — mặc định tắt.
