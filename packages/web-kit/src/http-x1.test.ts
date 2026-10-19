// HUB-FR-44/94 · http X1: `rawBody` (upload thân thô) và `ApiError.retryAfter` (429).
import { afterEach, describe, expect, test } from "bun:test";
import { TOO_MANY_RUNS_RETRY_AFTER_S } from "@ai/contracts/chat";
import { type ApiError, api, setAuthHooks } from "./http";

const realFetch = globalThis.fetch;
let seen: RequestInit | undefined;
const stub = (res: Response) => {
  globalThis.fetch = (async (_u: RequestInfo | URL, init?: RequestInit) => {
    seen = init;
    return res;
  }) as typeof fetch;
};
afterEach(() => {
  globalThis.fetch = realFetch;
  setAuthHooks(null);
  seen = undefined;
});

describe("rawBody", () => {
  test("gửi nguyên Blob, không JSON.stringify, không ép Content-Type JSON; header riêng giữ", async () => {
    stub(new Response("{}", { status: 200 }));
    const blob = new Blob(["abc"], { type: "text/plain" });
    await api("/attachments", {
      method: "POST",
      rawBody: blob,
      headers: { "X-Filename": "a.txt" },
    });
    expect(seen?.body).toBe(blob);
    const h = seen?.headers as Record<string, string>;
    expect(h["Content-Type"]).toBeUndefined();
    expect(h["X-Filename"]).toBe("a.txt");
  });
});

describe("retryAfter", () => {
  const err429 = (headers: Record<string, string>) =>
    new Response(JSON.stringify({ error: { code: "TOO_MANY_RUNS", message: "x" } }), {
      status: 429,
      headers,
    });
  const catchErr = async () => (await api("/x").catch((e: unknown) => e)) as ApiError;

  test("đọc Retry-After (giây)", async () => {
    stub(err429({ "Retry-After": "7" }));
    const e = await catchErr();
    expect(e.code).toBe("TOO_MANY_RUNS");
    expect(e.retryAfter).toBe(7);
  });
  test("sai định dạng / vắng → mặc định hợp đồng", async () => {
    stub(err429({ "Retry-After": "soon" }));
    expect((await catchErr()).retryAfter).toBe(TOO_MANY_RUNS_RETRY_AFTER_S);
    stub(err429({}));
    expect((await catchErr()).retryAfter).toBe(TOO_MANY_RUNS_RETRY_AFTER_S);
  });
  test("không phải 429 → không có retryAfter", async () => {
    stub(new Response("{}", { status: 500, headers: { "Retry-After": "3" } }));
    expect((await catchErr()).retryAfter).toBeUndefined();
  });
});
