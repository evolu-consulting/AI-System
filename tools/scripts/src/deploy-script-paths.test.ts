// Script deploy (setup.sh / up.sh / tenants/*.sh) gọi `tool <file>.ts` ⇒ file đó phải còn trong repo.
// Bắt ở tầng unit lỗi đã lọt lên lúc deploy prod (2026-11-16: setup.sh gọi process-library-backfill.ts đã gỡ ở CR-127).
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");
const DIRS = ["deploy/prod-sohoptac2", "deploy/stg-test", "deploy/tenants"];

function shellFiles(): string[] {
  return DIRS.flatMap((d) =>
    existsSync(join(ROOT, d))
      ? readdirSync(join(ROOT, d))
          .filter((f) => f.endsWith(".sh"))
          .map((f) => `${d}/${f}`)
      : [],
  );
}

/** Đường dẫn `.ts` đứng ngay sau từ `tool` (dịch vụ compose chạy bun) trong một dòng lệnh. */
export function toolScripts(text: string): string[] {
  const out = new Set<string>();
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("#")) continue;
    for (const m of line.matchAll(/\btool\s+((?:apps|packages|tools)\/[\w./-]+\.ts)\b/g))
      out.add(m[1] as string);
  }
  return [...out];
}

describe("deploy-script-paths", () => {
  test("toolScripts lấy đúng đường dẫn, bỏ dòng chú thích", () => {
    const sh =
      "dc run --rm -T -e X tool packages/db/src/migrate.ts\n# dc run tool apps/old/gone.ts\n";
    expect(toolScripts(sh)).toEqual(["packages/db/src/migrate.ts"]);
  });

  test("mọi script `tool <file>.ts` mà script deploy gọi đều tồn tại", () => {
    const missing = shellFiles().flatMap((f) =>
      toolScripts(readFileSync(join(ROOT, f), "utf8"))
        // Bộ kit có thể chép file nằm cạnh script vào image (vd deploy/stg-test/stg-seed.ts ⇒ tools/scripts/src/).
        .filter(
          (p) => !existsSync(join(ROOT, p)) && !existsSync(join(ROOT, dirname(f), basename(p))),
        )
        .map((p) => `${f} → ${p}`),
    );
    expect(missing).toEqual([]);
  });
});
