---
id: cr118-deploy-kit
lát: cr118-deploy-kit
cr: CR-118
làn: nhanh
migration: không
phụ thuộc: cr118-move (web gộp apps/sohoptac-web); module Community vào sohoptac-web (cr118-community-module) TRƯỚC khi deploy
---
## Plan (ngắn)
Kit prod phục vụ web gộp: Dockerfile bỏ build community-web; nginx host chính nhận `/community/*` (history fallback sẵn) + `/me/stream`; cổng 8085
(community.<d>) thành 301 HTML về `sohoptac.<d>/community`, giữ proxy `/auth,/pack,/conversations,/runs,/me/stream` đến mốc 30 ngày; `gen-env.sh` đặt
`S2_PUBLIC_COMMUNITY_URL = <SHT>/community` ⇒ hub `COMMUNITY_WEB_URL` + `APP_URL_COMMUNITY`; link báo giá của hub = `/community` (bỏ `#/feed`);
catalog `community` (url + `sso=false`) đổi bằng `s2-app-urls.ts` (script cấu hình đã có, KHÔNG migration). Kit UAT `deploy/stg-cr118/` cô lập
(project `sohoptac2-cr118`, image `:cr118`, cổng 2853x, tmpfs, bí mật sinh mới, up/down/dry-run). README prod: runbook rollout + rollback.

## Làm
- [x] `deploy/prod-sohoptac2`: Dockerfile, nginx.conf, docker-compose.yml, gen-env.sh, edge/sohoptac2.conf, edge-lib.sh, enable-domain.sh, README (mục "Deploy CR-118").
- [x] hub `communityLink()` (domain/quote.rules.ts) dùng ở quote.service; unit.
- [x] `tools/scripts/src/s2-app-urls.ts`: community → `<SHT>/community`, host cũ `community[-test].<d>` được đổi, `--community-url` (stg), `sso=false`; unit.
- [x] `deploy/stg-cr118/` (compose, gen-env, lib/build/up/down `--dry-run`, push.ps1 `-DryRun`, stg-seed 285xx, README).
- [x] `tools/scripts/src/cr118-deploy-kit.test.ts`: bất biến kit prod + cô lập stg.

## Không làm / Chạm
Không deploy, không chạy stg-cr118 trên host, không build/tag `sohoptac2-app:latest`, không migration (admin 0033 không cần), không sửa `rsbuild` dev proxy
(web gộp cần thêm `/me/stream` cho dev — việc của lát shell/feature-gate), không đụng DLC/engine.

## Test tối thiểu
`bun test tools/scripts/src/cr118-deploy-kit.test.ts tools/scripts/src/s2-app-urls.test.ts apps/hub-api/src/modules/packs/community/domain/quote.rules.test.ts`;
`sh -n` các script `.sh`; `bash stg-cr118/{build,up,down}.sh --dry-run`; `push.ps1 -DryRun`. `bun run verify:predeploy` chỉ đọc `deploy/prod-sohoptac2/env.template` (không đổi đường dẫn).

