// arch-a1 · luật giữ packages/contracts THUẦN (shared kernel: kiểu + zod) — điều kiện để application import nó (ca-application-inward-only).

/** @type {import('dependency-cruiser').IForbiddenType[]} */
module.exports = [
  {
    name: "contracts-pure",
    comment: "T-DEP-6: contracts chỉ là zod, không phụ thuộc db/app",
    severity: "error",
    from: { path: "(^|/)packages/contracts/" },
    to: { path: ["(^|/)packages/db/", "(^|/)@ai/db(/|$)", "(^|/)apps/"] },
  },
  {
    name: "contracts-only-zod",
    comment:
      "arch-a1: điều kiện để application import contracts (shared kernel) — mã production của contracts chỉ phụ thuộc zod, không core Node/Bun, không package npm khác",
    severity: "error",
    from: {
      path: "(^|/)packages/contracts/src/",
      pathNot: "\\.test\\.tsx?$|(^|/)(__tests__|testing)/",
    },
    to: {
      dependencyTypes: ["core", "npm", "npm-dev", "npm-peer", "npm-optional"],
      pathNot: "(^|/)node_modules/(\\.bun/)?zod[@/]",
    },
  },
];
