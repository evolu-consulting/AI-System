// HUB-FR-143…147 · ADM-FR-72 · T3a P-d (test-plan §7, spec-ca §2, plan-domain §4): nạp động module sản phẩm theo lớp bốn
// lớp (ADR-0023). Test viết TRƯỚC code ⇒ không import tĩnh file chưa có (giữ `bun run typecheck` xanh). Module vắng ⇒
// Proxy vắng — truy cập export ném "module vắng: <đường dẫn>" (đỏ từng `it`, rõ lý do); KHÔNG trả `{}` lặng lẽ.
// `P/` = `apps/hub-api/src/modules/processes/`. Đường dẫn = đường dẫn ĐÃ KẾ HOẠCH (plan-domain §4, spec-ca §2).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { absentModule, fn, type Loose, loadAnyOf, ROOT, tryLoad } from "../../P-a/_support/modules";

export { absentModule, fn, type Loose, loadAnyOf, ROOT, tryLoad };

export const PROC = "apps/hub-api/src/modules/processes";

/** Lớp 1: `P/domain/<rel>` (vd `runs/job-error.rules.ts`). */
export const loadDomain = (rel: string): Promise<Loose> => tryLoad(`${PROC}/domain/${rel}`);
/** Lớp 2: `P/application/<rel>` (vd `runs/handle-job-failure.usecase.ts`). */
export const loadUsecase = (rel: string): Promise<Loose> => tryLoad(`${PROC}/application/${rel}`);
/** Lớp 3: `P/adapters/<rel>` (vd `hub-uow.ts`). */
export const loadAdapter = (rel: string): Promise<Loose> => tryLoad(`${PROC}/adapters/${rel}`);

/** Lấy hàm `name` của module lớp 1 `rel` (module vắng ⇒ ném "module vắng"; hàm vắng ⇒ đỏ ở expect của `fn`). */
// biome-ignore lint/suspicious/noExplicitAny: hàm sản phẩm chưa có kiểu khi viết test
export async function domainFn(rel: string, name: string): Promise<(...a: any[]) => any> {
  return fn(await loadDomain(rel), name);
}

/** Lấy export (hằng/hàm) `name` của module lớp 1 `rel`; module vắng ⇒ ném "module vắng". */
// biome-ignore lint/suspicious/noExplicitAny: export sản phẩm chưa có kiểu khi viết test
export async function domainExport(rel: string, name: string): Promise<any> {
  const m = await loadDomain(rel);
  const v = m[name];
  if (v === undefined) throw new Error(`export vắng: ${name} (${PROC}/domain/${rel})`);
  return v;
}

// ---------- cổng lớp ổn định (T15, người dùng yêu cầu 2026-10-18) ----------
// Test P-d2 KHÔNG phụ thuộc đường dẫn file bên trong: chỉ nạp barrel `P/domain/index.ts` / `P/application/index.ts` (T17).
// Barrel vắng ⇒ "chưa có cổng lớp: … (T17)"; export vắng ⇒ "chưa có tính năng: <tên> (<task>)". Test P-d1 có thể dời sang
// đây sau (test-plan-d2 §0).
export type Layer = "domain" | "application";
const layerCache = new Map<Layer, Promise<Loose | null>>();
function loadBarrel(layer: Layer): Promise<Loose | null> {
  let p = layerCache.get(layer);
  if (!p) {
    p = (async () => {
      const rel = `${PROC}/${layer}/index.ts`;
      if (!existsSync(join(ROOT, rel))) return null;
      return tryLoad(rel);
    })();
    layerCache.set(layer, p);
  }
  return p;
}
/** Export `name` của barrel lớp `layer`; barrel vắng ⇒ ném "chưa có cổng lớp"; export vắng ⇒ "chưa có tính năng". */
// biome-ignore lint/suspicious/noExplicitAny: export sản phẩm chưa có kiểu khi viết test
export async function loadLayer(layer: Layer, name: string, task = "T17"): Promise<any> {
  const m = await loadBarrel(layer);
  if (!m) throw new Error(`chưa có cổng lớp: ${PROC}/${layer}/index.ts (T17)`);
  const v = m[name];
  if (v === undefined) throw new Error(`chưa có tính năng: ${name} (${task})`);
  return v;
}
// biome-ignore lint/suspicious/noExplicitAny: hàm sản phẩm chưa có kiểu khi viết test
type AnyFn = (...a: any[]) => any;
/** Như `loadLayer` nhưng đòi là hàm. */
export async function layerFn(layer: Layer, name: string, task = "T17"): Promise<AnyFn> {
  const v = await loadLayer(layer, name, task);
  if (typeof v !== "function") throw new Error(`chưa có tính năng: ${name} là hàm (${task})`);
  return v;
}
/** Admin `modules/workflow-tools/domain/index.ts` (T18a) — cùng khuôn cổng lớp. */
// biome-ignore lint/suspicious/noExplicitAny: hàm sản phẩm chưa có kiểu khi viết test
export async function adminToolsFn(name: string): Promise<(...a: any[]) => any> {
  const rel = "apps/admin-api/src/modules/workflow-tools/domain/index.ts";
  if (!existsSync(join(ROOT, rel))) throw new Error(`chưa có cổng lớp: ${rel} (T18a)`);
  const v = (await tryLoad(rel))[name];
  if (typeof v !== "function") throw new Error(`chưa có tính năng: ${name} (T18a)`);
  return v;
}

/** Contract (đã có; export mới vắng ⇒ `undefined` ⇒ đỏ ở expect). */
export const loadChat = (): Promise<Loose> => import("@ai/contracts/chat");
export const loadHubAdmin = (): Promise<Loose> => import("@ai/contracts/hub-admin");
export const loadTenantsContract = (): Promise<Loose> =>
  tryLoad("packages/contracts/src/tenants.ts");
