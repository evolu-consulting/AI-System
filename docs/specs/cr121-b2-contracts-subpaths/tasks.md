---
id: cr121-b2-contracts-subpaths
lát: cr121-b2-contracts-subpaths
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-b1-boundaries
---
## Plan (ngắn)
CR-121 phần B-2 (ADR-0037): (1) thay import barrel `@ai/contracts` bằng subpath theo file bằng codemod chạy lại được; (2) `public.ts` cho module `config` của hub-api + chuyển import xuyên module + co baseline; (3) `test:affected` coi `public.ts` là cửa: đổi file trong module chỉ kéo module đó + module import `public.ts` của nó (một bước).

## Làm
- `tools/scripts/src/codemod-contracts-subpaths.ts` (+ `.rules.ts`, test): đồ thị TS thật của barrel gốc → subpath của file khai báo; tự thêm `exports` thiếu vào `packages/contracts/package.json`; `--check` báo file còn import barrel gốc. Đã chạy toàn repo (1006 file); `import * as` (9 câu, test đóng băng/mirror) giữ nguyên.
- Barrel gốc `packages/contracts/src/index.ts` giữ lại, đánh dấu `@deprecated`.
- `apps/hub-api/src/modules/config/public.ts` (theo tên, không `export *`); `tools/scripts/src/codemod-module-public.ts <module>` chuyển import ngoài module sang `public` (tái dùng cho `kit`).
- `check:boundaries --write`: baseline 570 → 522 (module `config` về 0).
- `test-affected.closure.ts`: `PUBLIC_GATE` — bao đóng ngược chỉ đi qua tối đa một `public.ts`; import sâu (không qua cửa) vẫn đi đủ.

## Không làm / Chạm
- Không đổi hành vi, không migration, không xoá barrel gốc. Module `kit` (243 vi phạm sâu) để lát sau.
- Perf: không chạm đường nóng.

## Test tối thiểu
- unit: `codemod-contracts-subpaths.test.ts`, `test-affected.scope.test.ts` (cửa public.ts), `check-boundaries.test.ts`.
- typecheck toàn repo (trừ đỏ có sẵn), build admin-web + workspace-web, `check:boundaries` 522/522, một lượt evotest int cho module config.

## Quyết định trong lúc làm
- Subpath theo FILE khai báo (`@ai/contracts/access`, `/config`…), không gom theo miền: import một tên chỉ kéo đúng file.
- Gate `test:affected` chỉ áp cho seed theo module (không áp cho seed rộng như migration/file gốc).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: refactor import — đổi đường dẫn import `@ai/contracts` → subpath, thêm `public.ts` cho module config, và logic chọn test của công cụ `test:affected`; runtime không đổi)

## Việc còn lại
- Module `kit` (`modules/packs/kit`, 243 vi phạm sâu): viết `public.ts` rồi `bun tools/scripts/src/codemod-module-public.ts packs/kit` + `check:boundaries --write`.
- 9 câu `import * as … from "@ai/contracts"` (test đóng băng/mirror) còn dùng barrel; gỡ barrel gốc khi chúng chuyển được.
- Các module còn lại trong baseline (attachments 44, runs 29, dify 21, …) theo cùng khuôn: `public.ts` + codemod-module-public.
