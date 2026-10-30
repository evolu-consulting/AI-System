// dlc-dify · mỗi node code của flow quy trình: tham số `main(...)` khớp đúng biến được nối vào node (Dify gọi `main(**inputs)`).
import { describe, expect, test } from "bun:test";
import { PROCESSES, processDsl } from "./process-flows";

type DslNode = {
  id: string;
  data: { type: string; code?: string; variables?: { variable: string }[] };
};

const nodesOf = (dsl: Record<string, unknown>) =>
  (dsl as { workflow: { graph: { nodes: DslNode[] } } }).workflow.graph.nodes;

describe("process flows", () => {
  for (const p of PROCESSES) {
    test(`${p.key}: code node params = wired inputs`, () => {
      const dsl = processDsl(p, { hubUrl: "http://hub", wsUrl: "http://ws", wsToken: "t" });
      const code = nodesOf(dsl).filter((n) => n.data.type === "code");
      expect(code.length).toBeGreaterThan(0);
      for (const n of code) {
        const sig = /def main\(([^)]*)\)/.exec(n.data.code ?? "")?.[1] ?? "";
        const params = sig
          .split(",")
          .map((s) => s.split(":")[0]?.trim())
          .filter(Boolean)
          .sort();
        const vars = (n.data.variables ?? []).map((v) => v.variable).sort();
        expect({ node: n.id, params }).toEqual({ node: n.id, params: vars });
      }
    });
  }
});
