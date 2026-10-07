// HUB-FR-96 · HUB-FR-99 · HUB-FR-102 · X2a-AC11 · K02 (test-plan X2a §3, §9 G10 — lưới phụ, khoá thật ở
// `tests/acceptance/X2a/rules/contracts-x2a.test.ts` R33): mọi Hub (mock stub B3 / Hub thật) trả đúng hình contract X2a
// cho `GET /rooms`, `GET /directory`, `GET /me/stream` (SSE 200), không token ⇒ 401. Contract X2a nạp động (chưa có lúc viết).
import { describe, expect, it } from "bun:test";
import { call, lazySession } from "./_client";
import { HUB_URL, USERS } from "./_env";

const lan = lazySession(USERS.a);
// biome-ignore lint/suspicious/noExplicitAny: contract X2a nạp động
const chat = async (): Promise<Record<string, any>> => import("@ai/contracts/chat");

describe("K02 · X2a chỉ thêm, Hub trả đúng hình [X2a-AC11]", () => {
  it("HUB-FR-96 · K02a · GET /rooms (Bearer) ⇒ 200 khớp RoomListResponseSchema [X2a-AC11]", async () => {
    const c = await chat();
    const res = await call("GET", "/rooms", { token: (await lan()).access });
    expect(res.status).toBe(200);
    expect(typeof c.RoomListResponseSchema?.parse).toBe("function");
    c.RoomListResponseSchema.parse(await res.json());
  });

  it("HUB-FR-102 · K02b · GET /directory (Bearer) ⇒ 200 khớp DirectoryResponseSchema (strict 4 trường) [X2a-AC10]", async () => {
    const c = await chat();
    const res = await call("GET", "/directory", { token: (await lan()).access });
    expect(res.status).toBe(200);
    expect(typeof c.DirectoryResponseSchema?.parse).toBe("function");
    c.DirectoryResponseSchema.parse(await res.json());
  });

  it("HUB-FR-99 · K02c · GET /me/stream (Bearer) ⇒ 200 text/event-stream; không token ⇒ 401 [X2a-AC12]", async () => {
    const ac = new AbortController();
    const res = await fetch(`${HUB_URL}/me/stream`, {
      headers: { Authorization: `Bearer ${(await lan()).access}` },
      signal: ac.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");
    ac.abort();
    const anon = await call("GET", "/me/stream");
    expect(anon.status).toBe(401);
    await anon.body?.cancel();
  });
});
