// HUB-FR-104…117 · HUB-BR-23…28 · nạp động module sản phẩm P-a (mẫu X2b `_modules.ts`): test viết TRƯỚC code ⇒ import tĩnh
// file chưa có làm vỡ `bun run typecheck`. Đường dẫn = đường dẫn ĐÃ KẾ HOẠCH (plan-contract §7, §7.1; plan-step0 §2).
// Module vắng ⇒ `{}` ⇒ ca đỏ ở `expect(typeof mod.fn).toBe("function")` (test-plan §5), không đỏ ở import.
import { expect } from "bun:test";
import { join } from "node:path";
import { type Loose, ROOT } from "../../M1/_modules";

export { type Loose, ROOT };

const PROC = "apps/hub-api/src/modules/processes";

async function tryLoad(rel: string): Promise<Loose> {
  try {
    return await import(join(ROOT, rel));
  } catch {
    return {};
  }
}

/** `core/<name>.rules.ts` (B0): `bang`, `process-state`, `run-access`, `limits`, `task`, `thread`. */
export const loadCoreRules = (name: string): Promise<Loose> =>
  tryLoad(`${PROC}/core/${name}.rules.ts`);
/** `core/thread.ts` (B0): `enqueueThread(tx, ev)`. */
export const loadThread = (): Promise<Loose> => tryLoad(`${PROC}/core/thread.ts`);
/** `core/thread-poster.ts` (B0): `postThreadOnce`, `post`. */
export const loadThreadPoster = (): Promise<Loose> => tryLoad(`${PROC}/core/thread-poster.ts`);
/** `defs/def.rules.ts` (B3): `validateProcessDef`, `copyFromTemplate`. */
export const loadDefRules = (): Promise<Loose> => tryLoad(`${PROC}/defs/def.rules.ts`);
/** PF dùng: `runs/template.rules.ts`, `runs/team.rules.ts`, `gates/*.rules.ts`, `asks/ask.rules.ts`, … */
export const loadProcRules = (rel: string): Promise<Loose> => tryLoad(`${PROC}/${rel}`);

/** Contract chat (khối P-a chỉ thêm) — tồn tại sẵn; export mới vắng ⇒ `undefined`. */
export const loadChat = (): Promise<Loose> => import("@ai/contracts/chat");
/** Contract hub-admin (`HUB_ADMIN_PROCESS_ERRORS`, `ProcessDefInputSchema`, …). */
export const loadHubAdmin = (): Promise<Loose> => import("@ai/contracts/hub-admin");
/** `withHubScope` (đã có, `packages/db/src/hub-scope.ts`) — dựng tx Drizzle cho `enqueueThread`. */
export const loadHubScope = (): Promise<Loose> => tryLoad("packages/db/src/hub-scope.ts");
/** `runHubSeed` (đã có) — S0-32/33. */
export const loadSeed = (): Promise<Loose> => tryLoad("apps/hub-api/src/modules/seed/seed.ts");

/** Lấy hàm `name` của module; vắng ⇒ đỏ ở expect (đúng lý do). */
// biome-ignore lint/suspicious/noExplicitAny: hàm sản phẩm chưa có kiểu khi viết test
export function fn(mod: Loose, name: string): (...a: any[]) => any {
  const f = mod[name];
  expect({ [name]: typeof f }).toEqual({ [name]: "function" });
  return f;
}
