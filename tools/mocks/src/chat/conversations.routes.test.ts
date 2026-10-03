// C1-R09 · cách ly E7–E11 ở mức route (bộ contract isolation cần E12 → B4).
import { describe, expect, test } from "bun:test";
import { ChatPageSchema, ConversationSchema, FlowSchema, MessageSchema } from "@ai/contracts/chat";
import { createChatMock } from "./index";

const app = createChatMock({ fast: true, flowIdleS: 600, eventsRetentionS: 600 });

async function token(tenant_key: string, username: string): Promise<string> {
  const body = JSON.stringify({ tenant_key, username, password: "dev-password-1" });
  const res = await app.request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  return ((await res.json()) as { access_token: string }).access_token;
}

const req = (tok: string, method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { Authorization: `Bearer ${tok}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function minhSeed(tok: string) {
  const list = ChatPageSchema(ConversationSchema).parse(
    await (await req(tok, "GET", "/conversations?limit=200")).json(),
  );
  const conv = list.items[0];
  if (!conv) throw new Error("thiếu seed");
  const flows = ChatPageSchema(FlowSchema).parse(
    await (await req(tok, "GET", `/conversations/${conv.id}/flows`)).json(),
  );
  return { conv, flowId: flows.items[0]?.id ?? "" };
}

describe("C1-R09 · route E5–E11 cách ly", () => {
  test("hoa (cùng tenant) và an (khác tenant): mọi E7–E11 trên id của minh → 404, không lộ tiêu đề", async () => {
    const { conv, flowId } = await minhSeed(await token("acme", "minh"));
    const c = `/conversations/${conv.id}`;
    for (const tok of [await token("acme", "hoa"), await token("beta", "an")]) {
      const calls: [string, string, unknown?][] = [
        ["GET", c],
        ["PATCH", c, { title: "Đổi trộm" }],
        ["PATCH", c, { la: 1 }],
        ["DELETE", c],
        ["GET", `${c}/flows`],
        ["GET", `${c}/messages?flow_id=${flowId}`],
        ["GET", `${c}/messages?limit=0`],
      ];
      for (const [m, p, b] of calls) {
        const res = await req(tok, m, p, b);
        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain(conv.title);
      }
      const list = await (await req(tok, "GET", "/conversations?limit=200")).json();
      expect(list).toEqual({ items: [], next_cursor: null });
    }
    const minh = await token("acme", "minh");
    expect((await req(minh, "GET", c)).status).toBe(200);
  });
});

describe("CHAT-AC-20 · route E11", () => {
  test("E11: flow_id của hội thoại khác → 404; phân trang tin mới nhất trước, items tăng dần", async () => {
    const tok = await token("acme", "minh");
    const { conv, flowId } = await minhSeed(tok);
    const res = await req(tok, "GET", `/conversations/${conv.id}/flows`);
    const f2 = ChatPageSchema(FlowSchema).parse(await res.json()).items[1];
    const MsgPage = ChatPageSchema(MessageSchema);
    const p1 = MsgPage.parse(
      await (await req(tok, "GET", `/conversations/${conv.id}/messages?limit=4`)).json(),
    );
    expect(p1.items.map((m) => m.flow_id)).toEqual(Array(4).fill(f2?.id));
    const cur = encodeURIComponent(p1.next_cursor ?? "");
    const p2 = MsgPage.parse(
      await (
        await req(tok, "GET", `/conversations/${conv.id}/messages?limit=4&cursor=${cur}`)
      ).json(),
    );
    expect(p2.items.map((m) => [m.flow_id, m.role])).toEqual([
      [flowId, "user"],
      [flowId, "assistant"],
    ]);
    expect(p2.next_cursor).toBeNull();
    const list = await (await req(tok, "GET", "/conversations?limit=200")).json();
    const items = ChatPageSchema(ConversationSchema).parse(list).items;
    const foreign = `/conversations/${items[1]?.id}/messages?flow_id=${flowId}`;
    expect((await req(tok, "GET", foreign)).status).toBe(404);
  });
});
