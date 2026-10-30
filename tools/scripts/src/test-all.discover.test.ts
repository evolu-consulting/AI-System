// #225 · khám phá cấu hình e2e phải thấy cấu hình gốc và mọi cấu hình dưới e2e/ (kể cả trên Windows).
// GX2: khớp danh sách ĐÚNG (18 = gốc + 17 dưới e2e/); thêm/bớt cấu hình ⇒ cập nhật danh sách này.
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
  "e2e/fnr-showcase/playwright.fnr.config.ts",
  "e2e/ops/playwright.ops.config.ts",
  "e2e/studio/playwright.config.ts",
  "e2e/x1/playwright.config.ts",
  "playwright.config.ts",
];

it("findE2eConfigs: đúng 22 cấu hình (gốc + 21 dưới e2e/), không thừa không thiếu", async () => {
  const found = (await findE2eConfigs(resolve(import.meta.dir, "../../.."))).map((f) =>
    f.replaceAll("\\", "/"),
  );
  expect(found.sort()).toEqual([...EXPECTED].sort());
  expect(found).toHaveLength(22);
});
