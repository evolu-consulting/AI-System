// HUB-FR-131…134 · nạp động module thuần K1 (plan §2.1–§2.5, CR-073) — test viết TRƯỚC code: import tĩnh file chưa có
// làm vỡ `bun run typecheck`. Module/export vắng ⇒ `{}` ⇒ ca đỏ ở `fn()` ("qc: <tên> chưa có"). Không DB/env.
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
const DIR = "apps/hub-api/src/modules/kh";
/** plan §2.1 */
export const loadRules = () => tryLoad(`${DIR}/kh.rules.ts`);
/** plan §2.2 */
export const loadCheck = () => tryLoad(`${DIR}/kh.check.rules.ts`);
/** plan §2.3 */
export const loadAgent = () => tryLoad(`${DIR}/kh.agent.rules.ts`);
/** plan §2.4 */
export const loadQuery = () => tryLoad(`${DIR}/kh.query.rules.ts`);
/** plan §2.5 */
export const loadSummary = () => tryLoad(`${DIR}/kh.summary.rules.ts`);
export const loadHubAdmin = (): Promise<Loose> => import("@ai/contracts/hub-admin");
export const loadChat = (): Promise<Loose> => import("@ai/contracts/chat");
export const loadStudio = (): Promise<Loose> => import("@ai/contracts/studio");

// biome-ignore lint/suspicious/noExplicitAny: module nạp động, kết quả kiểm bằng expect
export type Fn = (...a: any[]) => any;
/** Lấy hàm theo tên; vắng ⇒ ném (ca đỏ đúng lý do). */
export function fn(m: Loose, name: string): Fn {
  const f = m[name];
  if (typeof f !== "function") throw new Error(`qc: ${name} chưa có (plan §2)`);
  return f as Fn;
}
/** Lấy schema zod theo tên; vắng ⇒ ném. */
// biome-ignore lint/suspicious/noExplicitAny: schema zod nạp động
export function schema(m: Loose, name: string): any {
  const s = m[name];
  if (typeof s?.safeParse !== "function") throw new Error(`qc: ${name} chưa có (spec §3.1)`);
  return s;
}
export const ok = (s: { safeParse: Fn }, v: unknown): boolean => s.safeParse(v).success === true;
/** Mảng / zod enum / object hằng ⇒ danh sách chuỗi phẳng (hình hằng không ép buộc). */
export function flat(v: unknown): string[] {
  if (Array.isArray(v)) return v.flatMap(flat);
  if (typeof v === "string") return [v];
  const o = v as { options?: unknown } | null;
  if (o && Array.isArray(o.options)) return flat(o.options);
  if (o && typeof o === "object") return [...Object.keys(o), ...Object.values(o).flatMap(flat)];
  return [];
}
