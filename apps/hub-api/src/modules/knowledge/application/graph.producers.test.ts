// R1 · bộ sinh đồ thị với cổng G1 giả + AI giả: mỗi tài liệu gọi attach/linkDocuments/addLinks đúng MỘT lần (lô), ứng viên bí
// danh một lần đọc; AI vắng ⇒ không trích thực thể nhưng vẫn LINKS_TO + SIMILAR; hợp đồng ⇒ không so giống; bước lỗi không chặn
// bước sau.
import { describe, expect, it } from "bun:test";
import { fakeGraphAi } from "../adapters/graph-ai.adapters";
import { graphProducers, type IngestUow, toChunkGraph } from "./graph.producers";
import type { GraphService } from "./graph.usecases";
import type { Hit } from "./ports";

const who = { tenantId: "7e5d0000-0000-4000-8000-000000000001", userId: null };
const DOC = "7e5d0000-0000-4000-8000-0000000000d1";
const hit = (id: string, docId: string, body: string): Hit => ({
  chunkId: id,
  docId,
  title: "t",
  heading: "",
  clauseNo: null,
  ord: 0,
  body,
  score: 1,
});
const MINE = [
  hit(
    "c1",
    DOC,
    "Dự án Apollo do Nguyen An phụ trách, thanh toán trong vòng 30 ngày kể từ ngày nhận hóa đơn",
  ),
];
const OTHER = hit(
  "o1",
  "other-doc",
  "Dự án Apollo do Nguyen An phụ trách, thanh toán trong vòng 45 ngày kể từ ngày nhận hóa đơn",
);

function fakes(
  o: { existing?: { key: string; name: string; type: string }[]; attachFails?: boolean } = {},
) {
  const calls: Record<string, unknown[][]> = {};
  /** Hàm giả: ghi lời gọi rồi trả `v`. */
  const fn =
    <T>(k: string, v: T) =>
    async (...a: unknown[]): Promise<T> => {
      calls[k] ??= [];
      calls[k].push(a);
      return v;
    };
  const attach = fn("attach", { ok: true, value: null });
  const graph = {
    attach: async (...a: unknown[]) => {
      const r = await attach(...a);
      if (o.attachFails) throw new Error("db down");
      return r;
    },
    linkDocuments: fn("linkDocuments", { ok: true, value: 1 }),
    hasAlias: fn("hasAlias", { ok: true, value: false }),
    addAlias: fn("addAlias", { ok: true, value: true }),
    addLinks: fn("addLinks", { ok: true, value: 1 }),
  } as unknown as GraphService;
  const uow: IngestUow = {
    tenant: async (_w, run) =>
      run({
        knowledge: { searchFts: fn("searchFts", [OTHER, MINE[0] as Hit]) },
        ingest: { aliasCandidates: fn("aliasCandidates", o.existing ?? []) },
      } as never),
  };
  return { calls, graph, uow };
}

describe("R1 · graphProducers", () => {
  it("toChunkGraph: quan hệ theo tên ⇒ theo key; quan hệ tới tên lạ bị bỏ", () => {
    const g = toChunkGraph("c1", {
      entities: [
        { name: "An", type: "Person" },
        { name: "Apollo", type: "Project" },
      ],
      relations: [
        { src: "An", dst: "Apollo", type: "LEADS" },
        { src: "An", dst: "X", type: "LEADS" },
      ],
    });
    expect(g.relations).toEqual([{ src: "Person:an", dst: "Project:apollo", type: "LEADS" }]);
  });

  it("AI giả: attach/linkDocuments/addLinks/aliasCandidates/searchFts mỗi thứ đúng 1 lần; SIMILAR + CONFLICTS trong một lô", async () => {
    const f = fakes({ existing: [{ key: "Person:an nguyen", name: "An Nguyen", type: "Person" }] });
    const rep = await graphProducers({ graph: f.graph, uow: f.uow, ai: fakeGraphAi() })(
      who,
      DOC,
      MINE,
      "[x](https://wiki.local/apollo)",
    );
    for (const k of ["attach", "linkDocuments", "addLinks", "aliasCandidates", "searchFts"])
      expect([k, f.calls[k]?.length]).toEqual([k, 1]);
    const links = f.calls.addLinks?.[0]?.[1] as { kind: string; b: string }[];
    expect(links.map((l) => l.kind).sort()).toEqual(["CONFLICTS", "SIMILAR"]);
    expect(links.every((l) => l.b === "o1")).toBe(true);
    expect(f.calls.linkDocuments?.[0]?.[2]).toEqual(["https://wiki.local/apollo"]);
    expect(rep).toMatchObject({ similar: 1, conflicts: 1, docLinks: 1, aliases: 1 });
    expect(f.calls.addAlias?.[0]?.slice(1)).toEqual(["Person:nguyen an", "Person:an nguyen"]);
  });

  it("không AI ⇒ không trích/không bí danh/không phán mâu thuẫn, vẫn LINKS_TO + SIMILAR", async () => {
    const f = fakes();
    const rep = await graphProducers({ graph: f.graph, uow: f.uow, ai: null })(who, DOC, MINE, "");
    expect(f.calls.attach).toBeUndefined();
    expect(f.calls.aliasCandidates).toBeUndefined();
    const links = (f.calls.addLinks?.[0]?.[1] ?? []) as { kind: string }[];
    expect(links.map((l) => l.kind)).toEqual(["SIMILAR"]);
    expect(rep).toMatchObject({ entities: 0, similar: 1, conflicts: 0 });
  });

  it("hợp đồng ⇒ không so giống; attach lỗi ⇒ log, bước sau vẫn chạy", async () => {
    const f = fakes({ attachFails: true });
    const logs: string[] = [];
    await graphProducers({
      graph: f.graph,
      uow: f.uow,
      ai: fakeGraphAi(),
      log: (m) => logs.push(m),
    })(who, DOC, MINE, "", "contract");
    expect(logs).toEqual(["knowledge-graph-step-failed"]);
    expect(f.calls.linkDocuments?.length).toBe(1);
    expect(f.calls.searchFts).toBeUndefined();
  });
});
