// HUB-FR-143…147 · ADM-FR-72 · T3a P-d (test-plan §7, spec-ca §2, plan-domain §4): nạp động module sản phẩm theo lớp bốn
// lớp (ADR-0023). Test viết TRƯỚC code ⇒ không import tĩnh file chưa có (giữ `bun run typecheck` xanh). Module vắng ⇒
// Proxy vắng — truy cập export ném "module vắng: <đường dẫn>" (đỏ từng `it`, rõ lý do); KHÔNG trả `{}` lặng lẽ.
// `P/` = `apps/hub-api/src/modules/processes/`. Đường dẫn = đường dẫn ĐÃ KẾ HOẠCH (plan-domain §4, spec-ca §2).
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

/** Contract (đã có; export mới vắng ⇒ `undefined` ⇒ đỏ ở expect). */
export const loadChat = (): Promise<Loose> => import("@ai/contracts/chat");
export const loadHubAdmin = (): Promise<Loose> => import("@ai/contracts/hub-admin");
export const loadTenantsContract = (): Promise<Loose> =>
  tryLoad("packages/contracts/src/tenants.ts");
