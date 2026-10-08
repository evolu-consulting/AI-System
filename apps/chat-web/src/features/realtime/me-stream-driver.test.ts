// HUB-FR-99, HUB-FR-100, X2a-AC08, X2a-AC12 · driver /me/stream với stream/đồng hồ giả.
import { expect, test } from "bun:test";
import type { MeStreamEvent } from "@ai/contracts/chat";
import { ApiError } from "~/lib/http";
import { readRawSse } from "./lib/read-raw-sse";
import { type MeStreamDeps, MeStreamDriver } from "./me-stream-driver";
import { createRealtimeStore } from "./realtime-store";

const ROOM = "00000000-0000-4000-8000-000000000001";
const enc = new TextEncoder();
const reset = "event: stream.reset\ndata: {}\n\n";
const deleted = (id: string) => `id: ${id}\nevent: room.deleted\ndata: {"room_id":"${ROOM}"}\n\n`;

type Step = { chunks: string[]; hang?: boolean } | Error;

function bodyOf(chunks: string[], hang: boolean, signal: AbortSignal) {
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const s of chunks) c.enqueue(enc.encode(s));
      if (hang) signal.addEventListener("abort", () => c.close(), { once: true });
      else c.close();
    },
  });
}

function setup(steps: Step[], hasRoomsData?: () => boolean) {
  const store = createRealtimeStore();
  const events: MeStreamEvent[] = [];
  const opens: (string | null)[] = [];
  const sleeps: number[] = [];
  const timers: (() => void)[] = [];
  let used = 0;
  let onDone: () => void = () => {};
  const done = new Promise<void>((r) => {
    onDone = r;
  });
  const deps: MeStreamDeps = {
    open: async (last, signal) => {
      opens.push(last);
      const step = steps[used++];
      if (!step) {
        onDone();
        return new Promise(() => {});
      }
      if (step instanceof Error) throw step;
      return bodyOf(step.chunks, step.hang ?? false, signal);
    },
    read: readRawSse,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    setTimer: (cb) => {
      timers.push(cb);
      return () => {};
    },
    onEvent: (e) => events.push(e),
    hasRoomsData,
  };
  return { store, driver: new MeStreamDriver(store, deps), events, opens, sleeps, timers, done };
}

test("mở với Last-Event-ID rỗng, ping đầu tiên → open, nối lại gửi id cuối", async () => {
  const t = setup([{ chunks: [": ping\n\n", deleted("5-0")] }, { chunks: [] }]);
  t.driver.start();
  await t.done;
  expect(t.opens).toEqual([null, "5-0", "5-0"]);
  expect(t.sleeps[0]).toBe(500);
  expect(t.events.map((e) => e.event)).toEqual(["room.deleted"]);
  t.driver.stop();
  expect(t.store.get()).toEqual({ phase: "idle", lastEventId: null });
});

test("phase: connecting → open ngay khi có byte đầu (kể cả ping)", async () => {
  const t = setup([{ chunks: [": ping\n\n"], hang: true }]);
  const phases: string[] = [];
  t.store.subscribe(() => phases.push(t.store.get().phase));
  t.driver.start();
  await Bun.sleep(5);
  expect(phases).toContain("open");
  t.driver.stop();
});

test("stream.reset xoá lastEventId và vẫn chuyển cho router", async () => {
  const t = setup([{ chunks: [deleted("7-0"), reset] }, { chunks: [] }]);
  t.driver.start();
  await t.done;
  expect(t.opens.slice(0, 2)).toEqual([null, null]);
  // reset thứ 2: đóng sạch khi chưa có id ⇒ nối lại phải nạp lại cache.
  expect(t.events.map((e) => e.event)).toEqual(["room.deleted", "stream.reset", "stream.reset"]);
  t.driver.stop();
});

test("khung hỏng / event lạ bị bỏ, không làm đứt luồng", async () => {
  const t = setup([
    { chunks: ["event: room.deleted\ndata: {oops\n\n", "event: x\ndata: {}\n\n", deleted("1-0")] },
  ]);
  t.driver.start();
  await t.done;
  expect(t.events).toHaveLength(1);
  t.driver.stop();
});

test("lỗi liên tiếp: backoff 0,5→8 s (trần), phase down từ lần 5, không bỏ cuộc", async () => {
  const err = new ApiError(0, "NETWORK_ERROR", "x");
  const t = setup([err, err, err, err, err, err, err]);
  t.driver.start();
  await t.done;
  expect(t.sleeps).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000]);
  expect(t.store.get().phase).toBe("down");
  t.driver.stop();
});

