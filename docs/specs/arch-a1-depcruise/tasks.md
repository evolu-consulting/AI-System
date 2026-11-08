# arch-a1-depcruise — cổng kiến trúc: luật contracts, vi phạm mới, depcruise nhanh

Làn: nhanh (tooling/refactor). Nhánh `slice/arch-a1-depcruise`. Không chạm DLC, `packs/contracts`, `partners`, process canvas.

## Delta (so với docs/current)

Không thay đổi hành vi (lý do: tooling/refactor — luật dependency-cruiser, tách file băm/kiểu, script kiểm; runtime không đổi).
Trạng thái gộp: đã gộp 2026-11-08 (đợt CR-125 cuoi dot)

## Đã làm

- Luật `ca-application-inward-only`: application được import `packages/contracts/src` (shared kernel: kiểu + zod). Điều kiện giữ bằng luật mới `contracts-only-zod` (mã production của contracts chỉ phụ thuộc zod, không core Node/Bun) cùng `contracts-pure` (không db/apps). Dòng ghi chú trong `.dependency-cruiser.cjs`.
- Sửa thật (không baseline): `*.rules.ts` thuần — `evotest-cache.hash.ts` / `artifact.hash.ts` giữ `node:crypto`, file `.rules` re-export; bỏ `PATH_DELIM` (không ai dùng) khỏi `e2e-lane.rules.ts`; phá vòng `test-affected.closure` <-> `test-affected.scope` bằng `test-affected.scope.types.ts`.
- Baseline tạo lại từ lần quét đầy đủ: 289 (chỉ 3 luật ranh giới) -> 519 mục = đúng các vi phạm còn thật (trước đó 230 vi phạm luật khác chưa có trong baseline nên `depcruise --all` đỏ). Chỉ được co lại.
- `depcruise:affected` (`bun run depcruise:affected`): `--affected <merge-base platform/gd0>` + cache nội dung `node_modules/.cache/dependency-cruiser`; in 1 dòng tóm tắt + 10 vi phạm đầu. Nối vào lefthook pre-commit (glob `*.{ts,tsx}`). `depcruise --all` (slice:merge/đợt) dùng chung cache.
- Số đo: `--all` 83 s (không cache) -> 20.9 s (cache ấm); `--affected` 2.7 s (cache ấm; lần đầu mỗi worktree ~60 s để dựng cache).

## Kế hoạch dọn

Còn 519 mục baseline. Mỗi lát <= 60 phút, xếp theo giá trị (số vi phạm / rủi ro hỏng kiến trúc). "sau" = đang có người làm, chưa đụng.

