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
      comment: "T-DEP-2: module không import repo của module khác (đi qua service)",
      severity: "error",
      from: { path: "modules/([^/]+)/" },
      to: { path: "modules/[^/]+/[^/]*\\.repo\\.ts$", pathNot: "modules/$1/" },
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
      name: "component-no-fetch",
      comment: "T-DEP-5: component chỉ trình bày; gọi API qua features/<f>/api.ts ở page/hook",
      severity: "error",
      from: { path: "apps/[^/]+-web/src/features/[^/]+/components/" },
      to: {
        path: ["apps/[^/]+-web/src/features/[^/]+/api\\.tsx?$", "apps/[^/]+-web/src/lib/http"],
      },
    },
    {
      name: "web-no-db-or-api",
      comment: "T-DEP-6: web không import db hay code api",
      severity: "error",
      from: { path: "apps/[^/]+-web/" },
      to: { path: ["(^|/)packages/db/", "(^|/)@ai/db(/|$)", "apps/[^/]+-api/"] },
    },
    {
      name: "api-no-web",
      comment: "T-DEP-6: api không import code web",
      severity: "error",
      from: { path: "apps/[^/]+-api/" },
      to: { path: "apps/[^/]+-web/" },
    },
    {
      name: "contracts-pure",
      comment: "T-DEP-6: contracts chỉ là zod, không phụ thuộc db/app",
      severity: "error",
      from: { path: "(^|/)packages/contracts/" },
      to: { path: ["(^|/)packages/db/", "(^|/)@ai/db(/|$)", "(^|/)apps/"] },
    },
    {
      name: "no-circular",
      comment: "T-DEP-7: không vòng import",
      severity: "error",
      from: {},
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
    exclude: { path: "(^|/)__fixtures__/|^(apps|packages|tools)/[^/]+/dist/" },
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
