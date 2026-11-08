# Engine · Sự kiện runtime của agent

Cập nhật: 2026-11-09 · Nguồn: kr-int-py. Code: `apps/agent-runtime/src/agent_runtime/events/`.

#### Yêu cầu: job.result không mang khoá null tuỳ chọn (nguồn: kr-int-py)
Sự kiện `job.result` chỉ có `outputs` / `source_reads` khi có giá trị; không bao giờ dump `null` (Hub zod `.optional()`). Job không đọc nguồn ⇒ không có khoá `source_reads`.
