// HUB-FR-94 · AC-H21 · HUB-H2b-AC-03 · H2b-R16–R18 · plan §5.4, P8, P9 · plan-db §2 · plan-errors §1, §3 · test-plan H2b §5,
// Q-T3, cases §2 A80–A88: tối đa `maxConcurrentRuns` (= 2) run `running` mỗi user, mọi `kind` → `429 TOO_MANY_RUNS` +
// `Retry-After: 5` (expose qua CORS), 0 ghi; nguyên tử dưới song song (đúng 2/10, không deadlock); `FLOW_BUSY` thắng 429;
// run đã `ask`, `/internal/test-run`, user khác không tính; log `info run-limit`; env sai → server không lên.
// Catalog H2a + MK: `/dich` dùng `mk-slow-2000` (run `command` còn chạy ~2 s).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import {
  call,
  counts,
  HUB_API_URL,
  type Keys,
  makeKeys,
  REDIS_TEST_URL,
  type Res,
  type Sql,
  sign,
  USERS,
  type UserKey,
  waitFor,
} from "../H1/_fixtures";
import { type HubX, insertConv, pgDeadlocks, runRow, testRedis } from "../H1/_hub";
import { ScriptRuntime } from "../H1/_runtime";
import {
  ARGS_DICH,
  type Dify,
  INTERNAL_TOKEN,
  MAP_DICH,
  OUT,
  setAppKey,
  startDify,
  WF,
} from "../H2a/_h2a";
import { captureLogs, routingError, runsRunning, settleRuns, setupH2b, startHubH2b } from "./_h2b";

const REPO = resolve(import.meta.dir, "../../..");
let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime;
let dify: Dify;

beforeAll(async () => {
  dify = startDify();
  sql = await setupH2b({ catalogBaseUrl: dify.baseUrl });
  await setAppKey(sql, "dich", "mk-slow-2000");
  k = await makeKeys();
  hub = await startHubH2b(k);
  redis = await testRedis();
  rt = new ScriptRuntime(sql, redis);
}, 60_000);
afterEach(() => settleRuns(hub, sql, k));
afterAll(async () => {
  await hub?.stop();
  await dify?.close();
  redis?.disconnect();
  await sql?.end();
});

const tok = (who: UserKey) => sign(k, USERS[who]);
const newConv = (who: UserKey) => insertConv(sql, who, crypto.randomUUID());
type PostOpts = {
  conv?: string;
  flow?: string;
  headers?: Record<string, string>;
  h?: { base: string };
};
async function post(who: UserKey, content: string, o: PostOpts = {}): Promise<Res> {
  const conv = o.conv ?? (await newConv(who));
  return call((o.h ?? hub) as unknown as HubX, "POST", `/conversations/${conv}/messages`, {
    token: await tok(who),
    body: o.flow ? { content, flow_id: o.flow } : { content },
    headers: o.headers,
  });
}
const runIdOf = (r: Res) => r.headers.get("x-run-id") ?? "";
/** Run `orchestrated` giữ `running` (không ai nhận job). */
async function hold(who: UserKey = "lan", content = "Việc giữ chỗ"): Promise<Res> {
  const r = await post(who, content);
  expect(r.status).toBe(200);
  return r;
}
/** Kết thúc run bằng câu trả lời Orchestrator rồi chờ DB hết `running`. */
async function finishRun(runId: string): Promise<void> {
  await rt.decide(await rt.next(runId), { decision: "answer", text: "Xong." });
  await waitFor(
    async () => (await runRow(sql, runId))?.status,
    (s) => s !== "running",
    10_000,
  );
}
const TOO_MANY = { error: { code: "TOO_MANY_RUNS", message: "Too many running requests" } };
function expectTooMany(res: Res): void {
  expect(routingError(res)).toMatchObject({ status: 429, code: "TOO_MANY_RUNS" });
  expect(res.json).toEqual(TOO_MANY);
  expect(res.headers.get("retry-after")).toBe("5");
}

