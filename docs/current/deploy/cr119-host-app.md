# Deploy · app.<d> là host duy nhất (CR-119)

Cập nhật: 2026-11-09 · Gộp từ: cr119-drop-sohoptac (đợt cr125-wave).

## Yêu cầu: UW-DEP-07 Host app[-test].<d> là host web gộp duy nhất (nguồn: cr119-drop-sohoptac)
Edge không còn `server_name`/301 cho `sohoptac[-test].<d>`; URL công khai, CORS, catalog dùng `app[-test].<d>`; cờ `S2_APP_HOST_LIVE` và `deploy.ps1 -AppHostLive` bị bỏ.
- Kịch bản: khi render edge thì chỉ có `server_name` app (không `__N_CONTRACTS__`/`__LEGACY_*`), `gen-env.sh` đặt URL công khai = app và không còn cờ [test: tools/scripts/src/cr118-deploy-kit.test.ts » CR-119 (2026-11-05): app[-test].<d>]
- Kịch bản: khi chạy `planUrlChanges` thì hàng contracts/community còn sohoptac/localhost đổi sang app, chạy lại không đổi [test: tools/scripts/src/s2-app-urls.test.ts » CR-119: catalog contracts/community]

## Yêu cầu: UW-DEP-08 Bỏ hẳn host community[-test].<d> (nguồn: cr119-drop-sohoptac)
Edge không còn `server_name` community, nginx `web` không còn cổng 8085 (301 + proxy 30 ngày), compose/env bỏ `S2_PORT_COMMUNITY`/18435; Community chỉ ở `app[-test].<d>/community`.
- Kịch bản: khi render edge/nginx thì không còn `__N_COMMUNITY__`, `listen 8085`, `s2_main_origin`, `S2_PORT_COMMUNITY` [test: tools/scripts/src/cr118-deploy-kit.test.ts » CR-119 (2026-11-05): community.<d> bỏ hẳn]

## Yêu cầu: UW-WEB-09 Đổi tên app sohoptac-web thành workspace-web (nguồn: cr119-drop-sohoptac)
Package `@ai/workspace-web` (`apps/workspace-web`); job e2e `workspace-web-stack`; tên hiển thị "Sổ Hợp Tác" giữ nguyên.
- Kịch bản: khi build Dockerfile thì dùng `--cwd apps/workspace-web build` [test: tools/scripts/src/cr118-deploy-kit.test.ts » Dockerfile: build workspace-web]
