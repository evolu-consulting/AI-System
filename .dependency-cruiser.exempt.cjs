// Tách khỏi .dependency-cruiser.cjs (giới hạn 400 dòng).
/** Luật ranh giới code sản phẩm: file test (`*.test.ts(x)`, kể cả `.int.`/`.perf.int.`) được import chéo để dựng fixture ⇒ không tính. */
const TEST_FILE = ".test.tsx?$";
const TEST_EXEMPT = new Set([
  "no-cross-module-repo",
  "pack-no-cross-pack",
  "pack-no-hub-modules",
  "contracts-no-process-engine",
  "pack-no-hub-modules-any-layer",
  "pack-no-platform-db-internals",
  "platform-no-pack-internals",
  "web-no-db-or-api",
]);
const exemptTests = (rules) =>
  rules.map((r) => {
    if (!TEST_EXEMPT.has(r.name)) return r;
    const prev = r.from.pathNot;
    return { ...r, from: { ...r.from, pathNot: prev ? [].concat(prev, TEST_FILE) : TEST_FILE } };
  });

/** Bọc cấu hình: luật ranh giới bỏ qua file test. */
const withTestExempt = (cfg) => ({ ...cfg, forbidden: exemptTests(cfg.forbidden) });

module.exports = { exemptTests, withTestExempt };
