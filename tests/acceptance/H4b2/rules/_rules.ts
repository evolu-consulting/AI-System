// HUB-FR-66 · HUB-FR-67 · nạp động module thuần H4b-2 (plan §2.1–§2.3) — test viết TRƯỚC code: import tĩnh file chưa có
// làm vỡ `bun run typecheck`. Module/export vắng ⇒ `{}` ⇒ ca đỏ ở `fn()` ("qc: <hàm> chưa có"). Không DB/env.
import { join } from "node:path";
import { type Loose, ROOT } from "../../M1/_modules";

export type { Loose };

async function tryLoad(rel: string): Promise<Loose> {
  try {
    return await import(join(ROOT, rel));
  } catch {
    return {};
  }
}
const DIR = "apps/hub-api/src/modules/studio/models";
/** plan §2.1 */
export const loadModels = () => tryLoad(`${DIR}/models.rules.ts`);
/** plan §2.2 */
export const loadCheck = () => tryLoad(`${DIR}/provider-check.rules.ts`);
/** plan §2.3 */
export const loadPick = () => tryLoad("apps/hub-api/src/modules/runner/profile-step.rules.ts");
/** spec §3 `@ai/contracts/studio` (khối models). */
export const loadStudio = (): Promise<Loose> => import("@ai/contracts/studio");

// biome-ignore lint/suspicious/noExplicitAny: module nạp động, kết quả kiểm bằng expect
export type Fn = (...a: any[]) => any;
/** Lấy hàm theo tên; vắng ⇒ ném (ca đỏ đúng lý do: chưa có code). */
export function fn(m: Loose, name: string): Fn {
  const f = m[name];
  if (typeof f !== "function") throw new Error(`qc: ${name} chưa có (plan §2)`);
  return f as Fn;
}
