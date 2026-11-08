# Deploy · host app.<d> (CR-119)

Cập nhật: 2026-11-09 · Gộp từ: cr119-app-domain (đợt cr125-wave).

## Yêu cầu: UW-DEP-04 Host trung tính app.<d> phục vụ web gộp (nguồn: cr119-app-domain)
Edge có server `app[-test].<d>` tới `web:8081` song song với `sohoptac[-test].<d>`; SHT ở gốc, Community ở `/community`.
- Kịch bản: khi render edge thì có `server_name app.<d> app-test.<d>` và `nginx -t` đạt với cờ 0 và 1 [test: tools/scripts/src/cr118-deploy-kit.test.ts » CR-119 (2026-11-05): app[-test].<d>]

## Yêu cầu: UW-DEP-05 Cờ S2_APP_HOST_LIVE điều khiển 301 sang app.<d> (nguồn: cr119-app-domain)
Cờ 0 (mặc định): sohoptac.<d> phục vụ như cũ; cờ 1: sohoptac/community 301 → app.<d> giữ path; đích cố định, không lấy từ Host client.
- Kịch bản: khi cờ=1 thì map `$s2_legacy_to` có đích `https://app.<d>` và 301 giữ `$request_uri`; cờ=0 thì map rỗng [test: tools/scripts/src/cr118-deploy-kit.test.ts » CR-119 (2026-11-05): app[-test].<d>]

## Yêu cầu: UW-DEP-06 URL công khai, CORS và catalog theo cờ (nguồn: cr119-app-domain)
`gen-env.sh`: CORS gồm cả `app*` và `sohoptac*`; URL công khai = app khi cờ=1. `s2-app-urls.ts --app-host` đặt `contracts`/`community` về app.<d> (idempotent).
- Kịch bản: khi chạy `planUrlChanges(..., "prod", true)` thì đổi hàng sohoptac sang app, chạy lại không đổi, không bật cờ thì giữ nguyên [test: tools/scripts/src/s2-app-urls.test.ts » CR-119: catalog contracts/community]
