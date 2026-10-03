import { describe, expect, test } from "bun:test";
import { RunEngine } from "./runs";
import type { ScenarioName } from "./scenarios";
import { runStream } from "./sse";
import { ChatStore } from "./store";

// plan §6 R9 · đóng stream (drop / client huỷ) phải gỡ listener; run chạy tiếp tới khi xong.
const A = { userId: "00000000-0000-4000-8000-0000000c1a02", tenantId: "t-acme" };

function setup(scenario: ScenarioName) {
  const store = new ChatStore();
  const engine = new RunEngine({ store, fast: true, sleep: () => Bun.sleep(1) });
  const conv = store.createConversation(A, "X");
  const run = engine.start({ owner: A, flow: store.startFlow(conv, "Câu").flow, scenario });
  return { engine, run };
}
const frames = (text: string) => text.split("\n\n").filter((f) => f.includes("event: "));

describe("runStream · gỡ listener", () => {
  test("dropAfterDeltas=5: đóng sau delta thứ 5, listener = 0, run vẫn xong", async () => {
    const { engine, run } = setup("drop");
    const body = runStream(engine, run, 0, { dropAfterDeltas: 5, heartbeatMs: 5 });
    const got = frames(await new Response(body).text());
    expect(got.filter((f) => f.includes("event: delta")).length).toBe(5);
    expect(got.some((f) => f.includes("event: run.finished"))).toBe(false);
    expect(run.listeners.size).toBe(0);
    for (let i = 0; i < 500 && run.status === "running"; i += 1) await Bun.sleep(1);
    expect(run.status).toBe("finished");
  });

  test("client huỷ giữa chừng: listener = 0, run chạy tiếp", async () => {
    const { engine, run } = setup("slow");
    const reader = runStream(engine, run, 0, { heartbeatMs: 5 }).getReader();
    await reader.read();
    await Bun.sleep(1);
    expect(run.listeners.size).toBe(1);
    await reader.cancel();
    expect(run.listeners.size).toBe(0);
    expect(run.status).toBe("running");
    engine.cancel(run.id);
  });

  test("run đã xong: phát lại phần còn lại rồi đóng, không đăng ký listener", async () => {
    const { engine, run } = setup("normal");
    for (let i = 0; i < 500 && run.status === "running"; i += 1) await Bun.sleep(1);
    const got = frames(await new Response(runStream(engine, run, 2)).text());
    expect(got.length).toBe(run.events.length - 2);
    expect(run.listeners.size).toBe(0);
  });
});
