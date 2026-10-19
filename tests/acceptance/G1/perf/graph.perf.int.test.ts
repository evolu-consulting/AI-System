// G1 · Luật 4c: `neighbourhood` và `similar_documents` p95 ≤ 50 ms ở 10.000 tài liệu / 100.000 đoạn MỖI tenant (× 2 tenant),
// 300.000 MENTIONS, 20.000 thực thể (phân bố lệch random()^2), 20.000 REL, 2.000 cặp bí danh, 55.000 SIMILAR/CONFLICTS,
// 10.000 LINKS_TO mỗi tenant. Hạt cố định `setseed(0.42)`. Đo qua đường thật (`graphService`, tx `knowledge_rw` + RLS), 200 lượt
// tuần tự sau 20 lượt nóng, tài liệu chọn ngẫu nhiên. Thêm: số câu SQL cố định + EXPLAIN không Seq Scan. Chỉ chạy dưới PERF=1.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, inPack, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { assertNoSeqScan, captureSql, measure, type Stat } from "@ai/test-kit/perf";
import type { GraphService } from "../../../../apps/hub-api/src/modules/knowledge/application/graph.usecases";
import { graphService } from "../../../../apps/hub-api/src/modules/knowledge/knowledge.mount";

const PERF = process.env.PERF === "1";
const N_DOCS = 10_000;
const PER_DOC = 10; // 100.000 đoạn / tenant
const N_ENT = 20_000;
const T = [tenantId(991), tenantId(992)];
const who = { tenantId: T[0] as string, userId: userId(991) };

async function seed(o: Sql, t: string): Promise<void> {
  await o`with d as (insert into knowledge.documents (tenant_id, title, uri, content_hash, chunk_count)
      select ${t}::uuid, 'Tài liệu ' || g, 'file://d' || g, md5(${t} || g) || md5(g::text), ${PER_DOC}
      from generate_series(1, ${N_DOCS}) g returning id, tenant_id)
    insert into knowledge.chunks (tenant_id, doc_id, ord, body)
    select d.tenant_id, d.id, o, 'đoạn ' || o from d, generate_series(0, ${PER_DOC - 1}) o`;
  await o`insert into knowledge.entities (tenant_id, key, name, type)
    select ${t}::uuid, 'T' || (g % 5) || ':e' || g, 'Thực thể ' || g, 'T' || (g % 5) from generate_series(1, ${N_ENT}) g`;
  await o`drop table if exists g1c, g1e`;
  await o`create temp table g1c as select id, doc_id, row_number() over (order by id)::int as rn
    from knowledge.chunks where tenant_id = ${t}::uuid`;
  await o`create temp table g1e as select id, row_number() over (order by id)::int as rn
    from knowledge.entities where tenant_id = ${t}::uuid`;
  await o`create index on g1c (rn)`;
  await o`create index on g1e (rn)`;
  const nc = N_DOCS * PER_DOC;
  // 3 MENTIONS / đoạn, thực thể lệch (random()^2: thực thể đầu bảng phổ biến)
  await o`insert into knowledge.chunk_entities (tenant_id, chunk_id, entity_id)
    select ${t}::uuid, r.cid, e.id
    from (select c.id as cid, 1 + floor(power(random(), 2) * ${N_ENT})::int as x
      from g1c c cross join generate_series(1, 3) k) r join g1e e on e.rn = r.x
    on conflict do nothing`;
  await o`insert into knowledge.entity_rels (tenant_id, src_id, dst_id, type)
    select ${t}::uuid, a.id, b.id, 'R' || (r.g % 7)
    from (select g, 1 + floor(random() * ${N_ENT})::int x, 1 + floor(random() * ${N_ENT})::int y
      from generate_series(1, ${N_ENT}) g) r join g1e a on a.rn = r.x join g1e b on b.rn = r.y
    on conflict do nothing`;
  await o`insert into knowledge.entity_aliases (tenant_id, a_id, b_id)
    select ${t}::uuid, least(a.id, b.id), greatest(a.id, b.id)
    from (select 1 + floor(random() * ${N_ENT})::int x, 1 + floor(random() * ${N_ENT})::int y
      from generate_series(1, 2000)) r join g1e a on a.rn = r.x join g1e b on b.rn = r.y
    where a.id <> b.id on conflict do nothing`;
  await o`insert into knowledge.chunk_links (tenant_id, src_id, dst_id, kind, score, reason, src_doc_id, dst_doc_id)
    select ${t}::uuid, a.id, b.id, case when r.g % 10 = 0 then 'CONFLICTS' else 'SIMILAR' end,
      case when r.g % 10 = 0 then null else 0.8 + random() * 0.2 end,
      case when r.g % 10 = 0 then 'khác ngày' end, a.doc_id, b.doc_id
    from (select g, 1 + floor(random() * ${nc})::int x, 1 + floor(random() * ${nc})::int y
      from generate_series(1, 55000) g) r join g1c a on a.rn = r.x join g1c b on b.rn = r.y
    where a.id <> b.id on conflict do nothing`;
  await o`insert into knowledge.document_links (tenant_id, src_id, dst_id)
    select ${t}::uuid, a.doc_id, b.doc_id
    from (select 1 + floor(random() * ${nc})::int x, 1 + floor(random() * ${nc})::int y
      from generate_series(1, ${N_DOCS})) r join g1c a on a.rn = r.x join g1c b on b.rn = r.y
    where a.doc_id <> b.doc_id on conflict do nothing`;
}