## Quyết định trong lúc làm
- 8085/18435 GIỮ (không đổi cổng) để rollback chỉ cần image cũ; 301 chỉ cho GET/HEAD (405 cho phương thức khác); `/` và đường dẫn HTML lạ → `/community`, riêng `/sso` → `/sso` (mã SSO đang bay giữ fragment).
- Đích 301 suy từ `Host` (community[-test].<d> → sohoptac[-test].<d>); tunnel cổng …5 → …1 để UAT stg không nhảy sang cổng prod.
- `Cache-Control: max-age=86400` trên 301 để rollback không bị trình duyệt nhớ vĩnh viễn.
- Mốc gỡ proxy 30 ngày ghi tạm `2026-12-05` (deploy dự kiến 2026-11-05): đổi theo ngày deploy thật.
- Catalog community: dùng `s2-app-urls.ts` (idempotent, chỉ ghi hàng còn localhost/host cũ) thay vì migration/seed đè; `DEFAULT_APPS` không đổi (tránh đổi hành vi int test auth/SSO).
- filebox/runtime của UAT dùng lại image prod `:latest` (chỉ đọc, CR-118 không đổi); chỉ app + web build tag `cr118`.
- Không có docker/bash/nginx trên máy dev: `docker compose config` và `nginx -t` CHƯA chạy; kiểm bằng parse YAML + test bất biến + `sh -n` + dry-run; `nginx -t` xảy ra khi container web UAT lên (up.sh).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED deploy/cr118-rollout.md
#### Yêu cầu: UW-DEP-01 Host chính phục vụ Community theo đường dẫn, community.<d> chuyển hướng 301
Kit prod build web gộp (`sohoptac-web`) và không còn build `community-web`; `sohoptac.<d>/community/*` rơi vào history fallback; `community.<d>` (cổng 8085) trả 301 cho điều hướng HTML về `https://sohoptac.<d>/community` (`community-test` → `sohoptac-test`), `/sso` → `/sso`, và giữ proxy `/auth,/pack,/conversations,/runs,/me/stream` đến mốc 30 ngày. `COMMUNITY_WEB_URL` và hàng catalog `community` = `<host SHT>/community`, `sso=false`; link báo giá của hub không còn `#/feed`.
- Kịch bản: khi `community.<d>` nhận GET HTML thì trả 301 về `sohoptac.<d>/community` và tunnel cổng …5 trỏ về cổng …1 [test: tools/scripts/src/cr118-deploy-kit.test.ts » map đích 301]
- Kịch bản: khi cổng 8085 nhận GET HTML thì không phục vụ SPA riêng mà vẫn proxy /auth,/pack,/me/stream [test: tools/scripts/src/cr118-deploy-kit.test.ts » community.<d> (8085)]
- Kịch bản: khi hub dựng link Lưu báo giá thì dùng `COMMUNITY_WEB_URL` (đường dẫn /community) không có `#/feed` [test: apps/hub-api/src/modules/packs/community/domain/quote.rules.test.ts » communityLink (CR-118)]
- Kịch bản: khi chạy `s2-app-urls.ts` thì hàng community còn host cũ đổi sang `/community` và `sso=false`, chạy lại không đổi gì [test: tools/scripts/src/s2-app-urls.test.ts » CR-118: hàng community còn host cũ]

#### Yêu cầu: UW-DEP-02 UAT web gộp trên host prod cô lập khỏi prod
`deploy/stg-cr118/`: project `sohoptac2-cr118`, image `sohoptac2-app:cr118` + `sohoptac2-web:cr118` (không `:latest`), cổng `127.0.0.1:28531..28535`, DB/Redis/FileBox tmpfs, bí mật sinh mới, `down.sh` xoá container/volume/image cr118; mọi script có `--dry-run`.
- Kịch bản: khi kiểm kit UAT thì compose chỉ dùng tag cr118, cổng 127.0.0.1:2853x, không volume prod/claude-home [test: tools/scripts/src/cr118-deploy-kit.test.ts » stg-cr118 · cô lập khỏi prod]
- Kịch bản: khi chạy `build.sh|up.sh|down.sh --dry-run` thì chỉ in kế hoạch và thoát 0 [test: tools/scripts/src/cr118-deploy-kit.test.ts » --dry-run]

#### Yêu cầu: UW-DEP-03 Runbook rollout / rollback CR-118
README prod có thứ tự rollout (verify:predeploy, backup, tag `pre-cr118`, deploy, catalog, kiểm, gỡ proxy sau 30 ngày) và rollback không migration (image trước, catalog URL cũ, `.env`, lưu ý cache 301).
- Kịch bản: khi cần quay lại thì làm theo mục "Deploy CR-118" của README prod mà không chạy migration [test: thủ công — chỉ chạy khi người dùng xác nhận deploy prod]

## Việc còn lại
- Chạy UAT `stg-cr118` trên host khi người dùng xác nhận (push.ps1 → build.sh → up.sh → tunnel → down.sh --rm-dir).
- `docker compose config` + `nginx -t` chưa chạy được ở máy dev (không có docker/nginx); chạy ở bước UAT.
- Dev proxy `apps/sohoptac-web/rsbuild.config.ts` chưa có `/me/stream` (lát shell/feature-gate); nginx prod đã có.
- Đổi mốc `2026-12-05` trong nginx.conf theo ngày deploy thật.
