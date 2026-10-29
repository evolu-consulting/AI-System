// CR-103 · R1 fnr-registry: mọi loại executor trong union contract có mục registry (thuần + chạy), họ khớp contract;
// lõi ngoài `nodes/` không import `nodes/<kind>/*` (chỉ `nodes/registry*`).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { EXECUTOR_KINDS } from "@ai/contracts/chat";
import { NODE_FAMILY_OF, ProcessStageDefSchema } from "@ai/contracts/hub-admin";
import { NODES, nodeSpecOf } from "./registry";
import { NODE_LAUNCHERS } from "./registry.launch";

const contractKinds = (): string[] =>
  ProcessStageDefSchema.shape.executor.options.map((o) => String(o.shape.kind.value)).sort();

describe("CR-103 · registry loại node (BE)", () => {
  test("mọi kind trong union contract có NodeSpec + NodeLauncher + họ", () => {
    const kinds = contractKinds();
    expect(kinds).toEqual([...EXECUTOR_KINDS].sort());
    expect(Object.keys(NODES).sort()).toEqual(kinds);
    expect(Object.keys(NODE_LAUNCHERS).sort()).toEqual(kinds);
    for (const k of kinds) {
      const spec = nodeSpecOf(k);
      expect(spec?.kind).toBe(k as never);
      expect(spec?.family).toBe(NODE_FAMILY_OF[k as keyof typeof NODE_FAMILY_OF]);
    }
    expect(nodeSpecOf("toString")).toBeUndefined();
  });
});

const SRC = join(import.meta.dir, "..", "..", "..", "..", "..");
const ROOTS = [
  join(SRC, "hub-api", "src", "modules"),
  join(SRC, "admin-web", "src", "features", "processes"),
];
const KIND_IMPORT = /from\s+["'][^"']*\/nodes\/(?!registry)[^"']+["']/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") walk(p, out);
    } else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("CR-103 · ranh giới import lõi ↔ node", () => {
  test("file ngoài `nodes/` chỉ import `nodes/registry*`, không `nodes/<kind>/*`", () => {
    const bad = ROOTS.flatMap((r) => walk(r))
      .filter((f) => !f.split(sep).includes("nodes"))
      .filter((f) => KIND_IMPORT.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f));
    expect(bad).toEqual([]);
  });
});