test("sau lỗi, phase reconnecting rồi open khi có byte", async () => {
  const err = new ApiError(0, "NETWORK_ERROR", "x");
  const t = setup([err, { chunks: [": ping\n\n"], hang: true }]);
  const phases: string[] = [];
  t.store.subscribe(() => phases.push(t.store.get().phase));
  t.driver.start();
  await Bun.sleep(10);
  expect(phases).toEqual(["connecting", "reconnecting", "open"]);
  t.driver.stop();
});

test("401 sau refresh: dừng hẳn, không nối lại", async () => {
  const t = setup([new ApiError(401, "UNAUTHORIZED", "x"), { chunks: [] }]);
  t.driver.start();
  await Bun.sleep(10);
  expect(t.opens).toHaveLength(1);
  expect(t.driver.running).toBe(false);
  expect(t.store.get().phase).toBe("idle");
});

test("quá hạn không có byte (ping-timeout) → huỷ kết nối và nối lại", async () => {
  const t = setup([{ chunks: [": ping\n\n"], hang: true }, { chunks: [] }]);
  t.driver.start();
  await Bun.sleep(5);
  expect(t.timers.length).toBeGreaterThan(0);
  t.timers.at(-1)?.();
  await t.done;
  expect(t.opens.length).toBeGreaterThanOrEqual(2);
  expect(t.sleeps[0]).toBe(500);
  t.driver.stop();
});

test("stop() đóng stream đang mở và không nối lại", async () => {
  const t = setup([{ chunks: [": ping\n\n"], hang: true }, { chunks: [] }]);
  t.driver.start();
  await Bun.sleep(5);
  t.driver.stop();
  await Bun.sleep(10);
  expect(t.opens).toHaveLength(1);
  expect(t.store.get().phase).toBe("idle");
});

test("nối lại khi chưa có lastEventId: báo stream.reset để nạp lại cache; lần đầu thì không", async () => {
  const err = new ApiError(0, "NETWORK_ERROR", "x");
  const t = setup([err, { chunks: [": ping\n\n"], hang: true }]);
  t.driver.start();
  await Bun.sleep(10);
  expect(t.events.map((e) => e.event)).toEqual(["stream.reset"]);
  t.driver.stop();
  const first = setup([{ chunks: [": ping\n\n"], hang: true }]);
  first.driver.start();
  await Bun.sleep(10);
  expect(first.events).toEqual([]);
  first.driver.stop();
});

test("nối lại khi đã có lastEventId: không giả stream.reset (server phát bù)", async () => {
  const err = new ApiError(0, "NETWORK_ERROR", "x");
  const t = setup([{ chunks: [deleted("1-0")] }, err, { chunks: [": ping\n\n"], hang: true }]);
  t.driver.start();
  await Bun.sleep(10);
  expect(t.events.map((e) => e.event)).toEqual(["room.deleted"]);
  t.driver.stop();
});

test("RV1 #2: lần nối đầu connecting→open mà cache phòng đã có dữ liệu ⇒ stream.reset; chưa có ⇒ không", async () => {
  const t = setup([{ chunks: [": ping\n\n"], hang: true }], () => true);
  t.driver.start();
  await Bun.sleep(10);
  expect(t.events.map((e) => e.event)).toEqual(["stream.reset"]);
  t.driver.stop();
  const empty = setup([{ chunks: [": ping\n\n"], hang: true }], () => false);
  empty.driver.start();
  await Bun.sleep(10);
  expect(empty.events).toEqual([]);
  empty.driver.stop();
});

test("RV1 #7: server đóng sạch sau khi open (hết hạn token) ⇒ nối lại ngay, không banner reconnecting, không backoff", async () => {
  const t = setup([{ chunks: [deleted("3-0")] }, { chunks: [": ping\n\n"], hang: true }]);
  const phases: string[] = [];
  t.store.subscribe(() => phases.push(t.store.get().phase));
  t.driver.start();
  await Bun.sleep(10);
  expect(t.opens).toEqual([null, "3-0"]);
  expect(t.sleeps).toEqual([]);
  expect(phases).not.toContain("reconnecting");
  expect(phases).not.toContain("down");
  expect(t.store.get().phase).toBe("open");
  t.driver.stop();
});

test("RV1 #7: đóng sạch quá nhanh liên tục ⇒ tính là sự cố (backoff, không vòng nóng)", async () => {
  const quick = { chunks: [deleted("3-0")] };
  const t = setup([quick, quick, quick, quick, quick, quick]);
  t.driver.start();
  await t.done;
  expect(t.sleeps.length).toBeGreaterThan(0);
  t.driver.stop();
});
