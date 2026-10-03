// CHAT-AC-10, CHAT-AC-11, CHAT-AC-31, UC-04 · E15 huỷ run (plan C1 §2.4 E15, §3.1 engine, §3.3 slow;
// test-plan §4 cancel).

import { describe, expect, it } from "bun:test";
import {
  CHAT_SCN_PREFIX,
  type ChatEvent,
  ChatPageSchema,
  LAST_EVENT_ID_HEADER,
  MessageSchema,
  RUN_ID_HEADER,
  RunSchema,
} from "@ai/contracts/chat";
import {
  call,
  expectChatError,
  expectStatus,
  joinDeltas,
  lazySession,
  newConv,
  okJson,
  readStream,
  send,
  sendOpen,
  titles,
  UNKNOWN_UUID,
} from "./_client";
import { isMock, USERS } from "./_env";

const lan = lazySession(USERS.a);
const title = titles();
const SLOW = `${CHAT_SCN_PREFIX}slow Viết báo cáo dài`;

async function cancel(token: string, runId: string) {
  return okJson(
    await call("POST", `/runs/${runId}/cancel`, { token }),
    200,
    RunSchema,
    "POST /runs/:id/cancel",
  );
}

/** K-X1: gửi `#scn:slow`, đọc ≥ 3 delta, huỷ; trả mọi sự kiện + thời gian từ E15 tới khi stream đóng. */
async function cancelledRun(token: string) {
  const conv = await newConv(token, title("Huỷ"));
  const { res, stream } = await sendOpen(token, conv.id, SLOW);
  const runId = res.headers.get(RUN_ID_HEADER) ?? "";
  const flowId = res.headers.get("X-Flow-Id") ?? "";
  let deltas = 0;
  while (deltas < 3) {
    const e = await stream.next();
    if (e === null) break;
    if (e.event === "delta") deltas += 1;
  }
  const t0 = performance.now();
  const snap = await cancel(token, runId);
  const events: ChatEvent[] = await stream.rest();
  return { convId: conv.id, runId, flowId, snap, events, closeMs: performance.now() - t0 };
}

describe.if(isMock)("cancel · huỷ giữa chừng (chỉ mock)", () => {
  it("CHAT-AC-10 · #scn:slow, ≥ 3 delta → E15 200; stream kết thúc run.failed CANCELLED ≤ 5 s; E11 giữ delta [K-X1]", async () => {
    const { access } = await lan();
    const r = await cancelledRun(access);
    expect(r.snap.id).toBe(r.runId);
    const end = r.events.at(-1);
    expect(end?.event).toBe("run.failed");
    expect(end?.event === "run.failed" ? end.data.code : null).toBe("CANCELLED");
    expect(r.closeMs).toBeLessThanOrEqual(5000);
    const res = await call("GET", `/conversations/${r.convId}/messages?flow_id=${r.flowId}`, {
      token: access,
    });
    const items = (await okJson(res, 200, ChatPageSchema(MessageSchema), "E11")).items;
    const asst = items.find((m) => m.role === "assistant");
    expect(asst?.content).toBe(joinDeltas(r.events));
    expect(joinDeltas(r.events).length).toBeGreaterThan(0);
    expect(asst?.run?.status).toBe("cancelled");
    expect(asst?.run?.error?.code).toBe("CANCELLED");
  });

  it("CHAT-AC-10 · E15 lần 2 → 200 status=cancelled; E13 từ id cuối không có sự kiện mới [K-X2]", async () => {
    const { access } = await lan();
    const r = await cancelledRun(access);
    const again = await cancel(access, r.runId);
    expect(again.status).toBe("cancelled");
    expect(again.error?.code).toBe("CANCELLED");
    const lastId = String(r.events.at(-1)?.id ?? 0);
    const res = await call("GET", `/runs/${r.runId}/events`, {
      token: access,
      headers: { [LAST_EVENT_ID_HEADER]: lastId },
    });
    await expectStatus(res, 200, "E13 từ id cuối");
    expect(await readStream(res)).toEqual([]);
  });

  it("CHAT-AC-11 · sau huỷ, gửi lại cùng content không flow_id → run_id, flow_id mới [K-X4]", async () => {
    const { access } = await lan();
    const r = await cancelledRun(access);
    const { res, stream } = await sendOpen(access, r.convId, SLOW);
    const runId = res.headers.get(RUN_ID_HEADER) ?? "";
    try {
      expect(runId).not.toBe(r.runId);
      expect(res.headers.get("X-Flow-Id")).not.toBe(r.flowId);
    } finally {
      await cancel(access, runId);
      await stream.rest();
    }
  });
});

describe("cancel · idempotent (mọi Hub)", () => {
  it("UC-04 · run đã xong → E15 200 status=finished; E13 phát lại không có CANCELLED [K-X3]", async () => {
    const { access } = await lan();
    const conv = await newConv(access, title("Huỷ muộn"));
    const r = await send(access, conv.id, "Câu xong rồi mới huỷ");
    const snap = await cancel(access, r.runId);
    expect(snap.status).toBe("finished");
    expect(snap.error).toBeNull();
    const res = await call("GET", `/runs/${r.runId}/events`, { token: access });
    await expectStatus(res, 200, "E13 sau huỷ muộn");
    const events = await readStream(res);
    expect(events.at(-1)?.event).toBe("run.finished");
    expect(events.some((e) => e.event === "run.failed")).toBe(false);
  });

  it("CHAT-AC-31 · E15 uuid lạ → 404 NOT_FOUND [K-X5]", async () => {
    const { access } = await lan();
    await expectChatError(
      await call("POST", `/runs/${UNKNOWN_UUID}/cancel`, { token: access }),
      "NOT_FOUND",
      "E15",
    );
  });
});
