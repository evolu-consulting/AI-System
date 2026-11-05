---
id: cr119-app-domain
lát: cr119-app-domain
cr: CR-119
làn: nhanh
migration: không
phụ thuộc: cr118-deploy-kit (kit prod web gộp, đã trong platform/gd0 hoặc merge trước)
---
## Plan (ngắn)
Host trung tính `app[-test].<d>` phục vụ web gộp, đường dẫn giữ nguyên. Cờ `S2_APP_HOST_LIVE` (mặc định 0) quyết định `sohoptac.<d>`/`community.<d>` có 301 sang `app.<d>` không; URL công khai/CORS/catalog theo cờ. Spec: `docs/specs/CR-119/spec.md`.

## Làm
- [x] `edge-lib.sh` (`s2_names app`, `s2_render` điền `__N_APP__`, `__MAIN_*__`, `__LEGACY_*__` theo cờ; cờ sai ⇒ lỗi), `edge/sohoptac2.conf` (server app, map `$s2_legacy_to`, 301 giữ `$request_uri`, map `$s2_cm_main` theo cờ), `nginx.conf` (header tin cậy `app|sohoptac`), `gen-env.sh` (cờ, CORS gồm cả hai, URL công khai), `enable-domain.sh`/`cutover.sh` (HOSTS + lệnh kiểm), `deploy.ps1 -AppHostLive`.
- [x] `s2-app-urls.ts --app-host` + test.
- [x] README prod "Deploy CR-119" (bước người dùng: DNS + certbot --expand; rồi cờ=1 + cutover).
- [x] Kiểm link "mở app" admin/chat/studio: đọc catalog `/me/apps` (fallback từ env `PUBLIC_*`), không hardcode `sohoptac.<d>` (grep `apps/`, `packages/`).

## Không làm / Chạm
Không đổi đường dẫn SPA/cổng/compose/mã app, không migration, không deploy; tiền tố `/contracts` để CR sau.

## Test tối thiểu
`bun test tools/scripts/src/cr118-deploy-kit.test.ts tools/scripts/src/s2-app-urls.test.ts`; `nginx -t` (container nginx:1.27-alpine trên stg) cho edge render cờ 0 và 1 (both/test) + nginx.conf web.

## Quyết định trong lúc làm
- Đích 301 qua `map $host` với giá trị điền từ `__BASE__` lúc render (không dùng Host client); cờ=0 ⇒ giá trị map rỗng ⇒ không `if`-redirect.
- `s2_render` đọc cờ từ env, rồi `.env` của kit, rồi 0, nên `cutover.sh` tự theo cờ đã ghi bởi `gen-env.sh`.
- Header `X-S2-Main-Origin` (CR-118) chấp nhận cả `app*` và `sohoptac*`.

> Cập nhật 2026-11-05: cờ S2_APP_HOST_LIVE và host sohoptac đã bị bỏ — xem docs/specs/cr119-drop-sohoptac/tasks.md (Delta thay thế UW-DEP-05/06).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED deploy/cr119-app-domain.md
#### Yêu cầu: UW-DEP-04 Host trung tính app.<d> phục vụ web gộp
Edge có server `app[-test].<d>` tới `web:8081` song song với `sohoptac[-test].<d>`; SHT ở gốc, Community ở `/community`.
- Kịch bản: khi render edge thì có `server_name app.<d> app-test.<d>` và `nginx -t` đạt với cờ 0 và 1 [test: tools/scripts/src/cr118-deploy-kit.test.ts » CR-119 (2026-11-05): app[-test].<d>]

#### Yêu cầu: UW-DEP-05 Cờ S2_APP_HOST_LIVE điều khiển 301 sang app.<d>
Cờ 0 (mặc định): sohoptac.<d> phục vụ như cũ; cờ 1: sohoptac/community 301 → app.<d> giữ path; đích cố định, không lấy từ Host client.
- Kịch bản: khi cờ=1 thì map `$s2_legacy_to` có đích `https://app.<d>` và 301 giữ `$request_uri`; cờ=0 thì map rỗng [test: tools/scripts/src/cr118-deploy-kit.test.ts » CR-119 (2026-11-05): app[-test].<d>]

#### Yêu cầu: UW-DEP-06 URL công khai, CORS và catalog theo cờ
`gen-env.sh`: CORS gồm cả `app*` và `sohoptac*`; URL công khai = app khi cờ=1. `s2-app-urls.ts --app-host` đặt `contracts`/`community` về app.<d> (idempotent).
- Kịch bản: khi chạy `planUrlChanges(..., "prod", true)` thì đổi hàng sohoptac sang app, chạy lại không đổi, không bật cờ thì giữ nguyên [test: tools/scripts/src/s2-app-urls.test.ts » CR-119: catalog contracts/community]

## Việc còn lại
- Người dùng: DNS `app`/`app-test` + `certbot --expand` rồi bật cờ (README "Deploy CR-119").
- CR sau: tiền tố `/contracts`; `app.<d>/` thành trang chọn app.