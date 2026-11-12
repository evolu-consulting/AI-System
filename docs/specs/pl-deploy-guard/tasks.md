---
id: pl-deploy-guard
lát: pl-deploy-guard
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Dev-flow §5 G2/G6, §6 dòng 2 và 7: hợp đồng env cho kit deploy (chặn biến mà mặc định âm thầm tắt tính năng) và nhật ký phát hành.

## Làm
- [x] `deploy/env-contract.json` + `tools/scripts/src/env-contract{,.rules}.ts` + `bun run check:env-contract`; `verify-predeploy.ts` gọi và in cảnh báo (chưa chặn vì prod còn thiếu biến).
- [x] `tools/scripts/src/release-log{,.rules}.ts` + `bun run release:log --env --ref [--by]` ghi `docs/RELEASES.md`; `deploy/stg-test/push.ps1` gọi cuối lần đẩy; prod chỉ có dòng nhắc trong `deploy.ps1`.
- [x] Backfill một dòng staging cho `2cc1b296e`.

## Không làm / Chạm
Không chạm `apps/**`, `.env` thật, prod, e2e. Không đổi hành vi deploy prod.

## Test tối thiểu
Unit: `env-contract.rules.test.ts`, `release-log.rules.test.ts`.

## Quyết định trong lúc làm
- Parse tĩnh chỉ gen-env.sh / env.template / filebox-env.sh (compose chỉ đọc biến, không đặt) ; chênh lệch giữa hai kit chỉ báo, không làm đỏ.
- predeploy chỉ cảnh báo để không chặn mọi lần deploy prod khi còn thiếu; bật chặn sau khi bù biến.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: công cụ deploy)

## Việc còn lại
- Prod chưa đặt HUB_NOTIFY_MODE và HUB_SMTP_*/SMTP_PASSWORD trong gen-env.sh/env.template (xem kết quả check:env-contract); bù rồi đổi cảnh báo thành chặn.
