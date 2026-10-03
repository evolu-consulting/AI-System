// UC-02, UC-04, UC-08, C1-R06, CHAT-AC-06 · RunDriver với stream giả (encodeSseEvent): rAF gộp delta, nối lại
// Last-Event-ID + backoff, lost + Thử lại, 410, 409 FLOW_BUSY, Dừng không abort, gắn lại từ 0.
import { expect, test } from "bun:test";
import { type ChatEvent, encodeSseEvent, type Run } from "@ai/contracts/chat";
import { ApiError } from "~/lib/http";
import { readEvents } from "~/lib/sse";
import type { SendAccepted } from "./api";
import type { RunState } from "./lib/reducer";
import { RunDriver } from "./run-driver";
import { createRunStore } from "./run-store";

const RUN = "11111111-1111-4111-8111-111111111111";
const FLOW = "22222222-2222-4222-8222-222222222222";
const MSG = "33333333-3333-4333-8333-333333333333";
const enc = new TextEncoder();

const started: ChatEvent = {
  id: 1,
  event: "run.started",
  data: { run_id: RUN, flow_id: FLOW, quota: { state: "ok", pct: 1 } },
};
const delta = (id: number, text: string): ChatEvent => ({ id, event: "delta", data: { text } });
const finished = (id: number, content: string): ChatEvent => ({
  id,
  event: "run.finished",
  data: { run_id: RUN, message_id: MSG, content, ms: 10 },
});
const cancelled = (id: number): ChatEvent => ({
  id,
  event: "run.failed",
  data: { run_id: RUN, message_id: MSG, code: "CANCELLED", message: "Đã dừng", hint: "" },
});

type Ctl = {
  body: ReadableStream<Uint8Array>;
  push(...e: ChatEvent[]): void;
  close(): void;
  fail(): void;
  enqueueRaw(text: string): void;
};
function fakeStream(): Ctl {
  let c!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(x) {
      c = x;
    },
  });
  return {
    body,
    push: (...es) => {
      for (const e of es) c.enqueue(enc.encode(encodeSseEvent(e)));
    },
    close: () => c.close(),
    fail: () => c.error(new TypeError("network")),
    enqueueRaw: (text) => c.enqueue(enc.encode(text)),
  };
}

const flush = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

function setup(
  opts: {
    send?: (convId: string, req: unknown) => Promise<SendAccepted>;
    open?: (id: string, last: number) => Promise<ReadableStream<Uint8Array>>;
    getRun?: () => Promise<{ status: Run["status"] }>;
  } = {},
) {
  const store = createRunStore();
  const frames: (() => void)[] = [];
  const log = {
    sleeps: [] as number[],
    opens: [] as number[],
    cancels: [] as string[],
    settled: [] as RunState[],
    expired: [] as RunState[],
    dispatches: 0,
    getRuns: 0,
  };
  const first = fakeStream();
  store.subscribe(() => log.dispatches++);
  const driver = new RunDriver(store, {
    sendMessage:
      opts.send ?? (async () => ({ runId: RUN, flowId: FLOW, messageId: MSG, body: first.body })),
    openEvents: async (id, last) => {
      log.opens.push(last);
      if (!opts.open) throw new ApiError(0, "NETWORK_ERROR", "down");
      return opts.open(id, last);
    },
    cancelRun: async (id) => void log.cancels.push(id),
    getRun: async () => {
      log.getRuns++;
      if (!opts.getRun) throw new ApiError(0, "NETWORK_ERROR", "down");
      return opts.getRun();
    },
    readEvents,
    sleep: async (ms) => void log.sleeps.push(ms),
    requestFrame: (cb) => void frames.push(cb),
    onSettled: (r) => void log.settled.push(r),
    onExpired: (r) => void log.expired.push(r),
    newKey: () => "k1",
  });
  const runFrames = () => {
    for (const f of frames.splice(0)) f();
  };
  return { store, driver, first, log, runFrames };
}

