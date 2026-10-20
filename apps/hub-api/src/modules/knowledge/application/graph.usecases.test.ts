// G1 · use case đồ thị: kiểm đầu vào TRƯỚC khi mở tx (sai ⇒ mã ổn định, 0 tx), kẹp limit, mỗi lời gọi đúng một tx.
import { describe, expect, it } from "bun:test";
import type { GraphRepo, GraphUow } from "./graph.ports";
import { graphUsecases } from "./graph.usecases";

const T = "00000000-0000-4000-8000-0000000000aa";
const D = "00000000-0000-4000-8000-000000000001";
const C = "00000000-0000-4000-8000-000000000011";
const who = { tenantId: T, userId: null };

function fake() {
  const calls: { fn: string; args: unknown[] }[] = [];
  let tx = 0;
  const rec =
    <R>(fn: string, out: R) =>
    async (...args: unknown[]) => {
      calls.push({ fn, args });
      return out;
    };
  const repo: GraphRepo = {
    attach: rec("attach", undefined),
    linkDocuments: rec("linkDocuments", 1),
    expand: rec("expand", [C]),
    hasAlias: rec("hasAlias", true),
    addAlias: rec("addAlias", true),
    addLinks: rec("addLinks", 2),
    similarDocuments: rec("similarDocuments", []),
    neighbourhood: rec("neighbourhood", [
      { row: "doc", src: D, dst: null, label: "g1", ntype: "Document", ltype: null },
    ]),
    corpus: rec("corpus", []),
    stats: rec("stats", {
      entities: { total: 0, byType: {}, aliasPairs: 0 },
      links: { conflicts: 0, duplicates: 0 },
    }),
    conflicts: rec("conflicts", []),
  };
  const uow: GraphUow = {
    tenant: (_w, fn) => {
      tx++;
      return fn({ graph: repo });
    },
  };
  return { g: graphUsecases({ uow }), calls, txs: () => tx };
}

describe("G1 · graph use cases", () => {
  it("id/khoá sai ⇒ mã lỗi, không mở tx", async () => {
    const f = fake();
    expect(await f.g.similarDocuments(who, "g1")).toEqual({ ok: false, code: "ID_INVALID" });
    expect(await f.g.neighbourhood(who, "")).toEqual({ ok: false, code: "ID_INVALID" });
    expect(await f.g.expand(who, ["  "])).toEqual({ ok: false, code: "KEY_INVALID" });
    expect(await f.g.expand(who, ["P:a"], ["g1:0"])).toEqual({ ok: false, code: "ID_INVALID" });
    expect(await f.g.hasAlias(who, "", "x")).toEqual({ ok: false, code: "KEY_INVALID" });
    expect(await f.g.addLinks(who, [{ a: C, b: "x", kind: "SIMILAR" }])).toEqual({
      ok: false,
      code: "LINK_INVALID",
    });
    expect(await f.g.addLinks(who, [{ a: C, b: D, kind: "OTHER" as never, score: 1 }])).toEqual({
      ok: false,
      code: "LINK_INVALID",
    });
    expect(
      await f.g.attach(who, D, [
        { chunkId: C, entities: [{ key: "P:a", name: "", type: "P" }], relations: [] },
      ]),
    ).toEqual({ ok: false, code: "ENTITY_INVALID" });
    expect(f.txs()).toBe(0);
  });

  it("đầu vào rỗng ⇒ kết quả rỗng, không mở tx; alias với chính nó ⇒ false", async () => {
    const f = fake();
    expect(await f.g.expand(who, [])).toEqual({ ok: true, value: [] });
    expect(await f.g.addLinks(who, [])).toEqual({ ok: true, value: 0 });
    expect(await f.g.linkDocuments(who, D, [])).toEqual({ ok: true, value: 0 });
    expect(await f.g.addAlias(who, "P:a", "P:a")).toEqual({ ok: true, value: false });
    expect(f.txs()).toBe(0);
  });
});

describe("G1 · graph use cases (tiếp)", () => {
  it("limit kẹp theo GRAPH_LIMITS; mỗi lời gọi đúng một tx", async () => {
    const f = fake();
    await f.g.expand(who, ["P:a"], [C], 10_000);
    await f.g.similarDocuments(who, D, "abc");
    await f.g.corpus(who, 0, 5000);
    await f.g.conflicts(who, -3);
    expect(f.calls.map((c) => [c.fn, c.args.at(-1)])).toEqual([
      ["expand", 200],
      ["similarDocuments", 200],
      ["corpus", 1000],
      ["conflicts", 1],
    ]);
    expect(f.calls[2]?.args[0]).toBe(1); // minShared kẹp về 1
    expect(f.txs()).toBe(4);
  });

  it("neighbourhood dựng đồ thị từ hàng repo", async () => {
    const f = fake();
    expect(await f.g.neighbourhood(who, D)).toEqual({
      ok: true,
      value: { nodes: [{ id: D, label: "g1", type: "Document" }], links: [] },
    });
  });
});
