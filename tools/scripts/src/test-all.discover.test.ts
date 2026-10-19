// #225 · khám phá cấu hình e2e phải thấy cấu hình gốc và mọi cấu hình dưới e2e/ (kể cả trên Windows).
import { expect, it } from "bun:test";
import { resolve } from "node:path";
import { findE2eConfigs } from "./test-all.discover";

it("findE2eConfigs: thấy playwright.config.ts gốc và e2e/N2, e2e/P-d", async () => {
  const found = (await findE2eConfigs(resolve(import.meta.dir, "../../.."))).map((f) =>
    f.replaceAll("\\", "/"),
  );
  expect(found).toContain("playwright.config.ts");
  expect(found).toContain("e2e/N2/playwright.n2.config.ts");
  expect(found).toContain("e2e/P-d/playwright.pd.config.ts");
});
