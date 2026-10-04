-- HUB-FR-75 · plan H1 §1 P1, §3.4: cho hub_api và agent_runtime đăng nhập ở dev/test (mật khẩu dev, không phải secret).
-- Không chạy ở production (runHubMigrations bỏ migrations-hub-dev); vận hành tự đặt mật khẩu thật.
ALTER ROLE hub_api WITH LOGIN PASSWORD 'hub_api_dev_pw';
--> statement-breakpoint
ALTER ROLE agent_runtime WITH LOGIN PASSWORD 'agent_runtime_dev_pw';
