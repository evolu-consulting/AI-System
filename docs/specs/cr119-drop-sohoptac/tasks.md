---
id: cr119-drop-sohoptac
lát: cr119-drop-sohoptac
cr: CR-119
làn: nhanh
migration: không
phụ thuộc: cr119-app-domain
---
## Plan (ngắn)
Người dùng 2026-11-05: host `sohoptac[-test].<d>` không còn dùng; web gộp chỉ ở `app[-test].<d>`. Spec: `docs/specs/CR-119/spec.md` §2b.

## Làm
1. `git mv apps/sohoptac-web apps/workspace-web`, `e2e/sohoptac-web` → `e2e/workspace-web`; package `@ai/workspace-web`; mọi filter/script/depcruise/job e2e (`workspace-web-stack`)/rules/docs cập nhật. Tên hiển thị "Sổ Hợp Tác" giữ.
2. Kit `deploy/prod-sohoptac2` (tên thư mục/project/volume giữ): bỏ sohoptac khỏi edge-lib/edge conf/gen-env/enable-domain/cutover/CORS/URL; bỏ cờ `S2_APP_HOST_LIVE` + `deploy.ps1 -AppHostLive`; bỏ hẳn host community[-test].<d> + cổng 8085/18435 (không 301); `s2-app-urls.ts` luôn đặt catalog về app.
3. README runbook "Deploy CR-119" viết lại; spec CR-119 §2b.

## Không làm / Chạm
Không đổi tên thư mục kit/project Docker/volume; không deploy/push; không đụng DLC.

## Test tối thiểu
`tools/scripts/src/cr118-deploy-kit.test.ts`, `s2-app-urls.test.ts`; typecheck; check:bundle; openspec:check; e2e `contracts-web,workspace-web-stack,community-web`; `nginx -t` edge + web (stg).

## Quyết định trong lúc làm
- CORS không còn `sohoptac*`/`community*`. stg-cr118 bỏ cổng 28535; `stg-sohoptac2` (cũ, CR-102) chưa đổi.
- `gen-env.sh` xoá khoá `S2_APP_HOST_LIVE` cũ khỏi `.env`.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED deploy/cr119-host-app.md
#### Yêu cầu: UW-DEP-07 Host app[-test].<d> là host web gộp duy nhất
Edge không còn `server_name`/301 cho `sohoptac[-test].<d>`; URL công khai, CORS, catalog dùng `app[-test].<d>`; cờ `S2_APP_HOST_LIVE` và `deploy.ps1 -AppHostLive` bị bỏ.
- Kịch bản: khi render edge thì chỉ có `server_name` app (không `__N_CONTRACTS__`/`__LEGACY_*`), `gen-env.sh` đặt URL công khai = app và không còn cờ [test: tools/scripts/src/cr118-deploy-kit.test.ts » CR-119 (2026-11-05): app[-test].<d>]
- Kịch bản: khi chạy `planUrlChanges` thì hàng contracts/community còn sohoptac/localhost đổi sang app, chạy lại không đổi [test: tools/scripts/src/s2-app-urls.test.ts » CR-119: catalog contracts/community]

#### Yêu cầu: UW-DEP-08 Bỏ hẳn host community[-test].<d>
Edge không còn `server_name` community, nginx `web` không còn cổng 8085 (301 + proxy 30 ngày), compose/env bỏ `S2_PORT_COMMUNITY`/18435; Community chỉ ở `app[-test].<d>/community`.
- Kịch bản: khi render edge/nginx thì không còn `__N_COMMUNITY__`, `listen 8085`, `s2_main_origin`, `S2_PORT_COMMUNITY` [test: tools/scripts/src/cr118-deploy-kit.test.ts » CR-119 (2026-11-05): community.<d> bỏ hẳn]

#### Yêu cầu: UW-WEB-09 Đổi tên app sohoptac-web thành workspace-web
Package `@ai/workspace-web` (`apps/workspace-web`); job e2e `workspace-web-stack`; tên hiển thị "Sổ Hợp Tác" giữ nguyên.
- Kịch bản: khi build Dockerfile thì dùng `--cwd apps/workspace-web build` [test: tools/scripts/src/cr118-deploy-kit.test.ts » Dockerfile: build workspace-web]