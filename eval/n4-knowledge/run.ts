// N4 eval 0.11 (ADR-0021) · harness chạy được: nạp kho `corpus.json` qua use case thật của module `knowledge` (DB Postgres test
// riêng, role `knowledge_rw`, RLS), hỏi `questions.json`, đo recall@k, MRR, phủ ý đáp án, rò rỉ chéo tenant, p50/p95 độ trễ
// (thứ tự câu hỏi xáo bằng hạt cố định) + tải CPU máy; chấm đáp án theo RUBRIC (Claude API nếu có key, không thì fixture
// offline). Chạy: `bun --env-file=.env.local eval/n4-knowledge/run.ts --variant fts [--reps 5] [--seed 42]`.
// Biến thể: fts (c) | fts-plain (đối chứng: OR + ts_rank, không IDF) | fts-bigram | fts-bgw<w> | fts-noctx | embedding (a, cần
// OPENAI_API_KEY) | embedding+rerank / fts+rerank (cần ANTHROPIC_API_KEY). Không in key.
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { createDb } from "@ai/db";
import { cloneDb } from "@ai/test-kit/db";
import { urls, withCreds } from "@ai/test-kit/env";
import { createAiClient } from "../../apps/hub-api/src/lib/ai-client/ai-client";
import { envProvider } from "../../apps/hub-api/src/lib/ai-client/ai-client.env";
import {
  clientReranker,
  openAiEmbedder,
} from "../../apps/hub-api/src/modules/knowledge/adapters/ai.adapters";
import { knowledgeRepos } from "../../apps/hub-api/src/modules/knowledge/adapters/knowledge.repo";
import {
  addDocument,
  searchKnowledge,
} from "../../apps/hub-api/src/modules/knowledge/application/knowledge.usecases";
import type {
  KnowledgeUow,
  RetrievalStrategy,
} from "../../apps/hub-api/src/modules/knowledge/application/ports";
import {
  embeddingStrategy,
  ftsStrategy,
} from "../../apps/hub-api/src/modules/knowledge/application/strategies";
import { createPackUow } from "../../apps/hub-api/src/modules/packs/kit/adapters/pack-uow";
import { claudeJudge, type OfflineFixture, offlineJudge, signature, type Verdict } from "./judge";
import * as M from "./metrics";

const DIR = import.meta.dir;
const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? (process.argv[i + 1] ?? d) : d;
};
const VARIANT = arg("variant", "fts");
const REPS = Number(arg("reps", "5"));
const SEED = Number(arg("seed", "42"));
const K = 10;
const TENANT = {
  A: "7e5d00f4-0000-4000-8000-0000000000a1",
  B: "7e5d00f4-0000-4000-8000-0000000000b2",
} as const;
const USER = "7e5d00f5-0000-4000-8000-000000000001";

type Doc = {
  id: string;
  file: string;
  title: string;
  kind: "markdown" | "contract";
  tenant: "A" | "B";
};
const corpus = (await Bun.file(join(DIR, "corpus.json")).json()) as { docs: Doc[] };
const { questions } = (await Bun.file(join(DIR, "questions.json")).json()) as {
  questions: M.Question[];
};
const out = join(DIR, "results");
mkdirSync(out, { recursive: true });

function write(name: string, v: unknown): void {
  writeFileSync(join(out, name), `${JSON.stringify(v, null, 2)}\n`);
}

const needEmb = VARIANT.startsWith("embedding");
const needRerank = VARIANT.endsWith("+rerank");
if ((needEmb && !process.env.OPENAI_API_KEY) || (needRerank && !process.env.ANTHROPIC_API_KEY)) {
  const missing = [
    needEmb && !process.env.OPENAI_API_KEY ? "OPENAI_API_KEY" : null,
    needRerank && !process.env.ANTHROPIC_API_KEY ? "ANTHROPIC_API_KEY" : null,
  ].filter(Boolean);
  write(`${VARIANT}.json`, {
    variant: VARIANT,
    status: "chờ key",
    missing,
    at: new Date().toISOString(),
  });
  console.log(`${VARIANT}: chờ key (${missing.join(", ")}) — không gọi API.`);
  process.exit(0);
}

// DB test RIÊNG của eval, LUÔN ghi đè `HUB_TEST_DATABASE_URL` của .env.local (cloneDb ngắt mọi phiên tới DB đích — không được
// trỏ vào DB test chung của lát khác).
{
  const u = new URL(process.env.TEST_DATABASE_URL as string);
  u.pathname = `/${process.env.EVAL_DB_NAME ?? "ai_system_n4eval_test"}`;
  process.env.HUB_TEST_DATABASE_URL = u.toString();
}
await cloneDb("full");
const db = createDb(withCreds(urls().owner, "hub_api", "hub_api_dev_pw"), { max: 4 });
const uow: KnowledgeUow = createPackUow(db, "knowledge", knowledgeRepos);