test("CHAT-AC-06 · delta gộp 1 lần/khung hình; run.finished đẩy ngay + onSettled", async () => {
  const { store, driver, first, log, runFrames } = setup();
  const out = await driver.send({ convId: "c", origin: "main", request: { content: "hi" } });
  expect(out).toEqual({ ok: true, key: "k1" });
  first.push(started, ...Array.from({ length: 50 }, (_, i) => delta(i + 2, "x")));
  await flush();
  const before = log.dispatches;
  runFrames();
  expect(log.dispatches - before).toBe(1);
  expect(store.get("k1")?.text).toBe("x".repeat(50));
  first.push(finished(52, "kết quả"));
  first.close();
  await flush();
  expect(store.get("k1")?.phase).toBe("finished");
  expect(store.get("k1")?.text).toBe("kết quả");
  expect(log.settled.length).toBe(1);
  expect(log.opens).toEqual([]);
});

test("C1-R06 · đứt giữa chừng → Last-Event-ID = id cuối, sự kiện trùng bị bỏ", async () => {
  const second = fakeStream();
  const { store, driver, first, log, runFrames } = setup({ open: async () => second.body });
  await driver.send({ convId: "c", origin: "main", request: { content: "hi" } });
  first.push(started, delta(2, "Chào "));
  await flush();
  first.fail();
  await flush();
  expect(log.opens).toEqual([2]);
  expect(log.sleeps).toEqual([500]);
  second.push(delta(2, "Chào "), delta(3, "bạn"));
  await flush();
  runFrames();
  expect(store.get("k1")?.text).toBe("Chào bạn");
  expect(store.get("k1")?.phase).toBe("streaming");
});

test("C1-R06 · hết 5 lần → lost; Thử lại nối tiếp từ lastEventId", async () => {
  const { store, driver, first, log } = setup();
  await driver.send({ convId: "c", origin: "main", request: { content: "hi" } });
  first.push(started);
  first.close();
  await flush(30);
  expect(log.sleeps).toEqual([500, 1000, 2000, 4000, 8000]);
  expect(store.get("k1")?.phase).toBe("lost");
  driver.reconnect("k1");
  await flush(30);
  expect(log.opens).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
});

test("410 EVENTS_EXPIRED → onExpired, không thử tiếp", async () => {
  const { store, driver, first, log } = setup({
    open: async () => {
      throw new ApiError(410, "EVENTS_EXPIRED", "gone");
    },
  });
  await driver.send({ convId: "c", origin: "main", request: { content: "hi" } });
  first.push(started);
  first.close();
  await flush();
  expect(log.opens).toEqual([1]);
  expect(log.expired.map((r) => r.key)).toEqual(["k1"]);
  expect(store.get("k1")?.phase).not.toBe("lost");
});

test("409 FLOW_BUSY trước stream → ok:false, bỏ run", async () => {
  const { store, driver } = setup({
    send: async () => {
      throw new ApiError(409, "FLOW_BUSY", "busy");
    },
  });
  const out = await driver.send({
    convId: "c",
    origin: "flow",
    request: { content: "hi", flowId: FLOW },
  });
  expect(out.ok).toBe(false);
  expect(!out.ok && out.error.code).toBe("FLOW_BUSY");
  expect(store.getRuns()).toEqual([]);
});

test("UC-04 · Dừng gửi E15, không abort: nhận run.failed CANCELLED trên stream cũ", async () => {
  const { store, driver, first, log, runFrames } = setup();
  await driver.send({ convId: "c", origin: "main", request: { content: "hi" } });
  first.push(started, delta(2, "Dở"));
  await flush();
  runFrames();
  await driver.cancel("k1");
  expect(log.cancels).toEqual([RUN]);
  first.push(cancelled(3));
  first.close();
  await flush();
  expect(store.get("k1")?.phase).toBe("cancelled");
  expect(store.get("k1")?.text).toBe("Dở");
});

test("UC-08 · gắn lại run đang chạy: E13 từ 0, không gửi lại tin", async () => {
  const s = fakeStream();
  const { store, driver, log } = setup({ open: async () => s.body });
  const key = driver.attach({ convId: "c", runId: RUN, flowId: FLOW, origin: "flow" });
  expect(driver.attach({ convId: "c", runId: RUN, flowId: FLOW, origin: "flow" })).toBe(key);
  s.push(started, delta(2, "a"), finished(3, "a"));
  s.close();
  await flush();
  expect(log.opens).toEqual([0]);
  expect(store.get(key)?.phase).toBe("finished");
});

