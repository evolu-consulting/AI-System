// R1 · F-03 (review CR-095 đợt C) · Luật 4c: trigger df `knowledge.lexemes_sub` khoá hàng lexeme theo thứ tự xác định
// (tenant_id, lexeme) giống nhánh thêm `lexemes_add` ⇒ xoá ∥ xoá, xoá ∥ thêm cùng tenant, chung lexeme không deadlock (40P01).
// (1) định nghĩa hàm: khoá `ORDER BY … FOR UPDATE` TRƯỚC câu UPDATE; (2) chạy song song nhiều lượt — mọi tx phải commit và df
// khớp số đoạn thật (đếm lại từ `chunks`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { knowledgeService } from "../../../apps/hub-api/src/modules/knowledge/knowledge.mount";

const T = tenantId(981);
const U = userId(981);
const VOCAB = Array.from({ length: 300 }, (_, i) => `lexkhoa${i.toString(36)}q`);
const ROUNDS = 12;

let db: Db;
let owner: Sql;
let svc: ReturnType<typeof knowledgeService>;

/** Văn bản dùng chung toàn bộ VOCAB, thứ tự xáo theo `seed` (thứ tự trong văn bản không ảnh hưởng tsvector). */
const body = (seed: number) =>
  VOCAB.map((w, i) => ({ w, k: (i * 7919 + seed * 104729) % 1009 }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.w)
    .join(" ");
const add = async (title: string, seed: number) => {
  const r = await svc.add(
    { tenantId: T, userId: U },
    { title, content: `# ${title}\n${body(seed)}`, kind: "markdown" },
  );
  if (!r.ok) throw new Error(r.code);
};
const del = (title: string) =>
  owner`delete from knowledge.documents where tenant_id = ${T}::uuid and title = ${title}`;

beforeAll(async () => {
  await cloneDb("full");
  owner = openOwner(4);
  db = createDb(urls().hubApi, { max: 4 });
  svc = knowledgeService(db, { env: {}, ai: { embedder: null, reranker: null } });
  for (let i = 0; i < ROUNDS * 2; i++) await add(`D${i}`, i);
});
afterAll(async () => {
  await db?.close();
  await owner?.end({ timeout: 2 });
});

describe("R1 · F-03 trigger df khoá theo thứ tự (không deadlock)", () => {
  it("lexemes_sub khoá `ORDER BY tenant_id, lexeme … FOR UPDATE` trước UPDATE", async () => {
    const [f] = await owner<{ src: string }[]>`
      select pg_get_functiondef('knowledge.lexemes_sub()'::regprocedure) as src`;
    const src = (f?.src ?? "").replace(/\s+/g, " ");
    const lock = src.search(/ORDER BY [a-z.]*tenant_id, [a-z.]*lexeme FOR UPDATE/i);
    expect(lock).toBeGreaterThan(-1);
    expect(src.search(/UPDATE knowledge\.lexemes/i)).toBeGreaterThan(lock);
  });

  it(`${ROUNDS} lượt xoá ∥ xoá ∥ thêm ∥ thêm cùng tenant, chung 300 lexeme: mọi tx commit, df = số đoạn thật`, async () => {
    const failures: string[] = [];
    for (let r = 0; r < ROUNDS; r++) {
      const res = await Promise.allSettled([
        del(`D${2 * r}`),
        del(`D${2 * r + 1}`),
        add(`N${2 * r}`, 1000 + r),
        add(`N${2 * r + 1}`, 2000 + r),
      ]);
      for (const x of res)
        if (x.status === "rejected")
          failures.push(String((x.reason as { code?: string }).code ?? x.reason));
    }
    expect(failures).toEqual([]);
    const bad = await owner<{ lexeme: string; df: number; n: number }[]>`
      with c as (select x.lexeme, count(*)::int as n from knowledge.chunks ch, unnest(tsvector_to_array(ch.tsv)) x(lexeme)
                 where ch.tenant_id = ${T}::uuid group by x.lexeme)
      select l.lexeme, l.df, coalesce(c.n, 0) as n from knowledge.lexemes l left join c on c.lexeme = l.lexeme
      where l.tenant_id = ${T}::uuid and l.df <> coalesce(c.n, 0)`;
    expect([...bad]).toEqual([]);
    const [k] = await owner<{ n: number }[]>`
      select df as n from knowledge.lexemes where tenant_id = ${T}::uuid and lexeme = ${VOCAB[0] ?? ""}`;
    expect(k?.n ?? 0).toBeGreaterThanOrEqual(ROUNDS * 2); // ≥ 1 đoạn mỗi tài liệu N* còn lại
  });
});