function strategyOf(): RetrievalStrategy {
  const base = VARIANT.replace("+rerank", "");
  if (base === "fts-plain") return ftsStrategy(uow, { mode: "plain" });
  if (base === "fts-bigram")
    return ftsStrategy(uow, { query: { bigrams: true }, name: "fts-bigram" });
  if (base.startsWith("fts-bgw"))
    return ftsStrategy(uow, {
      query: { bigrams: true, bigramWeight: Number(base.slice(7)) },
      name: base,
    });
  if (base.startsWith("embedding")) {
    const e = openAiEmbedder(process.env);
    if (!e) throw new Error("unreachable: key checked");
    return embeddingStrategy(uow, e, {
      hybrid: base === "embedding" ? true : base !== "embedding-only",
    });
  }
  return ftsStrategy(uow);
}
const strategy = strategyOf();
const embedder = needEmb ? openAiEmbedder(process.env) : null;
const add = addDocument({
  uow,
  newId: () => Bun.randomUUIDv7(),
  sha256: (s) => new Bun.CryptoHasher("sha256").update(s).digest("hex"),
  embedder,
  docContext: VARIANT !== "fts-noctx",
});
const search = searchKnowledge({
  strategy,
  // F-07: rerank qua AI client chung (eval chạy ngoài Hub: không ghi usage, không trần)
  reranker: needRerank
    ? clientReranker(
        createAiClient({
          provider: envProvider(),
          usage: { record: async () => {}, tokensSince: async () => 0 },
          caps: { dailyTokens: async () => null },
        }),
        process.env,
      )
    : null,
});

// ---- nạp kho
const docOf = new Map<string, string>(); // uuid tài liệu → id kho
const t0 = performance.now();
for (const d of corpus.docs) {
  const content = await Bun.file(join(DIR, "corpus", d.file)).text();
  const r = await add(
    { tenantId: TENANT[d.tenant], userId: USER },
    { title: d.title, content, kind: d.kind, source: "eval" },
  );
  if (!r.ok) throw new Error(`add ${d.id}: ${r.code}`);
  docOf.set(r.value.documentId, d.id);
}
const ingestMs = performance.now() - t0;

// ---- kiểm đoạn vàng tồn tại (sai chuỗi `has` ⇒ dừng ngay)
const all = await uow.tenant({ tenantId: TENANT.A, userId: USER }, async (r) => {
  const out: M.Ranked[] = [];
  for (const id of docOf.keys()) {
    const doc = await r.knowledge.getDocument(id);
    for (const c of doc?.chunks ?? [])
      out.push({ doc: docOf.get(id) as string, ord: c.ord, text: `${c.title}\n${c.body}` });
  }
  return out;
});
const missing = questions.flatMap((q) =>
  q.gold
    .flat()
    .filter((g) => !all.some((c) => M.isGold(c, g)))
    .map((g) => `${q.id}:${g.doc}:${g.has}`),
);
if (missing.length) throw new Error(`đoạn vàng không có trong kho: ${missing.join(" | ")}`);

// ---- truy hồi + độ đo
const who = { tenantId: TENANT.A, userId: USER };
// text = tiêu đề + thân: đúng những gì tool `knowledge-search` trả cho agent (title + text)
const toRanked = (
  hits: { docId: string; ord: number; title: string; body: string }[],
): M.Ranked[] =>
  hits.map((h) => ({ doc: docOf.get(h.docId) ?? "?", ord: h.ord, text: `${h.title}\n${h.body}` }));
async function ask(q: M.Question): Promise<M.Ranked[]> {
  const r = await search(who, { query: q.q, k: K });
  if (!r.ok) throw new Error(`${q.id}: ${r.code}`);
  return toRanked(r.value.hits);
}
const rankedOf = new Map<string, M.Ranked[]>();
for (const q of questions) rankedOf.set(q.id, await ask(q));

// ---- độ trễ: REPS lượt, thứ tự xáo theo hạt
const cpu0 = M.cpuSnap();
const lat: number[] = [];
const order = M.shuffle(Array.from({ length: REPS }, () => questions).flat(), M.rng(SEED));
for (const q of order) {
  const s = performance.now();
  await ask(q);
  lat.push(performance.now() - s);
}
const busy = M.busyPct(cpu0, M.cpuSnap());

