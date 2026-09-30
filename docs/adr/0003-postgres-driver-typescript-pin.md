# ADR-0003 · Driver Postgres và bản TypeScript

Trạng thái: **Accepted** (Gate M0, 2026-10-01) · Ngày: 2026-10-01 · Tác giả: backend-lead

## Bối cảnh
- ADR-0001 chọn Postgres 16 + Drizzle nhưng chưa chọn driver. Driver phải chạy được trên Bun (admin-api, Hub) **và** Node LTS (Worker), và được `drizzle-kit`/migrator của Drizzle hỗ trợ.
- Bản TypeScript `latest` trên npm là 7.0.2 (bản native). Gói `typescript@7.0.2` chỉ export `./lib/version.cjs` và `./unstable/*` — không còn Compiler API cũ (`transpileModule`, `SyntaxKind`…). `dependency-cruiser@18.5.0` (`src/meta.cjs`) khai `supportedTranspilers.typescript: ">=2.0.0 <7.0.0"` và dùng Compiler API để đọc import của file `.ts` (`src/extract/transpile/typescript-wrap.mjs`, `src/extract/tsc/extract-typescript-deps.mjs`).

## Lựa chọn — driver

| Tiêu chí | `postgres` (postgres.js) 3.4.9 | `pg` (node-postgres) 8.23.1 | `Bun.sql` (built-in) |
|---|---|---|---|
| Chạy trên Bun + Node | Có | Có | Chỉ Bun → Worker (Node) không dùng chung được |
| Drizzle runtime | `drizzle-orm/postgres-js` | `drizzle-orm/node-postgres` | `drizzle-orm/bun-sql` |
| drizzle-kit (generate/migrate/studio) | Có | Có | Không dùng làm driver của drizzle-kit |
| Kích thước cài (npm `unpackedSize`) | 299.744 B, 0 dependency | 102.632 B + 6 dependency (`pg-pool`, `pg-protocol`, `pg-types`…) + `@types/pg` | 0 (có sẵn) |
| Kiểu TS | Có sẵn | Cần `@types/pg` 8.23.1 | Có sẵn trong `@types/bun` |
| LISTEN/NOTIFY (cần cho `config_changed`, readiness #13) | Có (`sql.listen`) | Có (client riêng) | Cần xác minh |
| Peer của drizzle-orm 0.45.3 | `postgres >=3` | `pg >=8` | `bun-types *` |

Chưa có số đo tốc độ tự chạy trên máy dự án; không dùng benchmark làm căn cứ. Ngân sách API (CONVENTIONS §6: p95 < 300 ms) sẽ đo ở M1 với 5.000 bản ghi.

## Lựa chọn — TypeScript

| Phương án | Ưu | Nhược |
|---|---|---|
| A. `typescript@6.0.3` (bản mới nhất nhánh 6) | dependency-cruiser đọc được `.ts`; Compiler API đủ cho mọi công cụ | Không phải bản `latest`; `tsc` chậm hơn bản native |
| B. `typescript@7.0.2` | Bản mới nhất, `tsc` native nhanh | dependency-cruiser không phân tích được `.ts` → mất luật import (CONVENTIONS §4) |
| C. Cả hai (alias `npm:typescript@7.0.2` cho typecheck, `typescript@6.0.3` cho công cụ) | Tốc độ typecheck của 7 | Hai bản cùng bin `tsc`, dễ nhầm; tăng độ phức tạp ngay ở M0 |

## Quyết định (đề xuất)
- Driver: **`postgres` (postgres.js) 3.4.9** qua `drizzle-orm/postgres-js`. Pool mặc định `max: 10`.
- TypeScript: **6.0.3** (phương án A). Mọi tuỳ chọn `tsconfig` ghi tường minh để nâng lên 7 không đổi hành vi.

## Hệ quả
- `packages/db` phụ thuộc `postgres`; Worker (Node) dùng lại được `packages/db`.
- Nâng TypeScript 7 khi dependency-cruiser công bố hỗ trợ `typescript >=7` → ADR mới thay thế phần TypeScript.
- Nếu M1 đo thấy driver không đạt ngân sách → ADR mới so sánh lại với số đo thật.
