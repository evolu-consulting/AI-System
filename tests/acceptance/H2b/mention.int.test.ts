// HUB-FR-91 · HUB-BR-18 · HUB-FR-94 · AC-H18 · H2b-R01–R05, R18 · plan-errors §1 · test-plan H2b §5, cases §2 A01–A07:
// router `@` ở E12 — tag sai/không dùng được → 404 `AGENT_NOT_FOUND{suggestions ⊆ AU}`, tag rỗng → 422 `CMD_MISSING_ARG`,
// trả JSON **trước khi tạo run** (0 message/run/job); `@@` = chữ `@` qua Orchestrator; `@` giữa tin không phải tag; thứ tự
// kiểm R18. Hộp đen: hub-api thật (`maxConcurrentRuns: 2`) + DB riêng + Redis DB 15; test đóng vai Runtime.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import {
  call,
  counts,
  type Keys,
  makeKeys,
  type Res,
  type Sql,
  sign,
  UNKNOWN,
  USERS,
  type UserKey,
  waitFor,
} from "../H1/_fixtures";
import {
  type HubX,
  hubConfigChange,
  insertConv,
  runIdOf,
  runRow,
  send,
  testRedis,
} from "../H1/_hub";
import { ScriptRuntime } from "../H1/_runtime";
import {
  AG3,
  expectAgentNotFound,
  expectMissingContent,
  jobsOf,
  LAN_AU,
  menuKeys,
  messageOf,
  routingError,
  settleRuns,
  setupH2b,
  startHubH2b,
} from "./_h2b";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime;

beforeAll(async () => {
  sql = await setupH2b();
  k = await makeKeys();
  hub = await startHubH2b(k);
  redis = await testRedis();
  rt = new ScriptRuntime(sql, redis);
}, 60_000);
afterEach(() => settleRuns(hub, sql, k));
afterAll(async () => {
  await hub?.stop();
  redis?.disconnect();
  await sql?.end();
});

const tok = (who: UserKey = "lan") => sign(k, USERS[who]);
const newConv = (who: UserKey = "lan") => insertConv(sql, who, crypto.randomUUID());
async function post(content: string, o: { conv?: string; flow?: string } = {}): Promise<Res> {
  const conv = o.conv ?? (await newConv());
  return call(hub, "POST", `/conversations/${conv}/messages`, {
    token: await tok(),
    body: o.flow ? { content, flow_id: o.flow } : { content },
  });
}
/**
 * Gửi `content`; bị từ chối (≠ 200) thì kiểm "0 ghi" (counts không đổi, kể cả job). 200 (run đã tạo) → để người gọi
 * đỏ ở mã HTTP (lý do đỏ rõ hơn đếm dòng).
 */
async function rejected(content: string, o: { conv?: string; flow?: string } = {}): Promise<Res> {
  const conv = o.conv ?? (await newConv());
  const before = await counts(sql);
  const res = await post(content, { ...o, conv });
  if (res.status !== 200) expect(await counts(sql)).toEqual(before);
  return res;
}
const subsetOfAu = (s: string[]) =>
  expect(s.every((x) => (LAN_AU as readonly string[]).includes(x))).toBe(true);

describe("A01–A04 · tag sai → AGENT_NOT_FOUND / tag rỗng → CMD_MISSING_ARG, 0 ghi [AC-H18 · H2b-R02–R05]", () => {
  for (const content of ["@hoadon xin", "@nope xin", "@orchestrator xin", "@llmbot xin"])
    it(`HUB-FR-91 · A01 · lan ${JSON.stringify(content)} (không thuộc AU) → 404 AGENT_NOT_FOUND, suggestions ⊆ AU, 0 message/run/job [AC-H18 · H2b-R02 · H2b-R05]`, async () => {
      subsetOfAu(expectAgentNotFound(await rejected(content)));
    });

  it("HUB-FR-91 · A01 · gợi ý chỉ trong AU: @orchestratr x không gợi ý orchestrator; @hoadonn x không gợi ý hoadon; @asistant x → [assistant] [AC-H18 · H2b-R03]", async () => {
    const orch = expectAgentNotFound(await rejected("@orchestratr x"));
    expect(orch).not.toContain("orchestrator");
    subsetOfAu(orch);
    const hd = expectAgentNotFound(await rejected("@hoadonn x"));
    expect(hd).not.toContain("hoadon");
    expect(expectAgentNotFound(await rejected("@asistant x"))).toEqual(["assistant"]);
  });

  it("HUB-FR-91 · A01 · tắt writer (config change + NOTIFY) → @writer xin → 404 AGENT_NOT_FOUND, 0 ghi [AC-H18 · H2b-R02 · H2b-R11]", async () => {
    await hubConfigChange(
      sql,
      (tx) => tx`update hub.agents set enabled = false where id = ${AG3.writer}`,
    );
    try {
      await waitFor(
        async () => menuKeys(hub, await tok()),
        (ks) => ks !== null && !ks.includes("writer"),
        5_000,
      );
      expectAgentNotFound(await rejected("@writer xin"));
    } finally {
      await hubConfigChange(
        sql,
        (tx) => tx`update hub.agents set enabled = true where id = ${AG3.writer}`,
      );
    }
  });

  it("HUB-BR-18 · A02 · '@ x', '@' → 404 suggestions []; '  @assistant x' (khoảng trắng đầu) → run direct [H2b-R01]", async () => {
    for (const c of ["@ x", "@"]) expect(expectAgentNotFound(await rejected(c))).toEqual([]);
    const ok = await post("  @assistant x");
    expect(ok.status).toBe(200);
    expect((await runRow(sql, ok.headers.get("x-run-id") ?? ""))?.kind).toBe("direct");
  });

  it("HUB-FR-91 · A03 · '@assistant', '@assistant   ' → 422 CMD_MISSING_ARG {missing:[content], invalid:[]}; '@nope' (không nội dung) → 404 (tag kiểm trước); 0 ghi [H2b-R04 · H2b-R05]", async () => {
    expectMissingContent(await rejected("@assistant"));
    expectMissingContent(await rejected("@assistant   "));
    expectAgentNotFound(await rejected("@nope"));
  });

  it("HUB-FR-91 · A04 · '@assistant @helpr x' → 404 gợi ý cho tag sai thứ 2 ([helper]); '@nope @assistant x' → 404; không run, không job Orchestrator [H2b-R02 · T1]", async () => {
    expect(expectAgentNotFound(await rejected("@assistant @helpr x"))).toEqual(["helper"]);
    expectAgentNotFound(await rejected("@assistant @nope x"));
    expectAgentNotFound(await rejected("@nope @assistant x"));
  });
});

