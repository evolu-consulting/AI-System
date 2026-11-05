---
id: web-bundle-headroom
lát: web-bundle-headroom
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Phân tích đồ thị ban đầu (rspack stats): zod (~370 KB nguồn) nằm trong JS ban đầu vì 3 hằng số import từ file có zod
(`MY_APPS_PATH`, `RETRY_AFTER_HEADER`/`TOO_MANY_RUNS_RETRY_AFTER_S`, `CONTRACT_DATE_FIELDS`/`CONTRACT_DUE_PRESETS`).

## Làm
- `@ai/contracts/light` (`src/light.ts`, không import): định nghĩa các hằng số trên; module cũ import lại + re-export.
- web-kit `http.ts`, `auth/session.ts` và `date-filter.ts` của workspace-web import từ `@ai/contracts/light`.
- `check:bundle` báo lỗi nếu JS ban đầu chứa zod (chuỗi `invalid_type`).

## Không làm / Chạm
Không đổi ngân sách (162 KB). Không đổi hành vi. Contracts chỉ thêm subpath + chuyển định nghĩa hằng số.

## Test tối thiểu
`packages/contracts/src/light.test.ts`, `scripts/check-bundle.test.ts`, check:bundle.

## Quyết định trong lúc làm
Số liệu: initial JS gzip 165888 B (162.0 KB) → xem báo cáo lát.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ chuyển hằng số sang module không phụ thuộc zod để zod rời JS tải ban đầu của workspace-web; giá trị và đường import cũ giữ nguyên).

## Việc còn lại
