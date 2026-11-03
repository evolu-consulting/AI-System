// Luật lọc test do người khác sở hữu (DLC/AIDLC của rowan): path của họ + test/e2e có token "dlc"; code dùng chung vẫn chạy.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { externalMatcher, parseExternalOwned } from "./external-owned.rules";
import { parseAffectedArgs } from "./test-affected.rules";

const entries = parseExternalOwned(
  readFileSync(resolve(import.meta.dir, "../../../tests/external-owned.json"), "utf8"),
);
const ext = externalMatcher(entries);

describe("external-owned · luật lọc", () => {
  it("file seed hợp lệ: owner rowan, 4 path", () => {
    expect(entries).toHaveLength(1);
    expect(entries[0]?.owner).toBe("rowan");
    expect(entries[0]?.paths).toHaveLength(4);
  });

  it("test dưới path của rowan bị bỏ (kể cả đường dẫn Windows)", () => {
    expect(ext("apps/dlc-workspace/src/a.test.ts")).toBe(true);
    expect(ext("apps/hub-api/src/modules/packs/dlc/x/y.int.test.ts")).toBe(true);
    expect(ext("tools/dlc-dify/src/z.test.ts")).toBe(true);
    expect(ext("packages/db/migrations-pack-dlc/0001.test.ts")).toBe(true);
    expect(ext("apps\\dlc-workspace\\src\\a.test.ts")).toBe(true);
  });

  it("mọi test/e2e có token dlc/aidlc trong đường dẫn bị bỏ", () => {
    expect(ext("tests/acceptance/DLC1/flow.int.test.ts")).toBe(true);
    expect(ext("tests/acceptance/aidlc/x.int.test.ts")).toBe(true);
    expect(ext("e2e/dlc/playwright.dlc.config.ts")).toBe(true);
    expect(ext("e2e/admin/flow-dlc.spec.ts")).toBe(true);
    expect(ext("apps/hub-api/src/modules/dlc-calls/calls.test.ts")).toBe(true);
  });

  it("code dùng chung vẫn chạy test của ta; 'sdlc' không phải dlc; code không-test có token dlc không bị coi là test", () => {
    expect(ext("apps/hub-api/src/modules/processes/run.test.ts")).toBe(false);
    expect(ext("apps/admin-web/src/features/processes/list.test.tsx")).toBe(false);
    expect(ext("packages/i18n/src/vi.test.ts")).toBe(false);
    expect(ext("tests/acceptance/P-a/scenario/sdlc.int.test.ts")).toBe(false);
    expect(ext("e2e/P-a/scenario/sdlc.pa.ts")).toBe(false);
    expect(ext("apps/hub-api/src/modules/dlc-calls/calls.ts")).toBe(false);
  });

  it("parseExternalOwned: lỗi nêu rõ; không mục ⇒ không bỏ gì; --include-external đọc từ tham số", () => {
    expect(() => parseExternalOwned("{}")).toThrow("entries");
    expect(() => parseExternalOwned('{"entries":[{"owner":"x"}]}')).toThrow("paths");
    expect(externalMatcher([])("apps/dlc-workspace/a.test.ts")).toBe(false);
    expect(parseAffectedArgs([]).includeExternal).toBe(false);
    expect(parseAffectedArgs(["--include-external"]).includeExternal).toBe(true);
  });
});
