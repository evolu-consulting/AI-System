// ---- CR-121 phần B · ADR-0037: ranh giới module hub-api. Module khác chỉ vào qua `modules/<m>/public.ts`.
// Miễn: `*.mount.ts` (gồm packs.mount.ts), `app.ts` (ngoài modules/), file test. Vi phạm cũ nằm trong
// `.dependency-cruiser-known-violations.json` (chỉ được co lại — `bun run check:boundaries`, bản quét nhanh
// tools/scripts/src/check-boundaries.rules.ts phải khớp 3 luật này).

/** @type {import('dependency-cruiser').IForbiddenType[]} */
module.exports = [
  {
    name: "cross-module-deep",
    comment:
      "ADR-0037: import sâu vào adapters/application/domain của module khác — đi qua modules/<m>/public.ts (cổng, kiểu, hàm dựng mount; không `export *`)",
    severity: "error",
    from: {
      path: "^apps/hub-api/src/modules/(packs/[^/]+|[^/]+)/",
      pathNot: ["\\.mount\\.ts$", "\\.test\\.tsx?$"],
    },
    to: {
      path: "^apps/hub-api/src/modules/(packs/[^/]+|[^/]+)/(adapters|application|domain)/",
      pathNot: "^apps/hub-api/src/modules/$1/",
    },
  },
  {
    name: "cross-module-flat",
    comment:
      "ADR-0037: import vào ruột module chưa chia lớp của module khác — đi qua modules/<m>/public.ts",
    severity: "error",
    from: {
      path: "^apps/hub-api/src/modules/(packs/[^/]+|[^/]+)/",
      pathNot: ["\\.mount\\.ts$", "\\.test\\.tsx?$"],
    },
    to: {
      path: "^apps/hub-api/src/modules/(packs/[^/]+|[^/]+)/",
      pathNot: [
        "^apps/hub-api/src/modules/$1/",
        "^apps/hub-api/src/modules/(packs/[^/]+|[^/]+)/(adapters|application|domain|testing)/",
        "^apps/hub-api/src/modules/(packs/[^/]+|[^/]+)/public\\.ts$",
      ],
    },
  },
  {
    name: "no-prod-import-testing",
    comment:
      "ADR-0037: fake/stub ở modules/<m>/testing/ chỉ cho test — code production (không phải *.test.ts, không nằm trong testing/) không import",
    severity: "error",
    from: {
      path: "^apps/hub-api/src/",
      pathNot: ["\\.test\\.tsx?$", "(^|/)testing/"],
    },
    to: { path: "^apps/hub-api/src/modules/(packs/[^/]+|[^/]+)/testing/" },
  },
];
