// CR-101 DOC-model · Luật 4c: danh sách có HĐ NT + con. acme thêm 5.000 HĐ + 50 HĐ NT × 20 con (set-based). Đo TRƯỚC (danh sách
// thường) → SAU (`nest=1`, `doc_type=framework&nest=1`: con của cả trang trong CÙNG câu, `frame_root_id = any(mảng)`): p95 ≤ 50 ms,
// số câu SQL cố định = 2 (như HD1), không HTTP/Redis. Chạy: `PERF=1 bun --config=bunfig.perf.toml test tests/acceptance/DOC-model/perf/`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  CBASE,
  type CtxN1,
  ensureRoles,
  getWith,
  measure,
  P,
  startHd1,
  T,
} from "../../HD1/_support/hd1";
import { countHops } from "../../HD1/_support/hops";

let c: CtxN1;
let token = "";
const N = 5000;
const FRAMES = 50;
const KIDS = 20;

beforeAll(async () => {
  c = await startHd1();
  await ensureRoles(c);
  const who = P.lan.id;
  await c.sql`insert into contracts.contracts (tenant_id, title, status, created_by, owner_user_id)
    select ${T.acme}, 'HĐ perf ' || g, 'needs_review', ${who}, ${who} from generate_series(1, ${N}) g`;
  const frames = await c.sql<{ id: string }[]>`insert into contracts.contracts
      (tenant_id, title, status, created_by, owner_user_id, doc_type, credit_limit)
    select ${T.acme}, 'HĐ NT perf ' || g, 'needs_review', ${who}, ${who}, 'framework', 1000000000
    from generate_series(1, ${FRAMES}) g returning id::text`;
  await c.sql`insert into contracts.contracts (tenant_id, title, status, created_by, owner_user_id, frame_root_id)
    select ${T.acme}, 'Con perf ' || k, 'needs_review', ${who}, ${who}, f::uuid
    from unnest(${c.sql.array(frames.map((f) => f.id))}::text[]) f, generate_series(1, ${KIDS}) k`;
  await c.sql`analyze contracts.contracts`;
  token = await c.tok(P.lan);
}, 300_000);
afterAll(async () => {
  await c?.stop();
});

const CASES: Record<string, string> = {
  "trước · danh sách thường": "?page_size=50",
  "sau · nest=1": "?nest=1&page_size=50",
  "sau · HĐ NT + con (1.000 con/trang)": "?doc_type=framework&nest=1&page_size=50",
  "sau · nest=1 trang sâu": "?nest=1&page_size=50&page=40",
};

describe("CR-101 DOC-model · perf danh sách có con", () => {
  for (const [name, q] of Object.entries(CASES)) {
    it(`[${name}] p95 ≤ 50 ms, 2 câu SQL`, async () => {
      const path = `${CBASE}${q}`;
      const st = await measure(c, () => getWith(c, token, path), { n: 100 });
      const h = await countHops(c, () => getWith(c, token, path));
      console.log(
        `DOC-model perf [${name}] p50=${st.p50.toFixed(2)} p95=${st.p95.toFixed(2)} max=${st.max.toFixed(1)} ms · SQL=${h.sql} · items=${h.r.json?.items?.length} children=${h.r.json?.children?.length ?? "-"}`,
      );
      expect({ sql: h.sql, http: h.http, redis: h.redis }).toEqual({ sql: 2, http: [], redis: [] });
      expect(st.p95).toBeLessThanOrEqual(50);
    }, 300_000);
  }
});
