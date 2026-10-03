// CHAT-AC-28, CHAT-AC-31 · E13 phát lại / nối lại theo Last-Event-ID (plan C1 §2.4 E13, §2.5, §3.3 drop;
// spec §9 M4, M8; test-plan §4 resume).

import { describe, expect, it } from "bun:test";
import {
  CHAT_SCN_PREFIX,
  type ChatEvent,
  ConversationSchema,
  LAST_EVENT_ID_HEADER,
  LAST_EVENT_ID_QUERY,
} from "@ai/contracts/chat";
import {
  call,
  expectChatError,
  expectInvariants,
  expectStatus,
  isTerminal,
  joinDeltas,
  lazySession,
  login,
  newConv,
  okJson,
  readStream,
  send,
  sendOpen,
  terminal,
  titles,
  UNKNOWN_UUID,
} from "./_client";
import { inProcess, isMock, startInProcessMock, USERS } from "./_env";

const lan = lazySession(USERS.a);
const title = titles();

/** Run đã xong (mọi Hub): trả run id + mọi sự kiện của stream gốc. */
async function finishedRun(token: string): Promise<{ runId: string; events: ChatEvent[] }> {
  const conv = await newConv(token, title("Phát lại"));
  const r = await send(token, conv.id, "Câu để phát lại");
  expect(r.events.length).toBeGreaterThan(3);
  return { runId: r.runId, events: r.events };
}

async function replay(
  token: string,
  runId: string,
  opts: { header?: string; query?: string } = {},
) {
  const q = opts.query === undefined ? "" : `?${LAST_EVENT_ID_QUERY}=${opts.query}`;
  const headers: Record<string, string> =
    opts.header === undefined ? {} : { [LAST_EVENT_ID_HEADER]: opts.header };
  const res = await call("GET", `/runs/${runId}/events${q}`, { token, headers });
  await expectStatus(res, 200, `GET /runs/:id/events${q} ${JSON.stringify(headers)}`);
  expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");
  return readStream(res);
}

describe("resume · phát lại run đã xong (mọi Hub)", () => {
  it("CHAT-AC-28 · Last-Event-ID: 2 → đúng id 3…n, không lặp, kết thúc rồi đóng [K-R1]", async () => {
    const { access } = await lan();
    const { runId, events } = await finishedRun(access);
    const got = await replay(access, runId, { header: "2" });
    expect(got).toEqual(events.slice(2));
    expectInvariants(got, false);
  });

  it("CHAT-AC-28 · query last_event_id=2 = header; header 3 + query 1 → bắt đầu từ 4 (header thắng) [K-R2]", async () => {
    const { access } = await lan();
    const { runId, events } = await finishedRun(access);
    expect(await replay(access, runId, { query: "2" })).toEqual(events.slice(2));
    expect(await replay(access, runId, { header: "3", query: "1" })).toEqual(events.slice(3));
  });

  it("CHAT-AC-28 · không header · Last-Event-ID: 0 → phát lại đủ 1…n giống stream gốc [K-R3]", async () => {
    const { access } = await lan();
    const { runId, events } = await finishedRun(access);
    expect(await replay(access, runId)).toEqual(events);
    expect(await replay(access, runId, { header: "0" })).toEqual(events);
  });

  it("CHAT-AC-31 · Last-Event-ID sai định dạng 'abc' → 200, phát lại từ id 1 (spec §9 M8) [K-R7]", async () => {
    const { access } = await lan();
    const { runId, events } = await finishedRun(access);
    expect(await replay(access, runId, { header: "abc" })).toEqual(events);
  });

  it("CHAT-AC-31 · E13 / E14 uuid lạ → 404 NOT_FOUND [K-R5]", async () => {
    const { access } = await lan();
    const e13 = await call("GET", `/runs/${UNKNOWN_UUID}/events`, { token: access });
    await expectChatError(e13, "NOT_FOUND", "E13 uuid lạ");
    await expectChatError(
      await call("GET", `/runs/${UNKNOWN_UUID}`, { token: access }),
      "NOT_FOUND",
      "E14 uuid lạ",
    );
  });
});

describe.if(isMock)("resume · rớt kết nối (chỉ mock)", () => {
  it("CHAT-AC-28 · #scn:drop: E12 đóng sau delta thứ 5 không kết thúc; E13 từ id 6 nối đủ, không trùng [K-R4]", async () => {
    const { access } = await lan();
    const conv = await newConv(access, title("Rớt mạng"));
    const { res, stream } = await sendOpen(access, conv.id, `${CHAT_SCN_PREFIX}drop Câu rớt`);
    const first = await stream.rest();
    expect(first.filter((e) => e.event === "delta").length).toBe(5);
    expect(first.at(-1)?.id).toBe(6);
    expect(first.some(isTerminal)).toBe(false);
    const runId = res.headers.get("X-Run-Id") ?? "";
    const rest = await replay(access, runId, { header: "6" });
    expect(rest[0]?.id).toBe(7);
    const all = [...first, ...rest];
    expectInvariants(all);
    const end = terminal(all);
    expect(joinDeltas(all)).toBe(
      end?.event === "run.finished" ? end.data.content : "<không có run.finished>",
    );
    const run = await call("GET", `/runs/${runId}`, { token: access });
    expect(((await run.json()) as { status?: string }).status).toBe("finished");
  });
});

// Cần mock với `eventsRetentionS=1` (spec §9 M4) → chỉ khi bộ test tự dựng mock.
describe.if(inProcess)("resume · hết hạn giữ sự kiện (mock trong tiến trình)", () => {
  it("CHAT-AC-31 · eventsRetentionS=1: ngay sau khi xong E13 200; quá hạn → 410 EVENTS_EXPIRED [K-R6]", async () => {
    const mock = startInProcessMock({ MOCK_EVENTS_RETENTION_S: "1" });
    try {
      const base = mock.url;
      const s = await login(USERS.a, base);
      const token = s.access;
      const created = await call("POST", "/conversations", {
        token,
        base,
        body: { title: title("Hết hạn") },
      });
      const conv = await okJson(created, 201, ConversationSchema, "E6 (mock retention=1)");
      const sent = await call("POST", `/conversations/${conv.id}/messages`, {
        token,
        base,
        body: { content: "Câu" },
      });
      await expectStatus(sent, 200, "E12 (mock retention=1)");
      await readStream(sent);
      const finishedAt = Date.now();
      const runId = sent.headers.get("X-Run-Id") ?? "";
      const fresh = await call("GET", `/runs/${runId}/events`, { token, base });
      await expectStatus(fresh, 200, "E13 ngay sau khi xong");
      await fresh.body?.cancel();
      let status = 200;
      while (status === 200 && Date.now() - finishedAt < 5000) {
        await Bun.sleep(100); // nhịp thăm dò, không phải chờ cố định: dừng ngay khi có 410
        const res = await call("GET", `/runs/${runId}/events`, { token, base });
        status = res.status;
        if (status === 410) await expectChatError(res, "EVENTS_EXPIRED", "E13 quá hạn");
        else await res.body?.cancel();
      }
      expect(status).toBe(410);
      expect(Date.now() - finishedAt).toBeGreaterThanOrEqual(1000);
    } finally {
      mock.stop();
    }
  });
});
