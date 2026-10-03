// C1-R09, CHAT-AC-31 · cách ly theo user: id của user khác (cùng/khác tenant) → 404 NOT_FOUND, không lộ dữ liệu
// (plan C1 §2.4 "Mọi path có :id của user khác…"; test-plan §4 isolation). Mọi Hub; run đang chạy chỉ ở mock.

import { describe, expect, it } from "bun:test";
import {
  CHAT_SCN_PREFIX,
  ChatPageSchema,
  type Conversation,
  ConversationSchema,
  RUN_ID_HEADER,
  RunSchema,
} from "@ai/contracts/chat";
import {
  call,
  expectChatError,
  lazySession,
  newConv,
  okJson,
  type Session,
  type StreamReader,
  send,
  sendOpen,
  titles,
} from "./_client";
import { isMock, USERS } from "./_env";

const lan = lazySession(USERS.a);
const hoa = lazySession(USERS.b);
const an = lazySession(USERS.other_tenant);
const title = titles("Bí mật của Lan ");

type Owned = {
  conv: Conversation;
  flowId: string;
  runId: string;
  liveRunId: string | null;
  live: StreamReader | null;
};

let owned: Promise<Owned> | null = null;
/** K-I1: `lan` tạo hội thoại + 1 flow (run xong) + 1 run `#scn:slow` đang chạy (mock). Dựng lười, một lần. */
function fixture(): Promise<Owned> {
  owned ??= (async () => {
    const { access } = await lan();
    const conv = await newConv(access, title("Hợp đồng"));
    const r = await send(access, conv.id, "Câu riêng tư của Lan");
    if (!isMock) return { conv, flowId: r.flowId, runId: r.runId, liveRunId: null, live: null };
    const { res, stream } = await sendOpen(access, conv.id, `${CHAT_SCN_PREFIX}slow Đang chạy`);
    await stream.next();
    return {
      conv,
      flowId: r.flowId,
      runId: r.runId,
      liveRunId: res.headers.get(RUN_ID_HEADER),
      live: stream,
    };
  })();
  return owned;
}

async function expectAll404(s: Session, o: Owned): Promise<void> {
  const token = s.access;
  const c = `/conversations/${o.conv.id}`;
  const runs = [o.runId, ...(o.liveRunId ? [o.liveRunId] : [])];
  const calls: [string, string, unknown?][] = [
    ["GET", c],
    ["PATCH", c, { title: "Đổi trộm" }],
    ["DELETE", c],
    ["GET", `${c}/flows`],
    ["GET", `${c}/messages`],
    ["GET", `${c}/messages?flow_id=${o.flowId}`],
    ["POST", `${c}/messages`, { content: "Chen vào" }],
    ["POST", `${c}/messages`, { content: "Chen vào flow", flow_id: o.flowId }],
    ...runs.flatMap((id): [string, string][] => [
      ["GET", `/runs/${id}/events`],
      ["GET", `/runs/${id}`],
      ["POST", `/runs/${id}/cancel`],
    ]),
  ];
  for (const [method, path, body] of calls) {
    const res = await call(method, path, { token, body });
    const text = await expectChatError(
      res,
      "NOT_FOUND",
      `${s.grant.user.username} ${method} ${path}`,
    );
    expect(text).not.toContain(o.conv.title);
  }
}

describe("isolation · C1-R09", () => {
  it("C1-R09 · hoa (cùng tenant) gọi E7–E15 trên id của lan → 404 NOT_FOUND, không lộ tiêu đề [K-I1][K-I2]", async () => {
    const o = await fixture();
    await expectAll404(await hoa(), o);
  });

  it("C1-R09 · an (khác tenant) gọi E7–E15 trên id của lan → 404 NOT_FOUND, không lộ tiêu đề [K-I3]", async () => {
    const o = await fixture();
    await expectAll404(await an(), o);
  });

  it("C1-R09 · sau I2–I3: dữ liệu lan nguyên vẹn, run chưa bị huỷ; E5 của hoa/an không có id của lan [K-I4]", async () => {
    const o = await fixture();
    const { access } = await lan();
    try {
      const conv = await okJson(
        await call("GET", `/conversations/${o.conv.id}`, { token: access }),
        200,
        ConversationSchema,
        "lan E7",
      );
      expect(conv.title).toBe(o.conv.title);
      const runId = o.liveRunId ?? o.runId;
      const run = await okJson(
        await call("GET", `/runs/${runId}`, { token: access }),
        200,
        RunSchema,
        "lan E14",
      );
      expect(run.status).not.toBe("cancelled");
      for (const who of [hoa, an]) {
        const s = await who();
        for (const q of ["limit=200", `limit=200&q=${encodeURIComponent(o.conv.title)}`]) {
          const res = await call("GET", `/conversations?${q}`, { token: s.access });
          const page = await okJson(
            res,
            200,
            ChatPageSchema(ConversationSchema),
            `${s.grant.user.username} E5 ${q}`,
          );
          expect(page.items.map((i) => i.id)).not.toContain(o.conv.id);
        }
      }
    } finally {
      if (o.liveRunId) await call("POST", `/runs/${o.liveRunId}/cancel`, { token: access });
      await o.live?.rest();
    }
  });
});
