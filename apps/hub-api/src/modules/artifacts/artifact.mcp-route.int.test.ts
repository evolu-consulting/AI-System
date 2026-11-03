// CR-114 · hub-agent-handoff · đường thật: token job (`hub.jobs.token_hash`, `agent.cli` `running`) → POST `/mcp`
// `tools/list` / `tools/call artifact-get|artifact-search`. Phạm vi token = tenant + run của job + `payload.mcp.tools`:
// job tenant acme không đọc artifact tenant beta, cũng không đọc artifact của run khác cùng tenant; job không có tool
// artifact trong payload ⇒ tool lạ (-32602).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { makeKeys, type Sql, USERS } from "../../../../../tests/acceptance/H1/_fixtures";
import type { HubX } from "../../../../../tests/acceptance/H1/_hub";
import { AG } from "../../../../../tests/acceptance/H1/_hub";
import { insertSqlJob, mcp } from "../../../../../tests/acceptance/H2a/_runtime2";
import { setupH2b, startHubH2b } from "../../../../../tests/acceptance/H2b/_h2b";
import { ARTIFACT_GET, ARTIFACT_SEARCH } from "./artifact.mcp";

let sql: Sql;
let hub: HubX;
const prevFlag = process.env.HUB_ARTIFACT_HANDOFF;

type Rpc = {
  result?: { content: { text: string }[]; isError: boolean; tools?: { name: string }[] };
  error?: { code: number };
};

const job = (who: "lan" | "an", tools: string[]) =>
  insertSqlJob(sql, () => crypto.randomUUID(), {
    who,
    type: "agent.cli",
    agentId: AG.hoadon,
    agentKey: "hoadon",
    tools,
    mcpUrl: `${hub.base}/mcp`,
  });

/** Như `ArtifactStore.put`: hàng dedup theo (tenant, key) + link cho từng run. */
async function artifact(tenantId: string, runId: string, body: string): Promise<string> {
  const key = createHash("sha256").update(body, "utf8").digest("hex");
  await sql`insert into hub.artifacts (tenant_id, key, kind, body, size_bytes, tokens, summary, run_id, expires_at)
    values (${tenantId}, ${key}, 'text', ${body}, ${Buffer.byteLength(body)}, ${Math.ceil(body.length / 4)},
      ${body.slice(0, 40)}, ${runId}, now() + interval '1 day') on conflict do nothing`;
  await sql`insert into hub.artifact_runs (tenant_id, run_id, key) values (${tenantId}, ${runId}, ${key})
    on conflict do nothing`;
  return `art:${key.slice(0, 8)}`;
}

const call = async (token: string, name: string, args: unknown): Promise<Rpc> =>
  (await mcp(hub, token, "tools/call", { name, arguments: args })).json as Rpc;
const text = (r: Rpc) => (r.result?.content ?? []).map((c) => c.text).join("\n");

beforeAll(async () => {
  process.env.HUB_ARTIFACT_HANDOFF = "1";
  sql = await setupH2b();
  hub = await startHubH2b(await makeKeys(), { instanceId: "hub-cr114-art" });
}, 120_000);
afterAll(async () => {
  await hub?.stop();
  await sql?.end();
  if (prevFlag === undefined) delete process.env.HUB_ARTIFACT_HANDOFF;
  else process.env.HUB_ARTIFACT_HANDOFF = prevFlag;
});

describe("CR-114 · token job → POST /mcp artifact-get/search", () => {
  it("phạm vi token: tenant + run + payload.mcp.tools", async () => {
    const tools = [ARTIFACT_GET, ARTIFACT_SEARCH];
    const a = await job("lan", tools);
    const b = await job("an", tools);
    const own = await artifact(USERS.lan.tid, a.runId, "Hoá đơn acme: tổng thanh toán 128 triệu");
    const beta = await artifact(USERS.an.tid, b.runId, "Hoá đơn beta: tổng thanh toán 999 triệu");
    const otherRun = await artifact(
      USERS.lan.tid,
      crypto.randomUUID(),
      "Hoá đơn acme run khác 777",
    );

    const list = (await mcp(hub, a.token, "tools/list")).json as Rpc;
    expect((list.result?.tools ?? []).map((t) => t.name)).toEqual(
      expect.arrayContaining([ARTIFACT_GET, ARTIFACT_SEARCH]),
    );

    const got = await call(a.token, ARTIFACT_GET, { key: own });
    expect(got.result?.isError).toBe(false);
    expect(text(got)).toContain("128 triệu");

    for (const key of [beta, otherRun]) {
      const r = await call(a.token, ARTIFACT_GET, { key });
      expect(r.result?.isError).toBe(true);
      expect(text(r)).not.toMatch(/999|777/);
    }
    const s = await call(a.token, ARTIFACT_SEARCH, { query: "hoá đơn" });
    expect(text(s)).toContain(own);
    expect(text(s)).not.toContain(beta);
    expect(text(s)).not.toContain(otherRun);

    // Token beta thấy đúng của mình.
    expect(text(await call(b.token, ARTIFACT_GET, { key: beta }))).toContain("999 triệu");

    // Hai run cùng nội dung ⇒ cả hai đọc được (link riêng, không "chuyển"); run thứ ba cùng tenant không link ⇒ không.
    const a2 = await job("lan", tools);
    const a3 = await job("lan", tools);
    const shared = "Biên bản chung: hạn giao 15/12";
    expect(await artifact(USERS.lan.tid, a2.runId, shared)).toBe(
      await artifact(USERS.lan.tid, a.runId, shared),
    );
    const sharedKey = `art:${createHash("sha256").update(shared, "utf8").digest("hex").slice(0, 8)}`;
    expect(text(await call(a.token, ARTIFACT_GET, { key: sharedKey }))).toContain("15/12");
    expect(text(await call(a2.token, ARTIFACT_GET, { key: sharedKey }))).toContain("15/12");
    const third = await call(a3.token, ARTIFACT_GET, { key: sharedKey });
    expect(third.result?.isError).toBe(true);

    // Job không có tool artifact trong payload ⇒ tool lạ.
    const c = await job("lan", ["hd-tra-cuu"]);
    const denied = await call(c.token, ARTIFACT_GET, { key: own });
    expect(denied.error?.code).toBe(-32602);
  });
});
