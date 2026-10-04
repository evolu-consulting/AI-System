import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { scenarioOf, startDifyMock } from "./dify-mock";

const m = startDifyMock({ allowBlocking: true });
afterAll(() => m.close());
beforeEach(() => m.reset());

type Rec = { requests: { auth: string; body: { user: string } }[] };
const post = (path: string, key: string, body: object) =>
  fetch(`${m.url}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const stream = { response_mode: "streaming", user: "u1", inputs: { a: 1 } };
async function events(r: Response): Promise<string[]> {
  const t = await r.text();
  return [...t.matchAll(/^event: (\w+)$/gm)].map((x) => x[1] as string);
}

describe("dify-mock", () => {
  test("scenarioOf", () => {
    expect(scenarioOf("LEAK_KEY_abc").kind).toBe("ok");
    expect(scenarioOf("mk-slow-50")).toEqual({ kind: "slow", ms: 50 });
    expect(scenarioOf("mk-503x2")).toEqual({ kind: "flaky", times: 2 });
  });

  test("workflow ok streaming và ghi request", async () => {
    const ev = await events(await post("/v1/workflows/run", "mk-ok", stream));
    expect(ev.filter((e) => e === "text_chunk")).toHaveLength(5);
    expect(ev.at(-1)).toBe("workflow_finished");
    const rec = (await (await fetch(`${m.url}/__mock/requests`)).json()) as Rec;
    expect(rec.requests[0]?.auth).toBe("Bearer mk-ok");
    expect(rec.requests[0]?.body.user).toBe("u1");
    expect(m.calls()[0]?.path).toBe("/v1/workflows/run");
  });

  test("blocking, và từ chối khi tắt allowBlocking", async () => {
    const r = await post("/v1/workflows/run", "mk-ok", { response_mode: "blocking", user: "u" });
    expect(((await r.json()) as { data: { status: string } }).data.status).toBe("succeeded");
    const strict = startDifyMock();
    const r2 = await fetch(`${strict.url}/v1/workflows/run`, {
      method: "POST",
      body: JSON.stringify({ response_mode: "blocking" }),
    });
    expect(r2.status).toBe(400);
    await strict.close();
  });
});

describe("dify-mock kịch bản", () => {
  test("failed, error-event, outputs, agent, usage", async () => {
    const f = await (await post("/v1/workflows/run", "mk-failed", stream)).text();
    expect(f).toContain('"status":"failed"');
    const err = await events(await post("/v1/workflows/run", "mk-error-event", stream));
    expect(err).toContain("error");
    const out = await events(await post("/v1/workflows/run", "mk-outputs", stream));
    expect(out).not.toContain("text_chunk");
    const a = await events(await post("/v1/chat-messages", "mk-agent", stream));
    expect(a).toContain("agent_thought");
    expect(a).toContain("agent_message");
    const u = await (await post("/v1/chat-messages", "mk-ok", stream)).text();
    expect(u).toContain("total_tokens");
  });

  test("http lỗi và 503x2 đếm theo key", async () => {
    expect((await post("/v1/workflows/run", "mk-401", stream)).status).toBe(401);
    expect((await post("/v1/workflows/run", "mk-404", stream)).status).toBe(404);
    const s: number[] = [];
    for (let i = 0; i < 3; i++)
      s.push((await post("/v1/workflows/run", "mk-503x2", stream)).status);
    expect(s).toEqual([503, 503, 200]);
  });

  test("slow: stop kết thúc stream với stopped", async () => {
    const r = await post("/v1/workflows/run", "mk-slow-80", stream);
    const text = r.text();
    await new Promise((x) => setTimeout(x, 100));
    const st = await post("/v1/workflows/tasks/task-1/stop", "mk-slow-80", { user: "u1" });
    expect(((await st.json()) as { result: string }).result).toBe("success");
    const t = await text;
    expect(t).toContain('"status":"stopped"');
    expect((t.match(/text_chunk/g) ?? []).length).toBeLessThan(5);
  });

  test("parameters", async () => {
    const r = await fetch(`${m.url}/v1/parameters`, { headers: { authorization: "Bearer mk-ok" } });
    expect(r.status).toBe(200);
  });
});