describe("A05–A06 · '@@' và '@' giữa tin đi Orchestrator như chữ [AC-H18 · H2b-R01]", () => {
  it("HUB-BR-18 · A05 · '@@abc' → run orchestrated; job Orchestrator <message> = '@abc'; messages.content (user) = '@abc' [AC-H18 · H2b-R01]", async () => {
    const conv = await newConv();
    const s = await send(hub, await tok(), conv, "@@abc");
    try {
      expect(s.status).toBe(200);
      const runId = runIdOf(s);
      const job = await rt.next(runId);
      expect(job.payload.agent.role).toBe("orchestrator");
      expect(messageOf(job)).toBe("@abc");
      const [m] = await sql`select content from hub.messages where conversation_id = ${conv}
        and role = 'user'`;
      expect(m?.content).toBe("@abc");
      expect((await runRow(sql, runId))?.kind).toBe("orchestrated");
    } finally {
      s.close();
    }
  });

  it("HUB-FR-91 · A06 · 'x @assistant' → run orchestrated, <message> nguyên văn [H2b-R01]", async () => {
    const s = await send(hub, await tok(), await newConv(), "x @assistant");
    try {
      expect(s.status).toBe(200);
      const runId = runIdOf(s);
      const job = await rt.next(runId);
      expect(job.payload.agent.role).toBe("orchestrator");
      expect(messageOf(job)).toBe("x @assistant");
      expect((await runRow(sql, runId))?.kind).toBe("orchestrated");
      expect((await jobsOf(sql, runId)).map((j) => j.role)).toEqual(["orchestrator"]);
    } finally {
      s.close();
    }
  });
});

describe("A07 · thứ tự kiểm E12 với '@' [H2b-R18 · HUB-FR-94]", () => {
  it("HUB-FR-94 · A07 · hội thoại lạ → 404 NOT_FOUND; body sai → 400; flow lạ + '@nope x' → AGENT_NOT_FOUND; flow lạ + '@assistant x' → NOT_FOUND; flow đang chạy + '@nope x' → AGENT_NOT_FOUND; đủ 2 run + '@assistant' → 422 [H2b-R18]", async () => {
    const token = await tok();
    const unknownConv = await call(hub, "POST", `/conversations/${UNKNOWN}/messages`, {
      token,
      body: { content: "@nope x" },
    });
    expect(routingError(unknownConv)).toMatchObject({ status: 404, code: "NOT_FOUND" });
    const conv = await newConv();
    const bad = await call(hub, "POST", `/conversations/${conv}/messages`, {
      token,
      body: { content: "" },
    });
    expect(routingError(bad)).toMatchObject({ status: 400, code: "VALIDATION_ERROR" });
    expectAgentNotFound(await rejected("@nope x", { conv, flow: UNKNOWN }));
    const lostFlow = await post("@assistant x", { conv, flow: UNKNOWN });
    expect(routingError(lostFlow)).toMatchObject({ status: 404, code: "NOT_FOUND" });

    const first = await post("Việc đang chạy A07", { conv });
    expect(first.status).toBe(200);
    const busyFlow = first.headers.get("x-flow-id") ?? "";
    expectAgentNotFound(await rejected("@nope x", { conv, flow: busyFlow }));
    const second = await post("Việc thứ hai A07");
    expect(second.status).toBe(200);
    expectMissingContent(await rejected("@assistant"));
  });
});
