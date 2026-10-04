// HUB-FR-28, HUB-FR-20 · HUB-H1-AC-H14, AC-H15, HUB-H1-AC-01 · test-plan H1 §6 S2, S4: stack thật (hub-api process +
// agent-runtime container, `fake-cli`) — `need_input` → trả lời → delegate lại có resume phiên; "Xin chào" → `usage_logs`.
// Chạy: bun --env-file=.env.local test --timeout 120000 tests/acceptance/H1/stack
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { waitFor } from "../_fixtures";
import { deltaText, insertConv, runIdOf, send } from "../_hub";
import { bootStack, collectRunEvents, type Stack } from "./_stack";

let s: Stack;
beforeAll(async () => {
  s = await bootStack("qc-h1-stack-session");
}, 180_000);
afterAll(async () => {
  await s?.stop();
});

describe("S2 · need_input → trả lời → delegate lại [HUB-H1-AC-H14 · AC-H15]", () => {
  it("S2 · need_input: ask không lộ agent, pending_ask; tin kế delegate lại, job agent session_resumed=true [HUB-H1-AC-H15]", async () => {
    const conv = await insertConv(s.sql, "lan", "a3000000-0000-4000-8000-000000000201");
    const token = await s.token("lan");
    const first = await send(
      s.hub,
      token,
      conv,
      "#fake:delegate=assistant #fake:need_input Đặt lịch họp",
    );
    expect(first.status).toBe(200);
    const flowId = first.headers.get("x-flow-id") ?? "";
    const end1 = await first.terminal(60_000);
    first.close();
    expect(end1?.event).toBe("run.finished");
    const ask = first.events.find((e) => e.event === "ask");
    expect(ask?.data?.question).toBeString();
    expect(Object.keys(ask?.data ?? {})).not.toContain("agent");
    const [f1] = await s.sql`select agent_id, pending_ask from hub.flows where id = ${flowId}`;
    expect(f1?.pending_ask).toBe(true);

    const second = await send(s.hub, token, conv, "14:00 #fake:delegate=assistant", flowId);
    expect(second.status).toBe(200);
    const col = await collectRunEvents(runIdOf(second));
    const end2 = await second.terminal(60_000);
    second.close();
    col.stop();
    expect(end2?.event).toBe("run.finished");
    const results = col.events.filter((e) => e?.type === "job.result");
    expect(results.length).toBe(2); // Orchestrator + agent
    expect(results[1]?.session_resumed).toBe(true);
    const [f2] = await s.sql`select pending_ask from hub.flows where id = ${flowId}`;
    expect(f2?.pending_ask).toBe(false);
  }, 150_000);
});

describe("S4 · 'Xin chào' → usage_logs [HUB-H1-AC-01]", () => {
  it("S4 · gửi 'Xin chào' → run.finished có echo; usage_logs của run ≥ 1 dòng [HUB-H1-AC-01]", async () => {
    const conv = await insertConv(s.sql, "lan", "a3000000-0000-4000-8000-000000000401");
    const sse = await send(s.hub, await s.token("lan"), conv, "Xin chào");
    expect(sse.status).toBe(200);
    const runId = runIdOf(sse);
    const end = await sse.terminal(60_000);
    sse.close();
    expect(end?.event).toBe("run.finished");
    expect(deltaText(sse.events)).toStartWith("echo: Xin chào");
    const rows = await waitFor(
      () =>
        s.sql<
          { n: number }[]
        >`select count(*)::int as n from hub.usage_logs where run_id = ${runId}`,
      (r) => (r[0]?.n ?? 0) >= 1,
      10_000,
    );
    expect(rows[0]?.n ?? 0).toBeGreaterThanOrEqual(1);
  }, 90_000);
});
