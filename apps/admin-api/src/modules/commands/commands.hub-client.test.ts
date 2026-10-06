// ADM-FR-23 · client Hub `/internal/test-run`: header token, phân loại network/huỷ.
import { afterAll, describe, expect, it } from "bun:test";
import { callHubTestRun, hubWaitS } from "./commands.hub-client";

const TOKEN = "t".repeat(40);
let seen: { auth: string | null; path: string } | undefined;
const server = Bun.serve({
  port: 0,
  fetch(req) {
    seen = { auth: req.headers.get("authorization"), path: new URL(req.url).pathname };
    return Response.json({ ok: true });
  },
});
afterAll(() => server.stop(true));

const REQ = {
  command: {
    workflow_id: "01900000-0000-7000-8000-000000000001",
    args: [],
    input_map: {},
    output: { field: "text", render: "markdown" as const },
    timeout_s: 30,
  },
  text: "x",
  actor_user_id: "01900000-0000-7000-8000-000000000002",
};

describe("ADM-FR-23 · commands.hub-client", () => {
  it("hubWaitS = min(timeout_s, 300) + 35", () => {
    expect(hubWaitS(30)).toBe(65);
    expect(hubWaitS(900)).toBe(335);
  });

  it("gửi Bearer token tới /internal/test-run (bỏ '/' cuối URL), trả status + JSON", async () => {
    const r = await callHubTestRun(
      { url: `${server.url.origin}/`, token: TOKEN },
      REQ,
      new AbortController().signal,
    );
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(seen).toEqual({ auth: `Bearer ${TOKEN}`, path: "/internal/test-run" });
  });

  it("cổng đóng ⇒ network, không ném, không chứa token", async () => {
    const dead = Bun.serve({ port: 0, fetch: () => new Response("") });
    const url = dead.url.origin;
    dead.stop(true);
    const r = await callHubTestRun({ url, token: TOKEN }, REQ, new AbortController().signal);
    expect(r).toEqual({ status: "network", body: undefined });
  });

  it("client huỷ ⇒ ném lại (route không trả body)", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      callHubTestRun({ url: server.url.origin, token: TOKEN }, REQ, ac.signal),
    ).rejects.toThrow();
  });
});
