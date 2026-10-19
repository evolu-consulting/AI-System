// F1 (CR-095) · danh sách suite đóng băng: mẫu khớp đúng file, không mẫu nào "chết" (module đổi tên mà quên cập nhật), bunfig cổng sinh đúng.
import { describe, expect, it } from "bun:test";
import { Glob } from "bun";
import {
  FROZEN_E2E_CONFIGS,
  FROZEN_TEST_GLOBS,
  gateBunfig,
  isFrozenConfig,
  isFrozenFile,
} from "./frozen.rules";
import { repoRoot } from "./lib/git";

describe("F1 · frozen.rules", () => {
  it("isFrozenFile: module đóng băng khớp, module đang dùng thì không", () => {
    expect(isFrozenFile("apps/hub-api/src/modules/processes/core/x.test.ts")).toBe(true);
    expect(isFrozenFile("apps/admin-api/src/modules/transfer/transfer.int.test.ts")).toBe(true);
    expect(isFrozenFile("tests/acceptance/P-d/a/b.int.test.ts")).toBe(true);
    expect(isFrozenFile("tests/acceptance/X2a/rooms.int.test.ts")).toBe(true);
    expect(isFrozenFile("tests/acceptance/X2a/me-stream.int.test.ts")).toBe(false);
    expect(isFrozenFile("tests/acceptance/N2/x.int.test.ts")).toBe(false); // cầu gói ↔ engine: đang dùng
    expect(isFrozenFile("tests/acceptance/HD3/flow.int.test.ts")).toBe(false);
    expect(isFrozenFile("apps/hub-api/src/modules/packs/x.test.ts")).toBe(false);
    expect(isFrozenFile("apps/hub-api/src/modules/runs/runs.int.test.ts")).toBe(false);
    expect(isFrozenFile(".\\apps\\chat-web\\src\\features\\rooms\\a.test.tsx")).toBe(true);
  });

  it("mỗi mẫu đóng băng khớp ít nhất một file thật", async () => {
    const root = repoRoot();
    const files = Bun.spawnSync(["git", "ls-files", "-co", "--exclude-standard"], { cwd: root })
      .stdout.toString()
      .split("\n")
      .map((f) => f.trim());
    for (const g of FROZEN_TEST_GLOBS) {
      const glob = new Glob(g);
      expect({ g, hit: files.some((f) => glob.match(f)) }).toEqual({ g, hit: true });
    }
  });

  it("mỗi cấu hình e2e đóng băng tồn tại", async () => {
    for (const c of FROZEN_E2E_CONFIGS)
      expect(await Bun.file(`${repoRoot()}/${c}`).exists()).toBe(true);
    expect(isFrozenConfig("e2e/P-a/playwright.pa.config.ts")).toBe(true);
    expect(isFrozenConfig("e2e/contracts-web/playwright.config.ts")).toBe(false);
  });
  it("gateBunfig: thêm mẫu vào pathIgnorePatterns, giữ mẫu cũ", () => {
    const out = gateBunfig('[test]\npathIgnorePatterns = ["e2e/**", "spikes/**"]\n');
    expect(out).toContain('"e2e/**", "spikes/**", "apps/hub-api/src/modules/{processes,');
    expect(out.match(/pathIgnorePatterns/g)?.length).toBe(1);
  });
});
