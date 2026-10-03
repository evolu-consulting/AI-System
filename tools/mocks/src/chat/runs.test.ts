import { describe, expect, test } from "bun:test";
import { ChatEventSchema, MessageSchema, RunSchema } from "@ai/contracts/chat";
import { RunEngine } from "./runs";
import type { ScenarioName } from "./scenarios";
import { ChatStore } from "./store";

const A = { userId: "00000000-0000-4000-8000-0000000c1a02", tenantId: "t-acme" };
const B = { ...A, userId: "00000000-0000-4000-8000-0000000c1a03" };

function setup(scenario: ScenarioName) {
  const store = new ChatStore();
  const engine = new RunEngine({ store, fast: true, sleep: () => Promise.resolve() });
  const conv = store.createConversation(A, "X");
  const { flow } = store.startFlow(conv, "Câu");
  const run = engine.start({ owner: A, flow, scenario });
  return { store, engine, conv, flow, run };
}
const settle = async (engine: RunEngine, id: string) => {
  for (let i = 0; i < 500 && engine.get(A, id)?.status === "running"; i += 1) await Bun.sleep(0);
};

describe("RunEngine · chạy kịch bản", () => {
  test("normal: id liên tiếp từ 1, strict, tin assistant = nối delta, gỡ active_run_id", async () => {
    const { store, engine, conv, flow, run } = setup("normal");
    expect(flow.activeRunId).toBe(run.id);
    await settle(engine, run.id);
    expect(run.events.map((e) => e.id)).toEqual(run.events.map((_, i) => i + 1));
    for (const e of run.events) ChatEventSchema.parse(e);
    const end = run.events.at(-1);
    const asst = store.messagesOf(conv.id, flow.id).at(-1)?.message;
    expect(MessageSchema.parse(asst).id).toBe(
      end?.event === "run.finished" ? end.data.message_id : "",
    );
    expect(asst?.content).toBe(run.content);
    expect(flow.activeRunId).toBeNull();
    expect(RunSchema.parse(engine.toRun(run)).last_event_id).toBe(run.events.length);
  });

  test("err-timeout: run.failed, tóm tắt failed + bước failed có label", async () => {
    const { store, engine, conv, run } = setup("err-timeout");
    await settle(engine, run.id);
    expect(run.events.at(-1)?.event).toBe("run.failed");
    const asst = store.messagesOf(conv.id).at(-1)?.message;
    expect(asst?.run?.error?.code).toBe("TIMEOUT");
    expect(asst?.run?.steps).toEqual([
      { step_id: "s1", label: "Đang xử lý yêu cầu", status: "failed", ms: 1500 },
    ]);
  });
});

describe("RunEngine · huỷ, sở hữu, listener", () => {
  test("cancel đồng bộ: run.failed CANCELLED, idempotent, không phát thêm", async () => {
    const { engine, flow, run } = setup("slow");
    const seen: string[] = [];
    engine.subscribe(run, (e) => seen.push(e.event));
    engine.cancel(run.id);
    engine.cancel(run.id);
    await Bun.sleep(5);
    expect(run.status).toBe("cancelled");
    expect(seen.filter((e) => e === "run.failed").length).toBe(1);
    expect(run.events.at(-1)?.event).toBe("run.failed");
    expect(flow.activeRunId).toBeNull();
    expect(run.listeners.size).toBe(0);
  });

  test("get: chủ khác → null; hội thoại bị xoá → null", () => {
    const { store, engine, conv, run } = setup("slow");
    expect(engine.get(A, run.id)?.id).toBe(run.id);
    expect(engine.get(B, run.id)).toBeNull();
    for (const id of store.deleteConversation(conv)) engine.cancel(id);
    expect(engine.get(A, run.id)).toBeNull();
    expect(run.status).toBe("cancelled");
  });
});

describe("RunEngine · bộ nhớ (plan §5)", () => {
  const engineWith = (o: { retentionS?: number; maxRuns?: number; maxEvents?: number }) => {
    const store = new ChatStore();
    const engine = new RunEngine({ store, fast: true, sleep: () => Promise.resolve(), ...o });
    const conv = store.createConversation(A, "X");
    const run = () =>
      engine.start({ owner: A, flow: store.startFlow(conv, "Câu").flow, scenario: "normal" });
    return { engine, run };
  };

  test("quá maxEvents → run.failed INTERNAL_ERROR, không vượt giới hạn", async () => {
    const { engine, run } = engineWith({ maxEvents: 4 });
    const r = run();
    await settle(engine, r.id);
    expect(r.events.length).toBe(4);
    const end = r.events.at(-1);
    expect(end?.event === "run.failed" ? end.data.code : "").toBe("INTERNAL_ERROR");
    expect(RunSchema.parse(engine.toRun(r)).status).toBe("failed");
  });

  test("quá maxRuns → bỏ run đã xong cũ nhất, giữ run mới", async () => {
    const { engine, run } = engineWith({ maxRuns: 3 });
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const r = run();
      ids.push(r.id);
      await settle(engine, r.id);
    }
    expect(engine.size).toBe(3);
    expect(engine.get(A, ids[0] ?? "")).toBeNull();
    expect(engine.get(A, ids[4] ?? "")?.id).toBe(ids[4]);
  });

  test("hết hạn giữ: expired = true, lần dọn kế nhả sự kiện, last_event_id giữ nguyên", async () => {
    const { engine, run } = engineWith({ retentionS: 0 });
    const r = run();
    expect(engine.expired(r)).toBe(false);
    await settle(engine, r.id);
    const last = r.events.length;
    await Bun.sleep(5);
    expect(engine.expired(r)).toBe(true);
    run();
    expect(r.events).toEqual([]);
    expect(engine.toRun(r).last_event_id).toBe(last);
  });
});