// ---- chấm
const fixture = (await Bun.file(join(DIR, "judgments.offline.json"))
  .json()
  .catch(() => ({ rubric: "", judged_by: "", entries: {} }))) as OfflineFixture;
const key = process.env.ANTHROPIC_API_KEY;
const judgeOff = offlineJudge(fixture);
const judgeApi = key ? claudeJudge(key) : null;
const rows = [];
const toJudge = [];
for (const q of questions) {
  const ranked = rankedOf.get(q.id) as M.Ranked[];
  const v: Verdict | null = judgeApi ? await judgeApi(q, ranked) : judgeOff(q, ranked);
  if (!v)
    toJudge.push({
      id: q.id,
      kind: q.kind,
      q: q.q,
      gold: q.answer,
      sig: signature(ranked),
      top5: ranked.slice(0, 5).map((r) => `[${r.doc}#${r.ord}] ${r.text.replace(/\s+/g, " ")}`),
    });
  rows.push({
    id: q.id,
    kind: q.kind,
    r1: M.recallAtK(ranked, q.gold, 1),
    r3: M.recallAtK(ranked, q.gold, 3),
    r5: M.recallAtK(ranked, q.gold, 5),
    r10: M.recallAtK(ranked, q.gold, 10),
    rr: M.reciprocalRank(ranked, q.gold),
    facts5: M.factCoverage(ranked, q.facts, 5),
    leak: ranked.some((r) => r.doc === "canary" || /canary/i.test(r.text)),
    judge: v ? v.score : null,
    sig: signature(ranked),
    top5: ranked.slice(0, 5).map((r) => `${r.doc}#${r.ord}`),
  });
}

const agg = (xs: typeof rows) => ({
  n: xs.length,
  recall1: M.mean(xs.map((r) => r.r1)),
  recall3: M.mean(xs.map((r) => r.r3)),
  recall5: M.mean(xs.map((r) => r.r5)),
  recall10: M.mean(xs.map((r) => r.r10)),
  mrr: M.mean(xs.map((r) => r.rr)),
  facts5: M.mean(xs.map((r) => r.facts5)),
  judged: xs.filter((r) => r.judge !== null).length,
  correctness: M.mean(xs.filter((r) => r.judge !== null).map((r) => (r.judge as number) / 2)),
});
const kinds = ["fact", "clause", "number_date", "multi_hop", "no_answer"] as const;
const report = {
  variant: VARIANT,
  strategy: strategy.name,
  at: new Date().toISOString(),
  seed: SEED,
  reps: REPS,
  judge: judgeApi ? "claude-api" : "offline-claude-fixture (nhãn: Claude tự chấm, không gọi API)",
  corpus: { docs: corpus.docs.length, chunksTenantA: all.length, ingestMs: Math.round(ingestMs) },
  machine: { cpus: cpus().length, cpuBusyPctDuringLatency: Math.round(busy * 10) / 10 },
  latencyMs: {
    n: lat.length,
    p50: M.percentile(lat, 50),
    p95: M.percentile(lat, 95),
    max: Math.max(...lat),
  },
  leaks: rows.filter((r) => r.leak).map((r) => r.id),
  overall: agg(rows),
  byKind: Object.fromEntries(kinds.map((k) => [k, agg(rows.filter((r) => r.kind === k))])),
  unjudged: toJudge.length,
  rows,
};
write(`${VARIANT}.json`, report);
if (toJudge.length) write(`${VARIANT}.tojudge.json`, toJudge);
const f = (x: number) => (Number.isNaN(x) ? "—" : x.toFixed(3));
console.log(
  `${VARIANT} (${strategy.name}) · chunks A=${all.length} · ingest ${Math.round(ingestMs)} ms · CPU máy ${report.machine.cpuBusyPctDuringLatency}%`,
);
for (const [k, a] of [["ALL", report.overall], ...Object.entries(report.byKind)] as [
  string,
  ReturnType<typeof agg>,
][])
  console.log(
    `${k.padEnd(12)} n=${String(a.n).padStart(3)} R@1 ${f(a.recall1)} R@3 ${f(a.recall3)} R@5 ${f(a.recall5)} R@10 ${f(a.recall10)} MRR ${f(a.mrr)} facts@5 ${f(a.facts5)} judge ${f(a.correctness)} (${a.judged})`,
  );
console.log(
  `latency p50 ${report.latencyMs.p50.toFixed(1)} ms p95 ${report.latencyMs.p95.toFixed(1)} ms (n=${lat.length}) · leaks ${report.leaks.length} · unjudged ${toJudge.length}`,
);
await db.close?.();
process.exit(0);
