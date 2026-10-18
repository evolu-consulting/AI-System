// HUB-FR-143 · CA-R06 · plan-addendum A11 · review T6c (Trung #1): scope `system` (bỏ qua RLS) CHỈ cho vòng nền. Đường
// request — mọi `*.routes.ts`, `*.service.ts` của hub-api và điểm vào HTTP của PF1 (`conversation-start.ts`,
// `room-start.ts`) — không được gọi `.system(`/`.systemBatch(`, không biết `SystemUow`/`ProcessBgDeps`/`sysUow`, không tự
// dựng UoW (`hub-uow`). Kiểu đã chặn (`ProcessDeps.uow: TenantUow`); test này chặn đường vòng (ép kiểu, import thẳng).
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "..", "..");
const HTTP_ENTRY =
  /(\.routes|\.service)\.ts$|processes[\\/]runs[\\/](conversation-start|room-start)\.ts$/;
const FORBIDDEN: [string, RegExp][] = [
  ["gọi .system(", /\.system\s*(<[^>]*>)?\s*\(/],
  ["gọi .systemBatch(", /\.systemBatch\b/],
  ["kiểu SystemUow", /\bSystemUow\b/],
  ["kiểu ProcessBgDeps", /\bProcessBgDeps\b/],
  ["trường sysUow", /\bsysUow\b/],
  ["kiểu UnitOfWork đủ cổng", /\bUnitOfWork\b/],
  ["import adapter hub-uow", /adapters\/hub-uow/],
];

function httpEntryFiles(): string[] {
  const all = [...new Bun.Glob("**/*.ts").scanSync({ cwd: SRC })];
  return all.filter((f) => HTTP_ENTRY.test(f) && !/\.test\.ts$/.test(f)).sort();
}

/** Vi phạm `file: luật` trong một nội dung (tách để tự kiểm luật bằng mẫu dương). */
function violations(file: string, text: string): string[] {
  return FORBIDDEN.filter(([, re]) => re.test(text)).map(([why]) => `${file}: ${why}`);
}

describe("T6c · route/use case HTTP không chạm scope system", () => {
  it("HUB-FR-143 · quét đủ file đường request (có routes + service của processes)", () => {
    const files = httpEntryFiles();
    expect(files.some((f) => /processes[\\/]runs[\\/]runs\.routes\.ts$/.test(f))).toBe(true);
    expect(files.some((f) => /processes[\\/]runs[\\/]start\.service\.ts$/.test(f))).toBe(true);
    expect(files.some((f) => /processes[\\/]runs[\\/]conversation-start\.ts$/.test(f))).toBe(true);
    expect(files.length).toBeGreaterThan(20);
  });

  it("HUB-FR-143 · 0 vi phạm", () => {
    const bad = httpEntryFiles().flatMap((f) =>
      violations(relative(SRC, join(SRC, f)), readFileSync(join(SRC, f), "utf8")),
    );
    expect(bad).toEqual([]);
  });

  it("HUB-FR-143 · luật bắt được mẫu vi phạm (không xanh giả)", () => {
    const sample = [
      "await d.uow.system(tid, fn)",
      "await (d as any).uow.systemBatch(fn)",
      "import type { SystemUow } from '../application/ports'",
      "(d as ProcessBgDeps).sysUow",
      "const u = d.uow as UnitOfWork",
      "import { createHubUow } from '../adapters/hub-uow'",
      "await uow.system<number>(tid, fn)",
    ];
    expect(sample.map((s) => violations("x", s).length > 0)).toEqual(sample.map(() => true));
    expect(
      violations("x", 'withHubScope(d.db, { kind: "system" }, fn); d.uow.tenant(who, fn)'),
    ).toEqual([]);
  });
});
