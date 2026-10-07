// HUB-FR-99 · publishUserEvents: một pipeline, XADD MAXLEN ~ + EXPIRE mỗi người nhận; lỗi Redis chỉ log, không ném.
import { describe, expect, test } from "bun:test";
import { publishUserEvents, USER_STREAM_TTL_S, type UserEvent, userStreamKey } from "./user-stream";

const R = "a2a00000-0000-4000-8000-000000000f01";
const A = "a2a00000-0000-4000-8000-00000000000a";
const B = "a2a00000-0000-4000-8000-00000000000b";

function fakeRedis(fail = false) {
  const cmds: unknown[][] = [];
  let pipelines = 0;
  const p = {
    xadd(...a: unknown[]) {
      cmds.push(["xadd", ...a]);
      return p;
    },
    expire(...a: unknown[]) {
      cmds.push(["expire", ...a]);
      return p;
    },
    async exec() {
      if (fail) throw new Error("down");
      return cmds.map(() => [null, "ok"]);
    },
  };
  const pipeline = () => {
    pipelines++;
    // biome-ignore lint/suspicious/noExplicitAny: giả lập tối thiểu `Pipeline` của ioredis
    return p as any;
  };
  return { redis: { pipeline }, cmds, pipelines: () => pipelines };
}
const warns: unknown[] = [];
const log = { warn: (msg: string, f?: unknown) => void warns.push([msg, f]) };
const ev: UserEvent = { userIds: [A, B], event: "room.deleted", data: { room_id: R } };

describe("publishUserEvents", () => {
  test("mỗi người nhận: XADD ustream:<uid> MAXLEN ~ 1000 * e <json> + EXPIRE 7 ngày", async () => {
    const f = fakeRedis();
    await publishUserEvents(f.redis, [ev], log);
    expect(f.pipelines()).toBe(1);
    const body = JSON.stringify({ event: "room.deleted", data: { room_id: R } });
    expect(f.cmds).toEqual([
      ["xadd", userStreamKey(A), "MAXLEN", "~", 1000, "*", "e", body],
      ["expire", userStreamKey(A), USER_STREAM_TTL_S],
      ["xadd", userStreamKey(B), "MAXLEN", "~", 1000, "*", "e", body],
      ["expire", userStreamKey(B), USER_STREAM_TTL_S],
    ]);
  });

  test("không người nhận ⇒ không gọi Redis", async () => {
    const f = fakeRedis();
    await publishUserEvents(f.redis, [{ ...ev, userIds: [] }], log);
    expect(f.pipelines()).toBe(0);
  });

  test("Redis lỗi ⇒ log warn {room_id, n}, không ném, không nội dung", async () => {
    warns.length = 0;
    await publishUserEvents(fakeRedis(true).redis, [ev], log);
    expect(warns).toEqual([["ustream-publish-failed", { room_id: R, n: 1 }]]);
  });
});
