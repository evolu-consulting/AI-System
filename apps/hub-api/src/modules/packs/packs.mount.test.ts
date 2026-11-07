// PK-FR-09 · D-08 · review N1 m-04 + m-01: `pkdemo` fail-closed theo APP_ENV; luật tĩnh — chỉ `packages/db/src/*-scope.ts`
// (`scope.ts`, `hub-scope.ts`, `pack-scope.ts`) được `set_config('role', …)` / `set_config('app.tenant_id', …)` trong code nguồn.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createModuleRegistry } from "./kit/public";
import { mountedApps, verifyPackModules } from "./packs.modules-check";
import { pkdemoEnabled } from "./packs.mount";

describe("CR-125 m2 · MOD-FR-02 · verifyPackModules cuối mount", () => {
  const none = () =>
    createModuleRegistry({
      flow: { registerFactsReader: () => undefined, registerOutcomeHandler: () => undefined },
      nodes: { register: () => undefined, registerTool: () => undefined },
    });
  it("binding Ký số / sự kiện bị gỡ ⇒ ném câu «Khởi động dừng» + MOD_UNBOUND tiếng Việt", () => {
    expect(() => verifyPackModules(["core", "contracts", "community"], none())).toThrow(
      /^Khởi động dừng: \d+ lỗi module[\s\S]*\[MOD_UNBOUND\] Node «Ký số» \(contracts\.esign\) chưa có xử lý máy chủ/,
    );
  });
  it("chỉ gắn core (không DB) ⇒ không đòi binding app", () => {
    expect(() => verifyPackModules(mountedApps({}), none())).not.toThrow();
    expect(mountedApps({ packs: { contracts: false } })).toEqual(["core"]);
  });
});

const ROOT = join(import.meta.dir, "../../../../..");

describe("review m-04 · pkdemoEnabled", () => {
  it("chỉ development/test mở; production, vắng, giá trị lạ ⇒ tắt", () => {
    const on = ["development", "test", "production", undefined, "", "staging", "Test"].map(
      pkdemoEnabled,
    );
    expect(on).toEqual([true, true, false, false, false, false, false]);
  });
});

describe("review m-01 · set_config role/tenant chỉ ở *-scope.ts", () => {
  it("không file nguồn (ngoài test) nào trong apps/*/src, packages/*/src đặt role/app.tenant_id ngoài scope.ts/hub-scope.ts/pack-scope.ts", () => {
    const re = /set_config\(\s*'(role|app\.tenant_id)'\s*,/;
    const allowed = /^packages\/db\/src\/(scope|hub-scope|pack-scope)\.ts$/;
    const glob = new Bun.Glob("{apps,packages}/*/src/**/*.{ts,tsx}");
    const bad: string[] = [];
    for (const f of glob.scanSync({ cwd: ROOT })) {
      const rel = relative(ROOT, join(ROOT, f)).replaceAll("\\", "/");
      if (/\.test\.tsx?$/.test(rel) || allowed.test(rel)) continue;
      if (re.test(readFileSync(join(ROOT, rel), "utf8"))) bad.push(rel);
    }
    expect(bad).toEqual([]);
  });
  it("luật thật sự bắt được: 3 file scope đều chứa mẫu", () => {
    const re = /set_config\(\s*'(role|app\.tenant_id)'\s*,/;
    for (const f of ["scope", "hub-scope", "pack-scope"])
      expect(re.test(readFileSync(join(ROOT, `packages/db/src/${f}.ts`), "utf8"))).toBe(true);
  });
});
