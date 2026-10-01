-- ADM-NFR-07 · spec M1 §4: cho role admin_api đăng nhập ở dev/test (mật khẩu dev, không phải secret).
-- Không chạy ở production (runMigrations bỏ migrations-dev); vận hành tự đặt mật khẩu thật.
ALTER ROLE admin_api WITH LOGIN PASSWORD 'admin_api_dev_pw';
