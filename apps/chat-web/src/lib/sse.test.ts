// UC-08 · readEvents: chunk cắt giữa sự kiện/giữa ký tự UTF-8, bỏ ping và sự kiện hỏng, dừng khi huỷ.
import { describe, expect, test } from "bun:test";
import { type ChatEvent, encodeSseEvent } from "@ai/contracts/chat";
import { readEvents } from "./sse";

const enc = new TextEncoder();

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });
}

const delta = (id: number, text: string): ChatEvent => ({ id, event: "delta", data: { text } });

describe("readEvents", () => {
  test("ghép chunk cắt ngang (kể cả giữa byte UTF-8), bỏ ping và sự kiện sai schema", async () => {
    const bytes = enc.encode(
      `${encodeSseEvent(delta(1, "Hoá đơn"))}: ping\n\nid: 2\nevent: delta\ndata: {"bad":1}\n\n${encodeSseEvent(delta(3, "ổn"))}`,
    );
    const chunks = Array.from({ length: Math.ceil(bytes.length / 5) }, (_, i) =>
      bytes.slice(i * 5, i * 5 + 5),
    );
    const got: ChatEvent[] = [];
    await readEvents(streamOf(chunks), (e) => got.push(e));
    expect(got).toEqual([delta(1, "Hoá đơn"), delta(3, "ổn")]);
  });

  test("lỗi đọc giữa chừng được ném ra để nối lại", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        // `error()` xoá hàng đợi → báo lỗi ở lần đọc sau, như mạng đứt sau khi đã nhận dữ liệu.
        if (pulls++ === 0) c.enqueue(enc.encode(encodeSseEvent(delta(1, "a"))));
        else c.error(new TypeError("network"));
      },
    });
    const got: ChatEvent[] = [];
    await expect(readEvents(body, (e) => got.push(e))).rejects.toThrow("network");
    expect(got.length).toBe(1);
  });

  test("signal huỷ → trả về, không phát thêm", async () => {
    const ctrl = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(encodeSseEvent(delta(1, "a"))));
      },
    });
    const got: ChatEvent[] = [];
    const p = readEvents(
      body,
      (e) => {
        got.push(e);
        ctrl.abort();
      },
      ctrl.signal,
    );
    await p;
    expect(got.length).toBe(1);
  });
});
