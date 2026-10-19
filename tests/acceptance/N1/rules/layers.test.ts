// PK-FR-09 · PK-AC11 · plan §9: depcruise phủ module gói. Dựng cây tạm `apps/hub-api/src/modules/packs/…` (đường dẫn khớp
// regexp luật) rồi chạy `.dependency-cruiser.cjs` THẬT: vi phạm ⇒ có lỗi đúng luật; cây sạch ⇒ 0 lỗi.
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { depcruiseBin, runDepcruise } from "../../../../tools/scripts/src/depcruise";
import { ROOT } from "../_support/load";

const SLOW = 120_000; // depcruise 1–5 s trên Windows
const M = "apps/hub-api/src/modules";
type V = { rule: { name: string }; from: string; to: string };

function cruise(files: Record<string, string>): V[] {
  const dir = mkdtempSync(join(tmpdir(), "n1-dc-"));
  try {
    for (const [rel, src] of Object.entries(files)) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, src);
    }
    const r = runDepcruise({
      cwd: dir,
      targets: ["apps"],
      config: join(ROOT, ".dependency-cruiser.cjs"),
      outputType: "json",
      bin: depcruiseBin(ROOT),
    });
    const start = r.out.indexOf("{");
    expect({ json: start >= 0 }).toEqual({ json: true });
    return (JSON.parse(r.out.slice(start)) as { summary: { violations: V[] } }).summary.violations;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const names = (v: V[], from: string) =>
  v.filter((x) => x.from.endsWith(from)).map((x) => x.rule.name);

describe("PK-AC11 · depcruise module gói", () => {
  it(
    "PK-AC11 · domain/ của module gói import adapters/ ⇒ lỗi ca-domain-builtin-only",
    () => {
      const v = cruise({
        [`${M}/packs/pkdemo/domain/bad.ts`]:
          'import { x } from "../adapters/db";\nexport const y = x;\n',
        [`${M}/packs/pkdemo/adapters/db.ts`]: "export const x = 1;\n",
      });
      expect(names(v, "pkdemo/domain/bad.ts")).toContain("ca-domain-builtin-only");
    },
    SLOW,
  );
  it(
    "PK-AC11 · domain/ import driver DB (postgres) ⇒ lỗi ca-domain-builtin-only",
    () => {
      const v = cruise({
        [`${M}/packs/pkdemo/domain/bad2.ts`]:
          'import postgres from "postgres";\nexport const y = postgres;\n',
      });
      expect(names(v, "pkdemo/domain/bad2.ts")).toContain("ca-domain-builtin-only");
    },
    SLOW,
  );
  it(
    "PK-FR-09 · luật pack-no-cross-pack: pkdemo import gói khác ⇒ lỗi; import kit/ của chính khung ⇒ sạch",
    () => {
      const v = cruise({
        [`${M}/packs/pkdemo/adapters/a.ts`]:
          'import { z } from "../../other/adapters/z";\nexport const y = z;\n',
        [`${M}/packs/other/adapters/z.ts`]: "export const z = 1;\n",
        [`${M}/packs/pkdemo/adapters/ok.ts`]:
          'import { k } from "../../kit/adapters/k";\nexport const y = k;\n',
        [`${M}/packs/kit/adapters/k.ts`]: "export const k = 1;\n",
      });
      expect(names(v, "pkdemo/adapters/a.ts")).toContain("pack-no-cross-pack");
      expect(names(v, "pkdemo/adapters/ok.ts")).not.toContain("pack-no-cross-pack");
    },
    SLOW,
  );
  it(
    "PK-FR-09 · luật pack-no-hub-modules: lớp trong module gói import modules/ của hub (config…) ⇒ lỗi",
    () => {
      const v = cruise({
        [`${M}/packs/pkdemo/adapters/a.ts`]:
          'import { c } from "../../../config/config.service";\nexport const y = c;\n',
        [`${M}/config/config.service.ts`]: "export const c = 1;\n",
      });
      expect(names(v, "pkdemo/adapters/a.ts")).toContain("pack-no-hub-modules");
    },
    SLOW,
  );
  it(
    "PK-FR-09 · luật pack-no-hub-schema: module gói import schema hub ⇒ lỗi",
    () => {
      const v = cruise({
        [`${M}/packs/pkdemo/adapters/a.ts`]:
          'import { t } from "../../../../../../../packages/db/src/schema/hub";\nexport const y = t;\n',
        ["packages/db/src/schema/hub.ts"]: "export const t = 1;\n",
      });
      expect(names(v, "pkdemo/adapters/a.ts")).toContain("pack-no-hub-schema");
    },
    SLOW,
  );
  it(
    "PK-FR-09 · packs.mount.ts (lớp 4) được import modules/config — không bị pack-no-hub-modules",
    () => {
      const v = cruise({
        [`${M}/packs/packs.mount.ts`]: `import { c } from "../config/config.service";\nexport const y = c;\n`,
        [`${M}/config/config.service.ts`]: "export const c = 1;\n",
      });
      expect(names(v, "packs/packs.mount.ts")).not.toContain("pack-no-hub-modules");
    },
    SLOW,
  );
});
