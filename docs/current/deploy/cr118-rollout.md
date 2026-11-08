# Deploy · rollout web gộp CR-118

Cập nhật: 2026-11-09 · Gộp từ: cr118-deploy-kit (đợt cr125-wave).

## Yêu cầu: UW-DEP-01 Host chính phục vụ Community theo đường dẫn, community.<d> chuyển hướng 301 (nguồn: cr118-deploy-kit)
Kit prod build web gộp (`sohoptac-web`) và không còn build `community-web`; `sohoptac.<d>/community/*` rơi vào history fallback; `community.<d>` (cổng 8085) trả 301 cho điều hướng HTML về `https://sohoptac.<d>/community` (`community-test` → `sohoptac-test`), `/sso` → `/sso`, và giữ proxy `/auth,/pack,/conversations,/runs,/me/stream` đến mốc 30 ngày. `COMMUNITY_WEB_URL` và hàng catalog `community` = `<host SHT>/community`, `sso=false`; link báo giá của hub không còn `#/feed`.
- Kịch bản: khi `community.<d>` nhận GET HTML thì trả 301 về `sohoptac.<d>/community` và tunnel cổng …5 trỏ về cổng …1 [test: tools/scripts/src/cr118-deploy-kit.test.ts]
- Kịch bản: khi cổng 8085 nhận GET HTML thì không phục vụ SPA riêng mà vẫn proxy /auth,/pack,/me/stream [test: tools/scripts/src/cr118-deploy-kit.test.ts]
- Kịch bản: khi hub dựng link Lưu báo giá thì dùng `COMMUNITY_WEB_URL` (đường dẫn /community) không có `#/feed` [test: apps/hub-api/src/modules/packs/community/domain/quote.rules.test.ts » communityLink (CR-118)]
- Kịch bản: khi chạy `s2-app-urls.ts` thì hàng community còn host cũ đổi sang `/community` và `sso=false`, chạy lại không đổi gì [test: tools/scripts/src/s2-app-urls.test.ts » CR-118: hàng community còn host cũ]

## Yêu cầu: UW-DEP-02 UAT web gộp trên host prod cô lập khỏi prod (nguồn: cr118-deploy-kit)
`deploy/stg-cr118/`: project `sohoptac2-cr118`, image `sohoptac2-app:cr118` + `sohoptac2-web:cr118` (không `:latest`), cổng `127.0.0.1:28531..28535`, DB/Redis/FileBox tmpfs, bí mật sinh mới, `down.sh` xoá container/volume/image cr118; mọi script có `--dry-run`.
- Kịch bản: khi kiểm kit UAT thì compose chỉ dùng tag cr118, cổng 127.0.0.1:2853x, không volume prod/claude-home [test: tools/scripts/src/cr118-deploy-kit.test.ts » stg-cr118 · cô lập khỏi prod]
- Kịch bản: khi chạy `build.sh|up.sh|down.sh --dry-run` thì chỉ in kế hoạch và thoát 0 [test: tools/scripts/src/cr118-deploy-kit.test.ts » --dry-run]

## Yêu cầu: UW-DEP-03 Runbook rollout / rollback CR-118 (nguồn: cr118-deploy-kit)
README prod có thứ tự rollout (verify:predeploy, backup, tag `pre-cr118`, deploy, catalog, kiểm, gỡ proxy sau 30 ngày) và rollback không migration (image trước, catalog URL cũ, `.env`, lưu ý cache 301).
- Kịch bản: khi cần quay lại thì làm theo mục "Deploy CR-118" của README prod mà không chạy migration [test: thủ công — chỉ chạy khi người dùng xác nhận deploy prod]
