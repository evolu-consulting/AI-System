// CHAT-AC-19, CHAT-AC-21, CHAT-AC-22 · E5/E8/E9: query, body, 204.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { setAuthHooks } from "~/lib/http";
import { deleteConversation, listConversations, renameConversation } from "./api";

type Call = { path: string; method: string; body?: string };
const realFetch = globalThis.fetch;
let calls: Call[] = [];
let reply: () => Response;

beforeEach(() => {
  calls = [];
  setAuthHooks({ getToken: () => "t", refresh: async () => "t" });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      path: String(input),
      method: init?.method ?? "GET",
      body: init?.body as string | undefined,
    });
    return reply();
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  setAuthHooks(null);
});

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });

describe("conversations api", () => {
  test("list: q rỗng/khoảng trắng và cursor trống không vào query", async () => {
    reply = () => json({ items: [], next_cursor: null });
    await listConversations("  ", undefined);
    expect(calls[0]?.path).toBe("/conversations");
  });
  test("list: có q và cursor", async () => {
    reply = () => json({ items: [], next_cursor: null });
    await listConversations(" hợp đồng ", "abc");
    expect(calls[0]?.path).toBe("/conversations?q=h%E1%BB%A3p+%C4%91%E1%BB%93ng&cursor=abc");
  });
  test("rename: PATCH title", async () => {
    reply = () => json({ id: "1", title: "Mới" });
    await renameConversation("1", "Mới");
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.path).toBe("/conversations/1");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ title: "Mới" });
  });
  test("delete: DELETE, 204 → undefined", async () => {
    reply = () => new Response(null, { status: 204 });
    await expect(deleteConversation("1")).resolves.toBeUndefined();
    expect(calls[0]?.method).toBe("DELETE");
  });
});
