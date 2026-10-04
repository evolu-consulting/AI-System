// HUB-FR-40, 75 · HUB-BR-02, 14 · HUB-H1-AC-H07, H08 · H1-R03 · test-plan H1 §5 A5–A7 (Q7): cách ly tenant/user.
// A5, A7: HTTP vào hub-api thật; A6: SQL trực tiếp bằng role `hub_api` / `agent_runtime` trên `ai_system_h1_test`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import {
  AGENT_RT_URL,
  call,
  counts,
  type Ep,
  endpoints,
  err,
  errorOf,
  HUB_API_URL,
  type Hub,
  insertFixture,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  R,
  type Sql,
  sign,
  startHub,
  T,
  UNKNOWN,
  USERS,
  type UserKey,
} from "./_fixtures";

let sql: Sql;
let k: Keys;
let hub: Hub;

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  k = await makeKeys();
  hub = await startHub(k);
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await sql?.end();
});

// ---------- A5 ----------
/** Tài nguyên `lan` (hội thoại, flow, run đang chạy) + run đã xong; E5 (danh sách) không thuộc A5. */
function a5Eps(conv: string, flow: string, runLive: string, runDone: string): Ep[] {
  const eps = endpoints(conv, flow, runLive).filter((e) => e.name !== "E5");
  const done = endpoints(conv, flow, runDone)
    .filter((e) => ["E13", "E14", "E15"].includes(e.name))
    .map((e) => ({ ...e, name: `${e.name}(xong)` }));
  // E9 (xoá) để cuối: nếu lọt, các lệnh khác vẫn được kiểm trên dữ liệu nguyên.
  return [...eps.filter((e) => e.name !== "E9"), ...done, ...eps.filter((e) => e.name === "E9")];
}
const LAN_EPS = a5Eps(R.conv, R.flow2, R.runLive, R.runDone);
const UNKNOWN_EPS = a5Eps(UNKNOWN, UNKNOWN, UNKNOWN, UNKNOWN);

async function lanSnapshot() {
  const [c] = await sql<{ title: string; deleted: boolean }[]>`
    select title, deleted_at is not null as deleted from hub.conversations where id = ${R.conv}`;
  const runs = await sql<{ id: string; status: string }[]>`
    select id, status from hub.runs where conversation_id = ${R.conv} order by id`;
  return { conv: c, runs, counts: await counts(sql) };
}

async function a5(actor: UserKey): Promise<void> {
  const owner = await sign(k, USERS.lan);
  // Đối chứng: chủ thấy tài nguyên (404 mặc định của khung không đạt ca này, test-plan §8).
  expect((await call(hub, "GET", `/conversations/${R.conv}`, { token: owner })).status).toBe(200);
  expect((await call(hub, "GET", `/runs/${R.runLive}`, { token: owner })).status).toBe(200);

  const before = await lanSnapshot();
  const token = await sign(k, USERS[actor]);
  const got: Record<string, unknown> = {};
  const want: Record<string, unknown> = {};
  for (const [i, e] of LAN_EPS.entries()) {
    const u = UNKNOWN_EPS[i] as Ep;
    const ref = await call(hub, u.method, u.path, { token, body: u.body });
    const res = await call(hub, e.method, e.path, { token, body: e.body });
    got[e.name] = { ...errorOf(res), body: res.json };
    want[e.name] = { ...err("NOT_FOUND"), body: ref.json };
  }
  expect(got).toEqual(want);
  // Sau đó: dữ liệu `lan` nguyên, run đang chạy không bị huỷ, không thêm messages/runs/jobs.
  expect(await lanSnapshot()).toEqual(before);
  expect(before.runs).toContainEqual({ id: R.runLive, status: "running" });
}

describe("A5 · tài nguyên lan × người khác → 404 như uuid lạ [HUB-FR-75 · HUB-H1-AC-H07 · HUB-H1-AC-H08]", () => {
  it("A5 · hoa (cùng tenant, member) × E7–E15 → 404 NOT_FOUND [HUB-H1-AC-H07 · H1-R03]", async () => {
    await a5("hoa");
  });

  it("A5 · an (tenant khác) × E7–E15 → 404 NOT_FOUND [HUB-H1-AC-H08 · H1-R03]", async () => {
    await a5("an");
  });

  it("A5 · tadmin (tenant_admin cùng tenant) × E7–E15 → 404 NOT_FOUND [HUB-H1-AC-H07 · H1-R03]", async () => {
    await a5("tadmin");
  });

  it("A5 · padmin (platform_admin) × E7–E15 → 404 NOT_FOUND [HUB-H1-AC-H08 · H1-R03]", async () => {
    await a5("padmin");
  });
});

// ---------- A6 ----------
const CONV_TABLES = ["conversations", "flows", "messages", "runs", "run_steps"] as const;
class Rollback extends Error {}

/** Chạy `fn` trong transaction luôn rollback; `scope` đặt `app.*` cục bộ như `withHubScope` (plan §3.4). */
async function inTx<V>(
  db: Sql,
  scope: UserKey | null,
  fn: (tx: postgres.TransactionSql) => Promise<V>,
): Promise<V> {
  let out: V | undefined;
  await db
    .begin(async (tx) => {
      if (scope) {
        const x = USERS[scope];
        await tx`select set_config('app.scope', 'user', true), set_config('app.tenant_id', ${x.tid}, true),
          set_config('app.user_id', ${x.id}, true)`;
      }
      out = await fn(tx);
      throw new Rollback();
    })
    .catch((e) => {
      if (!(e instanceof Rollback)) throw e;
    });
  return out as V;
}

const pgCode = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code ?? String(e),
  );

