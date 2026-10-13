// HUB-FR-68 · HUB-BR-15 · nạp động module thuần H4b-1 (plan §2.1–§2.3) — test viết TRƯỚC code: import tĩnh file chưa có
// làm vỡ `bun run typecheck`. Module/export vắng ⇒ `{}` ⇒ ca đỏ ở `expect(typeof f).toBe("function")`. Không DB/env
// (không import `_h4b1.ts`: H1 fixture đòi biến DB, `bun test` không nạp `.env.local`).
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
const DIR = "apps/hub-api/src/modules/secrets";
/** plan §2.1 */
export const loadRules = () => tryLoad(`${DIR}/secrets.rules.ts`);
/** plan §2.2 */
export const loadCrypto = () => tryLoad(`${DIR}/secrets.crypto.ts`);
/** spec §3 `@ai/contracts/hub-admin` (khối secrets). */
export const loadHubAdmin = (): Promise<Loose> => import("@ai/contracts/hub-admin");

// biome-ignore lint/suspicious/noExplicitAny: module nạp động, kết quả kiểm bằng expect
export type Fn = (...a: any[]) => any;
/** Lấy hàm theo tên; vắng ⇒ đỏ ở expect. */
export function fn(m: Loose, name: string): Fn {
  const f = m[name];
  if (typeof f !== "function") throw new Error(`qc: ${name} chưa có (plan §2)`);
  return f as Fn;
}
/** `{code, paths}` của lỗi ném (AppError: `.code`, `.details.issues[].path`), hoặc "ok". */
export function thrown(f: () => unknown): { code: string; paths?: string[] } | "ok" {
  try {
    f();
    return "ok";
  } catch (e) {
    const x = e as { code?: string; message?: string; details?: { issues?: { path?: unknown }[] } };
    const issues = x.details?.issues;
    const paths = issues?.map((i) => (Array.isArray(i.path) ? i.path.join(".") : String(i.path)));
    return paths
      ? { code: String(x.code ?? x.message), paths }
      : { code: String(x.code ?? x.message) };
  }
}
/** Thông điệp lỗi ném (hoặc "ok"). */
export function msgOf(f: () => unknown): string {
  try {
    f();
    return "ok";
  } catch (e) {
    return String((e as Error)?.message ?? e);
  }
}
