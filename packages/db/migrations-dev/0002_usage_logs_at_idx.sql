-- ADM-FR-42 · spec M4 T0m: index (at) cho stub hub.usage_logs (truy vấn platform theo tháng, plan §7 perf).
-- Hub thật sở hữu bảng/index này; không chạy ở production.
CREATE INDEX IF NOT EXISTS usage_logs_at_idx ON hub.usage_logs (at);