describe("A6 · RLS hub_rw + quyền agent_runtime (Q7) [HUB-FR-75 · HUB-BR-14]", () => {
  let hubSql: Sql;
  let rtSql: Sql;
  beforeAll(() => {
    hubSql = postgres(HUB_API_URL, { max: 1, onnotice: () => {} });
    rtSql = postgres(AGENT_RT_URL, { max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    await hubSql?.end();
    await rtSql?.end();
  });

  it("A6 · hub_api không app.scope → 0 dòng ở 5 bảng hội thoại [HUB-FR-75 · Q7]", async () => {
    // Đối chứng: owner thấy dữ liệu fixture.
    expect((await counts(sql)).conversations).toBeGreaterThan(0);
    const seen: Record<string, number> = {};
    for (const t of CONV_TABLES) {
      const [r] = await inTx(
        hubSql,
        null,
        (tx) => tx<{ n: number }[]>`select count(*)::int as n from ${tx(`hub.${t}`)}`,
      );
      seen[t] = r?.n ?? -1;
    }
    expect(seen).toEqual({ conversations: 0, flows: 0, messages: 0, runs: 0, run_steps: 0 });
  });

  it("A6 · hub_api scope user=lan → chỉ dòng của lan [HUB-FR-75 · HUB-BR-02]", async () => {
    const L = USERS.lan;
    const foreign: Record<string, number> = {};
    for (const t of CONV_TABLES) {
      const [r] = await inTx(
        hubSql,
        "lan",
        (tx) => tx<{ n: number }[]>`
        select count(*)::int as n from ${tx(`hub.${t}`)} where tenant_id <> ${L.tid} or user_id <> ${L.id}`,
      );
      foreign[t] = r?.n ?? -1;
    }
    expect(foreign).toEqual({ conversations: 0, flows: 0, messages: 0, runs: 0, run_steps: 0 });
    const ids = await inTx(
      hubSql,
      "lan",
      (tx) => tx<{ id: string }[]>`select id from hub.conversations`,
    );
    expect(ids.map((x) => x.id)).toContain(R.conv);
  });

  it("A6 · hub_api scope lan INSERT hội thoại tenant/user khác → lỗi RLS 42501 [HUB-FR-75 · HUB-BR-14]", async () => {
    const an = USERS.an;
    const code = await inTx(hubSql, "lan", (tx) =>
      pgCode(
        tx`insert into hub.conversations (tenant_id, user_id, title, title_norm)
          values (${an.tid}, ${an.id}, 'Chen ngang', 'chen ngang')`,
      ),
    );
    expect(code).toBe("42501");
  });

  it("A6 · agent_runtime SELECT hub.conversations / admin.users → denied; EXECUTE tenant_sub_limit được [WRK-FR-24 · Q7]", async () => {
    expect(await pgCode(rtSql`select count(*) from hub.conversations`)).toBe("42501");
    expect(await pgCode(rtSql`select count(*) from admin.users`)).toBe("42501");
    expect(await pgCode(rtSql`select hub.tenant_sub_limit(${T.acme}::uuid)`)).toBe("ok");
  });
});

// ---------- A7 ----------
describe("A7 · tenant_id/user_id không nhận từ body/query [HUB-FR-40 · H1-R03]", () => {
  const an = USERS.an;

  it("A7 · body có tenant_id/user_id (E6, E8, E12) → 400 VALIDATION_ERROR, không ghi [H1-R03]", async () => {
    const token = await sign(k, USERS.lan);
    // Đối chứng: body hợp lệ được nhận.
    expect(
      (await call(hub, "POST", "/conversations", { token, body: { title: "Hợp lệ" } })).status,
    ).toBe(201);
    const before = await counts(sql);
    const cases = [
      { m: "POST", p: "/conversations", b: { title: "X", tenant_id: an.tid } },
      { m: "POST", p: "/conversations", b: { title: "X", user_id: an.id } },
      { m: "PATCH", p: `/conversations/${R.conv}`, b: { title: "Đổi", user_id: an.id } },
      { m: "PATCH", p: `/conversations/${R.conv}`, b: { title: "Đổi", tenant_id: an.tid } },
      {
        m: "POST",
        p: `/conversations/${R.conv}/messages`,
        b: { content: "Hi", tenant_id: an.tid },
      },
      { m: "POST", p: `/conversations/${R.conv}/messages`, b: { content: "Hi", user_id: an.id } },
    ];
    const got = [];
    for (const c of cases) got.push(errorOf(await call(hub, c.m, c.p, { token, body: c.b })));
    expect(got).toEqual(cases.map(() => err("VALIDATION_ERROR")));
    expect(await counts(sql)).toEqual(before);
    const [c] = await sql<
      { title: string }[]
    >`select title from hub.conversations where id = ${R.conv}`;
    expect(c?.title).toBe("Hoá đơn tháng 9");
  });

  it("A7 · query tenant_id/user_id bị bỏ qua: E5 vẫn là của lan, E7 hội thoại của an → 404 [H1-R03]", async () => {
    const token = await sign(k, USERS.lan);
    const q = `tenant_id=${T.beta}&user_id=${an.id}`;
    const list = await call(hub, "GET", `/conversations?${q}`, { token });
    expect(list.status).toBe(200);
    const ids = ((list.json?.items ?? []) as { id: string }[]).map((x) => x.id);
    expect(ids).toContain(R.conv);
    expect(ids).not.toContain(R.anConv);
    expect((await call(hub, "GET", `/conversations/${R.conv}?${q}`, { token })).status).toBe(200);
    expect(errorOf(await call(hub, "GET", `/conversations/${R.anConv}?${q}`, { token }))).toEqual(
      err("NOT_FOUND"),
    );
  });
});
