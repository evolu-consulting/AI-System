---
id: cr121-b3-module-public
lát: cr121-b3-module-public
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-b2-contracts-subpaths
---
## Plan (ngắn)
CR-121 phần B-3 (ADR-0037): giảm vi phạm ranh giới module của hub-api bằng `public.ts` + `codemod-module-public`. Chỉ đổi export/import, không đổi logic.

## Làm
Top 10 module đích theo số vi phạm trước lát (522 tổng): packs/kit 243 · attachments 44 · runs 29 · dify 21 · agents 20 · runner 20 · commands 19 · studio 16 · mention 14 · processes 13.
- `packs/kit/public.ts`: từ 9 → 98 tên (theo tên, không `export *`; 41 file nguồn). Tên lấy bằng đồ thị TS thật từ MỌI import ngoài module (không phải test), phân biệt `export type` / `export`.
- `bun tools/scripts/src/codemod-module-public.ts packs/kit` → 229 file; hoàn tác file `packs/dlc/**` (Rowan, không đụng) nên còn 10 vi phạm của DLC trong baseline.
- `bunx biome check --write` chỉ các file đổi; `check:boundaries --write`: baseline 522 → 289 (packs/kit 243 → 10).
- `.dependency-cruiser.cjs`: luật `ca-application-inward-only` coi `modules/**/public.ts` là đích hợp lệ (nếu không, mọi `application/` import cửa kit sẽ đỏ; depcruise đỏ sẵn có ở base, số lỗi theo luật này 203 → 211, còn lại giữ nguyên, không vòng import mới: `no-circular` 23 → 23).

## Không làm / Chạm
- Không đụng `packs/dlc*`, `processes/library/dlc-*`, module đóng băng (rooms, kh, sources), admin-api, logic test.
- Module còn lại chưa làm vì đã đạt mục tiêu ≤ 300: attachments, runs, dify, agents, runner, commands, studio, mention, processes, … (theo cùng khuôn).

## Test tối thiểu
- tsc `apps/hub-api` sạch; `bun run test:affected --explain` (xem Việc còn lại / báo cáo); `check:boundaries` 289/289.

## Quyết định trong lúc làm
- Tên export sinh bằng script TS (checker) thay vì tay: tránh `export *`, tránh nhầm type/value. Tên trùng giữa hai file nguồn sẽ báo (không xảy ra ở kit).
- Luật depcruise `contracts-no-process-engine` (cấm gói contracts dùng cầu `PackRuns` của kit theo đường file) không nhìn được tên export qua `kit/public.ts` ⇒ 28 cạnh cũ của nó (đã đỏ ở base) nay biến mất khỏi báo cáo; ghi nợ: cần luật theo tên hoặc cổng riêng cho PackRuns.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: refactor import — thêm export vào `packs/kit/public.ts`, đổi đường import ngoài module sang cửa này, co baseline `check:boundaries`; runtime không đổi)

## Việc còn lại
- Module còn trong baseline (289): attachments 44, runs 29, dify 21, agents 20, runner 20, commands 19, studio 16, mention 14, processes 13, kh 11 (đóng băng), packs/kit 10 (DLC), stream 10 … — dùng `genpub` (đồ thị TS) + `codemod-module-public`; nên đưa script sinh `public.ts` vào `tools/scripts` ở lát sau.
- Luật theo tên cho PackRuns (xem Quyết định).
