# H3a · Tiêu chí nghiệm thu (spec §8, qc)

Phụ lục của [`spec.md`](spec.md) §8. qc bổ sung cột "Test" chi tiết ở `test-plan.md`. Mọi ca dùng `fake-cli` (R18) trừ AC-12 (smoke).

| AC | Given / When / Then | Test |
|---|---|---|
| AC-W02 (vế subscription, CR-041) | Given `claude-sub` trả `RateLimitEvent{status:"rejected", resets_at:T}` ngay khi bắt đầu, When Runtime nhận diện, Then `provider_state` = `cooldown`, `cooldown_until` = T, job `failed ALL_PROVIDERS_EXHAUSTED quota`, client nhận `run.failed` câu R08 (`quota`) ≤ 5 s. **Không** có bước API (H2d hoãn) | stack + Python int |
| HUB-H3a-AC-01 | R02 biên: `resets_at` vắng / ở quá khứ / > now + 8 ngày → `cooldown_until` = now + 1 800 s (đồng hồ tiêm); hợp lệ → đúng `resets_at`; `rate_limit_type`, `utilization` được ghi | Python unit |
| HUB-H3a-AC-02 | R01 thứ tự: 429 + chữ "not logged in" → `cooldown`; 401 → `logged_out`; chữ "You've hit your usage limit" → `cooldown` | Python unit |
| HUB-H3a-AC-03 | R03: `allowed_warning` utilization 0,85 → `status` giữ `ok`, `utilization`/`warn_at` ghi, log `provider.quota_warning` đúng 1 lần cho cùng `resets_at`; job vẫn `done` | Python int |
| HUB-H3a-AC-04 | R06: provider `cooldown` (chưa hết hạn) → tin mới: 0 hàng `jobs` mới, `run.failed` câu `quota` ≤ 1 s; `logged_out` → câu `provider_unavailable`; job `queued` có sẵn của provider bị fail khi provider chuyển `cooldown`; Runtime không claim job của provider `cooldown` | int Hub + Python int |
| HUB-H3a-AC-05 | R07: job hết quota không được requeue/retry (`attempts` = 1); Orchestrator không tạo job thứ hai cho cùng provider trong run đó | stack |
| HUB-H3a-AC-06 | R08/R09: bảng câu vi/en theo `(code, reason)`; `cooldown` trước enqueue → reason `quota` (sửa hiện trạng `provider_unavailable`); reason lạ → câu H1; câu không chứa giờ, tên provider, email | unit TS + int |
| HUB-H3a-AC-07 | R10: `claude-sub` `cooldown` → command `/` sync (mock Dify H2a) vẫn chạy xong | int |
| HUB-H3a-AC-08 | R11/R15: probe `ok` khi provider `logged_out` → `ok`, `consecutive_errors=0`, log `provider.recovered` — **không** khởi động lại Runtime; probe `rejected` → `cooldown`; probe `hang` → sau `AGENT_RT_PROBE_TIMEOUT_S` tính lỗi, 3 lần → `error`; 2 Runtime cùng lúc → đúng 1 probe/provider/lượt | Python int |
| HUB-H3a-AC-09 | R12/R13: job thành công trong chu kỳ → lượt probe bị bỏ (0 lời gọi provider); `cooldown_until` qua → probe ngay; khởi động Runtime → probe thay reset mù | Python int (đồng hồ tiêm) |
| HUB-H3a-AC-10 | R15 chống ghi đè: job ghi `cooldown` trong lúc probe đang chạy (kết quả `ok`) → trạng thái cuối = `cooldown` | Python int |
| HUB-H3a-AC-11 | R04/R17: log `claude.rate_limit` chỉ có tên khoá `raw` + kiểu; log `probe.result` có token; 0 hàng `usage_logs` do probe; quét log không có prompt/token xác thực/email | Python int |
| HUB-H3a-AC-12 | Smoke `HUB_LIVE=1` (không chặn): probe thật `claude-sub` → `ok` + `last_probe_at`; `CLAUDE_CONFIG_DIR` trỏ thư mục trống → `logged_out` → trả lại → probe kế `ok`; ghi token/thời gian probe vào `spec-decisions` (S1) | smoke |
| HUB-H3a-AC-13 | Hồi quy (R19/R20): `test:contract:chat` 41 ca, test khoá H1/H2a/H2b/H2c, Admin M4 usage xanh | contract + CI |