describe("A80–A82 · ngưỡng 2 run/user, nguyên tử, FLOW_BUSY thắng [AC-H21 · HUB-H2b-AC-03 · H2b-R17 · H2b-R18]", () => {
  it("HUB-FR-94 · A80 · 2 run lan running → tin thứ 3 (flow mới) → 429 + Retry-After: 5, body {code, message} không details, 0 ghi; Origin hợp lệ → expose retry-after; xong 1 run → gửi được [AC-H21 · H2b-R17]", async () => {
    const r1 = await hold();
    await hold();
    expect(await runsRunning(sql, "lan")).toBe(2);
    const before = await counts(sql);
    const third = await post("lan", "Tin thứ ba A80", {
      headers: { origin: "http://localhost:3100" },
    });
    expectTooMany(third);
    expect(await counts(sql)).toEqual(before);
    const expose = (third.headers.get("access-control-expose-headers") ?? "").toLowerCase();
    expect(expose).toContain("retry-after");
    await finishRun(runIdOf(r1));
    expect((await post("lan", "Gửi lại A80")).status).toBe(200);
  });

  it("HUB-FR-94 · A81 · 5 vòng × 10 POST song song (flow mới, 0 đang chạy) → đúng 2 × 200 + 8 × 429; vòng có sẵn 1 → đúng 1 × 200; deadlocks không tăng [HUB-H2b-AC-03 · Q-T3]", async () => {
    const d0 = await pgDeadlocks(sql);
    const round = async (pre: number): Promise<number[]> => {
      for (let i = 0; i < pre; i++) await hold();
      const conv = await newConv("lan");
      const rs = await Promise.all(
        Array.from({ length: 10 }, (_, i) => post("lan", `Song song ${i}`, { conv })),
      );
      const st = rs.map((r) => r.status).sort();
      await settleRuns(hub, sql, k);
      return st;
    };
    for (let i = 0; i < 5; i++) {
      const st = await round(0);
      expect(st).toEqual([200, 200, ...Array(8).fill(429)]);
    }
    expect(await round(1)).toEqual([200, ...Array(9).fill(429)]);
    expect(await pgDeadlocks(sql)).toBe(d0);
  }, 120_000);

  it("HUB-FR-94 · A82 · đủ 2 run, POST vào flow đang running → 409 FLOW_BUSY (không 429); 5 POST song song cùng flow → chỉ 409 [HUB-H2b-AC-03 · H2b-R18]", async () => {
    const conv = await newConv("lan");
    const r1 = await post("lan", "Flow bận A82", { conv });
    expect(r1.status).toBe(200);
    await hold();
    const flow = r1.headers.get("x-flow-id") ?? "";
    expect(routingError(await post("lan", "Chen A82", { conv, flow }))).toMatchObject({
      status: 409,
      code: "FLOW_BUSY",
    });
    const rs = await Promise.all(
      Array.from({ length: 5 }, (_, i) => post("lan", `Chen ${i}`, { conv, flow })),
    );
    expect(rs.map((r) => r.status)).toEqual(Array(5).fill(409));
  });
});

describe("A83–A86 · mọi kind đều tính; ask/test-run/user khác không tính; log; 0 ghi [H2b-R16 · H2b-R17]", () => {
  it("HUB-FR-94 · A83 · 1 orchestrated + 1 command (/dich, mk-slow-2000) → '@assistant x' → 429; 1 direct + 1 orchestrated → '@helper x' → 429 [H2b-R16]", async () => {
    await hold();
    const cmd = await post("lan", "/dich en xin chào A83");
    expect(cmd.status).toBe(200);
    expect((await runRow(sql, runIdOf(cmd)))?.kind).toBe("command");
    expectTooMany(await post("lan", "@assistant x"));
    await settleRuns(hub, sql, k);

    const direct = await post("lan", "@assistant giữ chỗ A83");
    expect(direct.status).toBe(200);
    expect((await runRow(sql, runIdOf(direct)))?.kind).toBe("direct");
    await hold();
    expectTooMany(await post("lan", "@helper x"));
  });

  it("HUB-FR-94 · A84 · run đã ask (finished) không tính: ask + 2 run → tin kế 429; test-run đang chạy (actor lan) không tính; hoa gửi được khi lan đủ ngưỡng [H2b-R16]", async () => {
    const a = await post("lan", "Đặt lịch A84");
    expect(a.status).toBe(200);
    await rt.decide(await rt.next(runIdOf(a)), {
      decision: "delegate",
      agent: "assistant",
      task: "Đặt lịch",
    });
    await rt.agent(await rt.next(runIdOf(a)), {
      status: "need_input",
      question: "Mấy giờ?",
      choices: ["9:00", "14:00"],
    });
    await waitFor(
      async () => (await runRow(sql, runIdOf(a)))?.status,
      (s) => s === "finished",
      10_000,
    );
    await hold();
    await hold();
    expectTooMany(await post("lan", "Thứ ba sau ask A84"));
    await settleRuns(hub, sql, k);

    await hold();
    dify.mock.reset();
    const testRun = call(hub, "POST", "/internal/test-run", {
      headers: { authorization: `Bearer ${INTERNAL_TOKEN}` },
      body: {
        command: {
          workflow_id: WF.dich,
          args: ARGS_DICH,
          input_map: MAP_DICH,
          output: OUT,
          timeout_s: 10,
        },
        text: "en xin chào",
        actor_user_id: USERS.lan.id,
      },
    });
    await waitFor(
      async () => dify.runs().length,
      (n) => n >= 1,
      5_000,
    );
    expect((await post("lan", "Trong lúc test-run A84")).status).toBe(200);
    expectTooMany(await post("lan", "Vượt ngưỡng A84"));
    expect((await testRun).status).toBe(200);

    expect((await post("hoa", "Hoa gửi khi lan đủ ngưỡng A84")).status).toBe(200);
  }, 60_000);

  it("HUB-FR-94 · A85 · 429 → log info run-limit {tenant_id, user_id, running:2, limit:2}, không nội dung tin [H2b-R17 · plan-errors §3]", async () => {
    await hold();
    await hold();
    const log = captureLogs();
    try {
      expectTooMany(await post("lan", "NOI-DUNG-BI-MAT-A85"));
    } finally {
      log.restore();
    }
    const hit = log.lines.find((l) => l.rec.msg === "run-limit");
    expect(hit?.level).toBe("info");
    expect(hit?.rec).toMatchObject({
      tenant_id: USERS.lan.tid,
      user_id: USERS.lan.id,
      running: 2,
      limit: 2,
    });
    expect(JSON.stringify(log.lines)).not.toContain("NOI-DUNG-BI-MAT-A85");
  });

  it("HUB-FR-94 · A86 · 429 không lưu message user, không tạo flow/run (đếm flows, messages, runs, jobs) [H2b-R17]", async () => {
    await hold();
    await hold();
    const conv = await newConv("lan");
    const before = await counts(sql);
    expectTooMany(await post("lan", "Không được lưu A86", { conv }));
    expect(await counts(sql)).toEqual(before);
    const [m] = await sql<{ n: number }[]>`select count(*)::int as n from hub.messages
      where conversation_id = ${conv}`;
    expect(m?.n).toBe(0);
  });
});

