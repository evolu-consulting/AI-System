---
id: cr121-b1-boundaries
lát: cr121-b1-boundaries
cr: CR-121 (phần B, lát S1)
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Khoá ranh giới module hub-api bằng máy (ADR-0037): luật depcruise + baseline chỉ co + `check:boundaries` nhanh; pilot `knowledge`.
Các lát sau (`config`, `kit`, …) mỗi lát tạo `public.ts`, chuyển importer, co baseline.

## Làm
- `.dependency-cruiser.cjs`: 3 luật `cross-module-deep`, `cross-module-flat`, `no-prod-import-testing` (module = `modules/<m>/`, riêng `packs/<gói>` mỗi gói một module; miễn `*.mount.ts`, file test).
- `.dependency-cruiser-known-violations.json`: baseline khuôn depcruise; `tools/scripts/src/depcruise.ts` truyền `--ignore-known`.
- `bun run check:boundaries` (`tools/scripts/src/check-boundaries{,.rules,.test}.ts`): quét regex ~0,4 s, đỏ khi có vi phạm MỚI, in số đếm theo module đích; `--write` co baseline (từ chối nếu có vi phạm mới). Nối vào `bun run check` (CI) và pre-commit (lefthook).
- Pilot: `modules/knowledge/public.ts` (`openAiEmbedder`, `Embedder`, `mountKnowledge`); `artifact.service.ts`, `artifact.mount.ts`, `packs.mount.ts` chuyển sang `../knowledge/public`.
- ADR-0037, CONVENTIONS §2.

## Không làm / Chạm
Không dời file; không đụng `packs/kit/**`, `packs/contracts/**`, `packages/contracts/src/pack-contracts/**`, đường dẫn DLC. Không đổi hành vi chạy.

## Test tối thiểu
- unit `tools/scripts/src/check-boundaries.test.ts` (phân loại, quét import, so baseline, đếm theo module).
- Quét regex khớp 100% depcruise đầy đủ trên hub-api (572 = 572 vi phạm, hiệu tập = 0; chạy một lần khi sinh baseline).
- `tsc` hub-api; int của `artifacts` + `knowledge` qua `verify:slice`.

## Quyết định trong lúc làm
- Hai thực thi cùng luật: depcruise đầy đủ trên hub-api mất ~30 s (cả repo ~80 s) ⇒ hook dùng bản quét regex; `check-boundaries.test.ts` + lần đối chiếu một lần giữ hai bản khớp.
- Đơn vị module `packs/<gói>` (kit/community/contracts…) chứ không gộp cả `packs`: 245 import sâu vào `packs/kit` nằm ở đây; file gốc `modules/packs/*.ts` thuộc module `packs` nên được nối các gói.
- Baseline đếm sau miễn trừ (mount + test): 573 trước pilot (sâu 252, phẳng 321); con số thô 959 (517 sâu / 442 phẳng) gồm cả mount và test.
- Vi phạm cũ đã hết không làm đỏ (chỉ nhắc `--write`); vi phạm khác tên với cùng tổng vẫn đỏ (so theo tập, không chỉ đếm).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: công cụ kiểm ranh giới import và một `public.ts` re-export; không đổi hành vi người dùng hay API)

## Việc còn lại
Các lát S2+ của CR-121 B: `config`, `packs/kit` (lát khác đang sở hữu), `attachments`, `runs`, … mỗi module về 0 trong baseline.
