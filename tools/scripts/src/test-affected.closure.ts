// tool-affected-modules · bao đóng ngược có lý do + cắt tại file lắp ráp.
import type { Graph } from "./lib/import-graph";
import { isCompositionRoot } from "./test-affected.packs";
import type { Scope } from "./test-affected.scope.types";

/**
 * CR-121 B-2 (ADR-0037): `public.ts` của module là cửa hợp đồng. Đổi file trong module ⇒ kéo module đó + module import
 * `public.ts` của nó (1 bước); importer của importer KHÔNG bị kéo qua cửa thứ hai. Import sâu (không qua public.ts) vẫn đi đủ.
 */
export const PUBLIC_GATE_RE = /^apps\/[^/]+\/src\/modules\/(packs\/[^/]+|[^/]+)\/public\.ts$/;
export type Gate = { isGate: (f: string) => boolean; max: number };
const NO_GATE: Gate = { isGate: () => false, max: 0 };
export const PUBLIC_GATE: Gate = { isGate: (f) => PUBLIC_GATE_RE.test(f), max: 1 };

type Item = [file: string, seed: string];

/** Duyệt hết một mức: cạnh ngược thường ở lại mức này, cạnh ngược từ file cửa sang mức kế (`next`). */
function drainLevel(
  level: Item[],
  next: Item[],
  hops: number,
  ctx: {
    seen: Map<string, string>;
    rev: Pick<Graph, "rev">["rev"];
    ok: (r: string) => boolean;
    gate: Gate;
  },
): void {
  for (let it = level.pop(); it; it = level.pop()) {
    const [f, seed] = it;
    if (ctx.seen.has(f)) continue;
    ctx.seen.set(f, seed);
    const crossing = ctx.gate.isGate(f);
    if (crossing && hops >= ctx.gate.max) continue;
    const into = crossing ? next : level;
    for (const r of ctx.rev.get(f) ?? []) if (ctx.ok(r)) into.push([r, seed]);
  }
}

/**
 * Bao đóng ngược từ `seeds` (file → seed đầu tiên kéo nó); `cut(importer)` = bỏ cạnh ngược từ file lắp ráp không phải seed.
 * `gate`: đi qua tối đa `gate.max` file cửa (cạnh ngược từ file cửa sang importer ngoài module tính một bước).
 */
export function closureWhy(
  g: Pick<Graph, "rev">,
  seeds: ReadonlyMap<string, string>,
  cut: (importer: string) => boolean = () => false,
  gate: Gate = NO_GATE,
): Map<string, string> {
  const seen = new Map<string, string>();
  const ctx = {
    seen,
    rev: g.rev,
    gate,
    ok: (r: string): boolean => !seen.has(r) && (!cut(r) || seeds.has(r)),
  };
  let level: Item[] = [...seeds.keys()].map((k) => [k, k]);
  for (let hops = 0; level.length > 0; hops++) {
    const next: Item[] = [];
    drainLevel(level, next, hops, ctx);
    level = next;
  }
  return seen;
}
/** Tập file bị ảnh hưởng + lý do (`seed ← luật`): seed rộng đi đầy đủ, seed module cắt ở file lắp ráp; file đổi luôn nằm trong tập. */
export function affectedScoped(
  g: Pick<Graph, "rev">,
  scope: Scope,
  changed: readonly string[],
): { affected: Set<string>; why: Map<string, string> } {
  const why = new Map<string, string>();
  const rules = new Map([...scope.module, ...scope.broad]);
  const note = (f: string, seed: string) =>
    why.has(f) ||
    why.set(f, f === seed ? `${rules.get(seed) ?? "file đổi"}` : `${seed} ← ${rules.get(seed)}`);
  for (const [f, seed] of closureWhy(g, scope.broad)) note(f, seed);
  for (const [f, seed] of closureWhy(g, scope.module, isCompositionRoot, PUBLIC_GATE))
    note(f, seed);
  for (const f of changed) if (!why.has(f)) why.set(f, "file đổi");
  return { affected: new Set(why.keys()), why };
}
