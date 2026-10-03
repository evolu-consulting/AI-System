// E12–E15 + `/__mock/scenario` ở mức route (bộ contract messages/stream/flow-cold phủ phần còn lại).
import { describe, expect, test } from "bun:test";
import {
  ConversationSchema,
  createSseParser,
  RUN_ID_HEADER,
  RunSchema,
  SSE_CONTENT_TYPE,
  toChatEvent,
} from "@ai/contracts/chat";
import { createChatMock } from "./index";

const app = createChatMock({ fast: true, flowIdleS: 600, eventsRetentionS: 600 });

async function token(username: string): Promise<string> {
  const body = JSON.stringify({ tenant_key: "acme", username, password: "dev-password-1" });
  const init = { method: "POST", headers: { "content-type": "application/json" }, body };
  return ((await (await app.request("/auth/login", init)).json()) as { access_token: string })
    .access_token;
}

const req = (tok: string, method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { Authorization: `Bearer ${tok}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function events(res: Response) {
  const out: string[] = [];
  createSseParser((raw) => out.push(toChatEvent(raw).event))(await res.text());
  return out;
}

async function newConv(tok: string) {
  return ConversationSchema.parse(
    await (await req(tok, "POST", "/conversations", { title: "T" })).json(),
  );
}

describe("E12 · gửi tin", () => {
  test("SSE: header contract, ping đầu, run.started … run.finished", async () => {
    const tok = await token("lan");
    const conv = await newConv(tok);
    const res = await req(tok, "POST", `/conversations/${conv.id}/messages`, { content: "Chào" });
    expect(res.headers.get("content-type")).toBe(SSE_CONTENT_TYPE);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const ev = await events(res);
    expect(ev[0]).toBe("run.started");
    expect(ev.at(-1)).toBe("run.finished");
  });

  test("404 hội thoại người khác trước 400 body; 409 FLOW_BUSY khi flow đang chạy", async () => {
    const [lan, hoa] = [await token("lan"), await token("hoa")];
    const conv = await newConv(lan);
    expect((await req(hoa, "POST", `/conversations/${conv.id}/messages`, {})).status).toBe(404);
    expect((await req(lan, "POST", `/conversations/${conv.id}/messages`, {})).status).toBe(400);
    const res = await req(lan, "POST", `/conversations/${conv.id}/messages`, {
      content: "#scn:slow",
    });
    const flowId = res.headers.get("X-Flow-Id");
    const busy = await req(lan, "POST", `/conversations/${conv.id}/messages`, {
      content: "x",
      flow_id: flowId,
    });
    expect(busy.status).toBe(409);
    const runId = res.headers.get(RUN_ID_HEADER) ?? "";
    expect((await req(hoa, "POST", `/runs/${runId}/cancel`)).status).toBe(404);
    const snap = RunSchema.parse(await (await req(lan, "POST", `/runs/${runId}/cancel`)).json());
    expect(snap.status).toBe("running");
    expect((await events(res)).at(-1)).toBe("run.failed");
  });
});

describe("E13 · E14 · /__mock/scenario", () => {
  test("E13 Last-Event-ID phát lại phần sau; E14 finished", async () => {
    const tok = await token("lan");
    const conv = await newConv(tok);
    const res = await req(tok, "POST", `/conversations/${conv.id}/messages`, {
      content: "#scn:ask",
    });
    const all = await events(res);
    const runId = res.headers.get(RUN_ID_HEADER) ?? "";
    const tail = await events(
      await app.request(`/runs/${runId}/events`, {
        headers: { Authorization: `Bearer ${tok}`, "Last-Event-ID": "1" },
      }),
    );
    expect(tail).toEqual(all.slice(1));
    const run = RunSchema.parse(await (await req(tok, "GET", `/runs/${runId}`)).json());
    expect(run.status).toBe("finished");
  });

  test("mặc định toàn cục: tên lạ 400; 'ask' áp cho tin không tiền tố; reset về normal", async () => {
    const post = (name: string | null) =>
      app.request("/__mock/scenario", { method: "POST", body: JSON.stringify({ name }) });
    expect((await post("la")).status).toBe(400);
    expect((await post("ask")).status).toBe(204);
    const tok = await token("lan");
    const conv = await newConv(tok);
    const res = await req(tok, "POST", `/conversations/${conv.id}/messages`, { content: "Hỏi" });
    expect(await events(res)).toContain("ask");
    expect((await post(null)).status).toBe(204);
  });
});