let owner: Sql;
let db: Db;
let g: GraphService;
let docs: string[] = [];
let hot: string[] = [];
beforeAll(async () => {
  if (!PERF) return;
  await cloneDb("full");
  owner = openOwner(1);
  await owner`select setseed(0.42)`;
  for (const t of T) await seed(owner, t);
  await owner`analyze knowledge.documents, knowledge.chunks, knowledge.entities, knowledge.chunk_entities,
    knowledge.entity_rels, knowledge.entity_aliases, knowledge.chunk_links, knowledge.document_links`;
  docs = (
    await owner<
      { id: string }[]
    >`select id::text as id from knowledge.documents where tenant_id = ${T[0] as string}
      order by md5(id::text) limit 500`
  ).map((r) => r.id);
  // 50 thực thể được nhắc nhiều nhất (ca xấu của expand)
  hot = (
    await owner<{ key: string }[]>`select e.key from knowledge.entities e join (
        select entity_id, count(*) n from knowledge.chunk_entities where tenant_id = ${T[0] as string}
        group by entity_id order by n desc limit 50) m on m.entity_id = e.id`
  ).map((r) => r.key);
  db = createDb(urls().hubApi, { max: 2 });
  g = graphService(db);
}, 600_000);
afterAll(async () => {
  await db?.close();
  await owner?.end({ timeout: 2 });
});

const fmt = (s: Stat) =>
  `p50 ${s.p50.toFixed(1)} ms p95 ${s.p95.toFixed(1)} ms max ${s.max.toFixed(1)} ms`;
const pick = (i: number) => docs[Math.abs(i * 7919) % docs.length] as string;
const client = () => (db.db as unknown as { $client: Sql }).$client;
const RELS = [
  "documents",
  "chunks",
  "entities",
  "chunk_entities",
  "entity_rels",
  "entity_aliases",
  "chunk_links",
  "document_links",
];

describe.skipIf(!PERF)("G1 · đồ thị 10k tài liệu / 100k đoạn mỗi tenant", () => {
  it("dữ liệu đủ cỡ", async () => {
    const [r] = await owner<{ d: number; c: number; m: number; l: number }[]>`select
      (select count(*)::int from knowledge.documents where tenant_id = ${T[0] as string}) as d,
      (select count(*)::int from knowledge.chunks where tenant_id = ${T[0] as string}) as c,
      (select count(*)::int from knowledge.chunk_entities where tenant_id = ${T[0] as string}) as m,
      (select count(*)::int from knowledge.chunk_links where tenant_id = ${T[0] as string}) as l`;
    console.log(`G1 dữ liệu tenant: ${JSON.stringify(r)}`);
    expect(r?.d).toBe(N_DOCS);
    expect(r?.c).toBe(N_DOCS * PER_DOC);
    expect(r?.m).toBeGreaterThan(250_000);
  });

  it("neighbourhood p95 ≤ 50 ms (200 lượt)", async () => {
    const st = await measure(
      async (i) => {
        const r = await g.neighbourhood(who, pick(i));
        if (!r.ok || r.value.nodes.length === 0) throw new Error("rỗng");
      },
      { n: 200, warm: 20 },
    );
    console.log(`G1 neighbourhood: ${fmt(st)}`);
    expect(st.p95).toBeLessThanOrEqual(50);
  }, 120_000);

  it("similar_documents p95 ≤ 50 ms (200 lượt)", async () => {
    const st = await measure(
      async (i) => {
        const r = await g.similarDocuments(who, pick(i));
        if (!r.ok) throw new Error(r.code);
      },
      { n: 200, warm: 20 },
    );
    console.log(`G1 similar_documents: ${fmt(st)}`);
    expect(st.p95).toBeLessThanOrEqual(50);
  }, 120_000);

  it("expand (thực thể phổ biến + bí danh) chỉ ghi số", async () => {
    const st = await measure(
      async (i) => {
        const r = await g.expand(who, [hot[Math.abs(i) % hot.length] as string], [], 20);
        if (!r.ok || r.value.length === 0) throw new Error("rỗng");
      },
      { n: 100, warm: 10 },
    );
    console.log(`G1 expand: ${fmt(st)}`);
    expect(st.n).toBe(100);
  }, 120_000);

  it("stats + conflicts (toàn tenant) chỉ ghi số", async () => {
    const a = await measure(
      async () => {
        if (!(await g.stats(who)).ok) throw new Error("stats");
      },
      { n: 20, warm: 2 },
    );
    const b = await measure(
      async () => {
        const r = await g.conflicts(who, 100);
        if (!r.ok || r.value.length === 0) throw new Error("rỗng");
      },
      { n: 20, warm: 2 },
    );
    console.log(`G1 stats: ${fmt(a)} · conflicts: ${fmt(b)}`);
    expect(a.n + b.n).toBe(40);
  }, 120_000);

  it("số câu SQL cố định (set_config + 1) và EXPLAIN không Seq Scan trên bảng đồ thị", async () => {
    const d = pick(1);
    const nb = await captureSql(client(), () => g.neighbourhood(who, d));
    const sim = await captureSql(client(), () => g.similarDocuments(who, d));
    expect([nb.queries.length, sim.queries.length]).toEqual([2, 2]);
    const run = <R>(fn: (tx: Sql) => Promise<R>) => inPack("knowledge", T[0] as string, fn);
    for (const cap of [nb.queries[1], sim.queries[1]])
      await assertNoSeqScan(run, cap as never, RELS);
  }, 60_000);
});
