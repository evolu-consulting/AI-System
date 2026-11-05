// tool-affected-modules · bảng gói → vùng mã/test/e2e + nhận diện file lắp ráp (cắt bao đóng). Hàm/hằng thuần.
export type PackModule = { prefixes: string[]; e2e: string[] };
/** Gói → vùng mã/test của nó (khoá = `key` trong `PACK_DIRS` của migrate-packs.ts; test khoá đảm bảo đủ) + cấu hình e2e phục vụ. */
export const PACK_MODULES: Record<string, PackModule> = {
  community: {
    prefixes: [
      "apps/hub-api/src/modules/packs/community",
      "apps/workspace-web/src/modules/community/",
      "packages/contracts/src/pack-community/",
      "e2e/community-web/",
      "tests/acceptance/com-c3/",
      "tests/acceptance/com-c7/",
    ],
    e2e: ["e2e/community-web/*"],
  },
  contracts: {
    prefixes: [
      "apps/hub-api/src/modules/packs/contracts/",
      "apps/workspace-web/src/features/contracts-list/",
      "apps/workspace-web/src/modules/contracts/",
      "packages/contracts/src/pack-contracts/",
      "e2e/contracts-web/",
      "tests/acceptance/CF/",
    ],
    e2e: [
      "e2e/contracts-web/playwright.config.ts",
      "e2e/journey-approval/playwright.journey.config.ts",
    ],
  },
  knowledge: {
    prefixes: ["apps/hub-api/src/modules/knowledge/", "tests/acceptance/N4/"],
    e2e: [],
  },
  dlc: {
    prefixes: [
      "apps/hub-api/src/modules/packs/dlc/",
      "apps/hub-api/src/modules/dlc-calls/",
      "apps/dlc-workspace/",
    ],
    e2e: [],
  },
  pkdemo: {
    prefixes: ["apps/hub-api/src/modules/packs/pkdemo/", "tests/acceptance/N1/"],
    e2e: ["e2e/N1/playwright.config.ts"],
  },
};

/** File lắp ráp (mọi module boot qua đây): cắt cạnh ngược KHI nó không phải file đổi. */
export const isCompositionRoot = (f: string): boolean =>
  /^apps\/[^/]+\/src\/(app|server)\.ts$/.test(f) ||
  /\.mount\.ts$/.test(f) ||
  /packs\.after-mount\.ts$/.test(f);

export const packOf = (f: string): string | undefined =>
  Object.entries(PACK_MODULES).find(([, m]) => m.prefixes.some((p) => f.startsWith(p)))?.[0];
