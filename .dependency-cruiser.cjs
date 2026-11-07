// ADM-NFR-06 · luật import (spec M0 T-DEP-1…7, CONVENTIONS §2). Chạy qua `bun run depcruise` (T-DEP-8).
// Regex phần `apps/…` không neo `^` để dùng lại trên fixture (tools/scripts/src/__fixtures__/depcruise).
// Đường dẫn đã resolve luôn chứa `node_modules/<pkg>/` (kể cả store `.bun/` của linker isolated).
const NPM = (names) => `(^|/)node_modules/(${names})/`;
const { join } = require("node:path");

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-routes-to-repo",
      comment: "T-DEP-1: routes chỉ gọi service, không chạm repo",
      severity: "error",
      from: { path: "\\.routes\\.ts$" },
      to: { path: "\\.repo\\.ts$" },
    },
    {
      name: "no-cross-module-repo",
      comment:
        "T-DEP-2: module không import repo của module khác, kể cả repo lồng (modules/x/**/y.repo.ts) — đi qua service",
      severity: "error",
      from: { path: "modules/([^/]+)/" },
      to: { path: "modules/[^/]+/.*\\.repo\\.ts$", pathNot: "modules/$1/" },
    },
    {
      name: "rules-must-be-pure",
      comment: "T-DEP-3: *.rules.ts là hàm thuần, không I/O, không lớp khác",
      severity: "error",
      from: { path: "\\.rules\\.ts$" },
      to: {
        path: [
          "\\.(repo|service|routes)\\.ts$",
          "(^|/)packages/db/",
          "(^|/)@ai/db(/|$)",
          NPM("drizzle-orm|postgres|ioredis|hono"),
        ],
      },
    },
    {
      name: "rules-must-be-pure",
      comment: "T-DEP-3: *.rules.ts không import module core Node/Bun",
      severity: "error",
      from: { path: "\\.rules\\.ts$" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "service-no-http",
      comment: "T-DEP-4: service không biết HTTP",
      severity: "error",
      from: { path: "\\.service\\.ts$" },
      to: { path: ["\\.routes\\.ts$", NPM("hono")] },
    },
    {
      name: "ca-domain-builtin-only",
      comment:
        "ADR-0023 (CR-088): lớp 1 `domain/` chỉ dùng built-in ECMAScript — chỉ import file trong `domain/`; cấm package npm, node:*/bun:*, lớp khác. arch-a9: ngoại lệ `packages/contracts/src` (shared kernel kiểu + zod, giữ thuần bằng `contracts-only-zod`/`contracts-pure`) — cùng điều kiện với `ca-application-inward-only`",
      severity: "error",
      from: {
        path: "(^|/)(apps|packages)/.+/domain/",
        pathNot: "\\.test\\.tsx?$|^apps/workspace-web/",
      },
      to: { pathNot: "(^|/)(apps|packages)/.+/domain/|(^|/)packages/contracts/src/" },
    },
    {
      name: "ca-application-inward-only",
      comment:
        "ADR-0023 (CR-088): lớp 2 `application/` chỉ import `domain/`, `application/`; cấm package npm, @ai/contracts, @ai/db, node:*/bun:*; ngoại lệ CR-121 B-3: cửa `modules/**/public.ts` (ADR-0037)",
      severity: "error",
      from: { path: "(^|/)apps/.+/application/", pathNot: "\\.test\\.tsx?$|^apps/workspace-web/" },
      // arch-a1: packages/contracts = shared kernel (kiểu + zod, được rule `contracts-pure`/`contracts-only-zod` giữ thuần, không I/O)
      // ⇒ application được import (type lẫn schema runtime); mọi package/lớp ngoài vẫn cấm.
      to: {
        pathNot:
          "(^|/)apps/.+/(domain|application)/|(^|/)modules/.+/public\\.ts$|(^|/)packages/contracts/src/",
      },
    },
    {
      name: "ca-inner-no-cross-module",
      comment:
        "ADR-0023 (CR-088): lớp 1–2 của module A không import lớp 1–2 của module B; nối qua port ở <m>.mount.ts",
      severity: "error",
      from: {
        path: "modules/([^/]+)/(domain|application)/",
        pathNot: "\\.test\\.tsx?$|^apps/workspace-web/",
      },
      to: { path: "modules/[^/]+/", pathNot: "modules/$1/" },
    },
    ...require("./.dependency-cruiser.boundaries.cjs"), // CR-121 B · ADR-0037
    ...require("./.dependency-cruiser.contracts.cjs"), // arch-a1 · packages/contracts = shared kernel thuần
    {
      name: "pack-no-cross-pack",
      comment:
        "PK-FR-09 (N1 plan §9): gói A không import gói B — chỉ chính nó và khung `kit/`; nối ở `packs.mount.ts`",
      severity: "error",
      from: { path: "modules/packs/([^/]+)/" },
      to: { path: "modules/packs/[^/]+/", pathNot: "modules/packs/($1|kit)/" },
    },
    {
      name: "pack-no-hub-modules",
      comment:
        "PK-FR-09 (N1 plan §9): lớp 1–3 của module gói không import module khác của hub (config, attachments…) — chỉ lớp 4 `*.mount.ts` nối",
      severity: "error",
      from: { path: "modules/packs/[^/]+/(domain|application|adapters)/" },
      to: { path: "apps/hub-api/src/modules/", pathNot: "modules/packs/" },
    },
    {
      name: "contracts-no-process-engine",
      comment:
        "M3-decouple: gói contracts (trích + duyệt) không phụ thuộc engine quy trình — cấm `modules/processes/**` và cầu `PackRuns` của kit; chỉ trợ lý chat ở Agent Hub",
      severity: "error",
      from: { path: "modules/packs/contracts/" },
      to: {
        path: [
          "apps/hub-api/src/modules/processes/",
          "modules/packs/kit/application/(pack-runs\\.ports|start-pack-run\\.usecase|pack-run-outcome\\.usecase)\\.ts$",
        ],
      },
    },
    {
      name: "pack-ports-only-lib",
      comment:
        "pack-boundary: gói chỉ dùng cổng nền tảng ở `lib/` (errors, http, logger, loop, auth.middleware, redis, ai-client) — không import lib khác của hub; xem docs/platform/pack-boundary.md",
      severity: "error",
      from: { path: "modules/packs/(?!kit/)[^/]+/", pathNot: "\\.test\\.tsx?$" },
      to: {
        path: "apps/hub-api/src/lib/",
        pathNot: "lib/(errors|http|logger|loop|auth\\.middleware|redis|ai-client/[^/]+)\\.ts$",
      },
    },
    {
      name: "pack-no-hub-modules-any-layer",
      comment:
        "pack-boundary: không file nào của gói (kể cả `*.mount.ts`) import module khác của hub (runs, agents, config, attachments…) — nối ở `packs.mount.ts` bằng cổng tiêm vào",
      severity: "error",
      from: { path: "modules/packs/(?!kit/)[^/]+/" },
      to: { path: "apps/hub-api/src/modules/", pathNot: "modules/packs/" },
    },
    {
      name: "pack-no-platform-db-internals",
      comment:
        "pack-boundary: gói không đọc bảng admin/ops/permissions/totp và không dùng `hub-scope` — chỉ `withPackScope` (pack-scope) và bảng của chính gói",
      severity: "error",
      from: { path: "modules/packs/(?!kit/)[^/]+/" },
      to: {
        path: [
          "(^|/)packages/db/src/hub-scope",
          "(^|/)packages/db/src/schema/(admin|ops|permissions|totp)",
          "(^|/)@ai/db/schema/(admin|ops|permissions|totp)",
        ],
      },
    },
    {
      name: "platform-no-pack-internals",
      comment:
        "pack-boundary: code nền tảng chỉ chạm gói qua `packs.mount.ts`, cổng `kit/` (ports, registry, guard, uow, converters), cửa `packs/<gói>/public.ts` (ADR-0037) và `packs/<gói>/testing/` (chỉ test; `no-prod-import-testing` chặn code thật) — không import ruột `packs/<gói>/**`",
      severity: "error",
      from: { path: "apps/hub-api/src/", pathNot: "modules/packs/" },
      to: { path: "modules/packs/(?!kit/|packs\\.mount|[^/]+/(?:public\\.ts|testing/))[^/]+/" },
    },
    {
      name: "pack-no-hub-schema",
      comment:
        "PK-FR-09 (N1 plan §9): module gói không đọc schema hub — chỉ bảng của gói qua `PackUow`",
      severity: "error",
      from: { path: "modules/packs/" },
      to: { path: ["(^|/)@ai/db/schema/hub", "(^|/)packages/db/src/schema/hub"] },
    },
    {
      name: "component-no-fetch",
      comment: "T-DEP-5: component chỉ trình bày; gọi API qua features/<f>/api.ts ở page/hook",
      severity: "error",
      from: {
        path: "apps/[^/]+-web/src/features/[^/]+/components/",
        pathNot: "^apps/workspace-web/src/features/",
      },
      to: {
        path: [
          "apps/[^/]+-web/src/features/[^/]+/api\\.tsx?$",
          "apps/[^/]+-web/src/lib/http",
          "(^|/)packages/web-kit/src/http",
        ],
      },
    },
    {
      name: "component-no-fetch-legacy",
      comment:
        "CR-118 TECH-DEBT: 27 vi pháº¡m cÅ© cá»§a contracts (apps/workspace-web/src/features/*) giá»¯ warn tá»›i háº¡n xá»­ lÃ½ (docs/TECH-DEBT.md); code má»›i (modules/, platform/, shell/) váº«n error theo component-no-fetch",
      severity: "warn",
      from: { path: "^apps/workspace-web/src/features/[^/]+/components/" },
      to: {
        path: [
          "apps/[^/]+-web/src/features/[^/]+/api\\.tsx?$",
          "apps/[^/]+-web/src/lib/http",
          "(^|/)packages/web-kit/src/http",
        ],
      },
    },
    {
      name: "test-kit-no-apps",
      comment:
        "TK1: packages/test-kit là lá — chỉ @ai/db, postgres, bun:test; không import code từ apps/**",
      severity: "error",
      from: { path: "(^|/)packages/test-kit/" },
      to: { path: "(^|/)apps/" },
    },
    {
      name: "no-prod-import-test-kit",
      comment:
        "TK1 (review M-2): @ai/test-kit chỉ cho test — code production trong apps/** và packages/** (trừ packages/test-kit, *.test.ts, tests/**) không import",
      severity: "error",
      from: {
        path: "(^|/)(apps|packages)/",
        pathNot: [
          "(^|/)packages/test-kit/",
          "\\.(test|int\\.test|perf\\.int\\.test)\\.tsx?$",
          "(^|/)tests?/",
        ],
      },
      to: { path: "(^|/)packages/test-kit/" },
    },
    {
      name: "web-kit-no-apps",
      comment: "N1 TF3: packages/web-kit dùng chung cho các web app — không import code từ apps/**",
      severity: "error",
      from: { path: "(^|/)packages/web-kit/" },
      to: { path: "(^|/)apps/" },
    },
    {
      name: "flow-canvas-public-entry",
      comment:
        "CR-118 cr118-flow-canvas: apps chỉ import cửa công khai `@ai/flow-canvas` (nặng, nạp lười) và `@ai/flow-canvas/pure` — không import ruột packages/flow-canvas/src/*",
      severity: "error",
      from: { path: "^apps/" },
      to: {
        path: "(^|/)packages/flow-canvas/src/",
        pathNot: "(^|/)packages/flow-canvas/src/(index|pure)\\.ts$",
      },
    },
    {
      name: "flow-canvas-no-apps",
      comment:
        "CR-118: packages/flow-canvas dùng chung cho các web app — không import code từ apps/**",
      severity: "error",
      from: { path: "(^|/)packages/flow-canvas/" },
      to: { path: "(^|/)apps/" },
    },
    {
      name: "web-no-db-or-api",
      comment: "T-DEP-6: web không import db hay code api",
      severity: "error",
      from: { path: "apps/[^/]+-web/" },
      to: { path: ["(^|/)packages/db/", "(^|/)@ai/db(/|$)", "apps/[^/]+-api/"] },
    },
    {
      name: "studio-web-no-other-web",
      comment:
        "HUB-FR-72 (H4a F1): studio-web không import code apps/admin-web hay apps/chat-web (copy-then-own, D7)",
      severity: "error",
      from: { path: "apps/studio-web/" },
      to: { path: "apps/(admin|chat)-web/" },
    },
    // ---- CR-118 Â· web nghiá»‡p vá»¥ há»£p nháº¥t (apps/workspace-web): 6 luáº­t web-module (ADR-0034). 1â€“5 = warn tá»›i khi code dá»i xong
    // (cÃ¡c lÃ¡t cr118-*), 6 = error ngay. ÄÆ°á»ng dáº«n Ä‘Ã­ch: src/{shell,platform,shared,modules/<m>}.
    {
      name: "web-mod-no-cross-module",
      comment:
        "CR-118 luáº­t 1: modules/X khÃ´ng import modules/Y (giao tiáº¿p chá»‰ qua route path dáº¡ng chuá»—i + server port ADR-0031; giá»¯ COM-FR-26 P0-AC02)",
      severity: "error",
      from: { path: "^apps/workspace-web/src/modules/([^/]+)/" },
      to: {
        path: "^apps/workspace-web/src/modules/[^/]+/",
        pathNot: "^apps/workspace-web/src/modules/$1/",
      },
    },
    {
      name: "web-shell-manifest-only",
      comment:
        "CR-118 luáº­t 2: shell/ chá»‰ import modules/<m>/manifest.ts (khÃ´ng import ruá»™t module)",
      severity: "error",
      from: { path: "^apps/workspace-web/src/shell/" },
      to: {
        path: "^apps/workspace-web/src/modules/",
        pathNot: "^apps/workspace-web/src/modules/[^/]+/manifest\\.tsx?$",
      },
    },
    {
      name: "web-modules-no-shell",
      comment: "CR-118 luáº­t 2 (chiá»u ngÆ°á»£c): modules/ khÃ´ng import shell/",
      severity: "error",
      from: { path: "^apps/workspace-web/src/modules/" },
      to: { path: "^apps/workspace-web/src/shell/" },
    },
    {
      name: "web-domain-pure",
      comment:
        "CR-118 luáº­t 3: domain / features/<f>/lib lÃ  hÃ m thuáº§n â€” cáº¥m react, @ai/web-kit, adapters, ui (chá»‰ shared/kernel + kiá»ƒu @ai/contracts)",
      severity: "error",
      from: {
        path: "^apps/workspace-web/src/modules/[^/]+/(domain|features/[^/]+/lib)/",
        pathNot: "\\.test\\.tsx?$",
      },
      to: {
        path: [
          "(^|/)node_modules/(react|react-dom)/",
          "(^|/)packages/web-kit/",
          "^apps/workspace-web/src/modules/[^/]+/(adapters|ui)/",
          "^apps/workspace-web/src/modules/[^/]+/features/[^/]+/(components|pages|hooks)/",
          "^apps/workspace-web/src/modules/[^/]+/features/[^/]+/api\\.tsx?$",
        ],
      },
    },
    {
      name: "web-ui-no-adapters",
      comment:
        "CR-118 luáº­t 4: ui / components / pages khÃ´ng import adapters hay api.ts (Ä‘i qua application/hooks); má»Ÿ rá»™ng component-no-fetch",
      severity: "error",
      from: {
        path: "^apps/workspace-web/src/modules/[^/]+/(ui|features/[^/]+/(components|pages))/",
      },
      to: {
        path: [
          "^apps/workspace-web/src/modules/[^/]+/adapters/",
          "^apps/workspace-web/src/modules/[^/]+/features/[^/]+/api\\.tsx?$",
        ],
      },
    },
    {
      name: "web-features-port-only",
      comment:
        "CR-118 luáº­t 5: má»i nÆ¡i chá»‰ vÃ o platform/features qua platform/features/index.ts (FeatureGate má»ng, khÃ´ng ráº£i if)",
      severity: "error",
      from: {
        path: "^apps/workspace-web/src/",
        pathNot: "^apps/workspace-web/src/platform/features/",
      },
      to: {
        path: "^apps/workspace-web/src/platform/features/",
        pathNot: "^apps/workspace-web/src/platform/features/index\\.tsx?$",
      },
    },
    {
      name: "web-business-no-other-web",
      comment:
        "CR-118 luáº­t 6: web nghiá»‡p vá»¥ há»£p nháº¥t khÃ´ng import apps/(admin|chat|studio|dlc-workspace)-web (nhÆ° studio-web-no-other-web)",
      severity: "error",
      from: { path: "^apps/workspace-web/" },
      // `~/*` trong tsconfig.depcruise.json trỏ cả chat-web lẫn workspace-web ⇒ import alias bị resolve nhầm sang chat-web: bỏ qua "aliased".
      to: {
        path: "^apps/(admin|chat|studio|dlc-workspace)-web/",
        dependencyTypesNot: ["aliased"],
      },
    },
    {
      name: "api-no-web",
      comment: "T-DEP-6: api không import code web",
      severity: "error",
      from: { path: "apps/[^/]+-api/" },
      to: { path: "apps/[^/]+-web/" },
    },
    {
      name: "no-circular",
      comment: "T-DEP-7: không vòng import",
      severity: "error",
      from: { pathNot: "^apps/workspace-web/src/features/" },
      to: { circular: true },
    },
    {
      name: "no-circular-legacy",
      comment:
        "CR-118 TECH-DEBT: 3 vÃ²ng import cÅ© cá»§a contracts (features/partners, contract-approval, contracts-list) giá»¯ warn tá»›i háº¡n xá»­ lÃ½ (docs/TECH-DEBT.md); code má»›i váº«n error theo no-circular",
      severity: "warn",
      from: { path: "^apps/workspace-web/src/features/" },
      to: { circular: true },
    },

    {
      name: "not-to-unresolvable",
      comment: "T-DEP-7: import phải resolve được (trừ bun, bun:*)",
      severity: "error",
      from: {},
      to: { couldNotResolve: true, pathNot: "^bun(:|$)" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // dist neo vào build của workspace: `(^|/)dist/` từng loại cả cạnh tới gói npm (`node_modules/hono/dist/…`).
    // `.venv` (venv Python của agent-runtime khi chạy uv trên host) không phải code repo.
    exclude: { path: "(^|/)__fixtures__/|(^|/)\\.venv/|^(apps|packages|tools)/[^/]+/dist/" },
    tsPreCompilationDeps: true,
    // Alias `@/*` → `apps/admin-web/src/*` (tsconfig admin-web). Đường dẫn tuyệt đối để chạy được từ cwd bất kỳ
    // (fixture). Workspace khác không dùng `@/` nên không bị ảnh hưởng; thêm web app mới → gộp alias ở đây.
    tsConfig: { fileName: join(__dirname, "tsconfig.depcruise.json") },
    builtInModules: { add: ["bun", "bun:test", "bun:sqlite", "bun:ffi"] },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["bun", "import", "types", "default"],
    },
  },
};
