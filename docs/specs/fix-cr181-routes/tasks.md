---
id: fix-cr181-routes
lát: fix-cr181-routes
cr: CR-181
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Các đường mới của CR-181 chưa đến được máy chủ: web không chuyển `/me/signature*`, `/company/signature-*` sang hub, và bảng chuyển hướng cũ đổi `/contracts/sign/<id>` thành `/contracts/c/sign/<id>`.

## Làm
- [x] `apps/workspace-web/rsbuild.config.ts`: proxy `/me/signature`, `/company/signature-` → hub.
- [x] `deploy/prod-sohoptac2/nginx.conf` (web 8081, cũng là web của bản test): `location ~ ^/me/signature(/|$)` và `^/company/signature-` → hub.
- [x] `legacy-routes.ts`: `sign`, `signed` vào `CONTRACTS_PAGES`.
- [x] Test tĩnh khớp proxy rsbuild với nginx; `/my-signature` không bị chuyển hướng.

## Không làm / Chạm
Đường gói contracts (`/pack/contracts/:id/doc-sign-session`, `/signers`, `/sign-docs/*`, `/approval-record/stamps/*`) đã đi qua `/pack` nên không đổi. Không có route SPA `/company`. Hub, DB, migration: không chạm.

## Test tối thiểu
`apps/workspace-web/scripts/deploy-proxy.test.ts`, `apps/workspace-web/src/shared/kernel/legacy-routes.test.ts`.

## Quyết định trong lúc làm
- Proxy `/company` thu hẹp về `/company/signature-` vì web không có route trang nào trùng, nhưng giữ đúng tiền tố API cho an toàn.
- `/my-signature`: `legacyTarget` và `__root.tsx` không chuyển hướng đường này; nguyên nhân «vẫn ở Tổng quan» nằm ở `/me/signature` chưa vào hub.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED deploy/cr118-rollout.md
#### Yêu cầu: Chuyển tiếp API chữ ký nội bộ về hub
Web gộp (dev/preview rsbuild và nginx cổng 8081) chuyển `/me/signature*` và `/company/signature-*` sang hub; `/contracts/sign/<id>` và `/contracts/signed/<id>` là route trang, không bị đổi thành `/contracts/c/…`.
- Kịch bản: khi mở màn ký `/contracts/sign/abc` thì không bị chuyển hướng sang `/contracts/c/sign/abc` [test: apps/workspace-web/src/shared/kernel/legacy-routes.test.ts » CR-181: /contracts/sign|signed/<id> là màn ký / xem bản đã ký, không đổi thành /contracts/c/…]
- Kịch bản: khi mở trang `/my-signature` thì không bị chuyển hướng [test: apps/workspace-web/src/shared/kernel/legacy-routes.test.ts » CR-181: /my-signature là trang gốc của app, không bị chuyển hướng]
- Kịch bản: khi gọi API chữ ký thì cả nginx và proxy rsbuild đều đưa tới hub, còn `/my-signature` thì không [test: apps/workspace-web/scripts/deploy-proxy.test.ts » CR-181: /me/signature* và /company/signature-* có trong nginx web 8081 và proxy rsbuild, còn /my-signature (trang SPA) thì không]

## Việc còn lại
Không có.
