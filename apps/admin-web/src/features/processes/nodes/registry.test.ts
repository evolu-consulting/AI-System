// CR-103 · R1 fnr-registry: mọi loại executor trong union contract có mục registry editor; ô `executor` draft ↔ loại.
import { describe, expect, test } from "bun:test";
import { NODE_FAMILY_OF, ProcessStageDefSchema } from "@ai/contracts/hub-admin";
import { draftKindOf, FE_NODES } from "./registry";

describe("CR-103 · registry loại node (FE)", () => {
  test("mọi kind trong union contract có FeNode, họ khớp contract", () => {
    const kinds = ProcessStageDefSchema.shape.executor.options
      .map((o) => String(o.shape.kind.value))
      .sort();
    expect(Object.keys(FE_NODES).sort()).toEqual(kinds);
    for (const n of Object.values(FE_NODES)) expect(n.family).toBe(NODE_FAMILY_OF[n.kind]);
  });

  test("draftKindOf: giá trị ô executor ⇒ loại; trống/lạ ⇒ null", () => {
    expect(draftKindOf("agent:a1")).toBe("agent");
    expect(draftKindOf("team:t1")).toBe("team");
    expect(draftKindOf("apply")).toBe("apply");
    expect(draftKindOf("wait_until")).toBe("wait_until");
    expect(draftKindOf("tool")).toBe("tool");
    expect(draftKindOf("")).toBeNull();
    expect(draftKindOf("tool:x")).toBeNull();
    for (const n of Object.values(FE_NODES))
      if (n.draftValue !== null) expect(n.defaults().executor).toBe(n.draftValue);
  });
});
