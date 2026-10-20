// G1 · F-10 (review CR-095 đợt C) · Luật 4c: phân bố LỆCH — một thực thể "siêu phổ biến" được 5.000 tài liệu nhắc, có 3.000 REL
// và 1.000 bí danh. Trước: `corpus` tự join ~12,5 M cặp tài liệu, `neighbourhood` trả mọi REL/ALIAS của nó. Sau: corpus đếm SHARES
// trên ≤ corpusFanMax tài liệu mỗi thực thể; neighbourhood ≤ nbEntityMax/nbEdgeMax/nbDocMax. Ngưỡng: neighbourhood p95 ≤ 50 ms,
// corpus p95 ≤ 500 ms (toàn tenant, không phải đường nóng), số cạnh/node trả về có trần. Chỉ chạy dưới PERF=1.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { measure, type Stat } from "@ai/test-kit/perf";
import type { GraphService } from "../../../../apps/hub-api/src/modules/knowledge/application/graph.usecases";
import { GRAPH_LIMITS as L } from "../../../../apps/hub-api/src/modules/knowledge/domain/graph.rules";
import { graphService } from "../../../../apps/hub-api/src/modules/knowledge/knowledge.mount";

const PERF = process.env.PERF === "1";
const N_DOCS = 5_000;
const T = tenantId(993);
const who = { tenantId: T, userId: userId(993) };

async function seed(o: Sql): Promise<void> {
  await o`with d as (insert into knowledge.documents (tenant_id, title, uri, content_hash, chunk_count)
      select ${T}::uuid, 'Tài liệu ' || g, 'file://s' || g, md5('s' || g) || md5(g::text), 1 from generate_series(1, ${N_DOCS}) g
      returning id, tenant_id)
    insert into knowledge.chunks (tenant_id, doc_id, ord, body) select d.tenant_id, d.id, 0, 'đoạn' from d`;
  await o`insert into knowledge.entities (tenant_id, key, name, type)
    select ${T}::uuid, 'P:e' || g, 'Thực thể ' || g, 'P' from generate_series(0, 4000) g`;
  // e0 được MỌI đoạn nhắc; thêm 1 thực thể ngẫu nhiên mỗi đoạn
  await o`insert into knowledge.chunk_entities (tenant_id, chunk_id, entity_id)
    select ${T}::uuid, c.id, e.id from knowledge.chunks c join knowledge.entities e
      on e.tenant_id = ${T}::uuid and e.key = 'P:e0' where c.tenant_id = ${T}::uuid`;
  await o`insert into knowledge.chunk_entities (tenant_id, chunk_id, entity_id)
    select ${T}::uuid, c.id, e.id from knowledge.chunks c join knowledge.entities e
      on e.tenant_id = ${T}::uuid and e.key = 'P:e' || (1 + abs(hashtext(c.id::text)) % 4000)
    where c.tenant_id = ${T}::uuid on conflict do nothing`;
  await o`insert into knowledge.entity_rels (tenant_id, src_id, dst_id, type)
    select ${T}::uuid, a.id, b.id, 'R' from knowledge.entities a join knowledge.entities b
      on b.tenant_id = ${T}::uuid and b.key <> 'P:e0'
    where a.tenant_id = ${T}::uuid and a.key = 'P:e0' and b.key <= 'P:e3' limit 3000`;
  await o`insert into knowledge.entity_aliases (tenant_id, a_id, b_id)
    select ${T}::uuid, least(a.id, b.id), greatest(a.id, b.id) from knowledge.entities a join knowledge.entities b
      on b.tenant_id = ${T}::uuid and b.key <> 'P:e0'
    where a.tenant_id = ${T}::uuid and a.key = 'P:e0' limit 1000`;
  await o`analyze knowledge.documents, knowledge.chunks, knowledge.entities, knowledge.chunk_entities,
    knowledge.entity_rels, knowledge.entity_aliases, knowledge.chunk_links, knowledge.document_links`;
}

let owner: Sql;
let db: Db;
let g: GraphService;
let docs: string[] = [];
beforeAll(async () => {
  if (!PERF) return;
  await cloneDb("full");
  owner = openOwner(1);
  await seed(owner);
  docs = (
    await owner<{ id: string }[]>`select id::text as id from knowledge.documents
      where tenant_id = ${T}::uuid order by md5(id::text) limit 200`
  ).map((r) => r.id);
  db = createDb(urls().hubApi, { max: 2 });
  g = graphService(db);
}, 600_000);
afterAll(async () => {
  await db?.close();
  await owner?.end({ timeout: 2 });
});

const fmt = (s: Stat) =>
  `p50 ${s.p50.toFixed(1)} ms p95 ${s.p95.toFixed(1)} ms max ${s.max.toFixed(1)} ms`;

describe.skipIf(!PERF)("G1 · F-10 phân bố lệch (thực thể siêu phổ biến)", () => {
  it("neighbourhood: cạnh có trần, p95 ≤ 50 ms (100 lượt)", async () => {
    const one = await g.neighbourhood(who, docs[0] as string);
    if (!one.ok) throw new Error(one.code);
    const byType = (t: string) => one.value.links.filter((l) => l.type === t).length;
    expect(byType("ALIAS_OF")).toBeLessThanOrEqual(L.nbEdgeMax);
    expect(byType("R")).toBeLessThanOrEqual(L.nbEdgeMax);
    expect(byType("R")).toBeGreaterThan(0);
    const st = await measure(
      async (i) => {
        const r = await g.neighbourhood(who, docs[i % docs.length] as string);
        if (!r.ok) throw new Error(r.code);
      },
      { n: 100, warm: 10 },
    );
    console.log(`G1 skew neighbourhood: ${fmt(st)} · links ${one.value.links.length}`);
    expect(st.p95).toBeLessThanOrEqual(50);
  }, 120_000);

  it("corpus: SHARES ≤ limit, node ≤ corpusNodeMax, p95 ≤ 500 ms (10 lượt)", async () => {
    const one = await g.corpus(who, 1, L.corpusMax);
    if (!one.ok) throw new Error(one.code);
    const shares = one.value.links.filter((l) => l.type === "SHARES").length;
    expect(shares).toBeGreaterThan(0);
    expect(shares).toBeLessThanOrEqual(L.corpusMax);
    expect(one.value.nodes.length).toBeLessThanOrEqual(L.corpusNodeMax);
    const st = await measure(
      async () => {
        if (!(await g.corpus(who, 1, L.corpusMax)).ok) throw new Error("corpus");
      },
      { n: 10, warm: 2 },
    );
    console.log(`G1 skew corpus: ${fmt(st)} · nodes ${one.value.nodes.length} · shares ${shares}`);
    expect(st.p95).toBeLessThanOrEqual(500);
  }, 300_000);
});
