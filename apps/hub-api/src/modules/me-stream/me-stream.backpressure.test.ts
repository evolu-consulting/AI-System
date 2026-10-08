// HUB-FR-99 · unit `/me/stream` backpressure (review X2a RV1 #12): hàng đợi phiên vượt `bufferBytes` ⇒ đóng phiên (phần đã
// xếp vẫn giao, client nối lại bằng `Last-Event-ID`); dưới trần ⇒ phiên mở bình thường.
import { describe, expect, test } from "bun:test";
import type { Logger } from "../../lib/logger";
import { MeStreamConns, meEventStream } from "./me-stream.session";
import type { UserEntry, UserStreamReader } from "./user-stream-reader";

const ROOM = "a2a00000-0000-4000-8000-000000000001";
const USER = "a2a00000-0000-4000-8000-000000000002";
const entry = (n: number): UserEntry => ({
  id: `${n}-0`,
  ev: { event: "room.read", data: { room_id: ROOM, user_id: USER, seq: n } },
});

function setup(n: number, bufferBytes: number) {
  const warns: string[] = [];
  const log = { warn: (m: string) => warns.push(m) } as unknown as Logger;
  const reader = {
    range: async () => Array.from({ length: n }, (_, i) => entry(i + 1)),
    subscribe: () => () => {},
  } as unknown as UserStreamReader;
  const ac = new AbortController();
  const stream = meEventStream(
    { reader, conns: new MeStreamConns(), log, pingMs: 60_000, signal: ac.signal, bufferBytes },
    {
      user: { userId: USER, tenantId: ROOM, role: "member" },
      plan: { reset: false, replay: true, from: "0-0" },
      usable: async () => true,
    },
  );
  return { stream, warns, ac };
}

/** Đọc tới khi stream đóng hoặc hết `ms`; trả số frame `id:` đã nhận + đã đóng hay chưa. */
async function drain(s: ReadableStream<Uint8Array>, ms = 200) {
  const r = s.getReader();
  const dec = new TextDecoder();
  let text = "";
  let done = false;
  const timer = new Promise<"t">((res) => setTimeout(() => res("t"), ms));
  for (;;) {
    const x = await Promise.race([r.read(), timer]);
    if (x === "t") break;
    if (x.done) {
      done = true;
      break;
    }
    text += dec.decode(x.value);
  }
  if (!done) await r.cancel();
  return { frames: text.match(/^id: /gm)?.length ?? 0, done };
}

describe("HUB-FR-99 · backpressure /me/stream", () => {
  test("HUB-FR-99 · replay vượt trần byte ⇒ đóng phiên, chỉ giao phần đã xếp, log cảnh báo", async () => {
    const { stream, warns } = setup(500, 2_000);
    const out = await drain(stream);
    expect(out.done).toBe(true);
    expect(out.frames).toBeGreaterThan(0);
    expect(out.frames).toBeLessThan(500);
    expect(warns).toContain("me-stream-slow-client");
  });

  test("HUB-FR-99 · dưới trần ⇒ phiên vẫn mở, giao đủ", async () => {
    const { stream, warns, ac } = setup(5, 1_048_576);
    const out = await drain(stream, 100);
    ac.abort();
    expect(out.done).toBe(false);
    expect(warns).toEqual([]);
  });
});
