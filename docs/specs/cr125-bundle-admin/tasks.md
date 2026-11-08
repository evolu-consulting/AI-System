---
id: cr125-bundle-admin
lát: cr125-bundle-admin
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
`check:bundle` đỏ trên gd0 (JS tải ban đầu 186,9 KB > 174 KB; chunk async lớn nhất 51,0 KB > 50 KB). Đo bằng stats rspack (module trong chunk initial): zod (~360 KB nguồn) + 4 JSON locale `contracts/{v2l,rep3}.{vi,en}` nằm trong bundle ban đầu.

## Làm
- Nguyên nhân zod: 3 import tĩnh ở đường tải ban đầu kéo `@ai/contracts/tenants|audit` (schema zod) chỉ để lấy hằng số / một query.
  - `packages/contracts/src/light.ts` (đường không zod, có sẵn): thêm `TENANT_APP_IDS`, `FEATURE_APP_IDS`, `CONTRACTS_PARTNER_CONFIRM_FEATURE`, `AUDIT_ENTITIES`, `AUDIT_ACTIONS` (định nghĩa duy nhất); `tenants.ts` và `audit.ts` import lại và re-export (đường cũ vẫn dùng được).
  - `features/features/lib/feature-meta.ts` (route `apps_.$appKey`) và `features/audit/lib/search.ts` (route `audit`) import hằng từ `@ai/contracts/light`.
  - `features/shell/lib/legacy-route.ts`: `import("@/features/tenants/api")` lười, chỉ khi có `?tenant=`.
- Nguyên nhân JSON: `packages/i18n/src/process-locales.ts` import tĩnh `settings-paths` (4 JSON) ⇒ nạp lười cùng lúc với các phần `process.*`.
- Không nâng ngân sách (JS 174 KB, chunk 50 KB).

## Không làm / Chạm
Không đổi hành vi/UI, không đụng app khác hay DLC. Chạm: `packages/contracts/src/{light,tenants,audit}.ts`, `packages/i18n/src/process-locales.ts`, 3 file admin-web ở trên.

## Test tối thiểu
Unit của file đã chạm (i18n settings-paths/process-locales/contracts-locales, audit, shell, feature-meta, app-config, contracts audit/tenants): 96 pass. `bun run --filter @ai/admin-web build` + `check:bundle` xanh. tsc admin-web: 43 lỗi có sẵn (esign Panel, *.test), không thêm lỗi mới.

## Quyết định trong lúc làm
Đặt hằng vào `light.ts` (đã là mẫu CR-118) thay vì nhân đôi hằng ở admin-web (một nguồn sự thật).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

Không thay đổi hành vi (lý do: tối ưu bundle)

Số đo gzip (check:bundle): JS tải ban đầu 186,9 KB → 136,7 KB (ngân sách 174); chunk async lớn nhất 51,0 KB → 49,8 KB (ngân sách 50); CSS 18,8 KB (không đổi).

## Việc còn lại
Chunk async lớn nhất còn 49,8 KB sát ngưỡng 50 KB: chunk này gom schema zod dùng chung của các route; lát sau nên tách theo route nếu thêm schema.
