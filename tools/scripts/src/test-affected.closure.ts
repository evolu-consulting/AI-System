// tool-affected-modules · bao đóng ngược có lý do + cắt tại file lắp ráp.
import type { Graph } from "./lib/import-graph";
import { isCompositionRoot } from "./test-affected.packs";
import type { Scope } from "./test-affected.scope";

/** Bao đóng ngược từ `seeds` (file → seed đầu tiên kéo nó); `cut(importer)` = bỏ cạnh ngược từ file lắp ráp không phải seed. */
export function closureWhy(
  g: Pick<Graph, "rev">,
  seeds: ReadonlyMap<string, string>,
  cut: (importer: string) => boolean = () => false,
): Map<string, string> {
  const seen = new Map<string, string>();
  const queue: [string, string][] = [...seeds.keys()].map((k) => [k, k]);
  for (let it = queue.pop(); it; it = queue.pop()) {
    const [f, seed] = it;
    if (seen.has(f)) continue;
    seen.set(f, seed);
    for (const r of g.rev.get(f) ?? [])
      if (!seen.has(r) && (!cut(r) || seeds.has(r))) queue.push([r, seed]);
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
  for (const [f, seed] of closureWhy(g, scope.module, isCompositionRoot)) note(f, seed);
  for (const f of changed) if (!why.has(f)) why.set(f, "file đổi");
  return { affected: new Set(why.keys()), why };
}
