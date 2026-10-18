// HUB-FR-104…117 · HUB-BR-23…28 · nạp động module sản phẩm P-a (mẫu X2b `_modules.ts`): test viết TRƯỚC code ⇒ import tĩnh
// file chưa có làm vỡ `bun run typecheck`. Đường dẫn = đường dẫn ĐÃ KẾ HOẠCH (plan-contract §7, §7.1; plan-step0 §2).
// T3a P-d (CONVENTIONS §10, test-plan P-d §7): module vắng ⇒ Proxy vắng — mọi truy cập thuộc tính ném
// "module vắng: <rel>" (ca đỏ từng `it`, rõ đường dẫn), KHÔNG còn trả `{}` lặng lẽ; file có mà nạp lỗi ⇒ ném lại kèm `cause`.
import { expect } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type Loose, ROOT } from "../../M1/_modules";

export { type Loose, ROOT };

const PROC = "apps/hub-api/src/modules/processes";

/** Module vắng: `then`/Symbol trả undefined (await + in ấn được), thuộc tính khác ném "module vắng: <rel>". */
export function absentModule(rel: string): Loose {
  return new Proxy(
    {},
    {
      get(_t, p) {
        if (p === "then" || typeof p === "symbol") return undefined;
        throw new Error(`module vắng: ${rel}`);
      },
    },
  );
}

/** Nạp `ROOT/rel`. File không có ⇒ `absentModule(rel)`; có mà lỗi (cú pháp, import con hỏng) ⇒ ném lại kèm `cause`. */
export async function tryLoad(rel: string): Promise<Loose> {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return absentModule(rel);
  try {
    return await import(abs);
  } catch (e) {
    throw new Error(`nạp module lỗi: ${rel}`, { cause: e });
  }
}

/** Gộp export của mọi module CÓ THẬT trong `rels` (đầu danh sách thắng); không module nào có ⇒ ném "module vắng: …". */
export async function loadAnyOf(rels: readonly string[]): Promise<Loose> {
  const present = rels.filter((r) => existsSync(join(ROOT, r)));
  if (present.length === 0) throw new Error(`module vắng: ${rels.join(" | ")}`);
  const mods = await Promise.all(present.map((r) => tryLoad(r)));
  return Object.assign({}, ...mods.reverse());
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
/** PF dùng: `runs/template.rules.ts`, `runs/team.rules.ts`, `gates/*.rules.ts`, `domain/asks/forward.rules.ts`, … */
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