| # | Lát | Module · luật · số | File chính | Ghi chú |
|---|---|---|---|---|
| 1 | Cổng `public.ts` cho processes + runs | hub-api `processes` cross-module-flat 47, `runs` 30 | `modules/processes/**`, `modules/runs/**` (import vào `agent-hooks/dify/mcp/runner/orchestrator/rooms` đi qua `public.ts`) | dùng `codemod-module-public`; mount được miễn |
| 2 | Cổng `public.ts` cho commands/runner/orchestrator/internal | cross-module-flat 23+23+22+19 | `modules/commands`, `runner`, `orchestrator`, `internal` | cùng codemod, 4 module một lát |
| 3 | Cổng `public.ts` cho kh/dify/rooms/mention/mcp/studio + còn lại | cross-module-flat ~12+11+13+11+16+7 (+~30 lẻ) | `modules/kh,dify,rooms,mention,mcp,studio,agent-hooks,dlc-calls,me-stream,...` | tách 2 lát nếu quá 60 phút |
| 4 | `processes` -> `packs/*` nội bộ | platform-no-pack-internals 84 (processes 77, seed 4, ops 3), cross-module-deep 16 | `modules/processes/**`, `modules/seed/**`, `modules/ops/adapters/checks/flow-coverage.check.ts` | chỉ qua `packs/<gói>/public.ts`/`kit`; **sau** CR-124 q3 (đụng packs/contracts) |
| 5 | Ops: application sạch | ops ca-application-inward-only 7, ca-domain 3, no-routes-to-repo 1, no-prod-import-test-kit 1 | `modules/ops/application/{ops.check,ops.round,overview.service}.ts`, `ops/domain/{ops,overview}.rules.ts`, `ops/adapters/ops.routes.ts` | cổng (port) cho db/redis/repo, kiểu hub-admin type-only; domain nhận kiểu qua tham số |
| 6 | admin-web `component-no-fetch` | admin-web 31 (tenants 10, app-roles 5, partners 4, processes 4, feedback 3, còn lại 5) + studio-web 1 | `apps/admin-web/src/features/{tenants,app-roles,partners,feedback,system,overview,shell,ai-tools,workflows}/components/**` | đưa gọi API vào hook/`api.ts` ở page; `processes/*` và canvas **sau** (u3b đang chạy) |
| 7 | workspace-web legacy fetch + vòng | component-no-fetch-legacy 27, no-circular-legacy 3 | `apps/workspace-web/src/features/{contract-*,frame-panel,partners,promote-deal,settings}/**` | đã ghi TECH-DEBT; theo CR-118 hết hạn |
| 8 | domain thuần (hub-api) | ca-domain-builtin-only 17 (community 6, contracts 6, dlc 2, processes 3) | `modules/packs/community/domain/**`, `modules/processes/domain/**` | kiểu từ contracts: cân nhắc cho phép `import type` contracts ở domain (cần ADR nhỏ); `packs/contracts` + `dlc` **sau/không đụng** |
| 9 | pack-boundary hub-scope + lib | pack-no-platform-db-internals 10, pack-no-hub-modules(-any-layer) 15, pack-ports-only-lib 1, packs no-routes-to-repo 1 | `packs/community/**`, `packs/contracts/**` (**sau**, CR-124 q3), `packs/dlc/**` (Rowan, không đụng) | cần cổng `withPackScope` trong kit trước |
| 10 | admin-api repo chéo | no-cross-module-repo 3 + service-no-http 1 + no-routes-to-repo 1 | `apps/admin-api/src/modules/{app-roles,internal-tokens,packs}/**` | đi qua service; `app-roles.service` bỏ kiểu hono |
| 11 | hub-api repo chéo + vòng + test-kit | no-cross-module-repo 11, no-circular 3 (hub-api) +1 (processes launcher), no-prod-import-test-kit 5 | `modules/processes/**`, `modules/packs/contracts/application/approval*.ts` (**sau**), `test-support/**` | `launcher` <-> `launcher-batch`: tách kiểu |
| 12 | Vòng còn lại (không đụng) | no-circular: dlc-workspace (Rowan), `tests/acceptance/P-d` (test khoá) | — | để nguyên, nêu lý do |

Ghi chú: `ca-application-inward-only` 8 còn lại = ops 7 (lát 5) + `packs/kit/application/pack-nav.ports.ts` (kiểu `auth.middleware`, đi cùng lát 9).

## Quyết định trong lúc làm

- Cho phép cả `import` runtime lẫn `import type` contracts trong application (không dùng `dependencyTypesNot: type-only`): contracts chỉ có zod (kiểm bằng `contracts-only-zod`), schema zod là phần của kernel.
- Cảnh báo "stale known violations" của depcruise 18.5 liệt kê toàn bộ baseline kể cả mục đang khớp — bỏ qua; kiểm co lại bằng `check:boundaries` (289/289 cho 3 luật ranh giới).
- `slice:new` báo "hết làn e2e (14)" sau khi đã tạo worktree + bun install: slice này không chạy e2e nên chưa cấp làn; cần `bun run e2e:lanes --prune` ở checkout chính khi dọn worktree cũ.
