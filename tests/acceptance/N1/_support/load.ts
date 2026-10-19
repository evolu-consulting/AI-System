// PK-FR-01…09 · N1 · nạp ĐỘNG module chưa có (qc viết test TRƯỚC code, `tsc -p tsconfig.tests.json` phải sạch). Thiếu file ⇒
// ném "chưa có tính năng: …" NGAY (Luật 4c: đỏ vì thiếu tính năng, không vì lỗi dựng). Chỉ dùng chữ ký ở plan.md §2–§9.
// Không chứa `it(...)`.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "../../../..");
// biome-ignore lint/suspicious/noExplicitAny: module chưa tồn tại khi viết test (xem comment đầu file)
export type Loose = Record<string, any>;

/** Lỗi "chưa có tính năng" — đỏ ngay với lý do rõ. */
export function noFeature(what: string, task: string, detail = ""): never {
  throw new Error(`chưa có tính năng: ${what} (${task})${detail ? ` — ${detail}` : ""}`);
}

async function need(rel: string, what: string, task: string): Promise<Loose> {
  if (!existsSync(join(ROOT, rel))) noFeature(what, task, `thiếu ${rel}`);
  return (await import(join(ROOT, rel))) as Loose;
}

export const loadPackContract = () =>
  need("packages/contracts/src/packs.ts", "contract packs", "T5a");
export const loadMigratePacks = () =>
  need("packages/db/src/migrate-packs.ts", "runPackMigrations", "T5a");
export const loadPackScope = () => need("packages/db/src/pack-scope.ts", "withPackScope", "T5c");
export const loadPackAccessRules = () =>
  need("apps/hub-api/src/modules/packs/kit/domain/pack-access.rules.ts", "checkPackAccess", "T5b");
export const loadDocxRules = () =>
  need("apps/hub-api/src/modules/packs/kit/domain/docx.rules.ts", "checkZipEntries", "T5g");

/** Adapter DOCX: `createDocxConverter()` ⇒ `{ toMarkdown(bytes), close?() }` (plan §7; tên hàm xuất = Cần bổ sung #4). */
export const loadDocxAdapter = () =>
  need("apps/hub-api/src/modules/packs/kit/adapters/docx/index.ts", "adapter DOCX", "T5g");

/** Ca DOCX phụ thuộc quyết định người dùng (spec Q3 · D-10): ADR-0024 chưa `Accepted` ⇒ đỏ ngay, ghi rõ lý do phụ thuộc. */
export function needAdr0024Accepted(): void {
  const p = join(ROOT, "docs/adr/0024-docx-to-markdown.md");
  const txt = existsSync(p) ? readFileSync(p, "utf8") : "";
  if (
    !/^\W*(status|trạng thái)\W*:?\s*\W*accepted/im.test(txt) &&
    !/\bAccepted\b/.test(txt.slice(0, 600))
  )
    noFeature("DOCX → Markdown", "T5g", "PHỤ THUỘC: ADR-0024 chưa Accepted (Gate Q3/D-10)");
}
