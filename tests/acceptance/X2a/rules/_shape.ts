// X2a-AC11 · "hình" của một export `@ai/contracts/chat` để snapshot (test-plan X2a §5.1 R33): schema zod → JSON Schema
// (zod của `packages/contracts`, input), hằng → giá trị JSON, hàm → số tham số. Không phụ thuộc DB/env.
import { join } from "node:path";
import { ROOT } from "../_modules";

// biome-ignore lint/suspicious/noExplicitAny: zod nạp động từ packages/contracts (gốc repo không khai zod)
type Z = any;
let zMod: Z;
async function zod(): Promise<Z> {
  if (!zMod) zMod = await import(Bun.resolveSync("zod", join(ROOT, "packages/contracts")));
  return zMod.z ?? zMod;
}

export async function shapeOf(v: unknown): Promise<unknown> {
  if (v && typeof v === "object" && "_zod" in v) {
    const z = await zod();
    try {
      return { zod: z.toJSONSchema(v, { unrepresentable: "any", io: "input" }) };
    } catch {
      return { zod: (v as { _zod: { def: { type: string } } })._zod.def.type };
    }
  }
  if (typeof v === "function") return { fn: v.length };
  if (v instanceof RegExp) return { re: String(v) };
  return { value: JSON.parse(JSON.stringify(v ?? null)) };
}

export async function shapes(
  mod: Record<string, unknown>,
  names: string[],
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const n of [...names].sort()) out[n] = await shapeOf(mod[n]);
  return out;
}

/** Sinh snapshot (chạy một lần ở QC1 trên commit trước B2): `bun tests/acceptance/X2a/rules/_shape.ts`. */
if (import.meta.main) {
  const mod = (await import("@ai/contracts/chat")) as Record<string, unknown>;
  const snap = await shapes(mod, Object.keys(mod));
  await Bun.write(
    join(import.meta.dir, "__fixtures__/chat-exports-c1.json"),
    `${JSON.stringify(snap, null, 1)}\n`,
  );
  console.log(`chat-exports-c1.json: ${Object.keys(snap).length} export`);
}
