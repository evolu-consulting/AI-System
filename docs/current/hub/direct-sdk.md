# Hub · đường SDK trực tiếp

Cập nhật: 2026-11-09 · Gộp từ: hub-fast-sdk (đợt cr125-wave).

## Yêu cầu: Đường SDK trực tiếp cho lượt chat ngắn (nguồn: hub-fast-sdk)
Agent `agentic-cli` có `runtime_options.direct_sdk = true` và lượt không cần file/nguồn/tool chạy bằng Anthropic SDK trong Hub,
cùng bản ghi bước, phạm vi tenant, trần token và luồng delta như đường job; agent khác giữ đường job CLI.
- Kịch bản: khi cờ tắt hoặc lượt có file/tool thì đi đường job [test: apps/hub-api/src/modules/runner/direct/direct-sdk.rules.test.ts » direct-sdk eligibility]
- Kịch bản: khi đủ điều kiện thì phát delta và job.result kèm usage, đóng bước ok [test: apps/hub-api/src/modules/runner/direct/direct-sdk-runner.test.ts » direct-sdk runner streams deltas and result]
- Kịch bản: khi đo với server giả thì E12→delta đầu của đường SDK được báo số [test: apps/hub-api/src/modules/runner/direct/direct-sdk.perf.int.test.ts » direct-sdk perf]
## Yêu cầu: Prompt caching ổn định (nguồn: hub-fast-sdk)
Request SDK theo thứ tự system → tools → ngữ cảnh → history với breakpoint `cache_control`; tiền tố byte-ổn định qua các lượt.
- Kịch bản: khi hội thoại thêm lượt thì tiền tố đã cache của lượt trước là tiền tố byte của lượt sau [test: apps/hub-api/src/lib/ai-client/prompt-cache.test.ts » prompt-cache prefix stable]
## Yêu cầu: Trần tốc độ token/phút theo tenant (nguồn: hub-fast-sdk)
Trước mọi lời gọi SDK, bucket Redis (Lua nguyên tử) trừ token ước tính; hết ⇒ từ chối; Redis lỗi ⇒ cho qua kèm log, trần ngày giữ.
- Kịch bản: khi N lời gọi đồng thời thì tổng token được cấp không vượt dung lượng [test: apps/hub-api/src/lib/ai-client/token-bucket.int.test.ts » token bucket never over-admits]
- Kịch bản: khi Redis lỗi thì cho qua và log [test: apps/hub-api/src/lib/ai-client/token-bucket.int.test.ts » token bucket fails open]
- Kịch bản: khi caller cũ (`createHubAiClient`, contracts/knowledge) hết bucket thì `CAP_EXCEEDED`, không gọi nhà cung cấp [test: apps/hub-api/src/lib/ai-client/ai-client.rate.int.test.ts » legacy createHubAiClient caller is blocked when tenant bucket is exhausted]
## Yêu cầu: Cửa sổ history dịch theo khối (nguồn: hub-fast-sdk)
Đường SDK biết tổng tin của flow (`count(*) over ()` cùng câu history) dịch điểm bắt đầu cửa sổ theo khối (8 lượt = 16 tin, ≤ n/2)
thay vì trượt mỗi lượt; giữ (n − khối, n] tin. Đường job giữ `history_n` tin như cũ.
- Kịch bản: khi tổng tin tăng trong cùng khối thì điểm bắt đầu cửa sổ không đổi [test: apps/hub-api/src/lib/ai-client/prompt-cache.test.ts » history window shifts by block, keeping the start stable]
- Kịch bản: khi runner SDK nhận history kèm tổng thì cắt theo khối [test: apps/hub-api/src/modules/runner/direct/direct-sdk-runner.test.ts » history window shifts by block when flow total is known]
