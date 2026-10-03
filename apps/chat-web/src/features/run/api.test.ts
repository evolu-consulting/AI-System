// review C1 #3 · E12 trả 200 nhưng thiếu header id → đóng stream (nhả kết nối) rồi mới ném `ApiError`.
import { afterEach, expect, test } from "bun:test";
import { FLOW_ID_HEADER, MESSAGE_ID_HEADER, RUN_ID_HEADER } from "@ai/contracts/chat";
import { ApiError, setAuthHooks } from "~/lib/http";
import { sendMessage } from "./api";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setAuthHooks(null);
});

function sseResponse(headers: Record<string, string>) {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  globalThis.fetch = (async () =>
    new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream", ...headers },
    })) as unknown as typeof fetch;
  return { isCancelled: () => cancelled };
}

test("200 thiếu X-Run-Id → body bị cancel, ném HTTP_ERROR", async () => {
  setAuthHooks({ getToken: () => "t", refresh: async () => null });
  const res = sseResponse({ [FLOW_ID_HEADER]: "f", [MESSAGE_ID_HEADER]: "m" });
  const err = await sendMessage("c", { content: "hi" }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect((err as ApiError).code).toBe("HTTP_ERROR");
  expect(res.isCancelled()).toBe(true);
});

test("đủ header → trả id + body, không cancel", async () => {
  setAuthHooks({ getToken: () => "t", refresh: async () => null });
  const res = sseResponse({
    [RUN_ID_HEADER]: "r",
    [FLOW_ID_HEADER]: "f",
    [MESSAGE_ID_HEADER]: "m",
  });
  const out = await sendMessage("c", { content: "hi" });
  expect([out.runId, out.flowId, out.messageId]).toEqual(["r", "f", "m"]);
  expect(res.isCancelled()).toBe(false);
});