describe("A87–A88 · env HUB_MAX_CONCURRENT_RUNS, đua [H2b-R16 · K3]", () => {
  type Proc = ReturnType<typeof Bun.spawn>;
  const port = () => 43_000 + (process.pid % 1000) + Math.floor(Math.random() * 500);
  function spawnHub(limit: string, p: number): Proc {
    return Bun.spawn(["bun", "apps/hub-api/src/server.ts"], {
      cwd: REPO,
      env: {
        ...process.env,
        APP_ENV: "test",
        HUB_PORT: String(p),
        HUB_DATABASE_URL: HUB_API_URL,
        REDIS_URL: REDIS_TEST_URL,
        JWT_PUBLIC_KEY: k.publicPem,
        HUB_INSTANCE_ID: `qc-boot-a87-${limit}`,
        HUB_MAX_CONCURRENT_RUNS: limit,
        LOG_LEVEL: "info",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  for (const bad of ["0", "21", "abc"])
    it(`HUB-FR-94 · A87 · HUB_MAX_CONCURRENT_RUNS=${bad} → server.ts thoát ≠ 0 trong 10 s [H2b-R16]`, async () => {
      const proc = spawnHub(bad, port());
      const code = await Promise.race([proc.exited, Bun.sleep(10_000).then(() => null)]);
      if (code === null) proc.kill();
      await proc.exited;
      expect(code).not.toBeNull();
      expect(code).not.toBe(0);
    }, 30_000);

  it("HUB-FR-94 · A87 · HUB_MAX_CONCURRENT_RUNS=1 → server.ts lên; run thứ 2 của lan → 429 [H2b-R16]", async () => {
    const p = port();
    const proc = spawnHub("1", p);
    const h = { base: `http://localhost:${p}` };
    try {
      const health = await waitFor(
        () =>
          fetch(`${h.base}/health`, { signal: AbortSignal.timeout(1_000) })
            .then((r) => r.status)
            .catch(() => 0),
        (st) => st === 200 || proc.exitCode !== null,
        15_000,
      );
      expect(health).toBe(200);
      const first = await post("lan", "Một A87", { h });
      expect(first.status).toBe(200);
      expectTooMany(await post("lan", "Hai A87", { h }));
      await call(h as unknown as HubX, "POST", `/runs/${runIdOf(first)}/cancel`, {
        token: await tok("lan"),
      });
    } finally {
      proc.kill();
      await proc.exited;
    }
  }, 40_000);

  it("HUB-FR-94 · A88 · 5 vòng: đủ ngưỡng (429) rồi song song E12 + huỷ run 1 + job.result run 2 → mọi request ≤ 5 s, deadlocks không tăng, ≤ 2 running [H2b-R17 · K3]", async () => {
    const d0 = await pgDeadlocks(sql);
    for (let i = 0; i < 5; i++) {
      const r1 = await hold();
      const r2 = await hold();
      expectTooMany(await post("lan", `Đủ ngưỡng ${i}`));
      const job = await rt.next(runIdOf(r2));
      const t0 = Date.now();
      const [e12] = await Promise.all([
        post("lan", `Đua ${i}`),
        call(hub, "POST", `/runs/${runIdOf(r1)}/cancel`, { token: await tok("lan") }),
        rt.decide(job, { decision: "answer", text: "Đua xong." }),
      ]);
      expect(Date.now() - t0).toBeLessThanOrEqual(5_000);
      expect([200, 429]).toContain(e12.status);
      expect(await runsRunning(sql, "lan")).toBeLessThanOrEqual(2);
      await settleRuns(hub, sql, k);
    }
    expect(await pgDeadlocks(sql)).toBe(d0);
  }, 120_000);
});
