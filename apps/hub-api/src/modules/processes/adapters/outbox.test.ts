// HUB-FR-143 · CA-R07 · plan-addendum A7 Q4: bộ phát outbox — `user_events` gộp MỘT pipeline Redis; kick/post_thread qua
// launcher/ThreadPoster; lỗi một sự kiện chỉ log, không chặn sự kiện sau.
import { describe, expect, it } from "bun:test";
import type { UserEvent } from "../../../lib/user-stream";
import { makeOutboxPublisher } from "./outbox";

function fakes(kickFails = false) {
  const calls: string[] = [];
  let pipelines = 0;
  const warns: string[] = [];
  const pipe = {
    xadd: () => pipe,
    expire: () => pipe,
    exec: async () => [],
  };
  const publish = makeOutboxPublisher({
    redis: {
      pipeline: (() => {
        pipelines += 1;
        return pipe;
      }) as never,
    },
    log: { warn: (m: string) => void warns.push(m) },
    launcher: {
      kick: async (id) => {
        calls.push(`kick:${id}`);
        if (kickFails) throw new Error("x");
      },
    },
    postThread: async (id) => {
      calls.push(`post:${id}`);
      return 0;
    },
  });
  return { publish, calls, warns, pipelines: () => pipelines };
}
const ue = (u: string): UserEvent =>
  ({ userIds: [u], event: "process.notice", data: {} }) as unknown as UserEvent;

describe("makeOutboxPublisher", () => {
  it("HUB-FR-143 · nhiều user_events ⇒ 1 pipeline; kick + post_thread theo thứ tự", async () => {
    const f = fakes();
    await f.publish([
      { kind: "user_events", events: [ue("a")] },
      { kind: "kick", runId: "r1" },
      { kind: "user_events", events: [ue("b"), ue("c")] },
      { kind: "post_thread", runId: "r1" },
    ]);
    expect({ pipelines: f.pipelines(), calls: f.calls, warns: f.warns }).toEqual({
      pipelines: 1,
      calls: ["kick:r1", "post:r1"],
      warns: [],
    });
  });
  it("HUB-FR-143 · kick ném ⇒ log, post_thread vẫn chạy; không user_events ⇒ không gọi Redis", async () => {
    const f = fakes(true);
    await f.publish([
      { kind: "kick", runId: "r1" },
      { kind: "post_thread", runId: "r2" },
    ]);
    expect({ pipelines: f.pipelines(), calls: f.calls, warns: f.warns }).toEqual({
      pipelines: 0,
      calls: ["kick:r1", "post:r2"],
      warns: ["process-outbox-publish-failed"],
    });
  });
});