test("Chạy lại: ô chính → không flow_id; trong khung → cùng flow", async () => {
  const reqs: unknown[] = [];
  const { driver, store } = setup({
    send: async (_c, r) => {
      reqs.push(r);
      throw new ApiError(0, "NETWORK_ERROR", "x");
    },
  });
  const base = { key: "x", convId: "c", flowId: FLOW, request: { content: "lại" } } as RunState;
  await driver.retry({ ...base, origin: "main" });
  await driver.retry({ ...base, origin: "flow" });
  expect(reqs).toEqual([{ content: "lại" }, { content: "lại", flow_id: FLOW }]);
  expect(store.getRuns()).toEqual([]);
});

/** Stream Hub phát `chunks` rồi đóng êm (không lỗi, không sự kiện kết thúc hợp lệ). */
const closedStream = (...chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(ctl) {
      for (const x of chunks) ctl.enqueue(enc.encode(x));
      ctl.close();
    },
  });
/** `run.finished` sai schema (thiếu `content`) → parser bỏ, `lastEventId` đứng yên. */
const badFinished = 'id: 2\nevent: run.finished\ndata: {"run_id":"x"}\n\n';

test("review C1 #1 · Hub đóng stream không có sự kiện kết thúc, E14 vẫn running → 5 lần rồi lost", async () => {
  const { store, driver, first, log } = setup({
    open: async () => closedStream(),
    getRun: async () => ({ status: "running" }),
  });
  await driver.send({ convId: "c", origin: "main", request: { content: "hi" } });
  first.push(started);
  first.close();
  await flush(60);
  expect(log.sleeps).toEqual([500, 1000, 2000, 4000, 8000]);
  expect(log.opens).toEqual([1, 1, 1, 1, 1]);
  expect(store.get("k1")?.phase).toBe("lost");
});

test("review C1 #1 · sự kiện kết thúc sai schema bị phát lại mãi → không lặp vô hạn, tới lost", async () => {
  const { store, driver, first, log } = setup({
    open: async () => closedStream(badFinished),
    getRun: async () => ({ status: "running" }),
  });
  await driver.send({ convId: "c", origin: "main", request: { content: "hi" } });
  first.push(started);
  first.enqueueRaw(badFinished);
  first.close();
  await flush(60);
  expect(log.opens.length).toBe(5);
  expect(store.get("k1")?.phase).toBe("lost");
  expect(store.get("k1")?.lastEventId).toBe(1);
});

test("review C1 #1 · stream đóng chưa kết thúc, E14 báo đã xong → làm mới query + xoá, không nối lại", async () => {
  const { driver, first, log } = setup({ getRun: async () => ({ status: "finished" }) });
  await driver.send({ convId: "c", origin: "main", request: { content: "hi" } });
  first.push(started);
  first.enqueueRaw(badFinished);
  first.close();
  await flush();
  expect(log.getRuns).toBe(1);
  expect(log.opens).toEqual([]);
  expect(log.expired.map((r) => r.key)).toEqual(["k1"]);
});

test("review C1 m2 · run đã xong trên Hub: Dừng bị khoá (không gọi E15) trước khi onExpired", async () => {
  const { store, driver, first, log } = setup({ getRun: async () => ({ status: "finished" }) });
  await driver.send({ convId: "c", origin: "main", request: { content: "hi" } });
  first.push(started);
  first.enqueueRaw(badFinished);
  first.close();
  await flush();
  expect(log.expired[0]?.cancelling).toBe(true);
  await driver.cancel("k1");
  expect(log.cancels).toEqual([]);
  expect(store.get("k1")?.cancelling).toBe(true);
});

test("review C1 #1 · có sự kiện mới thì lượt nối lại hồi về đầu", async () => {
  let n = 0;
  const { store, driver, first, log } = setup({
    open: async () => {
      n++;
      return n === 2 ? closedStream(encodeSseEvent(delta(2, "a"))) : closedStream();
    },
    getRun: async () => ({ status: "running" }),
  });
  await driver.send({ convId: "c", origin: "main", request: { content: "hi" } });
  first.push(started);
  first.close();
  await flush(80);
  expect(log.sleeps).toEqual([500, 1000, 500, 1000, 2000, 4000, 8000]);
  expect(store.get("k1")?.phase).toBe("lost");
});
