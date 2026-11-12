// CR-132 · W1: một kết nối cho nhiều người nghe, đóng khi người nghe cuối huỷ, nối lại khi lỗi (đồng hồ giả, không sleep).
import { describe, expect, test } from "bun:test";
import { ApiError } from "@ai/web-kit/http";
import {
  createMeStream,
  type FrameHandler,
  reconnectDelay,
  type StreamTransport,
} from "./me-stream";

/** Transport giả: mỗi lần gọi = một kết nối, test điều khiển `open/emit/drop/fail`. */
function fake() {
  const conns: {
    signal: AbortSignal;
    emit: FrameHandler;
    open: () => void;
    drop: () => void;
    fail: (e: unknown) => void;
  }[] = [];
  const transport: StreamTransport = (signal, onOpen, onFrame) =>
    new Promise<void>((resolve, reject) => {
      conns.push({ signal, emit: onFrame, open: onOpen, drop: resolve, fail: reject });
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
  const waits: number[] = [];
  const releases: (() => void)[] = [];
  const wait = (ms: number) =>
    new Promise<void>((r) => {
      waits.push(ms);
      releases.push(r);
    });
  return { conns, transport, waits, releases, wait };
}
const tick = () => Promise.resolve().then(() => Promise.resolve());

describe("meStream", () => {
  test("nhiều người nghe ⇒ MỘT kết nối; phát đúng theo tên sự kiện", async () => {
    const f = fake();
    const s = createMeStream({ transport: f.transport, wait: f.wait });
    const a: string[] = [];
    const b: string[] = [];
    const c: string[] = [];
    s.subscribe("msg.new", (x) => a.push(x.data));
    s.subscribe("msg.new", (x) => b.push(x.data));
    s.subscribe("esign.updated", (x) => c.push(x.data));
    expect(f.conns.length).toBe(1);
    expect(s.active()).toBe(1);
    f.conns[0]?.emit({ event: "msg.new", data: "1" });
    f.conns[0]?.emit({ event: "esign.updated", data: "2" });
    f.conns[0]?.emit({ event: "ping", data: "3" });
    expect([a, b, c]).toEqual([["1"], ["1"], ["2"]]);
  });

  test("huỷ người nghe cuối ⇒ đóng; huỷ hai lần không giảm đếm; nghe lại ⇒ mở mới", async () => {
    const f = fake();
    const s = createMeStream({ transport: f.transport, wait: f.wait });
    const off1 = s.subscribe("msg.new", () => {});
    const off2 = s.subscribe("msg.read", () => {});
    off1();
    off1();
    expect(f.conns[0]?.signal.aborted).toBe(false);
    off2();
    expect(f.conns[0]?.signal.aborted).toBe(true);
    expect(s.active()).toBe(0);
    s.subscribe("msg.new", () => {});
    expect(f.conns.length).toBe(2);
  });

  test("lỗi mạng ⇒ nối lại giãn dần; mở lại sau đứt ⇒ onReconnected một lần; mở thành công đặt lại backoff", async () => {
    const f = fake();
    const s = createMeStream({ transport: f.transport, wait: f.wait });
    let re = 0;
    s.subscribe(
      "msg.new",
      () => {},
      () => re++,
    );
    f.conns[0]?.open();
    expect(re).toBe(0); // lần mở đầu không phải "nối lại"
    f.conns[0]?.fail(new TypeError("fetch failed"));
    await tick();
    expect(f.waits).toEqual([reconnectDelay(0)]);
    f.releases[0]?.();
    await tick();
    expect(f.conns.length).toBe(2);
    f.conns[1]?.fail(new TypeError("x")); // chưa mở được ⇒ giãn tiếp
    await tick();
    expect(f.waits).toEqual([1000, 2000]);
    f.releases[1]?.();
    await tick();
    f.conns[2]?.open();
    expect(re).toBe(1);
    f.conns[2]?.drop(); // stream đóng sạch ⇒ nối lại, backoff đã về 0
    await tick();
    expect(f.waits).toEqual([1000, 2000, 1000]);
  });

  test("huỷ trong lúc chờ nối lại ⇒ không mở kết nối mới", async () => {
    const f = fake();
    const s = createMeStream({ transport: f.transport, wait: f.wait });
    const off = s.subscribe("msg.new", () => {});
    f.conns[0]?.fail(new TypeError("x"));
    await tick();
    off();
    f.releases[0]?.();
    await tick();
    expect(f.conns.length).toBe(1);
  });

  test("lỗi 4xx (trừ 408/429) ⇒ dừng, không nối lại; người nghe mới mở lại được", async () => {
    const f = fake();
    const s = createMeStream({ transport: f.transport, wait: f.wait });
    s.subscribe("msg.new", () => {});
    f.conns[0]?.fail(new ApiError(403, "FORBIDDEN", ""));
    await tick();
    expect(f.waits).toEqual([]);
    expect(s.active()).toBe(0);
    s.subscribe("msg.read", () => {});
    expect(f.conns.length).toBe(2);
  });

  test("dừng do 4xx rồi người nghe mới mở lại ⇒ lần mở đó báo nối lại cho cả người nghe cũ (không lỡ tin/đếm)", async () => {
    const f = fake();
    const s = createMeStream({ transport: f.transport, wait: f.wait });
    let resyncs = 0;
    s.subscribe(
      "msg.new",
      () => {},
      () => resyncs++,
    );
    f.conns[0]?.open();
    f.conns[0]?.fail(new ApiError(403, "FORBIDDEN", ""));
    await tick();
    expect(resyncs).toBe(0);
    s.subscribe("msg.read", () => {});
    f.conns[1]?.open();
    expect(resyncs).toBe(1);
    f.conns[1]?.drop();
    await tick();
    f.releases[0]?.();
    await tick();
    f.conns[2]?.open(); // nối lại thường: một lần nữa
    expect(resyncs).toBe(2);
  });

  test("429 ⇒ vẫn nối lại", async () => {
    const f = fake();
    const s = createMeStream({ transport: f.transport, wait: f.wait });
    s.subscribe("msg.new", () => {});
    f.conns[0]?.fail(new ApiError(429, "RATE", ""));
    await tick();
    expect(f.waits).toEqual([1000]);
  });
});
