// #225 · khám phá cấu hình e2e phải thấy cấu hình gốc và mọi cấu hình dưới e2e/ (kể cả trên Windows).
// GX2: khớp danh sách ĐÚNG (29 = gốc + 28 dưới e2e/); thêm/bớt cấu hình ⇒ cập nhật danh sách này.
import { expect, it } from "bun:test";
import { resolve } from "node:path";
import { findE2eConfigs } from "./test-all.discover";

const EXPECTED = [
  "e2e/K1/playwright.k1.config.ts",
  "e2e/N1/playwright.config.ts",
  "e2e/N2/playwright.n2.config.ts",
  "e2e/P-a/playwright.pa.config.ts",
  "e2e/P-b/playwright.pb.config.ts",
  "e2e/P-b2/playwright.pb2.config.ts",
  "e2e/P-c/playwright.pc.config.ts",
  "e2e/P-c2/playwright.pc2.config.ts",
  "e2e/P-d/playwright.pd.config.ts",
  "e2e/chat/playwright.config.ts",
  "e2e/chat/playwright.x2a.config.ts",
  "e2e/chat/playwright.x2b.config.ts",
  "e2e/chat/playwright.x2b2.config.ts",
  "e2e/combine/playwright.config.ts",
  "e2e/community-web/playwright.config.ts",
  "e2e/community-web/playwright.stack.config.ts",
  "e2e/contracts-web/playwright.config.ts",
  "e2e/cr127/playwright.cr127.config.ts",
  "e2e/cr161/playwright.cr161.config.ts",
  "e2e/cr169/playwright.cr169.config.ts",
  "e2e/flows3/playwright.flows3.config.ts",
  "e2e/fnr-showcase/playwright.fnr.config.ts",
  "e2e/journey-approval/playwright.journey-fsc.config.ts",
  "e2e/journey-approval/playwright.journey-purchase.config.ts",
  "e2e/journey-approval/playwright.journey.config.ts",
  "e2e/ops/playwright.ops.config.ts",
  "e2e/pm-checklist/playwright.pm.config.ts",
  "e2e/studio/playwright.config.ts",
  "e2e/workspace-web/playwright.stack.config.ts",
  "e2e/x1/playwright.config.ts",
  "playwright.config.ts",
];

it("findE2eConfigs: đúng 31 cấu hình (gốc + 30 dưới e2e/; CR-165 thêm flows3; CR-127 gỡ journey-ms, CR-161 thêm cr161, CR-169 thêm cr169; smoke-journey và prod-journey là công cụ deploy/smoke, bị loại), không thừa không thiếu", async () => {
  const found = (await findE2eConfigs(resolve(import.meta.dir, "../../.."))).map((f) =>
    f.replaceAll("\\", "/"),
  );
  expect(found.sort()).toEqual([...EXPECTED].sort());
  expect(found).toHaveLength(31);
});

it("findE2eConfigs: loại e2e/smoke-journey (công cụ kiểm môi trường thật, không thuộc bộ evotest)", async () => {
  const found = (await findE2eConfigs(resolve(import.meta.dir, "../../.."))).map((f) =>
    f.replaceAll("\\", "/"),
  );
  expect(found.some((f) => f.startsWith("e2e/smoke-journey/"))).toBe(false);
});

it("findE2eConfigs: loại e2e/prod-journey (chỉ chạy qua deploy/smoke/prod-journey.ps1, cần PJ_CW + môi trường đã deploy)", async () => {
  const found = (await findE2eConfigs(resolve(import.meta.dir, "../../.."))).map((f) =>
    f.replaceAll("\\", "/"),
  );
  expect(found.some((f) => f.startsWith("e2e/prod-journey/"))).toBe(false);
});
