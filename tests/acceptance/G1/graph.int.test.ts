// G1 · CR-095 (bỏ Neo4j): cổng đồ thị tri thức trên Postgres, DB thật (role `knowledge_rw`, RLS FORCE). Chuyển các test chạm
// đồ thị của mgmt-app: tests/test_graph_store.py (expand, similar, neighbourhood, upsert lại, corpus), test_resolve.py (bí
// danh mở rộng truy hồi), test_domain.py (tài liệu hợp đồng không vào kho chung), test_migrate_orgs.py (không có cạnh
// SIMILAR giữa hai tổ chức ⇒ ở đây: không thể nối cạnh chéo tenant) + routes/stats.py (thống kê, /conflicts).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { countStatements } from "@ai/test-kit/perf";
import type { ChunkGraphIn } from "../../../apps/hub-api/src/modules/knowledge/application/graph.ports";
import type { GraphService } from "../../../apps/hub-api/src/modules/knowledge/application/graph.usecases";
import { graphService } from "../../../apps/hub-api/src/modules/knowledge/knowledge.mount";

const A = tenantId(971);
const B = tenantId(972);
const who = (t: string) => ({ tenantId: t, userId: userId(971) });

let owner: Sql;
let db: Db;
let g: GraphService;

type Doc = { id: string; chunks: string[] };
/** Tài liệu + `n` đoạn của `t` (owner, bỏ RLS) — phần N4 đã có; đồ thị gắn lên sau. */
async function doc(
  t: string,
  title: string,
  o: { n?: number; kind?: string; uri?: string } = {},
): Promise<Doc> {
  const id = crypto.randomUUID();
  const chunks = Array.from({ length: o.n ?? 1 }, () => crypto.randomUUID());
  await owner`insert into knowledge.documents (id, tenant_id, title, kind, uri, content_hash, chunk_count)
    values (${id}, ${t}, ${title}, ${o.kind ?? "markdown"}, ${o.uri ?? `file://${title}`},
      ${Bun.SHA256.hash(id, "hex") as string}, ${chunks.length})`;
  for (const [i, c] of chunks.entries())
    await owner`insert into knowledge.chunks (id, tenant_id, doc_id, ord, body) values (${c}, ${t}, ${id}, ${i}, ${`đoạn ${i} của ${title}`})`;
  return { id, chunks };
}
/** `_chunks()` của test_graph_store.py: Apollo + An, quan hệ An LEADS Apollo. */
const apollo = (chunkId: string): ChunkGraphIn[] => [
  {
    chunkId,
    entities: [
      { key: "Project:apollo", name: "Apollo", type: "Project" },
      { key: "Person:an", name: "An", type: "Person" },
    ],
    relations: [{ src: "Person:an", dst: "Project:apollo", type: "LEADS" }],
  },
];
const ok = <T>(r: { ok: true; value: T } | { ok: false; code: string }): T => {
  if (!r.ok) throw new Error(r.code);
  return r.value;
};

beforeAll(async () => {
  await cloneDb("full");
  owner = openOwner(2);
  db = createDb(urls().hubApi, { max: 2 });
  g = graphService(db);
});
afterAll(async () => {
  await db?.close();
  await owner?.end({ timeout: 2 });
});

describe("G1 · test_graph_store.py", () => {
  it("upsert → expand loại đoạn đã có; similar + conflict; links_to; neighbourhood có tài liệu, thực thể, LINKS_TO, LEADS", async () => {
    const g1 = await doc(A, "g1");
    const g2 = await doc(A, "g2");
    ok(await g.attach(who(A), g1.id, apollo(g1.chunks[0] as string)));
    ok(await g.attach(who(A), g2.id, apollo(g2.chunks[0] as string)));
    expect(ok(await g.expand(who(A), ["Project:apollo"], [g1.chunks[0] as string], 10))).toEqual([
      g2.chunks[0] as string,
    ]);

    const [c1, c2] = [g1.chunks[0] as string, g2.chunks[0] as string];
    expect(ok(await g.addLinks(who(A), [{ a: c1, b: c2, kind: "SIMILAR", score: 0.95 }]))).toBe(1);
    expect(
      ok(await g.addLinks(who(A), [{ a: c1, b: c2, kind: "CONFLICTS", reason: "dates differ" }])),
    ).toBe(1);
    const rows = ok(await g.similarDocuments(who(A), g1.id));
    expect(new Set(rows.map((r) => r.type))).toEqual(new Set(["SIMILAR", "CONFLICTS"]));
    expect(rows[0]?.docId).toBe(g2.id);
    const sim = rows.find((r) => r.type === "SIMILAR");
    expect(sim).toMatchObject({ chunkId: c1, otherChunkId: c2 });
    expect(Math.abs((sim?.score ?? 0) - 0.95)).toBeLessThan(1e-6);
    // chiều ngược (SIMILAR vô hướng khi đọc): từ g2 thấy g1, chunk/other đảo
    expect(
      ok(await g.similarDocuments(who(A), g2.id)).find((r) => r.type === "CONFLICTS"),
    ).toMatchObject({
      docId: g1.id,
      reason: "dates differ",
      chunkId: c2,
      otherChunkId: c1,
    });

    expect(
      ok(await g.linkDocuments(who(A), g1.id, ["file://g2", "file://g1", "file://none"])),
    ).toBe(1);
    const n = ok(await g.neighbourhood(who(A), g1.id));
    const ids = new Set(n.nodes.map((x) => x.id));
    for (const id of [g1.id, g2.id, "Project:apollo", "Person:an"]) expect(ids.has(id)).toBe(true);
    expect(n.links.some((l) => l.type === "LINKS_TO" && l.target === g2.id)).toBe(true);
    expect(n.links.some((l) => l.type === "LEADS" && l.source === "Person:an")).toBe(true);
    expect(n.links.filter((l) => l.type === "MENTIONS").length).toBe(2);
    // LINKS_TO vô hướng khi đọc: vùng của g2 thấy g1
    expect(
      ok(await g.neighbourhood(who(A), g2.id)).links.some(
        (l) => l.type === "LINKS_TO" && l.target === g1.id,
      ),
    ).toBe(true);
  });

  it("gắn lại đồ thị thay MENTIONS cũ; xoá tài liệu ⇒ cạnh đi theo (CASCADE)", async () => {
    const g3 = await doc(A, "g3", { n: 2 });
    ok(await g.attach(who(A), g3.id, apollo(g3.chunks[0] as string)));
    expect(ok(await g.expand(who(A), ["Project:apollo"], [], 50))).toContain(
      g3.chunks[0] as string,
    );
    ok(
      await g.attach(who(A), g3.id, [
        { chunkId: g3.chunks[1] as string, entities: [], relations: [] },
      ]),
    );
    expect(ok(await g.expand(who(A), ["Project:apollo"], [], 50))).not.toContain(
      g3.chunks[0] as string,
    );

    ok(await g.attach(who(A), g3.id, apollo(g3.chunks[1] as string)));
    await owner`delete from knowledge.documents where id = ${g3.id}`;
    const [left] = await owner<
      { n: number }[]
    >`select count(*)::int as n from knowledge.chunk_entities
      where chunk_id = any(${g3.chunks}::uuid[])`;
    expect(left?.n).toBe(0);
    expect(ok(await g.neighbourhood(who(A), g3.id))).toEqual({ nodes: [], links: [] });
  });

  it("corpus nối tài liệu bằng thực thể chung (SHARES n), CONFLICTS đếm cặp; min_shared=3 bỏ cặp chỉ chung 2", async () => {
    const c1 = await doc(A, "c1");
    const c2 = await doc(A, "c2");
    ok(await g.attach(who(A), c1.id, apollo(c1.chunks[0] as string)));
    ok(await g.attach(who(A), c2.id, apollo(c2.chunks[0] as string)));
    ok(
      await g.addLinks(who(A), [
        { a: c1.chunks[0] as string, b: c2.chunks[0] as string, kind: "CONFLICTS", reason: "x" },
      ]),
    );
    const c = ok(await g.corpus(who(A), 2));
    const ids = new Set(c.nodes.map((x) => x.id));
    expect(ids.has(c1.id) && ids.has(c2.id)).toBe(true);
    expect(c.nodes.every((x) => x.type === "Document")).toBe(true);
    const pair = new Set(
      c.links
        .filter(
          (l) =>
            new Set([l.source, l.target]).size === 2 &&
            [c1.id, c2.id].includes(l.source) &&
            [c1.id, c2.id].includes(l.target),
        )
        .map((l) => `${l.type}:${l.n}`),
    );
    expect(pair.has("SHARES:2")).toBe(true);
    expect(pair.has("CONFLICTS:1")).toBe(true);
    const c3 = ok(await g.corpus(who(A), 3));
    expect(
      c3.links.some(
        (l) =>
          l.type === "SHARES" &&
          [l.source, l.target].includes(c1.id) &&
          [l.source, l.target].includes(c2.id),
      ),
    ).toBe(false);
  });
});

describe("G1 · test_resolve.py (bí danh)", () => {
  it("add_alias lần đầu true, lần hai/đảo chiều false; has_alias hai chiều; expand theo bí danh độ sâu 1", async () => {
    const src = await doc(A, "alias-src");
    const tgt = await doc(A, "alias-tgt");
    const far = await doc(A, "alias-far");
    const ent = (key: string, name: string, chunkId: string): ChunkGraphIn[] => [
      { chunkId, entities: [{ key, name, type: "Person" }], relations: [] },
    ];
    ok(await g.attach(who(A), src.id, ent("Person:bao tran", "Bảo Trân", src.chunks[0] as string)));
    ok(await g.attach(who(A), tgt.id, ent("Person:tran bao", "Trân Bảo", tgt.chunks[0] as string)));
    ok(await g.attach(who(A), far.id, ent("Person:b tran", "B. Trân", far.chunks[0] as string)));
    expect(ok(await g.hasAlias(who(A), "Person:bao tran", "Person:tran bao"))).toBe(false);
    expect(ok(await g.addAlias(who(A), "Person:tran bao", "Person:bao tran"))).toBe(true);
    expect(ok(await g.addAlias(who(A), "Person:bao tran", "Person:tran bao"))).toBe(false);
    expect(ok(await g.addAlias(who(A), "Person:bao tran", "Person:khong co"))).toBe(false);
    expect(ok(await g.hasAlias(who(A), "Person:bao tran", "Person:tran bao"))).toBe(true);
    expect(ok(await g.hasAlias(who(A), "Person:tran bao", "Person:bao tran"))).toBe(true);
    ok(await g.addAlias(who(A), "Person:tran bao", "Person:b tran")); // chuỗi bao tran — tran bao — b tran
    const got = ok(await g.expand(who(A), ["Person:bao tran"], [], 5));
    expect(new Set(got)).toEqual(new Set([src.chunks[0] as string, tgt.chunks[0] as string])); // không tới b tran (độ sâu 2)
    const st = ok(await g.stats(who(A)));
    expect(st.entities.aliasPairs).toBe(2);
    const nb = ok(await g.neighbourhood(who(A), src.id));
    expect(nb.links).toContainEqual({
      source: "Person:bao tran",
      target: "Person:tran bao",
      type: "ALIAS_OF",
    });
  });
});

describe("G1 · test_domain.py + routes/stats.py", () => {
  it("tài liệu hợp đồng không vào corpus/thống kê/conflicts; conflicts xếp CONFLICTS trước, SIMILAR theo score giảm", async () => {
    const t = tenantId(973);
    const x1 = await doc(t, "ex-c1", { kind: "contract" });
    const x2 = await doc(t, "ex-c2", { kind: "contract" });
    const m1 = await doc(t, "m1");
    const m2 = await doc(t, "m2");
    const m3 = await doc(t, "m3");
    const ch = (d: Doc) => d.chunks[0] as string;
    ok(
      await g.addLinks(who(t), [
        { a: ch(x1), b: ch(x2), kind: "CONFLICTS", reason: "giá 100 triệu khác 200 triệu" },
        { a: ch(m1), b: ch(m2), kind: "SIMILAR", score: 0.8 },
        { a: ch(m2), b: ch(m3), kind: "SIMILAR", score: 0.9 },
        { a: ch(m3), b: ch(m1), kind: "CONFLICTS", reason: "ngày khác" },
        { a: ch(m3), b: ch(m1), kind: "CONFLICTS", reason: "trùng trong lô" },
      ]),
    );
    const c = ok(await g.corpus(who(t)));
    expect(c.nodes.map((n) => n.id).sort()).toEqual([m1.id, m2.id, m3.id].sort());
    expect(c.links.some((l) => [l.source, l.target].includes(x1.id))).toBe(false);
    const st = ok(await g.stats(who(t)));
    expect(st.links).toEqual({ conflicts: 1, duplicates: 2 });
    const cf = ok(await g.conflicts(who(t)));
    expect(
      cf.map((r) => [r.type, r.score === null ? null : Math.round(r.score * 10) / 10]),
    ).toEqual([
      ["CONFLICTS", null],
      ["SIMILAR", 0.9],
      ["SIMILAR", 0.8],
    ]);
    expect(cf[0]?.reason).toBe("ngày khác"); // trùng trong lô ⇒ giữ dòng đầu
    // similar_documents vẫn trả cạnh của hợp đồng (mgmt-app không lọc miền ở đó)
    expect(ok(await g.similarDocuments(who(t), x1.id)).map((r) => r.docId)).toEqual([x2.id]);
  });

  it("thống kê thực thể theo loại", async () => {
    const t = tenantId(974);
    const d = await doc(t, "st");
    ok(await g.attach(who(t), d.id, apollo(d.chunks[0] as string)));
    expect(ok(await g.stats(who(t))).entities).toEqual({
      total: 2,
      byType: { Project: 1, Person: 1 },
      aliasPairs: 0,
    });
  });
});

describe("G1 · cách ly tenant (thay test_migrate_orgs.py: không có cạnh giữa hai tổ chức)", () => {
  it("B không thấy, không nối, không gắn được vào dữ liệu của A; id của A dưới B ≡ id không tồn tại", async () => {
    const a = await doc(A, "bi-mat-A");
    const b = await doc(B, "cua-B");
    ok(await g.attach(who(A), a.id, apollo(a.chunks[0] as string)));
    const ca = a.chunks[0] as string;
    const cb = b.chunks[0] as string;
    expect(ok(await g.addLinks(who(B), [{ a: cb, b: ca, kind: "SIMILAR", score: 1 }]))).toBe(0);
    expect(ok(await g.addLinks(who(A), [{ a: ca, b: cb, kind: "SIMILAR", score: 1 }]))).toBe(0);
    ok(await g.attach(who(B), a.id, apollo(ca)));
    expect(ok(await g.linkDocuments(who(B), a.id, ["file://cua-B"]))).toBe(0);
    expect(ok(await g.linkDocuments(who(B), b.id, ["file://bi-mat-A"]))).toBe(0);
    expect(ok(await g.expand(who(B), ["Project:apollo"], [], 50))).toEqual([]);
    expect(ok(await g.neighbourhood(who(B), a.id))).toEqual(
      ok(await g.neighbourhood(who(B), crypto.randomUUID())),
    );
    expect(ok(await g.similarDocuments(who(B), a.id))).toEqual([]);
    expect(ok(await g.corpus(who(B))).nodes.map((n) => n.id)).toEqual([b.id]);
    const [n] = await owner<
      { n: number }[]
    >`select count(*)::int as n from knowledge.chunk_entities where chunk_id = ${ca}`;
    expect(n?.n).toBe(2); // gắn của B vào đoạn A không ghi gì
  });
});

describe("G1 · Luật 4c · số câu SQL cố định", () => {
  it("neighbourhood/similar = 1 câu, attach = 2 câu, addLinks = 1 câu (+1 set_config mỗi tx) bất kể số hàng", async () => {
    const client = (db.db as unknown as { $client: Sql }).$client;
    const d1 = await doc(A, "sql-1", { n: 3 });
    const d2 = await doc(A, "sql-2", { n: 3 });
    const many: ChunkGraphIn[] = d1.chunks.map((c, i) => ({
      chunkId: c,
      entities: Array.from({ length: 20 }, (_, j) => ({
        key: `T:${i}-${j}`,
        name: `e${j}`,
        type: "T",
      })),
      relations: [{ src: `T:${i}-0`, dst: `T:${i}-1`, type: "R" }],
    }));
    const attach = await countStatements(client, async () =>
      ok(await g.attach(who(A), d1.id, many)),
    );
    const links = d1.chunks.flatMap((a) =>
      d2.chunks.map((b) => ({ a, b, kind: "SIMILAR" as const, score: 0.5 })),
    );
    const add = await countStatements(client, async () => ok(await g.addLinks(who(A), links)));
    const nb = await countStatements(client, async () => ok(await g.neighbourhood(who(A), d1.id)));
    const sim = await countStatements(client, async () =>
      ok(await g.similarDocuments(who(A), d1.id)),
    );
    expect({ attach, add, nb, sim }).toEqual({ attach: 3, add: 2, nb: 2, sim: 2 });
    expect(ok(await g.similarDocuments(who(A), d1.id)).length).toBe(9);
    expect(ok(await g.neighbourhood(who(A), d1.id)).nodes.length).toBe(1 + 60 + 1);
  });
});
